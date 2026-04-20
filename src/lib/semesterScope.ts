export const buildYearlySemesterId = (studyYear: number) => `yearly:${Math.floor(studyYear)}`;

export const parseYearlySemesterId = (semesterId: string) => {
  const trimmed = semesterId.trim();
  const matched = trimmed.match(/^yearly:(\d{4})$/);
  if (!matched) return undefined;
  const studyYear = Number(matched[1]);
  if (!Number.isFinite(studyYear)) return undefined;
  return studyYear;
};

