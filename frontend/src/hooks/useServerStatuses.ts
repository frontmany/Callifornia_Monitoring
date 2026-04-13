import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

export interface ServerStatusEntry {
  id: number;
  status: "up" | "down";
}

export function useServerStatuses(pollIntervalMs = 10000) {
  const [statuses, setStatuses] = useState<ServerStatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const { servers } = await api.getServersMetrics();
      setStatuses(
        servers.map((s) => ({
          id: s.id,
          status: s.status,
        }))
      );
      setError(null);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, pollIntervalMs);
    return () => clearInterval(id);
  }, [poll, pollIntervalMs]);

  const downIds = statuses.filter((s) => s.status === "down").map((s) => s.id);

  return { statuses, downIds, loading, error, refetch: poll };
}

