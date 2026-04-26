import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useRealtimeMetrics } from "../hooks/useRealtimeMetrics";
import { useServers } from "../hooks/useServers";
import { useStatus } from "../hooks/useStatus";
import { useEffect, useMemo, useState } from "react";
import { useServerStatuses } from "../hooks/useServerStatuses";
import type { ProcessMetrics, ServerRuntime } from "../types";

const COLORS = ["#6c8cff", "#44cf6c", "#f55050", "#f0a840", "#a78bfa", "#38bdf8"];
const HARDWARE_METRICS = new Set(["cpu_usage", "memory_used", "memory_available"]);
const APPLICATION_METRICS = new Set([
  "active_users",
  "active_calls",
  "active_meetings",
  "pending_calls",
  "pending_meeting_requests",
  "uptime_sec",
]);

const METRIC_LABELS: Record<string, string> = {
  cpu_usage: "CPU Usage (%)",
  memory_used: "Memory Used (MB)",
  memory_available: "Memory Available (MB)",
  active_users: "Active Users",
  active_calls: "Active Calls",
  active_meetings: "Active Meetings",
  pending_calls: "Pending Calls",
  pending_meeting_requests: "Pending Meeting Requests",
  uptime_sec: "Uptime (sec)",
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0s";
  }
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function formatMemoryMb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

interface MetricGroup {
  metricName: string;
  label: string;
  servers: { key: string; serverLabel: string; colorIdx: number }[];
}

type RealtimeView = "hardware" | "application" | "processes";

function DashboardErrorState({ type, message }: { type: "error" | "degraded"; message: string }) {
  return (
    <div className={`dashboard-error-state ${type === "degraded" ? "dashboard-error-state--degraded" : ""}`}>
      <div className="dashboard-error-state__icon" aria-hidden>
        {type === "error" ? (
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        ) : (
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        )}
      </div>
      <p className="dashboard-error-state__title">
        {type === "error" ? "Cannot load metrics" : "Service degraded"}
      </p>
      <p className="dashboard-error-state__message">{message}</p>
    </div>
  );
}

export function RealtimeChart({ view }: { view: RealtimeView }) {
  const { status, error: statusError } = useStatus();
  const { history, serverSnapshots, error: metricsError, loading } = useRealtimeMetrics();
  const { servers } = useServers();
  const { downIds } = useServerStatuses();
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);

  useEffect(() => {
    const upServers = servers.filter((s) => !downIds.includes(s.id));
    if (upServers.length === 0) {
      setSelectedServerId(null);
      return;
    }
    if (selectedServerId == null || !upServers.some((s) => s.id === selectedServerId)) {
      setSelectedServerId(upServers[0].id);
    }
  }, [servers, downIds, selectedServerId]);

  const hasHardError = statusError != null || metricsError != null;
  const errorMessage = statusError
    ? `Cannot reach the server: ${statusError}`
    : metricsError ?? "";

  const isDegraded = status?.status === "degraded";

  const serverMap = useMemo(
    () => new Map(servers.map((s) => [s.id, `${s.host}:${s.port}`])),
    [servers]
  );
  const selectedServerSnapshot = selectedServerId != null ? serverSnapshots[selectedServerId] : undefined;
  const selectedRuntime = selectedServerSnapshot?.server_runtime ?? null;
  const selectedProcesses = selectedServerSnapshot?.processes ?? null;
  const sectionTitle =
    view === "hardware"
      ? "Hardware Metrics"
      : view === "application"
        ? "Application Metrics"
        : "Processes";

  const groups = useMemo(() => {
    if (selectedServerId == null) return [];
    const keys = Object.keys(history).filter(
      (k) => (history[k]?.length ?? 0) > 0
    );

    const byMetric = new Map<string, { serverId: number; key: string }[]>();
    for (const key of keys) {
      const sep = key.indexOf("_");
      const serverId = Number(key.slice(0, sep));
      if (serverId !== selectedServerId) continue;
      const metricName = key.slice(sep + 1);
      if (!byMetric.has(metricName)) byMetric.set(metricName, []);
      byMetric.get(metricName)!.push({ serverId, key });
    }

    const sortedMetricNames = Array.from(byMetric.keys()).sort((a, b) => {
      const la = METRIC_LABELS[a] ?? a;
      const lb = METRIC_LABELS[b] ?? b;
      return la.localeCompare(lb);
    });

    const result: MetricGroup[] = [];
    let colorIdx = 0;
    for (const metricName of sortedMetricNames) {
      const metricInCurrentView =
        view === "hardware"
          ? HARDWARE_METRICS.has(metricName)
          : view === "application"
            ? APPLICATION_METRICS.has(metricName)
            : false;
      if (!metricInCurrentView) continue;
      const entries = (byMetric.get(metricName) ?? [])
        .slice()
        .sort((a, b) => a.serverId - b.serverId);
      result.push({
        metricName,
        label: METRIC_LABELS[metricName] ?? metricName,
        servers: entries.map((e) => ({
          key: e.key,
          serverLabel: serverMap.get(e.serverId) ?? `Server #${e.serverId}`,
          colorIdx: colorIdx++,
        })),
      });
    }
    return result;
  }, [history, serverMap, selectedServerId, view]);

  if (hasHardError) {
    return (
      <DashboardErrorState
        type="error"
        message={errorMessage}
      />
    );
  }

  if (view !== "processes" && groups.length === 0 && !loading) {
    return (
      <div className="dashboard-error-state dashboard-error-state--empty">
        <div className="dashboard-error-state__icon" aria-hidden>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M18 17V9" />
            <path d="M13 17V5" />
            <path d="M8 17v-3" />
          </svg>
        </div>
        <p className="dashboard-error-state__title">No data yet</p>
        <p className="dashboard-error-state__message">
          Waiting for server polling or check backend connectivity.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">{sectionTitle}</h2>
        {isDegraded && (
          <div className="status-banner warning">Some servers are down</div>
        )}
      </div>
      <div className="mb-sm" style={{ maxWidth: 360 }}>
        <div className="field">
          <label>Server</label>
          <select
            value={selectedServerId == null ? "" : String(selectedServerId)}
            onChange={(e) => setSelectedServerId(Number(e.target.value))}
            disabled={selectedServerId == null}
          >
            {servers.map((s) => {
              const isDown = downIds.includes(s.id);
              return (
                <option key={s.id} value={s.id} disabled={isDown}>
                  {s.host}:{s.port} {isDown ? "(down)" : ""}
                </option>
              );
            })}
          </select>
        </div>
      </div>
      {view === "application" && <RuntimeStats runtime={selectedRuntime} />}
      {view !== "processes" && (
        <div className="charts-grid">
          {groups.map((group) => (
            <MetricCard key={group.metricName} group={group} history={history} />
          ))}
        </div>
      )}
      {view === "processes" && <ProcessesTable processes={selectedProcesses} />}
    </div>
  );
}

function RuntimeStats({ runtime }: { runtime: ServerRuntime | null }) {
  if (!runtime) {
    return null;
  }
  return (
    <div className="runtime-stats-grid mb-sm">
      <div className="runtime-stat-card">
        <div className="runtime-stat-label">Active Users</div>
        <div className="runtime-stat-value">{runtime.active_users}</div>
      </div>
      <div className="runtime-stat-card">
        <div className="runtime-stat-label">Active Calls</div>
        <div className="runtime-stat-value">{runtime.active_calls}</div>
      </div>
      <div className="runtime-stat-card">
        <div className="runtime-stat-label">Active Meetings</div>
        <div className="runtime-stat-value">{runtime.active_meetings}</div>
      </div>
      <div className="runtime-stat-card">
        <div className="runtime-stat-label">Pending Calls</div>
        <div className="runtime-stat-value">{runtime.pending_calls}</div>
      </div>
      <div className="runtime-stat-card">
        <div className="runtime-stat-label">Pending Requests</div>
        <div className="runtime-stat-value">{runtime.pending_meeting_requests}</div>
      </div>
      <div className="runtime-stat-card">
        <div className="runtime-stat-label">Uptime</div>
        <div className="runtime-stat-value">{formatDuration(runtime.uptime_sec)}</div>
      </div>
    </div>
  );
}

function ProcessesTable({ processes }: { processes: ProcessMetrics[] | null }) {
  if (processes == null) {
    return null;
  }

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <div className="card-title">Top Processes</div>
      {processes.length === 0 ? (
        <p className="text-muted">No process data in the latest snapshot.</p>
      ) : (
        <div className="processes-table-wrap">
          <table className="processes-table">
            <thead>
              <tr>
                <th>PID</th>
                <th>Name</th>
                <th>CPU (%)</th>
                <th>Memory RSS</th>
                <th>Threads</th>
                <th>FDs</th>
                <th>Uptime</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((processInfo) => (
                <tr key={processInfo.pid}>
                  <td>{processInfo.pid}</td>
                  <td className="process-name">{processInfo.name}</td>
                  <td>{processInfo.cpu_usage.toFixed(2)}</td>
                  <td>{formatMemoryMb(processInfo.memory_rss)}</td>
                  <td>{processInfo.threads}</td>
                  <td>{processInfo.fd_count}</td>
                  <td>{formatDuration(processInfo.uptime_sec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  group,
  history,
}: {
  group: MetricGroup;
  history: Record<string, { t: number; value: number }[]>;
}) {
  const { data, yMax } = useMemo(() => {
    const allT = new Set<number>();
    let max = 0;
    for (const s of group.servers) {
      for (const p of history[s.key] ?? []) {
        allT.add(p.t);
        if (p.value > max) max = p.value;
      }
    }
    const sorted = Array.from(allT).sort((a, b) => a - b);
    const rows = sorted.map((t) => {
      const row: Record<string, number | string> = { t, time: formatTime(t) };
      for (const s of group.servers) {
        const pt = (history[s.key] ?? []).find((x) => x.t === t);
        if (pt != null) row[s.key] = Math.round(pt.value * 100) / 100;
      }
      return row;
    });
    const padding = max > 0 ? max * 0.15 : 1;
    return { data: rows, yMax: Math.ceil(max + padding) };
  }, [group, history]);

  return (
    <div className="card">
      <div className="card-title">{group.label}</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: -10, bottom: 4 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#8b90a0" }}
            axisLine={{ stroke: "#2a2e3a" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#8b90a0" }}
            axisLine={false}
            tickLine={false}
            domain={[0, yMax]}
          />
          <Tooltip
            contentStyle={{
              background: "#1e2230",
              border: "1px solid #2a2e3a",
              borderRadius: 6,
              fontSize: 12,
              color: "#e1e4eb",
            }}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.time ?? ""}
          />
          {group.servers.length > 1 && (
            <Legend
              formatter={(value: string) => {
                const s = group.servers.find((x) => x.key === value);
                return s?.serverLabel ?? value;
              }}
              wrapperStyle={{ fontSize: 11, color: "#8b90a0" }}
            />
          )}
          {group.servers.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.key}
              stroke={COLORS[s.colorIdx % COLORS.length]}
              dot={false}
              isAnimationActive={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
