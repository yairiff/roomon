import type { ViewMode } from "../types/ui";
import { CalendarIcon, LiveIcon, SearchIcon } from "./Icons";

export type BottomNavProps = {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
  locked?: boolean;
};

export default function BottomNav({ view, onChange, locked }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      <button
        className={`nav-item ${view === "room" ? "active" : ""}`}
        onClick={() => onChange("room")}
        type="button"
        aria-label="Schedule"
        disabled={locked}
      >
        <CalendarIcon />
        <span className="nav-label">לוח זמנים</span>
      </button>
      <div className="nav-gap" aria-hidden="true" />
      <button
        className={`nav-item ${view === "finder" ? "active" : ""}`}
        onClick={() => onChange("finder")}
        type="button"
        aria-label="Finder"
        disabled={locked}
      >
        <SearchIcon />
        <span className="nav-label">איתור חדרים</span>
      </button>
      <button
        className={`nav-live ${view === "live" ? "active" : ""}`}
        onClick={() => onChange("live")}
        type="button"
        aria-label="Live"
      >
        <LiveIcon />
        <span className="nav-live-label">עכשיו</span>
      </button>
    </nav>
  );
}
