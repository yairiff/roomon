export type User = {
  name: string;
  email: string;
  picture?: string;
  allowed: boolean;
  role?: "admin" | "moderator" | "student" | "pending";
  phone?: string;
  cohortStartYear?: number;
};
