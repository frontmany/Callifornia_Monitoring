import { useState } from "react";
import { RealtimeChart } from "./components/RealtimeChart";
import { ReportsPage } from "./components/ReportsPage";
import "./App.css";

type Tab = "dashboard" | "reports";

function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="app">
      <aside className="sidebar">
        <nav className="sidebar-nav">
          <button
            type="button"
            className={tab === "dashboard" ? "active" : ""}
            onClick={() => setTab("dashboard")}
            title="Dashboard"
            aria-label="Dashboard"
          >
            <img src="/icons/sidebar-dashboard.png" alt="" className="sidebar-nav__icon" />
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
          {tab === "dashboard" && <RealtimeChart />}
          {tab === "reports" && <ReportsPage />}
        </div>
      </div>
    </div>
  );
}

export default App;
