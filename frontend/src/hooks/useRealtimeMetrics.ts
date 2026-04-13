import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { MetricPoint } from "../types";

const POLL_INTERVAL_MS = 3000;
const MAX_POINTS = 80;
const BYTES_TO_MB = 1_048_576;

// Key: "serverId_metricName" -> array of points
type History = Record<string, MetricPoint[]>;

function toDisplayValue(metricName: string, value: number): number {
  if (metricName === "memory_used" || metricName === "memory_available") {
    return value / BYTES_TO_MB;
  }
  return value;
}

export function useRealtimeMetrics() {
  const [history, setHistory] = useState<History>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const poll = useCallback(async () => {
    try {
      const { servers } = await api.getServersMetrics();
      setError(null);
      setLoading(false);
      const now = Date.now();
      setHistory((prev) => {
        let next = { ...prev };
        for (const s of servers) {
          if (!s.metrics) continue;
          for (const [name, value] of Object.entries(s.metrics)) {
            const key = `${s.id}_${name}`;
            const displayValue = toDisplayValue(name, value);
            const arr = [...(next[key] ?? []), { t: now, value: displayValue }].slice(-MAX_POINTS);
            next = { ...next, [key]: arr };
          }
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return { history, error, loading, refetch: poll };
}
