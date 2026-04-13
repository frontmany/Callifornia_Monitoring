const API_BASE = import.meta.env.VITE_API_URL ?? "";

function friendlyStatusMessage(status: number): string {
  const messages: Record<number, string> = {
    400: "Invalid request. Please check your input.",
    401: "Please sign in again.",
    403: "You don't have permission to do this.",
    404: "The requested resource was not found.",
    500: "Something went wrong on the server. Please try again later.",
    502: "Service is temporarily unavailable. Please try again later.",
    503: "Service is temporarily unavailable. Please try again later.",
  };
  return messages[status] ?? "Something went wrong. Please try again later.";
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let message: string;
    try {
      const err = text ? (JSON.parse(text) as { error?: string }) : {};
      if (err.error && !err.error.startsWith("HTTP")) message = err.error;
      else message = friendlyStatusMessage(res.status);
    } catch {
      message = friendlyStatusMessage(res.status);
    }
    throw new Error(message);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const api = {
  getStatus: () => request<import("../types").ServiceStatus>("/api/status"),
  getServers: () => request<import("../types").Server[]>("/api/servers"),
  getServersMetrics: () =>
    request<import("../types").RealtimeMetricsResponse>("/api/servers/metrics"),
  getServerMetrics: (serverId: number) =>
    request<import("../types").ServerRealtime>(
      `/api/servers/${serverId}/metrics`
    ),
  getReports: () =>
    request<import("../types").ReportSummary[]>("/api/reports"),
  getReport: (id: string) =>
    request<import("../types").ReportDetail>(`/api/reports/${id}`),
  createReport: (body: import("../types").CreateReportPayload) =>
    request<import("../types").ReportDetail>("/api/reports", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateReport: (id: string, body: import("../types").UpdateReportPayload) =>
    request<import("../types").ReportDetail>(`/api/reports/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteReport: (id: string) =>
    request<void>(`/api/reports/${id}`, { method: "DELETE" }),
};
