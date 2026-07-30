import type { Lesson } from "./schedule";
import type { SemesterKey } from "./ui";

export type UserRole = "admin" | "moderator" | "student" | "pending";

export type DirectoryUser = {
  email: string;
  name: string;
  role: UserRole;
  betaUser?: boolean;
  peopleToolEnabled?: boolean;
  themePreference?: "light" | "dark";
  phone?: string;
  pictureUrl?: string;
  pictureRemoved?: boolean;
  cohortStartYear?: number;
  notes?: string;
};

export type RoomMeta = {
  openMinutes?: number;
  closeMinutes?: number;
  isClosed?: boolean;
  sortOrder?: number;
  note?: string;
};

export type RoomRecord = {
  id: string;
  name: string;
  shortName: string;
  imageUrl?: string;
  rehearsalSuitable?: boolean;
  recordingSuitable?: boolean;
  apiName?: string;
  apiShortName?: string;
  externalId?: string;
  externalSlug?: string;
  syncSource?: "manual" | "api";
  syncHash?: string;
} & RoomMeta;

export type LessonRecord = Lesson & {
  semester: SemesterKey;
  syncSource?: "manual" | "api";
  externalId?: string;
};

export type LessonOverrideAction = "add" | "update" | "delete";

export type LessonOverride = {
  id: string;
  date: string;
  action: LessonOverrideAction;
  targetLessonId?: string;
  lesson?: Lesson;
  createdAt?: number;
  createdBy?: string;
  syncSource?: "manual" | "api";
  externalId?: string;
  syncHash?: string;
};
