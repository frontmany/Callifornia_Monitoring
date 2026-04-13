import { useEffect, useState } from "react";
import { CreateReportForm } from "./CreateReportForm";
import { ReportDetailsDialog } from "./ReportDetailsDialog";
import { ReportList } from "./ReportList";
import { useReports } from "../hooks/useReports";
import { useServers } from "../hooks/useServers";
import { useServerStatuses } from "../hooks/useServerStatuses";

export function ReportsPage() {
  const reportsState = useReports();
  const serversState = useServers();
  const { downIds } = useServerStatuses();
  const [detailReportId, setDetailReportId] = useState<string | null>(null);
  const [newlyCreatedReportId, setNewlyCreatedReportId] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => {
      const state = window.history.state as { reportDetailId?: string } | null;
      setDetailReportId(state?.reportDetailId ?? null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!detailReportId) return;
    window.scrollTo(0, 0);
  }, [detailReportId]);

  useEffect(() => {
    if (!detailReportId) {
      setNewlyCreatedReportId(null);
      return;
    }
    if (newlyCreatedReportId && newlyCreatedReportId !== detailReportId) {
      setNewlyCreatedReportId(null);
    }
  }, [detailReportId, newlyCreatedReportId]);

  const openReport = (id: string) => {
    setNewlyCreatedReportId(null);
    setDetailReportId(id);
    window.history.pushState({ reportDetailId: id }, "");
  };

  const closeReport = () => {
    const state = window.history.state as { reportDetailId?: string } | null;
    if (state?.reportDetailId) {
      window.history.back();
      return;
    }
    setNewlyCreatedReportId(null);
    setDetailReportId(null);
  };

  const createAndOpenReport = async (payload: Parameters<typeof reportsState.createReport>[0]) => {
    const created = await reportsState.createReport(payload);
    setNewlyCreatedReportId(created.id);
    setDetailReportId(created.id);
    window.history.pushState({ reportDetailId: created.id }, "");
    return created;
  };

  return (
    <>
      {detailReportId ? (
        <ReportDetailsDialog
          reportId={detailReportId}
          servers={serversState.servers}
          downServerIds={downIds}
          initialMode="edit"
          inline
          deleteOnCancel={newlyCreatedReportId === detailReportId}
          onDeleteReport={reportsState.deleteReport}
          onClose={closeReport}
          onUpdated={reportsState.updateReport}
        />
      ) : (
        <>
          <CreateReportForm
            servers={serversState.servers}
            downServerIds={downIds}
            onCreate={createAndOpenReport}
          />
          <ReportList
            reports={reportsState.reports}
            loading={reportsState.loading}
            error={reportsState.error}
            servers={serversState.servers}
            downServerIds={downIds}
            onDelete={reportsState.deleteReport}
            onOpenReport={openReport}
          />
        </>
      )}
    </>
  );
}

