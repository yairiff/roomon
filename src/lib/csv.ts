export function parseCsv(text: string, delimiter = ","): string[][] {
  if (!text) return [];
  const normalized = normalizeQuoteLines(text);
  const rows: string[][] = [];
  let current: string[] = [];
  let value = "";
  let inQuotes = false;

  const pushValue = () => {
    current.push(value);
    value = "";
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === "\uFEFF" && rows.length === 0 && current.length === 0 && value === "") {
      continue;
    }

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      pushValue();
      continue;
    }

    if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      pushValue();
      rows.push(current);
      current = [];
      inQuotes = false;
      continue;
    }

    value += char;
  }

  if (value.length > 0 || current.length > 0) {
    pushValue();
    rows.push(current);
  }

  return rows;
}

function normalizeQuoteLines(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized
    .split("\n")
    .map((line) => {
      const quoteCount = (line.match(/"/g) || []).length;
      if (quoteCount % 2 === 1) {
        return line.replace(/"/g, "");
      }
      return line;
    })
    .join("\n");
}
