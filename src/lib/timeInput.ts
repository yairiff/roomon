import { formatMinutes } from "./scheduleBuilder";

export function toTimeInput(minutes: number): string {
  return formatMinutes(minutes);
}

// Parses a `HH:MM` input value into minutes since midnight.
// Returns 0 for empty/invalid values to keep callsites simple.
export function parseTimeInput(value: string): number {
  if (!value) return 0;
  const [hoursText, minutesText = "0"] = value.split(":");
  const hours = Number(hoursText);
  const mins = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return 0;
  return hours * 60 + mins;
}

