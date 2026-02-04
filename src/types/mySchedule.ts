export type MySchedulePinKind = "lesson" | "special" | "closed" | "reservation";

export type MySchedulePin = {
  id: string;
  kind: MySchedulePinKind;
  dateKey: string;
  // For recurring lessons we store the underlying schedule lesson id.
  // When present, the pin recurs weekly (with lesson overrides/exceptions applied per date).
  lessonId?: string;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  title: string;
  meta: string;
  reservedEmail?: string;
  createdAt: number;
};
