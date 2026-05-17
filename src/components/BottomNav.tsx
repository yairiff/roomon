import type { ViewMode } from "../types/ui";
import { CalendarIcon, GroupsIcon, SearchIcon, ScheduleIcon } from "./Icons";

export type BottomNavProps = {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
  onReselect?: (view: ViewMode) => void;
  locked?: boolean;
  showCollaborationTabs?: boolean;
  groupsBadgeCount?: number;
};

export default function BottomNav({
  view,
  onChange,
  onReselect,
  locked,
  showCollaborationTabs = false,
  groupsBadgeCount = 0
}: BottomNavProps) {
  const handleTap = (target: ViewMode) => {
    if (view === target) {
      onReselect?.(target);
      return;
    }
    onChange(target);
  };
  const groupsBadgeLabel = groupsBadgeCount > 99 ? "99+" : String(groupsBadgeCount);
  const showGroupsBadge = groupsBadgeCount > 0;

  if (!showCollaborationTabs) {
    return (
      <nav className="bottom-nav">
        <button
          className={`nav-item ${view === "room" ? "active" : ""}`}
          style={{ gridColumn: "1" }}
          onClick={() => handleTap("room")}
          type="button"
          aria-label="Schedule"
          disabled={locked}
        >
          <CalendarIcon />
          <span className="nav-label">לוח זמנים</span>
        </button>
        <div className="nav-gap" style={{ gridColumn: "3" }} aria-hidden="true" />
        <button
          className={`nav-item ${view === "finder" ? "active" : ""}`}
          style={{ gridColumn: "5" }}
          onClick={() => handleTap("finder")}
          type="button"
          aria-label="Finder"
          disabled={locked}
        >
          <SearchIcon />
          <span className="nav-label">תמצא לי</span>
        </button>
        <button
          className={`nav-live ${view === "live" ? "active" : ""}`}
          onClick={() => handleTap("live")}
          type="button"
          aria-label="Live"
        >
          <span className="nav-live-icon" aria-hidden="true">LIVE</span>
          <span className="nav-live-label">זמן אמת</span>
        </button>
      </nav>
    );
  }

  return (
    <nav className="bottom-nav">
      <button
        className={`nav-item ${view === "room" ? "active" : ""}`}
        onClick={() => handleTap("room")}
        type="button"
        aria-label="Schedule"
        disabled={locked}
      >
        <CalendarIcon />
        <span className="nav-label">מערכת שעות</span>
      </button>
      <button
        className={`nav-item ${view === "finder" ? "active" : ""}`}
        onClick={() => handleTap("finder")}
        type="button"
        aria-label="Finder"
        disabled={locked}
      >
        <SearchIcon />
        <span className="nav-label">תמצא לי</span>
      </button>
      <div className="nav-gap" aria-hidden="true" />
      <button
        className={`nav-item ${view === "groups" ? "active" : ""}`}
        onClick={() => handleTap("groups")}
        type="button"
        aria-label="Groups"
        disabled={locked}
      >
        <span className="nav-icon-wrap" aria-hidden="true">
          <GroupsIcon />
          {showGroupsBadge ? (
            <span className="nav-badge">{groupsBadgeLabel}</span>
          ) : null}
        </span>
        <span className="nav-label">הרכבים</span>
      </button>
      <button
        className={`nav-item ${view === "mySchedule" ? "active" : ""}`}
        onClick={() => handleTap("mySchedule")}
        type="button"
        aria-label="My schedule"
        disabled={locked}
      >
        <ScheduleIcon />
        <span className="nav-label">הלו״ז שלי</span>
      </button>
      <button
        className={`nav-live ${view === "live" ? "active" : ""}`}
        onClick={() => handleTap("live")}
        type="button"
        aria-label="Live"
      >
        <span className="nav-live-icon" aria-hidden="true">LIVE</span>
        <span className="nav-live-label">זמן אמת</span>
      </button>
    </nav>
  );
}
