// Display-only formatting: never parse/rewrite stored deadlines or timestamps.
const formatters = new Map<string, { date: Intl.DateTimeFormat; month: Intl.DateTimeFormat }>();
export function getHomeTime(instant: Date, requestedZone = 'Europe/Rome') {
  let zone = requestedZone || 'Europe/Rome';
  if (!formatters.has(zone)) {
    try {
      formatters.set(zone, {
        date: new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
        month: new Intl.DateTimeFormat('en-GB', { timeZone: zone, month: 'long' }),
      });
    } catch { zone = 'Europe/Rome'; return getHomeTime(instant, zone); }
  }
  const formatter = formatters.get(zone)!;
  const parts = Object.fromEntries(formatter.date.formatToParts(instant).map(p => [p.type, p.value]));
  const monthName = formatter.month.format(instant), hour = Number(parts.hour);
  const greeting = hour >= 5 && hour < 12 ? 'Good Morning' : hour >= 12 && hour < 18 ? 'Good Afternoon' : 'Good Evening';
  return { zone, hour, greeting, hoursMinutes: `${parts.hour}:${parts.minute}`, seconds: `:${parts.second}`, day: parts.day,
    monthShort: monthName.slice(0, 3).toUpperCase(), fullDate: `${parts.weekday}, ${Number(parts.day)} ${monthName} ${parts.year}`,
    shortDate: `${parts.weekday.slice(0, 3)}, ${Number(parts.day)} ${monthName.slice(0, 3)}`,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(parts.weekday) };
}