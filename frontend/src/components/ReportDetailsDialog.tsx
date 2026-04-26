import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { CreateReportPayload, ReportDetail, ReportPreview, Server, UpdateReportPayload } from "../types";
import { ServerSelect } from "./ServerSelect";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MIN_DATETIME = "2000-01-01T00:00";

function formatDateTime(s: string | null | undefined) {
  if (!s) return "\u2014";
  return new Date(s).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toISOLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function isoToLocalInputValue(iso: string) {
  const d = new Date(iso);
  return toISOLocal(d);
}

function localInputValueToIso(value: string) {
  return new Date(value).toISOString();
}

function formatReportMetricValue(metricName: string, value: number) {
  if (metricName === "cpu_usage") {
    return `${Math.round(value)}%`;
  }
  if (metricName === "memory_used" || metricName === "memory_available") {
    return `${(value / 1_073_741_824).toFixed(2)} GB`;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function ReportDetailsDialog(props: {
  reportId?: string;
  reportPreview?: ReportPreview;
  previewPayload?: CreateReportPayload;
  servers: Server[];
  downServerIds: number[];
  initialMode?: "view" | "edit";
  /** When true, renders in the main column (no overlay); sidebar stays visible in App. */
  inline?: boolean;
  onClose: () => void;
  onUpdated?: (id: string, payload: UpdateReportPayload) => Promise<ReportDetail>;
  onCreateReport?: (payload: CreateReportPayload) => Promise<ReportDetail>;
  onCreated?: (report: ReportDetail) => void;
}) {
  const {
    reportId,
    reportPreview,
    previewPayload,
    servers,
    downServerIds,
    initialMode = "view",
    inline = false,
    onClose,
    onUpdated,
    onCreateReport,
    onCreated,
  } = props;
  const isPreview = reportPreview != null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportDetail | ReportPreview | null>(null);

  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [serverId, setServerId] = useState<number>(0);
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const serverLabel = useMemo(() => {
    if (report?.server) return `${report.server.host}:${report.server.port}`;
    if (report?.server_id != null) {
      const s = servers.find((x) => x.id === report.server_id);
      if (s) return `${s.host}:${s.port}`;
      return `#${report.server_id}`;
    }
    return "\u2014";
  }, [report, servers]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    setMode(isPreview ? "edit" : initialMode);
    if (reportPreview) {
      setReport(reportPreview);
      setServerId(previewPayload?.server_id ?? reportPreview.server_id);
      setPeriodStart(isoToLocalInputValue(reportPreview.period.start));
      setPeriodEnd(isoToLocalInputValue(reportPreview.period.end));
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (!reportId) {
      setError("Report id is missing.");
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    api
      .getReport(reportId)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        const initialServerId =
          r.server_id ??
          (servers.length ? servers[0].id : 0);
        setServerId(initialServerId);
        setPeriodStart(isoToLocalInputValue(r.period.start));
        setPeriodEnd(isoToLocalInputValue(r.period.end));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load report");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialMode, isPreview, previewPayload, reportId, reportPreview, servers]);

  const metricEntries = useMemo(() => {
    const m = report?.metrics ?? {};
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [report]);

  const handleSave = async () => {
    setError(null);
    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setError("Invalid date format. Please reselect dates.");
      return;
    }
    if (
      startDate.getFullYear() < MIN_YEAR ||
      startDate.getFullYear() > MAX_YEAR ||
      endDate.getFullYear() < MIN_YEAR ||
      endDate.getFullYear() > MAX_YEAR
    ) {
      setError(`Year must be between ${MIN_YEAR} and ${MAX_YEAR}.`);
      return;
    }
    const now = new Date();
    if (endDate.getTime() > now.getTime()) {
      setError("End time cannot be later than the current moment.");
      return;
    }
    const startIso = localInputValueToIso(periodStart);
    const endIso = localInputValueToIso(periodEnd);
    if (startDate >= endDate) {
      setError("End date must be after start date.");
      return;
    }
    if (serverId <= 0) {
      setError("Please select a server.");
      return;
    }
    setSaving(true);
    try {
      if (isPreview) {
        if (!onCreateReport) {
          throw new Error("Create handler is missing.");
        }
        const payload: CreateReportPayload = {
          server_id: serverId,
          period_start: startIso,
          period_end: endIso,
        };
        const created = await onCreateReport(payload);
        onCreated?.(created);
        if (!onCreated) onClose();
        return;
      }
      if (!reportId || !onUpdated) {
        throw new Error("Update handler is missing.");
      }
      const payload: UpdateReportPayload = {
        period_start: startIso,
        period_end: endIso,
      };
      if (serverId > 0) payload.server_id = serverId;
      await onUpdated(reportId, payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : isPreview ? "Failed to save report" : "Failed to update report");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  const nowLocalMax = toISOLocal(new Date());

  const header = (
    <div className="modal-header">
      <div>
        <div className="card-title">{isPreview ? "Report Preview" : "Report"}</div>
      </div>
      {!inline && (
        <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">
          Close
        </button>
      )}
    </div>
  );

  const body = (
    <>
      {loading && <p className="text-muted">Loading...</p>}
      {!loading && error && <div className="inline-alert danger">{error}</div>}

      {!loading && !error && report && (
        <>
          <div className="report-meta">
              <div className="report-meta__item">
                <div className="report-meta__label">Server</div>
                <div className="report-meta__value">{serverLabel}</div>
              </div>
              <div className="report-meta__item">
                <div className="report-meta__label">Period</div>
                <div className="report-meta__value">
                  {formatDateTime(report.period.start)} &mdash; {formatDateTime(report.period.end)}
                </div>
              </div>
              <div className="report-meta__item">
                <div className="report-meta__label">{isPreview ? "Status" : "Created"}</div>
                <div className="report-meta__value">
                  {isPreview ? "Not saved yet" : formatDateTime("created_at" in report ? report.created_at : null)}
                </div>
              </div>
            </div>

            {mode === "edit" && (
              <div className="card mb-md" style={{ marginTop: "1rem" }}>
                <div className="card-title">Edit report</div>
                <div className="form-grid">
                  <ServerSelect
                    label="Server"
                    value={serverId > 0 ? serverId : null}
                    onChange={setServerId}
                    disabled={
                      !servers.length ||
                      saving ||
                      servers.every((s) => downServerIds.includes(s.id))
                    }
                    emptyText="No servers"
                    options={servers.map((s) => {
                      const isDown = downServerIds.includes(s.id);
                      return {
                        value: s.id,
                        label: `${s.host}:${s.port}${isDown ? " (down)" : ""}`,
                        disabled: isDown,
                      };
                    })}
                  />
                  <div className="field">
                    <label>Period Start</label>
                    <input
                      type="datetime-local"
                      value={periodStart}
                      onChange={(e) => setPeriodStart(e.target.value)}
                      disabled={saving}
                      min={MIN_DATETIME}
                      max={nowLocalMax}
                    />
                  </div>
                  <div className="field">
                    <label>Period End</label>
                    <input
                      type="datetime-local"
                      value={periodEnd}
                      onChange={(e) => setPeriodEnd(e.target.value)}
                      disabled={saving}
                      min={MIN_DATETIME}
                      max={nowLocalMax}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="card" style={{ marginTop: "1rem" }}>
              <div className="card-title">Metrics</div>
              {metricEntries.length === 0 ? (
                <p className="text-muted">No metrics.</p>
              ) : (
                <table className="report-table report-table--static">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Avg</th>
                      <th>Min</th>
                      <th>Min At</th>
                      <th>Max</th>
                      <th>Max At</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricEntries.map(([name, s]) => (
                      <tr key={name}>
                        <td
                          style={{
                            fontFamily:
                              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                          }}
                        >
                          {name}
                        </td>
                        <td>{formatReportMetricValue(name, s.avg)}</td>
                        <td>{formatReportMetricValue(name, s.min)}</td>
                        <td>{formatDateTime(s.min_at)}</td>
                        <td>{formatReportMetricValue(name, s.max)}</td>
                        <td>{formatDateTime(s.max_at)}</td>
                        <td>{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {mode === "edit" && (
              <div className="modal-actions report-actions" style={{ marginTop: "1rem" }}>
                <button type="button" className="btn-primary report-actions__btn" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </button>
                <button type="button" className="btn-ghost report-actions__btn report-actions__cancel" onClick={handleCancel} disabled={saving}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
    </>
  );

  if (inline) {
    return (
      <section className="report-detail-inline" aria-label="Report details">
        {header}
        {body}
      </section>
    );
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Report details">
      <div className="modal card">
        {header}
        {body}
      </div>
    </div>
  );
}

