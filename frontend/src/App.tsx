import { useState } from "react";
import { RealtimeChart } from "./components/RealtimeChart";
import { ReportsPage } from "./components/ReportsPage";
import "./App.css";

type Tab = "hardware" | "application" | "processes" | "reports";

function App() {
  const [tab, setTab] = useState<Tab>("hardware");

  return (
    <div className="app">
      <aside className="sidebar">
        <nav className="sidebar-nav">
          <button
            type="button"
            className={tab === "hardware" ? "active" : ""}
            onClick={() => setTab("hardware")}
            title="Hardware Metrics"
            aria-label="Hardware Metrics"
          >
            <img src="/icons/sidebar-hardware.png" alt="" className="sidebar-nav__icon" />
          </button>
          <button
            type="button"
            className={tab === "application" ? "active" : ""}
            onClick={() => setTab("application")}
            title="Application Metrics"
            aria-label="Application Metrics"
          >
            <img src="/icons/sidebar-application.png" alt="" className="sidebar-nav__icon" />
          </button>
          <button
            type="button"
            className={tab === "processes" ? "active" : ""}
            onClick={() => setTab("processes")}
            title="Processes"
            aria-label="Processes"
          >
            <img src="/icons/sidebar-processes.png" alt="" className="sidebar-nav__icon" />
          </button>
          <button
            type="button"
            className={tab === "reports" ? "active" : ""}
            onClick={() => setTab("reports")}
            title="Reports"
            aria-label="Reports"
          >
            <img src="/icons/sidebar-reports.png" alt="" className="sidebar-nav__icon" />
          </button>
        </nav>
      </aside>
      <div className="app-main">
        <div className="page">
          {tab === "hardware" && <RealtimeChart view="hardware" />}
          {tab === "application" && <RealtimeChart view="application" />}
          {tab === "processes" && <RealtimeChart view="processes" />}
          {tab === "reports" && <ReportsPage />}
        </div>
      </div>
    </div>
  );
}

export default App;
