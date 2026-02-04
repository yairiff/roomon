import type { ReactNode } from "react";
import { CloseIcon } from "../../../components/Icons";

type PropsOverlayProps = {
  open: boolean;
  title: string;
  meta?: string | null;
  onClose: () => void;
  children: ReactNode;
};

export default function PropsOverlay({ open, title, meta, onClose, children }: PropsOverlayProps) {
  if (!open) return null;

  return (
    <div className="admin-tool-overlay admin-props-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="admin-tool-overlay-card" onClick={(event) => event.stopPropagation()}>
        <button className="admin-tool-overlay-close" type="button" aria-label="סגור" onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="admin-tool-overlay-heading admin-props-overlay-heading">
          <div className="admin-props-overlay-titles">
            <h3>{title}</h3>
            {meta ? <div className="admin-meta">{meta}</div> : null}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

