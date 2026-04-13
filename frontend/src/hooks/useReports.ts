import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { CreateReportPayload, ReportSummary, UpdateReportPayload } from "../types";

export function useReports() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getReports();
      setReports(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createReport = useCallback(
    async (payload: CreateReportPayload) => {
      const created = await api.createReport(payload);
      await refetch();
      return created;
    },
    [refetch]
  );

  const deleteReport = useCallback(async (id: string) => {
    await api.deleteReport(id);
    setReports((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateReport = useCallback(
    async (id: string, payload: UpdateReportPayload) => {
      const updated = await api.updateReport(id, payload);
      await refetch();
      return updated;
    },
    [refetch]
  );

  return { reports, loading, error, refetch, createReport, updateReport, deleteReport };
}
