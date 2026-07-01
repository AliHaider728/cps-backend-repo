function minutes(value: string | number | null | undefined): number | null {
  if (!value) return null;
  const [hours, mins] = String(value).slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  return (hours * 60) + mins;
}

export function calculateHours(start_time: string | number | null | undefined, end_time: string | number | null | undefined): number | null {
  const start = minutes(start_time);
  const end = minutes(end_time);
  if (start === null || end === null || end <= start) return null;
  return Math.round(((end - start) / 60) * 100) / 100;
}

export function calculateFTE(total_hours: number | string | null | undefined): number {
  return Math.round((Number(total_hours || 0) / 37.5) * 100) / 100;
}

export interface CompareHoursResult {
  difference: number;
  flag_color: "green" | "yellow" | "red";
}

export function compareHours(expected: number | string | null | undefined, actual: number | string | null | undefined): CompareHoursResult {
  const difference = Math.round((Number(actual || 0) - Number(expected || 0)) * 100) / 100;
  const abs = Math.abs(difference);
  const flag_color = abs === 0 ? "green" : abs < 1 ? "yellow" : "red";
  return { difference, flag_color };
}

export const comparHours = compareHours;
