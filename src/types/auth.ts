export type User = {
  name: string;
  email: string;
  picture?: string;
  pictureRemoved?: boolean;
  allowed: boolean;
  role?: "admin" | "moderator" | "student" | "pending";
  phone?: string;
  cohortStartYear?: number;
};
