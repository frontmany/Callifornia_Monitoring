import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { ReportDetail, Server, UpdateReportPayload } from "../types";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MIN_DATETIME = "2000-01-01T00:00";
const MAX_DATETIME = "2100-12-31T23:59";

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

export function ReportDetailsDialog(props: {
  reportId: string;
  servers: Server[];
  downServerIds: number[];
  initialMode?: "view" | "edit";
  /** When true, renders in the main column (no overlay); sidebar stays visible in App. */
  inline?: boolean;
  deleteOnCancel?: boolean;
  onDeleteReport?: (id: string) => Promise<void> | void;
  onClose: () => void;
  onUpdated: (id: string, payload: UpdateReportPayload) => Promise<ReportDetail>;
}) {
  const {
    reportId,
    servers,
    downServerIds,
    initialMode = "view",
    inline = false,
    deleteOnCancel = false,
    onDeleteReport,
    onClose,
    onUpdated,
  } = props;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportDetail | null>(null);

  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [serverId, setServerId] = useState<number>(0);
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

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
    setMode(initialMode);
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
  }, [initialMode, reportId, servers]);

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
    const startIso = localInputValueToIso(periodStart);
    const endIso = localInputValueToIso(periodEnd);
    if (startDate >= endDate) {
      setError("End date must be after start date.");
      return;
    }
    setSaving(true);
    try {
      const payload: UpdateReportPayload = {
        period_start: startIso,
        period_end: endIso,
      };
      if (serverId > 0) payload.server_id = serverId;
      await onUpdated(reportId, payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update report");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!deleteOnCancel) {
      onClose();
      return;
    }
    if (!onDeleteReport) {
      onClose();
      return;
    }
    setError(null);
    setCancelling(true);
    try {
      await onDeleteReport(reportId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete report");
    } finally {
      setCancelling(false);
    }
  };

  const header = (
    <div className="modal-header">
      <div>
        <div className="card-title">Report</div>
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
                <div className="report-meta__label">Created</div>
                <div className="report-meta__value">{formatDateTime(report.created_at)}</div>
              </div>
            </div>

            {mode === "edit" && (
              <div className="card mb-md" style={{ marginTop: "1rem" }}>
                <div className="card-title">Edit report</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Server</label>
                    <select
                      value={serverId}
                      onChange={(e) => setServerId(Number(e.target.value))}
                      disabled={
                        !servers.length ||
                        saving ||
                        servers.every((s) => downServerIds.includes(s.id))
                      }
                    >
                      {!servers.length && <option value={0}>No servers</option>}
                      {servers.map((s) => (
                        <option
                          key={s.id}
                          value={s.id}
                          disabled={downServerIds.includes(s.id)}
                        >
                          {s.host}:{s.port}{" "}
                          {downServerIds.includes(s.id) ? "(down)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Period Start</label>
                    <input
                      type="datetime-local"
                      value={periodStart}
                      onChange={(e) => setPeriodStart(e.target.value)}
                      disabled={saving}
                      min={MIN_DATETIME}
                      max={MAX_DATETIME}
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
                      max={MAX_DATETIME}
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
                        <td>{s.avg}</td>
                        <td>{s.min}</td>
                        <td>{formatDateTime(s.min_at)}</td>
                        <td>{s.max}</td>
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
                <button type="button" className="btn-primary report-actions__btn" onClick={handleSave} disabled={saving || cancelling}>
                  {saving ? "Saving..." : "Save"}
                </button>
                <button type="button" className="btn-ghost report-actions__btn report-actions__cancel" onClick={handleCancel} disabled={saving || cancelling}>
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

