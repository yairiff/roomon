export type CsvTable = "users" | "lessons" | "reservations" | "special" | "exam" | "closed";

export const userCsvHeaders = ["email", "name", "role", "phone", "grade"];
export const lessonsCsvHeaders = ["semester", "day", "roomId", "startTime", "endTime", "title", "teacher"];
export const reservationsCsvHeaders = ["date", "roomId", "startTime", "endTime", "reservedEmail"];
export const specialCsvHeaders = ["date", "roomId", "startTime", "endTime", "label"];
export const examCsvHeaders = ["date", "roomId", "startTime", "endTime", "label"];
export const closedCsvHeaders = ["date", "roomId", "startTime", "endTime", "label"];
