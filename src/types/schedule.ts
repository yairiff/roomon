export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu";

export type WeekDay = {
  key: DayKey;
  label: string;
  short?: string;
};

export type TimeSlot = {
  startMinutes: number;
  endMinutes: number;
};

export type Lesson = {
  id: string;
  title: string;
  teacher: string;
  day: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
};

export type Room = {
  id: string;
  name: string;
  shortName: string;
  externalId?: string;
};

export type ScheduleConfig = {
  columns: {
    course: string;
    teacher: string;
    semesterA: string;
    semesterB: string;
    day: string;
    time: string;
    room: string;
  };
  semesterRanges: {
    key: "A" | "B";
    start: string;
    end: string;
  }[];
  dayMap: Record<string, DayKey>;
  startHour: number;
  endHour: number;
  slotMinutes: number;
  academicHourMinutes: number;
  roomLabelOverrides: Record<string, string>;
};

export type ScheduleData = {
  lessons: Lesson[];
  rooms: Room[];
  config: ScheduleConfig;
};
