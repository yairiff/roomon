import fs from "fs";
import path from "path";
import process from "process";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  writeBatch
} from "firebase/firestore";

const ROOT = process.cwd();

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

function unescapeString(value) {
  return value.replace(/\\\\/g, "\\").replace(/\\"/g, "\"");
}

function parseObjectBlock(text, name) {
  const match = new RegExp(`${name}\\s*:[\\s\\S]*?{([\\s\\S]*?)}\\s*[,\\n]`).exec(text)
    || new RegExp(`${name}[^=]*=\\s*{([\\s\\S]*?)}\\s*;`).exec(text);
  if (!match) return {};
  const body = match[1];
  const map = {};
  const pairRegex = /(?:"((?:\\.|[^"\\])*)"|([A-Za-z0-9_]+))\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let pair;
  while ((pair = pairRegex.exec(body))) {
    const key = pair[1] ? unescapeString(pair[1]) : pair[2];
    map[key] = unescapeString(pair[3]);
  }
  return map;
}

function parseArrayBlock(text, name) {
  const match = new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]\\s*;`).exec(text);
  if (!match) return [];
  const body = match[1];
  const values = [];
  const valueRegex = /"((?:\\.|[^"\\])*)"/g;
  let value;
  while ((value = valueRegex.exec(body))) {
    values.push(unescapeString(value[1]));
  }
  return values;
}

function parseScheduleConfig(text) {
  const columns = parseObjectBlock(text, "columns");
  const dayMap = parseObjectBlock(text, "dayMap");
  const startHour = Number(/startHour\\s*:\\s*(\\d+)/.exec(text)?.[1] ?? 9);
  const endHour = Number(/endHour\\s*:\\s*(\\d+)/.exec(text)?.[1] ?? 22);
  const slotMinutes = Number(/slotMinutes\\s*:\\s*(\\d+)/.exec(text)?.[1] ?? 60);
  const academicHourMinutes = Number(/academicHourMinutes\\s*:\\s*(\\d+)/.exec(text)?.[1] ?? 45);
  return {
    columns,
    dayMap,
    startHour,
    endHour,
    slotMinutes,
    academicHourMinutes
  };
}

function parseCsv(text, delimiter = ",") {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;

  const pushValue = () => {
    current.push(value);
    value = "";
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "\uFEFF" && rows.length === 0 && current.length === 0 && value === "") continue;
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
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
    if (char === "\n") {
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

function normalizeRow(row, targetLength) {
  if (!targetLength || row.length >= targetLength) return row;
  return row.concat(Array.from({ length: targetLength - row.length }, () => ""));
}

function buildLessonsFromCsv(csvText, config, semesterKey) {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const [header, ...dataRows] = rows;
  const columnIndex = {};
  Object.entries(config.columns).forEach(([key, label]) => {
    const index = header.findIndex((cell) => String(cell || "").trim() === String(label || "").trim());
    columnIndex[key] = index;
  });

  const required = ["course", "day", "time", "room"];
  const hasRequired = required.every((col) => columnIndex[col] !== -1);
  if (!hasRequired) return [];

  const dayTokens = Object.keys(config.dayMap);
  const expanded = [];
  dataRows.forEach((row) => {
    if (!row || row.length === 0) return;
    if (row.length <= header.length) {
      expanded.push(row);
      return;
    }
    const dayIndexes = row
      .map((cell, index) => ({ index, value: String(cell || "").trim() }))
      .filter((entry) => dayTokens.includes(entry.value))
      .map((entry) => entry.index);
    if (dayIndexes.length) {
      dayIndexes.forEach((dayIndex) => {
        const start = dayIndex - 4;
        const end = dayIndex + 3;
        if (start < 0 || end > row.length) return;
        const slice = row.slice(start, end);
        if (slice.length === header.length) expanded.push(slice);
      });
      return;
    }
    const fullChunks = Math.floor(row.length / header.length);
    for (let i = 0; i < fullChunks; i += 1) {
      expanded.push(row.slice(i * header.length, (i + 1) * header.length));
    }
  });

  const lessons = [];
  expanded.forEach((row, index) => {
    const normalizedRow = normalizeRow(row, header.length);
    const getCell = (key) => {
      const idx = columnIndex[key];
      return idx === -1 || typeof idx !== "number" ? "" : (normalizedRow[idx] ?? "");
    };
    const course = String(getCell("course") || "").trim();
    if (!course) return;
    const dayRaw = String(getCell("day") || "").trim();
    const day = config.dayMap[dayRaw];
    if (!day) return;
    const roomId = String(getCell("room") || "").trim();
    if (!roomId) return;
    const timeValue = getCell("time");
    const startMinutes = parseTimeToMinutes(timeValue);
    if (!Number.isFinite(startMinutes)) return;
    const durationAcademic = pickSemesterHours(normalizedRow, columnIndex, semesterKey);
    if (!durationAcademic || durationAcademic <= 0) return;
    const durationMinutes = Math.round(durationAcademic * config.academicHourMinutes);
    if (durationMinutes <= 0) return;
    lessons.push({
      id: `lesson-${semesterKey}-${index}`,
      title: course,
      teacher: String(getCell("teacher") || "").trim(),
      day,
      roomId,
      startMinutes,
      durationMinutes
    });
  });
  return lessons;
}

function pickSemesterHours(row, columnIndex, semesterKey) {
  const key = semesterKey === "B" ? "semesterB" : "semesterA";
  const idx = columnIndex[key];
  if (idx === -1 || typeof idx !== "number") return 0;
  const raw = row[idx];
  if (raw === "" || raw === null || raw === undefined) return 0;
  const num = Number(String(raw).replace(/,/g, "."));
  return Number.isFinite(num) ? num : 0;
}

function parseTimeToMinutes(raw) {
  if (raw === "" || raw === null || raw === undefined) return Number.NaN;
  const text = String(raw).trim();
  if (text.includes(":")) {
    const [hoursText, minutesText = "0"] = text.split(":");
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
    return hours * 60 + minutes;
  }
  const value = Number(text.replace(/,/g, "."));
  if (!Number.isFinite(value)) return Number.NaN;
  const hours = Math.floor(value);
  const fraction = value - hours;
  const minutes = Math.round(fraction * 60);
  return hours * 60 + minutes;
}

async function replaceCollection(db, name, docs) {
  const snap = await getDocs(collection(db, name));
  const existing = snap.docs;
  const deleteChunks = chunk(existing, 400);
  for (const group of deleteChunks) {
    const batch = writeBatch(db);
    group.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }

  const chunks = chunk(docs, 400);
  for (const group of chunks) {
    const batch = writeBatch(db);
    group.forEach((docData) => {
      batch.set(doc(db, name, docData.id), docData);
    });
    await batch.commit();
  }
}

function chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

async function main() {
  loadEnv();

  const config = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID
  };

  if (!config.apiKey || !config.projectId || !config.appId) {
    throw new Error("Missing Firebase config in .env.");
  }

  const roomsText = fs.readFileSync(path.join(ROOT, "scripts/seed-data/rooms.ts"), "utf8");
  const labels = parseObjectBlock(roomsText, "roomLabels");
  const shorts = parseObjectBlock(roomsText, "roomShortLabels");
  const order = parseArrayBlock(roomsText, "roomOrder");
  const scheduleText = fs.readFileSync(path.join(ROOT, "src/config.ts"), "utf8");
  const scheduleConfig = parseScheduleConfig(scheduleText);
  const csvText = fs.readFileSync(path.join(ROOT, "scripts/seed-data/rimon_schedule.csv"), "utf8");

  const allowedPath = path.join(ROOT, "scripts/seed-data/allowedStudents.ts");
  const allowedText = fs.existsSync(allowedPath) ? fs.readFileSync(allowedPath, "utf8") : "";
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi;
  const allowedStudents = Array.from(new Set((allowedText.match(emailRegex) || []).map((e) => e.toLowerCase())));

  const adminEmailArg = getArg("admin");
  const adminEmail = (adminEmailArg || allowedStudents[0] || "").toLowerCase();
  if (!adminEmail) {
    throw new Error("Admin email missing. Pass --admin=email@example.com");
  }

  const app = initializeApp(config);
  const db = getFirestore(app);

  const roomIds = [
    ...order,
    ...Object.keys(labels).filter((id) => !order.includes(id)),
    ...Object.keys(shorts).filter((id) => !order.includes(id))
  ];
  const rooms = roomIds.map((id, index) => ({
    id,
    name: labels[id] || id.replace(/_/g, " "),
    shortName: shorts[id] || labels[id] || id.replace(/_/g, " "),
    openMinutes: scheduleConfig.startHour * 60,
    closeMinutes: scheduleConfig.endHour * 60,
    isClosed: false,
    sortOrder: index
  }));

  const lessonsA = buildLessonsFromCsv(csvText, scheduleConfig, "A")
    .map((lesson, index) => ({ ...lesson, id: `A-${index}`, semester: "A" }));
  const lessonsB = buildLessonsFromCsv(csvText, scheduleConfig, "B")
    .map((lesson, index) => ({ ...lesson, id: `B-${index}`, semester: "B" }));
  const lessons = [...lessonsA, ...lessonsB];

  const users = Array.from(new Set([adminEmail, ...allowedStudents])).map((email) => ({
    id: email,
    email,
    name: "",
    role: email === adminEmail ? "admin" : "student"
  }));

  await replaceCollection(db, "rooms", rooms);
  await replaceCollection(db, "lessons", lessons);
  await replaceCollection(db, "users", users);

  console.log(`Seeded rooms=${rooms.length}, lessons=${lessons.length}, users=${users.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
