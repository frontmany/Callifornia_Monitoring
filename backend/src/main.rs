mod api;
mod data_requester;
mod db;
mod tcp_client;
mod tcp_packet;
mod tcp_packet_type;

use std::collections::HashMap;
use std::env;
use std::process;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use chrono::{DateTime, Utc};
use dotenvy::dotenv;
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tokio::sync::RwLock;
use tokio::time::Duration;

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
struct ServerRuntimePayload {
    #[serde(rename = "active_users")]
    active_users: u64,
    #[serde(rename = "active_calls")]
    active_calls: u64,
    #[serde(rename = "active_meetings")]
    active_meetings: u64,
    #[serde(rename = "pending_calls")]
    pending_calls: u64,
    #[serde(rename = "pending_meeting_requests")]
    pending_meeting_requests: u64,
    #[serde(rename = "uptime_sec")]
    uptime_sec: u64,
}

impl Default for ServerRuntimePayload {
    fn default() -> Self {
        Self {
            active_users: 0,
            active_calls: 0,
            active_meetings: 0,
            pending_calls: 0,
            pending_meeting_requests: 0,
            uptime_sec: 0,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct ProcessPayload {
    pid: u32,
    name: String,
    #[serde(rename = "cpu_usage")]
    cpu_usage_percent: f64,
    #[serde(rename = "memory_rss")]
    memory_rss_bytes: u64,
    threads: u32,
    fd_count: u32,
    uptime_sec: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct GetMetricsResult {
    #[serde(rename = "recorded_at")]
    recorded_at: DateTime<Utc>,
    #[serde(rename = "cpu_usage")]
    cpu_usage_percent: f64,
    #[serde(rename = "memory_used")]
    memory_used_bytes: u64,
    #[serde(rename = "memory_available")]
    memory_available_bytes: u64,
    #[serde(default)]
    #[serde(rename = "server_runtime")]
    server_runtime: ServerRuntimePayload,
    #[serde(default)]
    processes: Vec<ProcessPayload>,
}

impl From<GetMetricsResult> for db::Metrics {
    fn from(m: GetMetricsResult) -> Self {
        Self {
            recorded_at: m.recorded_at,
            cpu_usage_percent: m.cpu_usage_percent,
            memory_used_bytes: m.memory_used_bytes,
            memory_available_bytes: m.memory_available_bytes,
            active_users: m.server_runtime.active_users,
            active_calls: m.server_runtime.active_calls,
            active_meetings: m.server_runtime.active_meetings,
            pending_calls: m.server_runtime.pending_calls,
            pending_meeting_requests: m.server_runtime.pending_meeting_requests,
            uptime_sec: m.server_runtime.uptime_sec,
        }
    }
}

fn parse_server_addr(addr: &str) -> (String, String) {
    let parts: Vec<&str> = addr.splitn(2, ':').collect();
    let host = parts[0].to_string();
    let port = parts.get(1).map(|s| (*s).to_string()).unwrap_or_else(|| "8081".to_string());
    (host, port)
}

fn on_metrics_received(
    pool: Arc<PgPool>,
    metric_ids: Arc<RwLock<HashMap<String, i16>>>,
    db_connected: Arc<AtomicBool>,
    latest_metrics: Arc<RwLock<HashMap<i64, api::LatestServerMetrics>>>,
    server_id: i64,
    server_addr: String,
) -> impl Fn(Vec<u8>) + Send + Sync + 'static {
    move |data: Vec<u8>| {
        let body = match String::from_utf8(data) {
            Ok(s) => s,
            Err(e) => {
                let invalid = e.as_bytes();
                let n = invalid.len();
                println!("Received {} bytes (invalid UTF-8): {:?}", n, &invalid[..n.min(64)]);
                return;
            }
        };

        match serde_json::from_str::<GetMetricsResult>(&body) {
            Ok(metrics) => {
                let mem_used_mb = metrics.memory_used_bytes as f64 / 1_048_576.0;
                let mem_avail_mb = metrics.memory_available_bytes as f64 / 1_048_576.0;
                tracing::info!(
                    "Metrics | CPU: {:.1}% | Memory: {:.2} MB used, {:.2} MB available | Active users: {} | Active calls: {} | Active meetings: {} | Pending calls: {} | Pending requests: {} | Processes: {}",
                    metrics.cpu_usage_percent,
                    mem_used_mb,
                    mem_avail_mb,
                    metrics.server_runtime.active_users,
                    metrics.server_runtime.active_calls,
                    metrics.server_runtime.active_meetings,
                    metrics.server_runtime.pending_calls,
                    metrics.server_runtime.pending_meeting_requests,
                    metrics.processes.len(),
                );

                let pool = Arc::clone(&pool);
                let metric_ids = Arc::clone(&metric_ids);
                let db_connected = Arc::clone(&db_connected);
                let latest_metrics = Arc::clone(&latest_metrics);
                let (server_host, server_port) = parse_server_addr(&server_addr);
                let metrics_for_db = db::Metrics::from(metrics.clone());
                let latest_payload = api::LatestServerMetrics {
                    recorded_at: metrics.recorded_at,
                    server_runtime: api::ServerRuntime {
                        active_users: metrics.server_runtime.active_users,
                        active_calls: metrics.server_runtime.active_calls,
                        active_meetings: metrics.server_runtime.active_meetings,
                        pending_calls: metrics.server_runtime.pending_calls,
                        pending_meeting_requests: metrics.server_runtime.pending_meeting_requests,
                        uptime_sec: metrics.server_runtime.uptime_sec,
                    },
                    processes: metrics
                        .processes
                        .iter()
                        .map(|p| api::ProcessMetrics {
                            pid: p.pid,
                            name: p.name.clone(),
                            cpu_usage: p.cpu_usage_percent,
                            memory_rss: p.memory_rss_bytes,
                            threads: p.threads,
                            fd_count: p.fd_count,
                            uptime_sec: p.uptime_sec,
                        })
                        .collect(),
                };

                tokio::spawn(async move {
                    {
                        let mut guard = latest_metrics.write().await;
                        guard.insert(server_id, latest_payload);
                    }

                    if !db_connected.load(Ordering::SeqCst) {
                        tracing::warn!("DB unavailable: metric batch received but not persisted");
                        return;
                    }

                    let ids_snapshot = {
                        let ids = metric_ids.read().await;
                        ids.clone()
                    };

                    if ids_snapshot.is_empty() {
                        tracing::warn!("Metric IDs are not loaded yet: skipping metric persist");
                        return;
                    }

                    if let Err(e) = db::insert_metrics(
                        &pool,
                        &ids_snapshot,
                        &server_host,
                        &server_port,
                        &metrics_for_db,
                    ).await
                    {
                        tracing::error!("DB insert failed: {}", e);
                        db_connected.store(false, Ordering::SeqCst);
                    }
                });
            }
            Err(_) => {
                println!("Received (not GetMetricsResult JSON): {}", body);
            }
        }
    }
}

fn exit_error(msg: &str) -> ! {
    eprintln!("Error: {}", msg);
    process::exit(1);
}

fn spawn_db_supervisor(
    pool: Arc<PgPool>,
    metric_ids: Arc<RwLock<HashMap<String, i16>>>,
    db_connected: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        loop {
            let ping_ok = sqlx::query_scalar::<_, i32>("SELECT 1")
                .fetch_one(pool.as_ref())
                .await
                .is_ok();

            if ping_ok {
                if !db_connected.swap(true, Ordering::SeqCst) {
                    tracing::info!("Database connectivity restored");
                }

                let need_metric_ids = {
                    let ids = metric_ids.read().await;
                    ids.is_empty()
                };

                if need_metric_ids {
                    match db::load_metric_ids_by_name(pool.as_ref()).await {
                        Ok(ids) => {
                            let len = ids.len();
                            {
                                let mut guard = metric_ids.write().await;
                                *guard = ids;
                            }
                            tracing::info!("Loaded {} metric IDs from database", len);
                        }
                        Err(e) => {
                            tracing::warn!("Failed to load metric IDs: {}", e);
                        }
                    }
                }
            } else if db_connected.swap(false, Ordering::SeqCst) {
                tracing::warn!("Database became unavailable, service is in degraded mode");
            }

            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

#[tokio::main]
async fn main() {
    dotenv().ok();

    tracing_subscriber::fmt().with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tracing::info!("Starting monitoring service...");

    let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {exit_error("DATABASE_URL is not set. Add it to .env or set the environment variable.");});
    let api_port = env::var("API_PORT").unwrap_or_else(|_| "3000".to_string());
    let reports_dir = env::var("REPORTS_DIR").unwrap_or_else(|_| "reports".to_string());

    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to connect to database: {}", e);
            process::exit(1);
        }
    };

    let pool = Arc::new(pool);
    let metric_ids = Arc::new(RwLock::new(HashMap::new()));
    let db_connected = Arc::new(AtomicBool::new(false));
    db_connected.store(true, Ordering::SeqCst);

    // При старте загружаем IDs метрик: без этого запись метрик невозможна.
    match db::load_metric_ids_by_name(pool.as_ref()).await {
        Ok(ids) => {
            let len = ids.len();
            {
                let mut guard = metric_ids.write().await;
                *guard = ids;
            }
            tracing::info!("Loaded {} metric IDs from database", len);
        }
        Err(e) => {
            eprintln!("Failed to load metric IDs from database: {}", e);
            process::exit(1);
        }
    }

    // Supervisor по-прежнему следит за доступностью БД и перечитывает metric_ids,
    // но старт сервиса невозможен без успешного подключения к БД (см. выше).
    spawn_db_supervisor(
        Arc::clone(&pool),
        Arc::clone(&metric_ids),
        Arc::clone(&db_connected),
    );

    // Загрузка списка серверов из БД и запуск сборщиков метрик для каждого.
    let servers = match db::list_servers(pool.as_ref()).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to load servers from database: {}", e);
            process::exit(1);
        }
    };

    if servers.is_empty() {
        tracing::warn!("No servers found in database; metrics collection will not start");
    }

    let source_statuses: Arc<RwLock<HashMap<i64, api::SourceRuntimeStatus>>> =
        Arc::new(RwLock::new(HashMap::new()));
    let latest_metrics: Arc<RwLock<HashMap<i64, api::LatestServerMetrics>>> =
        Arc::new(RwLock::new(HashMap::new()));
    {
        let mut guard = source_statuses.write().await;
        let now = Utc::now();
        for s in &servers {
            guard.insert(
                s.id,
                api::SourceRuntimeStatus {
                    server_id: s.id,
                    host: s.host.clone(),
                    port: s.port.clone(),
                    connected: false,
                    last_change: now,
                    last_error: Some("not connected yet".to_string()),
                },
            );
        }
    }

    let mut data_requesters = Vec::new();
    for server in &servers {
        let server_addr = format!("{}:{}", server.host, server.port);
        let server_id = server.id;
        let host = server.host.clone();
        let port = server.port.clone();
        let statuses = Arc::clone(&source_statuses);
        let requester = data_requester::DataRequester::new(
            &server_addr,
            5,
            on_metrics_received(
                Arc::clone(&pool),
                Arc::clone(&metric_ids),
                Arc::clone(&db_connected),
                Arc::clone(&latest_metrics),
                server_id,
                server_addr.clone(),
            ),
            move |connected: bool, err: Option<String>| {
                let statuses = Arc::clone(&statuses);
                let host = host.clone();
                let port = port.clone();
                tokio::spawn(async move {
                    let mut guard = statuses.write().await;
                    let now = Utc::now();
                    let entry = guard.entry(server_id).or_insert(api::SourceRuntimeStatus {
                        server_id,
                        host,
                        port,
                        connected,
                        last_change: now,
                        last_error: err.clone(),
                    });
                    if entry.connected != connected {
                        entry.connected = connected;
                        entry.last_change = now;
                    }
                    entry.last_error = err;
                });
            },
        );

        if let Err(e) = requester.start().await {
            eprintln!(
                "Failed to start metrics collector for {}:{}: {}",
                server.host, server.port, e
            );
            process::exit(1);
        }

        data_requesters.push(requester);
    }

    let app = api::router(
        pool,
        reports_dir,
        db_connected,
        source_statuses,
        latest_metrics,
    );
    
    let bind_addr = format!("0.0.0.0:{}", api_port);
    let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind API server to {}: {}", bind_addr, e);
            eprintln!("  Check that port {} is not in use.", api_port);
            process::exit(1);
        }
    };
    tracing::info!("API server listening on http://{}", bind_addr);
    tracing::info!("Endpoints: GET /api/servers, GET /api/servers/metrics, GET /api/servers/{{server_id}}/metrics");
    tracing::info!("Reports: GET/POST /api/reports, GET/PUT/DELETE /api/reports/{{id}}");
    tracing::info!("Status: GET /api/status");

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("API server error: {}", e);
        process::exit(1);
    }

    for requester in data_requesters {
        requester.stop().await;
    }
    tracing::info!("Stopped.");
}