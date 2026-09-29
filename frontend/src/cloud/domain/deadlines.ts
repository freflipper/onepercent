import type { Entity, EntityKind, Profile } from './types';
import { addDays, dayInZone, deadlineToUtc, todayInZone } from './dates';
import { subscriptionOccurrences } from './calculations';
export interface Deadline {
  id: string;
  kind: EntityKind;
  title: string;
  date: string;
  at: string;
  allDay: boolean;
  color?: string;
  occurrence: string;
  source: Entity;
}
export interface ReminderPlan {
  source_id: string;
  source_kind: EntityKind;
  source_version: number;
  title: string;
  due_at: string;
  occurrence: string;
}
export function calendarItems(
  records: Entity[],
  profile: Profile,
  from: string,
  to: string,
): Deadline[] {
  const result: Deadline[] = [];
  for (const r of records) {
    const d = r.data;
    let dates: string[] = [];
    let at: string | null = null;
    let allDay = true;
    if (r.kind === 'event') {
      at = d.all_day ? null : d.start_at;
      dates = [d.all_day ? d.date : dayInZone(d.start_at, profile.timezone)];
      allDay = !!d.all_day;
    } else if (
      (r.kind === 'homework' && d.status !== 'Done') ||
      (r.kind === 'test' && d.status !== 'Completed')
    ) {
      dates = [d.date];
      allDay = !d.time;
    } else if (r.kind === 'reminder' && d.status === 'Pending') {
      at = d.due_at;
      dates = [dayInZone(d.due_at, profile.timezone)];
      allDay = false;
    } else if (r.kind === 'subscription' && d.status === 'Active' && !d.archived) {
      dates = subscriptionOccurrences(r, from, to).filter(
        (date) =>
          !records.some(
            (t) =>
              t.kind === 'transaction' &&
              t.data.subscription_id === r.id &&
              t.data.occurrence_date === date &&
              t.data.status === 'Recorded',
          ),
      );
    }
    for (const date of dates) {
      if (date < from || date > to) continue;
      const instant =
        at || deadlineToUtc(date, d.time || d.alert_time || '08:00', profile.timezone);
      result.push({
        id: r.id,
        kind: r.kind,
        title: d.title || d.name,
        date,
        at: instant,
        allDay,
        color: d.color,
        occurrence: r.kind === 'subscription' ? date : instant,
        source: r,
      });
    }
  }
  return result.sort((a, b) => a.at.localeCompare(b.at));
}
export function reminderPlans(
  records: Entity[],
  profile: Profile,
  now = new Date(),
): ReminderPlan[] {
  const today = todayInZone(profile.timezone, now);
  const items = calendarItems(records, profile, addDays(today, -7), addDays(today, 90));
  return items
    .filter(
      (item) =>
        item.kind === 'reminder' ||
        (item.source.data.reminder_minutes !== null &&
          item.source.data.reminder_minutes !== undefined),
    )
    .map((item) => {
      const offset = item.kind === 'reminder' ? 0 : Number(item.source.data.reminder_minutes);
      const due_at = new Date(new Date(item.at).getTime() - offset * 60000).toISOString();
      return {
        source_id: item.id,
        source_kind: item.kind,
        source_version: item.source.version,
        title: item.title,
        due_at,
        occurrence: item.kind === 'subscription' ? item.date : due_at,
      };
    })
    .filter((item) => new Date(item.due_at).getTime() >= now.getTime() - 7 * 86400000);
}
export function notificationKey(userId: string, p: ReminderPlan) {
  return `${userId}:${p.source_id}:${p.source_version}:${p.occurrence}:${p.due_at}`;
}
export function dailyRecap(records: Entity[], profile: Profile, now = new Date()) {
  const today = todayInZone(profile.timezone, now);
  const onToday = (iso: unknown) =>
    typeof iso === 'string' && dayInZone(iso, profile.timezone) === today;
  return {
    today,
    agenda: calendarItems(records, profile, today, today),
    homeworkDone: records.filter(
      (r) => r.kind === 'homework' && r.data.status === 'Done' && onToday(r.data.completed_at),
    ),
    homeworkPending: records.filter((r) => r.kind === 'homework' && r.data.status === 'To do'),
    tests: records.filter(
      (r) =>
        r.kind === 'test' &&
        r.data.status === 'Scheduled' &&
        r.data.date >= today &&
        r.data.date <= addDays(today, 7),
    ),
    notes: records.filter((r) => r.kind === 'note' && onToday(r.updated_at)),
    grades: records.filter((r) => r.kind === 'grade' && onToday(r.created_at)),
    trades: records.filter(
      (r) => r.kind === 'trade' && r.data.status === 'Closed' && onToday(r.data.closed_at),
    ),
    transactions: records.filter(
      (r) =>
        r.kind === 'transaction' && r.data.status === 'Recorded' && onToday(r.data.recorded_at),
    ),
    renewals: calendarItems(records, profile, today, addDays(today, 7)).filter(
      (i) => i.kind === 'subscription',
    ),
  };
}
