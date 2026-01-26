import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";

export type TopNavProps = {
  primary: string;
  secondary?: string;
  onPrev: () => void;
  onNext: () => void;
};

export default function TopNav({ primary, secondary, onPrev, onNext }: TopNavProps) {
  return (
    <div className="nav-bar">
      <button className="icon-button" onClick={onPrev} aria-label="הקודם" type="button">
        <ChevronRightIcon />
      </button>
      <div className="nav-info">
        <p className="nav-primary">{primary}</p>
        {secondary ? <p className="nav-secondary">{secondary}</p> : null}
      </div>
      <button className="icon-button" onClick={onNext} aria-label="הבא" type="button">
        <ChevronLeftIcon />
      </button>
    </div>
  );
}
