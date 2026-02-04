export type MySchedulePinKind = "lesson" | "special" | "closed";

export type MySchedulePin = {
  id: string;
  kind: MySchedulePinKind;
  dateKey: string;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  title: string;
  meta: string;
  createdAt: number;
};

