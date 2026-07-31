import { gradeLabelFromCohort } from "./academics";
import type { DirectoryUser } from "../types/admin";

export type PeopleCategory = "all" | "year-a" | "year-b" | "year-c" | "alumni" | "staff";

export const peopleCategoryOptions: Array<{ value: PeopleCategory; label: string }> = [
  { value: "all", label: "כולם" },
  { value: "year-a", label: "שנה א׳" },
  { value: "year-b", label: "שנה ב׳" },
  { value: "year-c", label: "שנה ג׳" },
  { value: "alumni", label: "בוגרים" },
  { value: "staff", label: "צוות" }
];

export const getPeopleCategory = (user: Pick<DirectoryUser, "cohortStartYear">): Exclude<PeopleCategory, "all"> => {
  if (user.cohortStartYear == null) return "staff";
  const grade = gradeLabelFromCohort(user.cohortStartYear);
  if (grade === "א") return "year-a";
  if (grade === "ב") return "year-b";
  if (grade === "ג") return "year-c";
  return "alumni";
};

export const getPeopleCategoryLabel = (user: Pick<DirectoryUser, "cohortStartYear">) => {
  const category = getPeopleCategory(user);
  return peopleCategoryOptions.find((option) => option.value === category)?.label || "צוות";
};

export const matchesPeopleCategory = (
  user: Pick<DirectoryUser, "cohortStartYear">,
  category: PeopleCategory
) => category === "all" || getPeopleCategory(user) === category;
