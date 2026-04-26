import { useMemo } from "react";
import type { ReportSummary, Server } from "../types";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { EditIcon, TrashIcon } from "./Icons";
import { useState } from "react";

function formatDate(s: string | null) {
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

export function ReportList(props: {
  reports: ReportSummary[];
  loading: boolean;
  error: string | null;
  servers: Server[];
  downServerIds: number[];
  onDelete: (id: string) => Promise<void> | void;
  onOpenReport: (id: string) => void;
}) {
  const { reports, loading, error, servers, onDelete, onOpenReport } = props;
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const serverLabelById = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of servers) map.set(s.id, `${s.host}:${s.port}`);
    return map;
  }, [servers]);

  if (loading) return <p className="text-muted">Loading reports...</p>;
  if (error) return <div className="inline-alert danger">{error}</div>;
  if (reports.length === 0) {
    return <p className="text-muted">No reports yet. Use the form above to create one.</p>;
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Reports</div>
        <table className="report-table report-table--list">
          <thead>
            <tr>
              <th>Period</th>
              <th>Server</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr
                key={r.id}
                onClick={() => onOpenReport(r.id)}
                style={{ cursor: "pointer" }}
                title="Click to open report"
              >
                <td>
                  {formatDate(r.period_start)} &mdash; {formatDate(r.period_end)}
                </td>
                <td>{serverLabelById.get(r.server_id) ?? `#${r.server_id}`}</td>
                <td>{formatDate(r.created_at)}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenReport(r.id);
                    }}
                    aria-label="Edit report"
                  >
                    <EditIcon className="icon-btn__icon" />
                  </button>{" "}
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteId(r.id);
                    }}
                    aria-label="Delete"
                  >
                    <TrashIcon className="icon-btn__icon" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pendingDeleteId && (
        <ConfirmDeleteDialog
          deleting={deleting}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await onDelete(pendingDeleteId);
              setPendingDeleteId(null);
            } finally {
              setDeleting(false);
            }
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </>
  );
}
