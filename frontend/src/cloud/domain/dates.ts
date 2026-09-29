/** Date-only values deliberately never pass through the device's local timezone. */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function zoneParts(instant: Date | string, timezone: string) {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid date and time.');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
}

export function dayInZone(iso: string, timezone: string): string {
  const p = zoneParts(iso, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}
export function todayInZone(timezone: string, now: Date = new Date()): string {
  return dayInZone(now.toISOString(), timezone);
}
export function timeInZone(iso: string, timezone: string): string {
  const p = zoneParts(iso, timezone);
  return `${p.hour}:${p.minute}`;
}
export function addDays(date: string, days: number): string {
  if (!isLocalDate(date) || !Number.isInteger(days)) throw new Error('Enter a valid date.');
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function monthEnd(date: string): string {
  if (!isLocalDate(date)) throw new Error('Enter a valid date.');
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}
export function greeting(timezone: string, now: Date = new Date()): string {
  const hour = Number(zoneParts(now, timezone).hour);
  return hour >= 5 && hour < 12
    ? 'Good Morning'
    : hour >= 12 && hour < 18
      ? 'Good Afternoon'
      : 'Good Evening';
}

/** Reject nonexistent spring-forward times. At the repeated autumn hour choose the first occurrence. */
export function localToUtc(date: string, time: string, timezone: string): string {
  if (!isLocalDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error('Enter a valid date and time.');
  const target = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  // Offsets on both sides of a transition also cover fractional offsets and date-line zones.
  for (const h of [-36, -12, 0, 12, 36]) {
    const instant = target + h * 3_600_000;
    const p = zoneParts(new Date(instant), timezone);
    const wall = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    offsets.add(wall - instant);
  }
  const matches = [...offsets]
    .map((offset) => new Date(target - offset).toISOString())
    .filter((iso) => dayInZone(iso, timezone) === date && timeInZone(iso, timezone) === time)
    .sort();
  if (!matches.length)
    throw new Error('This time does not exist because the clocks change. Choose another time.');
  return matches[0];
}

/** Existing/recurring deadlines survive a timezone change or a later spring DST gap.
 * Explicit user-entered timestamps still use strict localToUtc instead.
 */
export function deadlineToUtc(date: string, time: string, timezone: string): string {
  try {
    return localToUtc(date, time, timezone);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('does not exist because the clocks change')
    )
      throw error;
  }
  const wall = Date.parse(`${date}T${time}:00Z`);
  for (let minutes = 1; minutes <= 180; minutes++) {
    const next = new Date(wall + minutes * 60_000).toISOString();
    try {
      return localToUtc(next.slice(0, 10), next.slice(11, 16), timezone);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('does not exist because the clocks change')
      )
        throw error;
    }
  }
  throw new Error('This deadline falls in a timezone transition. Choose another alert time.');
}
