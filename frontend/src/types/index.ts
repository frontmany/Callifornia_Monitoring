// API response types aligned with Rust backend

export interface ServiceStatus {
  status: "healthy" | "degraded";
  db_connected: boolean;
  sources_total: number;
  sources_connected: number;
  sources: {
    server_id: number;
    host: string;
    port: string;
    connected: boolean;
    last_change: string;
    last_error: string | null;
  }[];
}

export interface Server {
  id: number;
  host: string;
  port: string;
  is_active: boolean;
}

export interface ServerRealtime {
  id: number;
  host: string;
  port: string;
  status: "up" | "down";
  last_change: string; // ISO datetime
  last_error: string | null;
  metrics: Record<string, number> | null;
  recorded_at: string | null; // ISO datetime or null when down
  server_runtime: ServerRuntime | null;
  processes: ProcessMetrics[] | null;
}

export interface ServerRuntime {
  active_users: number;
  active_calls: number;
  active_meetings: number;
  pending_calls: number;
  pending_meeting_requests: number;
  uptime_sec: number;
}

export interface ProcessMetrics {
  pid: number;
  name: string;
  cpu_usage: number;
  memory_rss: number;
  threads: number;
  fd_count: number;
  uptime_sec: number;
}

export interface RealtimeMetricsResponse {
  servers: ServerRealtime[];
}

export interface ReportSummary {
  id: string;
  server_id: number;
  period_start: string;
  period_end: string;
  created_at: string | null;
}

export interface ReportServerRef {
  host: string;
  port: string;
}

export interface ReportPeriod {
  start: string; // ISO datetime
  end: string; // ISO datetime
}

export interface MetricStats {
  avg: number;
  min: number;
  min_at: string;
  max: number;
  max_at: string;
  count: number;
}

export interface ReportDetail {
  id: string;
  server?: ReportServerRef;
  server_id?: number;
  period: ReportPeriod;
  metrics: Record<string, MetricStats>;
  created_at: string;
}

export interface CreateReportPayload {
  server_id: number;
  period_start: string; // ISO datetime
  period_end: string;
}

export interface UpdateReportPayload {
  server_id?: number;
  period_start?: string; // ISO datetime
  period_end?: string;
}

export interface ApiError {
  error: string;
}

// For realtime chart: one point in time per metric
export interface MetricPoint {
  t: number; // timestamp
  value: number;
}
