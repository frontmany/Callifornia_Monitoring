use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Metrics {
    pub recorded_at: DateTime<Utc>,
    pub cpu_usage_percent: f64,
    pub memory_used_bytes: u64,
    pub memory_available_bytes: u64,
    pub active_users: u64,
}

pub async fn load_metric_ids_by_name(pool: &PgPool) -> anyhow::Result<HashMap<String, i16>> {
    let rows: Vec<(i16, String)> = sqlx::query_as("SELECT id, name FROM metrics")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|(id, name)| (name, id)).collect())
}

pub async fn get_server_id(pool: &PgPool, host: &str) -> anyhow::Result<Option<i64>> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT id FROM servers WHERE host = $1")
        .bind(host)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(id,)| id))
}

pub async fn add_server(pool: &PgPool, host: &str, port: &str) -> anyhow::Result<i64> {
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO servers (host, port) VALUES ($1, $2) ON CONFLICT (host) DO UPDATE SET port = EXCLUDED.port RETURNING id",
    )
    .bind(host)
    .bind(port)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn insert_metrics(
    pool: &PgPool,
    metric_ids: &HashMap<String, i16>,
    server_host: &str,
    server_port: &str,
    m: &Metrics,
) -> anyhow::Result<()> {
    let server_id = match get_server_id(pool, server_host).await? {
        Some(id) => id,
        None => add_server(pool, server_host, server_port).await?,
    };
    let time = m.recorded_at;

    let cpu_id = *metric_ids
        .get("cpu_usage")
        .ok_or_else(|| anyhow::anyhow!("metric 'cpu_usage' not found in database"))?;
    let mem_used_id = *metric_ids
        .get("memory_used")
        .ok_or_else(|| anyhow::anyhow!("metric 'memory_used' not found in database"))?;
    let mem_avail_id = *metric_ids
        .get("memory_available")
        .ok_or_else(|| anyhow::anyhow!("metric 'memory_available' not found in database"))?;
    let users_id = *metric_ids
        .get("active_users")
        .ok_or_else(|| anyhow::anyhow!("metric 'active_users' not found in database"))?;

    sqlx::query(
        r#"
        INSERT INTO metric_values (time, server_id, metric_id, value)
        VALUES ($1, $2, $3, $4), ($1, $2, $5, $6), ($1, $2, $7, $8), ($1, $2, $9, $10)
        "#,
    )
    .bind(time)
    .bind(server_id)
    .bind(cpu_id)
    .bind(m.cpu_usage_percent)
    .bind(mem_used_id)
    .bind(m.memory_used_bytes as f64)
    .bind(mem_avail_id)
    .bind(m.memory_available_bytes as f64)
    .bind(users_id)
    .bind(m.active_users as f64)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Servers & realtime metrics
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Server {
    pub id: i64,
    pub host: String,
    pub port: String,
    pub is_active: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ServerMetricValue {
    pub server_id: i64,
    pub metric_id: i16,
    pub metric_name: String,
    pub value: f64,
    pub time: DateTime<Utc>,
}

pub async fn list_servers(pool: &PgPool) -> anyhow::Result<Vec<Server>> {
    let rows = sqlx::query_as::<_, Server>(
        "SELECT id, host, port, is_active FROM servers ORDER BY id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Latest metric values per server.
pub async fn get_metrics_for_server(
    pool: &PgPool,
    server_id: i64,
) -> anyhow::Result<Vec<ServerMetricValue>> {
    let rows = sqlx::query_as::<_, ServerMetricValue>(
        r#"
        SELECT DISTINCT ON (mv.server_id, mv.metric_id)
            mv.server_id, mv.metric_id, m.name AS metric_name, mv.value, mv.time
        FROM metric_values mv
        JOIN metrics m ON m.id = mv.metric_id
        WHERE mv.server_id = $1
        ORDER BY mv.server_id, mv.metric_id, mv.time DESC
        "#,
    )
    .bind(server_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Latest metric values for all servers.
pub async fn get_metrics_all(pool: &PgPool) -> anyhow::Result<Vec<ServerMetricValue>> {
    let rows = sqlx::query_as::<_, ServerMetricValue>(
        r#"
        SELECT DISTINCT ON (mv.server_id, mv.metric_id)
            mv.server_id, mv.metric_id, m.name AS metric_name, mv.value, mv.time
        FROM metric_values mv
        JOIN metrics m ON m.id = mv.metric_id
        ORDER BY mv.server_id, mv.metric_id, mv.time DESC
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Reports CRUD
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Report {
    pub id: Uuid,
    pub server_id: i64,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub created_at: Option<DateTime<Utc>>,
    pub file_path: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateReport {
    pub server_id: i64,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateReport {
    pub server_id: Option<i64>,
    pub period_start: Option<DateTime<Utc>>,
    pub period_end: Option<DateTime<Utc>>,
    pub file_path: Option<String>,
}

pub async fn list_reports(pool: &PgPool) -> anyhow::Result<Vec<Report>> {
    let rows = sqlx::query_as::<_, Report>(
        "SELECT id, server_id, period_start, period_end, created_at, file_path FROM reports ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_server_by_id(pool: &PgPool, id: i64) -> anyhow::Result<Option<Server>> {
    let row = sqlx::query_as::<_, Server>("SELECT id, host, port, is_active FROM servers WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

#[derive(Debug, Clone)]
pub struct MetricAggregate {
    pub metric_name: String,
    pub avg: f64,
    pub min: f64,
    pub min_at: DateTime<Utc>,
    pub max: f64,
    pub max_at: DateTime<Utc>,
    pub count: i64,
}

pub async fn get_metric_aggregates_for_period(
    pool: &PgPool,
    server_id: i64,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> anyhow::Result<Vec<MetricAggregate>> {
    let rows = sqlx::query_as::<_, (String, f64, f64, DateTime<Utc>, f64, DateTime<Utc>, i64)>(
        r#"
        SELECT m.name,
            AVG(mv.value)::float8,
            MIN(mv.value)::float8,
            (SELECT mv2.time FROM metric_values mv2
             WHERE mv2.server_id = $1 AND mv2.metric_id = mv.metric_id
               AND mv2.time >= $2 AND mv2.time <= $3
             ORDER BY mv2.value ASC, mv2.time ASC LIMIT 1),
            MAX(mv.value)::float8,
            (SELECT mv2.time FROM metric_values mv2
             WHERE mv2.server_id = $1 AND mv2.metric_id = mv.metric_id
               AND mv2.time >= $2 AND mv2.time <= $3
             ORDER BY mv2.value DESC, mv2.time ASC LIMIT 1),
            COUNT(*)::bigint
        FROM metric_values mv
        JOIN metrics m ON m.id = mv.metric_id
        WHERE mv.server_id = $1 AND mv.time >= $2 AND mv.time <= $3
        GROUP BY mv.metric_id, m.name
        "#,
    )
    .bind(server_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(metric_name, avg, min, min_at, max, max_at, count)| MetricAggregate {
            metric_name,
            avg,
            min,
            min_at,
            max,
            max_at,
            count,
        })
        .collect())
}

pub async fn get_report_by_id(pool: &PgPool, id: Uuid) -> anyhow::Result<Option<Report>> {
    let row = sqlx::query_as::<_, Report>(
        "SELECT id, server_id, period_start, period_end, created_at, file_path FROM reports WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn create_report(
    pool: &PgPool,
    r: &CreateReport,
    file_path: &str,
) -> anyhow::Result<Report> {
    let row = sqlx::query_as::<_, Report>(
        r#"
        INSERT INTO reports (server_id, period_start, period_end, file_path)
        VALUES ($1, $2, $3, $4)
        RETURNING id, server_id, period_start, period_end, created_at, file_path
        "#,
    )
    .bind(r.server_id)
    .bind(r.period_start)
    .bind(r.period_end)
    .bind(file_path)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub async fn update_report(
    pool: &PgPool,
    id: Uuid,
    r: &UpdateReport,
) -> anyhow::Result<Option<Report>> {
    // Fetch current, apply updates
    let current = match get_report_by_id(pool, id).await? {
        Some(c) => c,
        None => return Ok(None),
    };
    let server_id = r.server_id.unwrap_or(current.server_id);
    let period_start = r.period_start.unwrap_or(current.period_start);
    let period_end = r.period_end.unwrap_or(current.period_end);
    let file_path = r
        .file_path
        .as_deref()
        .unwrap_or(current.file_path.as_deref().unwrap_or(""));

    sqlx::query(
        "UPDATE reports SET server_id = $1, period_start = $2, period_end = $3, file_path = $4 WHERE id = $5",
    )
    .bind(server_id)
    .bind(period_start)
    .bind(period_end)
    .bind(file_path)
    .bind(id)
    .execute(pool)
    .await?;
    get_report_by_id(pool, id).await
}

pub async fn delete_report(pool: &PgPool, id: Uuid) -> anyhow::Result<bool> {
    let result = sqlx::query("DELETE FROM reports WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
