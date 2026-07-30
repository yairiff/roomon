export type User = {
  name: string;
  email: string;
  picture?: string;
  pictureRemoved?: boolean;
  themePreference?: "light" | "dark";
  allowed: boolean;
  role?: "admin" | "moderator" | "student" | "pending";
  betaUser?: boolean;
  peopleToolEnabled?: boolean;
  phone?: string;
  cohortStartYear?: number;
};
