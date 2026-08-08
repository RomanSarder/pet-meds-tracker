export function addToDate(date: Date, delta: { days?: number; minutes?: number }): Date {
  const result = new Date(date);
  if (delta.days) result.setDate(result.getDate() + delta.days);
  if (delta.minutes) result.setMinutes(result.getMinutes() + delta.minutes);
  return result;
}
