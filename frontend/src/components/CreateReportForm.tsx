import { useEffect, useState } from "react";
import type { CreateReportPayload, Server } from "../types";

const MIN_YEAR = 2000;
const MAX_YEAR = 3000;
const MIN_DATETIME = "2000-01-01T00:00";
const MAX_DATETIME = "2100-12-31T23:59";

function toISOLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export function CreateReportForm(props: {
  servers: Server[];
  downServerIds: number[];
  onCreate: (payload: CreateReportPayload) => Promise<unknown>;
}) {
  const { servers, downServerIds, onCreate } = props;
  const [serverId, setServerId] = useState<number>(0);

  useEffect(() => {
    const upServers = servers.filter((s) => !downServerIds.includes(s.id));
    if (upServers.length && !upServers.some((s) => s.id === serverId)) {
      setServerId(upServers[0].id);
    }
  }, [servers, downServerIds, serverId]);

  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toISOLocal(d);
  });
  const [periodEnd, setPeriodEnd] = useState(() => toISOLocal(new Date()));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!message?.ok) return;
    const id = window.setTimeout(() => {
      setMessage((prev) => (prev?.ok ? null : prev));
    }, 4000);
    return () => window.clearTimeout(id);
  }, [message]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (serverId <= 0) {
      setMessage({ text: "Please select a server.", ok: false });
      return;
    }
    setSubmitting(true);
    try {
      if (!periodStart || !periodEnd) {
        throw new Error("Please select both start and end date.");
      }
      const startDate = new Date(periodStart);
      const endDate = new Date(periodEnd);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error("Invalid date format. Please reselect dates.");
      }
      if (
        startDate.getFullYear() < MIN_YEAR ||
        startDate.getFullYear() > MAX_YEAR ||
        endDate.getFullYear() < MIN_YEAR ||
        endDate.getFullYear() > MAX_YEAR
      ) {
        throw new Error(`Year must be between ${MIN_YEAR} and ${MAX_YEAR}.`);
      }
      const start = startDate.toISOString();
      const end = endDate.toISOString();
      if (startDate >= endDate) {
        throw new Error("End date must be after start date.");
      }
      await onCreate({ server_id: serverId, period_start: start, period_end: end });
      setMessage({ text: "Report created successfully.", ok: true });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to create report", ok: false });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card mb-md">
      <div className="card-title">New Report</div>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>Server</label>
            <select
              value={serverId}
              onChange={(e) => setServerId(Number(e.target.value))}
              disabled={!servers.length || servers.every((s) => downServerIds.includes(s.id))}
            >
              {!servers.length && <option value={0}>No servers</option>}
              {servers.map((s) => (
                <option key={s.id} value={s.id} disabled={downServerIds.includes(s.id)}>
                  {s.host}:{s.port} {downServerIds.includes(s.id) ? "(down)" : ""}
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
              min={MIN_DATETIME}
              max={MAX_DATETIME}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={submitting || !servers.length}>
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
        {message && (
          <div className={`inline-alert ${message.ok ? "success" : "danger"}`} style={{ marginTop: "0.75rem" }}>
            <span>{message.text}</span>
            {!message.ok && (
              <button
                type="button"
                className="inline-alert__close"
                onClick={() => setMessage(null)}
                aria-label="Dismiss error"
                title="Dismiss"
              >
                ×
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
