import type { Dispatch, SetStateAction } from "react";

type SemesterRangeDraft = {
  A: { start: string; end: string };
  B: { start: string; end: string };
};

type SemestersSectionProps = {
  rangeDraft: SemesterRangeDraft;
  setRangeDraft: Dispatch<SetStateAction<SemesterRangeDraft>>;
  settingsError: string;
  onSave: () => void;
  onReset: () => void;
};

export default function SemestersSection({
  rangeDraft,
  setRangeDraft,
  settingsError,
  onSave,
  onReset
}: SemestersSectionProps) {
  return (
    <section className="admin-section">
      {settingsError ? <p className="admin-error">{settingsError}</p> : null}
      <div className="admin-split">
        <div className="admin-split-list">
          <div className="admin-card">
            <div className="admin-card-header">
              <h3>מצב נוכחי</h3>
            </div>
            <p className="admin-meta">
              אם אין טווחים מוגדרים, המערכת מציגה זמינות חדרים ללא שיעורים (בין סמסטרים).
            </p>
            <p className="admin-meta">
              סמסטר א׳: {rangeDraft.A.start && rangeDraft.A.end ? `${rangeDraft.A.start} – ${rangeDraft.A.end}` : "לא מוגדר"}
            </p>
            <p className="admin-meta">
              סמסטר ב׳: {rangeDraft.B.start && rangeDraft.B.end ? `${rangeDraft.B.start} – ${rangeDraft.B.end}` : "לא מוגדר"}
            </p>
          </div>
        </div>
        <div className="admin-split-side">
          <div className="admin-card" id="semesters-range">
            <div className="admin-card-header">
              <h3>עריכת טווחים</h3>
            </div>
            <div className="admin-form-grid">
              <label>
                סמסטר א׳ התחלה
                <input
                  type="date"
                  value={rangeDraft.A.start}
                  onChange={(event) =>
                    setRangeDraft((prev) => ({
                      ...prev,
                      A: { ...prev.A, start: event.target.value }
                    }))
                  }
                />
              </label>
              <label>
                סמסטר א׳ סיום
                <input
                  type="date"
                  value={rangeDraft.A.end}
                  onChange={(event) =>
                    setRangeDraft((prev) => ({
                      ...prev,
                      A: { ...prev.A, end: event.target.value }
                    }))
                  }
                />
              </label>
              <label>
                סמסטר ב׳ התחלה
                <input
                  type="date"
                  value={rangeDraft.B.start}
                  onChange={(event) =>
                    setRangeDraft((prev) => ({
                      ...prev,
                      B: { ...prev.B, start: event.target.value }
                    }))
                  }
                />
              </label>
              <label>
                סמסטר ב׳ סיום
                <input
                  type="date"
                  value={rangeDraft.B.end}
                  onChange={(event) =>
                    setRangeDraft((prev) => ({
                      ...prev,
                      B: { ...prev.B, end: event.target.value }
                    }))
                  }
                />
              </label>
            </div>
            <div className="admin-actions">
              <button className="secondary" type="button" onClick={onReset}>
                איפוס
              </button>
              <button className="primary" type="button" onClick={onSave}>
                שמירה
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
