import type { ReactNode } from "react";
import type { CsvTable } from "./csvSchema";

type CsvHelpRow = { key: string; value: string };

function renderCsvHelp(rows: CsvHelpRow[]) {
  return (
    <div className="admin-csv-help-card" aria-label="שדות CSV">
      <div className="admin-csv-help-title">שדות בקובץ</div>
      <div className="admin-csv-help">
        {rows.map((row) => (
          <div key={row.key} className="admin-csv-help-row">
            <div className="admin-csv-help-key">{row.key}</div>
            <div className="admin-csv-help-value">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const usersCsvHelp: ReactNode = renderCsvHelp([
  { key: "email", value: "אימייל (מזהה ייחודי)" },
  { key: "name", value: "שם תצוגה" },
  { key: "role", value: "student (משתמש) / moderator (מתאם) / admin (מנהל) / pending (ממתין)" },
  { key: "phone", value: "טלפון (אופציונלי)" },
  { key: "grade", value: "A / B / C / STAFF (אפשר גם א/ב/ג/צוות). אם grade=צוות ו-role ריק → ברירת מחדל moderator" }
]);

export function scheduleCsvHelp(table: Exclude<CsvTable, "users">): ReactNode {
  const rows: CsvHelpRow[] =
    table === "lessons"
      ? [
          { key: "semester", value: "A / B (אופציונלי, ברירת מחדל: הסמסטר הפעיל)" },
          { key: "day", value: "א / ב / ג / ד / ה (אפשר גם sun/mon/tue/wed/thu)" },
          { key: "roomId", value: "מזהה חדר" },
          { key: "startTime", value: "HH:MM (למשל 09:00)" },
          { key: "endTime", value: "HH:MM (למשל 10:30)" },
          { key: "title", value: "שם שיעור" },
          { key: "teacher", value: "מרצה" }
        ]
      : table === "reservations"
        ? [
            { key: "date", value: "YYYY-MM-DD" },
            { key: "roomId", value: "מזהה חדר" },
            { key: "startTime", value: "HH:MM" },
            { key: "endTime", value: "HH:MM" },
            { key: "reservedEmail", value: "אימייל" }
          ]
        : [
            { key: "date", value: "YYYY-MM-DD" },
            { key: "roomId", value: "מזהה חדר" },
            { key: "startTime", value: "HH:MM" },
            { key: "endTime", value: "HH:MM" },
            {
              key: "label",
              value: table === "special" ? "תיאור אירוע" : table === "exam" ? "תיאור מבחן" : "תיאור סגירה"
            }
          ];

  return renderCsvHelp(rows);
}
