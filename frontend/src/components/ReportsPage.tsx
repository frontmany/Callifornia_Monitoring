import { useEffect, useState } from "react";
import { CreateReportForm } from "./CreateReportForm";
import { ReportDetailsDialog } from "./ReportDetailsDialog";
import { ReportList } from "./ReportList";
import { useReports } from "../hooks/useReports";
import { useServers } from "../hooks/useServers";
import { useServerStatuses } from "../hooks/useServerStatuses";
import type { CreateReportPayload, ReportDetail, ReportPreview } from "../types";

interface ReportPreviewState {
  payload: CreateReportPayload;
  report: ReportPreview;
}

export function ReportsPage() {
  const reportsState = useReports();
  const serversState = useServers();
  const { downIds } = useServerStatuses();
  const [detailReportId, setDetailReportId] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<ReportPreviewState | null>(null);

  useEffect(() => {
    const onPopState = () => {
      const state = window.history.state as { reportDetailId?: string } | null;
      setDetailReportId(state?.reportDetailId ?? null);
      setPreviewState(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!detailReportId) return;
    window.scrollTo(0, 0);
  }, [detailReportId]);

  const openReport = (id: string) => {
    setPreviewState(null);
    setDetailReportId(id);
    window.history.pushState({ reportDetailId: id }, "");
  };

  const closeReport = () => {
    if (previewState) {
      setPreviewState(null);
      return;
    }
    const state = window.history.state as { reportDetailId?: string } | null;
    if (state?.reportDetailId) {
      window.history.back();
      return;
    }
    setDetailReportId(null);
  };

  const previewAndOpenReport = async (payload: CreateReportPayload) => {
    const report = await reportsState.previewReport(payload);
    setDetailReportId(null);
    setPreviewState({ payload, report });
    return report;
  };

  const openSavedReport = (_report: ReportDetail) => {
    setPreviewState(null);
    setDetailReportId(null);
  };

  return (
    <>
      {previewState ? (
        <ReportDetailsDialog
          reportPreview={previewState.report}
          previewPayload={previewState.payload}
          servers={serversState.servers}
          downServerIds={downIds}
          initialMode="edit"
          inline
          onClose={closeReport}
          onCreateReport={reportsState.createReport}
          onCreated={openSavedReport}
        />
      ) : detailReportId ? (
        <ReportDetailsDialog
          reportId={detailReportId}
          servers={serversState.servers}
          downServerIds={downIds}
          initialMode="edit"
          inline
          onClose={closeReport}
          onUpdated={reportsState.updateReport}
        />
      ) : (
        <>
          <CreateReportForm
            servers={serversState.servers}
            downServerIds={downIds}
            onCreate={previewAndOpenReport}
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

