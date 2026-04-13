import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Server } from "../types";

export function useServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = async () => {
    setLoading(true);
    try {
      const data = await api.getServers();
      const sorted = data.slice().sort((a, b) => a.id - b.id);
      setServers(sorted);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refetch();
  }, []);

  return { servers, loading, error, refetch };
}
