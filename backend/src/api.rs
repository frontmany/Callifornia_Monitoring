//! REST API backend for monitoring service.

use std::collections::HashMap;
use std::path::Path as StdPath;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use tokio::fs;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use crate::db;

#[derive(Clone)]
struct AppState {
    pool: Arc<PgPool>,
    reports_dir: String,
    db_connected: Arc<AtomicBool>,
    source_statuses: Arc<RwLock<HashMap<i64, SourceRuntimeStatus>>>,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct RealtimeMetricsResponse {
    pub servers: Vec<ServerRealtime>,
}

#[derive(Debug, Serialize)]
pub struct ServerRealtime {
    pub id: i64,
    pub host: String,
    pub port: String,
    pub status: String,
    pub last_change: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub metrics: Option<HashMap<String, f64>>,
    pub recorded_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceRuntimeStatus {
    pub server_id: i64,
    pub host: String,
    pub port: String,
    pub connected: bool,
    pub last_change: DateTime<Utc>,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ServiceStatusResponse {
    pub status: String,
    pub db_connected: bool,
    pub sources_total: usize,
    pub sources_connected: usize,
    pub sources: Vec<SourceRuntimeStatus>,
}

#[derive(Debug, Serialize)]
pub struct ReportSummaryResponse {
    id: Uuid,
    server_id: i64,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
    created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct ReportResponse {
    id: Uuid,
    server: ReportServer,
    period: ReportPeriod,
    metrics: HashMap<String, ReportMetricStats>,
    created_at: Option<DateTime<Utc>>,
}

/// Report file JSON structure.
#[derive(Debug, Serialize)]
struct ReportFile {
    server: ReportServer,
    period: ReportPeriod,
    metrics: HashMap<String, ReportMetricStats>,
}

#[derive(Debug, Serialize)]
struct ReportServer {
    host: String,
    port: String,
}

#[derive(Debug, Serialize)]
struct ReportPeriod {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
struct ReportMetricStats {
    avg: f64,
    min: f64,
    min_at: DateTime<Utc>,
    max: f64,
    max_at: DateTime<Utc>,
    count: i64,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

fn db_unavailable_response() -> axum::response::Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse {
            error: "Database is temporarily unavailable. Service is running in degraded mode."
                .to_string(),
        }),
    )
        .into_response()
}

fn ensure_db_available(state: &AppState) -> Option<axum::response::Response> {
    if !state.db_connected.load(Ordering::SeqCst) {
        return Some(db_unavailable_response());
    }
    None
}

async fn get_status(State(state): State<AppState>) -> impl IntoResponse {
    let db_connected = state.db_connected.load(Ordering::SeqCst);
    let sources = {
        let guard = state.source_statuses.read().await;
        let mut v: Vec<SourceRuntimeStatus> = guard.values().cloned().collect();
        v.sort_by_key(|s| s.server_id);
        v
    };
    let sources_total = sources.len();
    let sources_connected = sources.iter().filter(|s| s.connected).count();
    let status = if db_connected && sources_total > 0 && sources_connected == sources_total {
        "healthy"
    } else if db_connected {
        "degraded"
    } else {
        "degraded"
    };

    (
        StatusCode::OK,
        Json(ServiceStatusResponse {
            status: status.to_string(),
            db_connected,
            sources_total,
            sources_connected,
            sources,
        }),
    )
        .into_response()
}

async fn get_servers(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(resp) = ensure_db_available(&state) {
        return resp;
    }

    match db::list_servers(&state.pool).await {
        Ok(servers) => (StatusCode::OK, Json(servers)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn get_metrics_all(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(resp) = ensure_db_available(&state) {
        return resp;
    }

    let servers = match db::list_servers(&state.pool).await {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    let all_metrics = match db::get_metrics_all(&state.pool).await {
        Ok(m) => m,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    // Group metrics by server_id
    let mut by_server: HashMap<i64, (HashMap<String, f64>, DateTime<Utc>)> = HashMap::new();
    for mv in all_metrics {
        let entry = by_server.entry(mv.server_id).or_default();
        entry.0.insert(mv.metric_name.clone(), mv.value);
        if mv.time > entry.1 {
            entry.1 = mv.time;
        }
    }

    let status_snapshot = { state.source_statuses.read().await.clone() };
    let servers_realtime: Vec<ServerRealtime> = servers
        .into_iter()
        .map(|s| {
            let src = status_snapshot.get(&s.id);
            let (connected, last_change, last_error) = match src {
                Some(v) => (v.connected, Some(v.last_change), v.last_error.clone()),
                None => (false, None, Some("source status unknown".to_string())),
            };

            if !connected {
                return ServerRealtime {
                    id: s.id,
                    host: s.host,
                    port: s.port,
                    status: "down".to_string(),
                    last_change,
                    last_error,
                    metrics: None,
                    recorded_at: None,
                };
            }

            let (metrics, recorded_at) = by_server.remove(&s.id).unwrap_or_else(|| (HashMap::new(), Utc::now()));
            ServerRealtime {
                id: s.id,
                host: s.host,
                port: s.port,
                status: "up".to_string(),
                last_change,
                last_error,
                metrics: Some(metrics),
                recorded_at: Some(recorded_at),
            }
        })
        .collect();

    (
        StatusCode::OK,
        Json(RealtimeMetricsResponse {
            servers: servers_realtime,
        }),
    )
        .into_response()
}

async fn get_metrics_for_server(
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
) -> impl IntoResponse {
    if let Some(resp) = ensure_db_available(&state) {
        return resp;
    }

    let servers = match db::list_servers(&state.pool).await {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    let server = servers.into_iter().find(|s| s.id == server_id);
    let Some(server) = server else {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Server not found".to_string(),
            }),
        )
            .into_response();
    };

    let src = { state.source_statuses.read().await.get(&server_id).cloned() };
    let (connected, last_change, last_error) = match src {
        Some(v) => (v.connected, Some(v.last_change), v.last_error.clone()),
        None => (false, None, Some("source status unknown".to_string())),
    };

    if !connected {
        return (
            StatusCode::OK,
            Json(ServerRealtime {
                id: server.id,
                host: server.host,
                port: server.port,
                status: "down".to_string(),
                last_change,
                last_error,
                metrics: None,
                recorded_at: None,
            }),
        )
            .into_response();
    }

    let metrics = match db::get_metrics_for_server(&state.pool, server_id).await {
        Ok(m) => m,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    let metrics_map: HashMap<String, f64> = metrics
        .iter()
        .map(|m| (m.metric_name.clone(), m.value))
        .collect();
    let recorded_at = metrics
        .first()
        .map(|m| m.time)
        .unwrap_or_else(Utc::now);

    (
        StatusCode::OK,
        Json(ServerRealtime {
            id: server.id,
            host: server.host,
            port: server.port,
            status: "up".to_string(),
            last_change,
            last_error,
            metrics: Some(metrics_map),
            recorded_at: Some(recorded_at),
        }),
    )
        .into_response()
}

async fn list_reports(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(resp) = ensure_db_available(&state) {
        return resp;
    }

    match db::list_reports(&state.pool).await {
        Ok(reports) => {
            let resp: Vec<ReportSummaryResponse> = reports
                .into_iter()
                .map(|r| ReportSummaryResponse {
                    id: r.id,
                    server_id: r.server_id,
                    period_start: r.period_start,
                    period_end: r.period_end,
                    created_at: r.created_at,
                })
                .collect();
            (StatusCode::OK, Json(resp)).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn get_report(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    if let Some(resp) = ensure_db_available(&state) {
        return resp;
    }

    let report = match db::get_report_by_id(&state.pool, id).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Report not found".to_string(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    let server = match db::get_server_by_id(&state.pool, report.server_id).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Server not found".to_string(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    let aggregates = match db::get_metric_aggregates_for_period(
        &state.pool,
        report.server_id,
        report.period_start,
        report.period_end,
    )
    .await
    {
        Ok(a) => a,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    let metrics: HashMap<String, ReportMetricStats> = aggregates
        .into_iter()
        .map(|a| {
            (
                a.metric_name,
                ReportMetricStats {
                    avg: a.avg,
                    min: a.min,
                    min_at: a.min_at,
                    max: a.max,
                    max_at: a.max_at,
                    count: a.count,
                },
            )
        })
        .collect();

    (
        StatusCode::OK,
        Json(ReportResponse {
            id: report.id,
            server: ReportServer {
                host: server.host,
                port: server.port,
            },
            period: ReportPeriod {
                start: report.period_start,
                end: report.period_end,
            },
            metrics,
            created_at: report.created_at,
        }),
    )
        .into_response()
}

async fn create_report(
    State(state): State<AppState>,
    Json(payload): Json<db::CreateReport>,
) -> impl IntoResponse {
    if let Some(resp) = ensure_db_available(&state) {
        return resp;
    }

    let server = match db::get_server_by_id(&state.pool, payload.server_id).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Server not found".to_string(),
                }),
            )
            .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
            .into_response()
        }
    };

    let aggregates = match db::get_metric_aggregates_for_period(
        &state.pool,
        payload.server_id,
        payload.period_start,
        payload.period_end,
    )
    .await
    {
        Ok(a) => a,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    let metrics: HashMap<String, ReportMetricStats> = aggregates
        .into_iter()
        .map(|a| {
            (
                a.metric_name,
                ReportMetricStats {
                    avg: a.avg,
                    min: a.min,
                    min_at: a.min_at,
                    max: a.max,
                    max_at: a.max_at,
                    count: a.count,
                },
            )
        })
        .collect();

    let report_file = ReportFile {
        server: ReportServer {
            host: server.host.clone(),
            port: server.port.clone(),
        },
        period: ReportPeriod {
            start: payload.period_start,
            end: payload.period_end,
        },
        metrics: metrics.clone(),
    };

    let start_date = payload.period_start.format("%Y-%m-%d").to_string();
    let end_date = payload.period_end.format("%Y-%m-%d").to_string();
    let filename = format!("{}_{}_{}.json", server.host, start_date, end_date);
    let file_path = StdPath::new(&state.reports_dir).join(&filename);
    let file_path_str = file_path.to_string_lossy().into_owned();

    if let Err(e) = fs::create_dir_all(&state.reports_dir).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to create reports directory: {}", e),
            }),
        )
        .into_response();
    }

    let json = match serde_json::to_string_pretty(&report_file) {
        Ok(j) => j,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to serialize report: {}", e),
                }),
            )
            .into_response()
        }
    };

    if let Err(e) = fs::write(&file_path, json).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to write report file: {}", e),
            }),
        )
            .into_response();
    }

    match db::create_report(&state.pool, &payload, &file_path_str).await {
        Ok(report) => (
            StatusCode::CREATED,
            Json(ReportResponse {
                id: report.id,
                server: ReportServer {
                    host: server.host,
                    port: server.port,
                },
                period: ReportPeriod {
                    start: payload.period_start,
                    end: payload.period_end,
                },
                metrics,
                created_at: report.created_at,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn update_report(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<db::UpdateReport>,
) -> impl IntoResponse {
    if let Some(resp) = ensure_db_available(&state) {
        return resp;
    }

    let updated = match db::update_report(&state.pool, id, &payload).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Report not found".to_string(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    // Return the same shape as GET /api/reports/{id}: recompute aggregates for updated period/server.
    let server = match db::get_server_by_id(&state.pool, updated.server_id).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Server not found".to_string(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    let aggregates = match db::get_metric_aggregates_for_period(
        &state.pool,
        updated.server_id,
        updated.period_start,
        updated.period_end,
    )
    .await
    {
        Ok(a) => a,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
                .into_response()
        }
    };

    let metrics: HashMap<String, ReportMetricStats> = aggregates
        .into_iter()
        .map(|a| {
            (
                a.metric_name,
                ReportMetricStats {
                    avg: a.avg,
                    min: a.min,
                    min_at: a.min_at,
                    max: a.max,
                    max_at: a.max_at,
                    count: a.count,
                },
            )
        })
        .collect();

    (
        StatusCode::OK,
        Json(ReportResponse {
            id: updated.id,
            server: ReportServer {
                host: server.host,
                port: server.port,
            },
            period: ReportPeriod {
                start: updated.period_start,
                end: updated.period_end,
            },
            metrics,
            created_at: updated.created_at,
        }),
    )
        .into_response()
}

async fn delete_report(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    if let Some(resp) = ensure_db_available(&state) {
        return resp;
    }

    match db::delete_report(&state.pool, id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Report not found".to_string(),
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router(
    pool: Arc<PgPool>,
    reports_dir: String,
    db_connected: Arc<AtomicBool>,
    source_statuses: Arc<RwLock<HashMap<i64, SourceRuntimeStatus>>>,
) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/status", get(get_status))
        .route("/api/servers", get(get_servers))
        .route("/api/servers/metrics", get(get_metrics_all))
        .route("/api/servers/{server_id}/metrics", get(get_metrics_for_server))
        .route("/api/reports", get(list_reports).post(create_report))
        .route(
            "/api/reports/{id}",
            get(get_report).put(update_report).delete(delete_report),
        )
        .with_state(AppState {
            pool,
            reports_dir,
            db_connected,
            source_statuses,
        })
        .layer(cors)
}
