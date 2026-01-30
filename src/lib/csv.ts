type CsvCell = string;

// Small CSV parser/stringifier for admin import/export.
// - RFC4180-ish: commas, CRLF/LF, quoted fields with "" escaping.
// - No fancy type inference; callers map/validate.

export function parseCsv(text: string): CsvCell[][] {
  const input = text.replace(/^\uFEFF/, ""); // strip UTF-8 BOM
  const rows: CsvCell[][] = [];
  let row: CsvCell[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    // Avoid trailing empty row from final newline.
    if (row.length === 1 && row[0] === "" && rows.length === 0) {
      // allow single empty header to be handled by caller
    }
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === "\"") {
        const next = input[i + 1];
        if (next === "\"") {
          cell += "\"";
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      pushCell();
      i += 1;
      continue;
    }

    if (ch === "\n") {
      pushCell();
      pushRow();
      i += 1;
      continue;
    }

    if (ch === "\r") {
      // Handle CRLF and bare CR.
      if (input[i + 1] === "\n") {
        pushCell();
        pushRow();
        i += 2;
        continue;
      }
      pushCell();
      pushRow();
      i += 1;
      continue;
    }

    cell += ch;
    i += 1;
  }

  // Flush last cell/row (even if empty, but avoid adding a trailing empty row if file ends with newline).
  if (inQuotes) {
    // Caller can decide what to do; keep best-effort parse.
    inQuotes = false;
  }
  pushCell();
  // If the only row is a single empty cell, treat it as no data.
  if (!(row.length === 1 && row[0] === "" && rows.length === 0)) {
    pushRow();
  }

  return rows;
}

export function stringifyCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const escapeCell = (value: unknown) => {
    const raw = value === null || value === undefined ? "" : String(value);
    if (/[",\r\n]/.test(raw)) {
      return `"${raw.replace(/\"/g, "\"\"")}"`;
    }
    return raw;
  };

  const lines: string[] = [];
  lines.push(headers.map(escapeCell).join(","));
  rows.forEach((row) => {
    lines.push(headers.map((h) => escapeCell((row as Record<string, unknown>)[h])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

export function parseCsvAsObjects(text: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const grid = parseCsv(text);
  if (!grid.length) return { headers: [], rows: [] };
  const headers = (grid[0] || []).map((h) => h.trim());
  const rows = grid.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, rows };
}

