export function formatDurationLabelHe(minutes: number): string {
  if (minutes === 30) return "חצי שעה";
  if (minutes === 45) return "45 דקות";
  if (minutes === 60) return "שעה";
  if (minutes === 75) return "שעה ורבע";
  if (minutes === 90) return "שעה וחצי";
  if (minutes === 105) return "שעה ו-45 דקות";
  if (minutes === 120) return "שעתיים";
  if (minutes === 150) return "שעתיים וחצי";
  if (minutes === 180) return "3 שעות";

  const hours = minutes / 60;
  if (Number.isInteger(hours)) {
    if (hours === 1) return "שעה";
    if (hours === 2) return "שעתיים";
    return `${hours} שעות`;
  }
  return `${hours.toFixed(2)} שעות`;
}

