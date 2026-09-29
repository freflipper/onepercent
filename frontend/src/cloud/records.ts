import { dayInZone, localToUtc, timeInZone } from './domain/dates';
import type { Data, Entity, EntityKind, Profile } from './domain/types';

export const kinds = {
  subjects: 'subject',
  folders: 'folder',
  events: 'event',
  reminders: 'reminder',
  homework: 'homework',
  tests: 'test',
  grades: 'grade',
  timetable: 'slot',
  subscriptions: 'subscription',
  finance: 'transaction',
  accounts: 'account',
  cashflows: 'cashflow',
  strategies: 'strategy',
  trades: 'trade',
  notes: 'note',
  screenshots: 'screenshot',
} as const;
export type Section = keyof typeof kinds;
export const sections = Object.fromEntries(
  Object.entries(kinds).map(([section, kind]) => [kind, section]),
) as Record<EntityKind, string>;
const fields: Record<Section, string[]> = {
  subjects: ['name', 'color', 'archived'],
  folders: ['name', 'color'],
  events: [
    'title',
    'date',
    'all_day',
    'time',
    'end_time',
    'description',
    'location',
    'color',
    'reminder_minutes',
    'alert_time',
  ],
  reminders: ['title', 'date', 'time', 'description', 'status', 'reminder_minutes', 'alert_time'],
  homework: [
    'title',
    'subject_id',
    'description',
    'date',
    'time',
    'reminder_minutes',
    'alert_time',
    'status',
  ],
  tests: [
    'title',
    'subject_id',
    'type',
    'date',
    'time',
    'notes',
    'reminder_minutes',
    'alert_time',
    'status',
  ],
  grades: ['subject_id', 'value', 'date', 'type', 'notes'],
  timetable: ['day', 'hour', 'subject_id'],
  subscriptions: [
    'name',
    'amount',
    'frequency',
    'next_date',
    'category',
    'notes',
    'status',
    'reminder_minutes',
    'alert_time',
  ],
  finance: ['type', 'amount', 'date', 'category', 'description', 'status'],
  accounts: ['name', 'type', 'provider', 'currency', 'opening_balance', 'opening_date', 'archived'],
  cashflows: ['account_id', 'type', 'amount', 'date', 'notes'],
  strategies: [
    'name',
    'description',
    'entry_rules',
    'exit_rules',
    'risk_management',
    'checklist',
    'notes',
    'archived',
  ],
  trades: [
    'account_id',
    'instrument',
    'direction',
    'status',
    'opened_at',
    'closed_at',
    'entry_price',
    'exit_price',
    'stop_loss',
    'take_profit',
    'quantity',
    'initial_risk',
    'gross_pnl',
    'commission',
    'swap',
    'strategy_id',
    'notes',
  ],
  notes: ['title', 'subject_id', 'folder_id', 'pages', 'editor_version'],
  screenshots: ['title', 'date', 'notes', 'trade_id'],
};
const renames: Record<string, string> = {
  amount: 'amount_cents',
  notes: 'note',
  risk_management: 'risk_rules',
  gross_pnl: 'gross_cents',
  commission: 'commission_cents',
  swap: 'swap_cents',
  initial_risk: 'risk_cents',
};
export function sectionKind(section: string): EntityKind {
  if (!Object.hasOwn(kinds, section)) throw new Error('Unknown section.');
  return kinds[section as Section];
}
export function profileView(
  profile: Profile,
  identity: { email?: string; user_metadata?: Data } = {},
) {
  return {
    ...profile,
    user_id: profile.id,
    email: identity.email || '',
    picture: identity.user_metadata?.avatar_url || '',
    visible_days: profile.visible_days.map((day) => day - 1),
  };
}
export function profilePatch(value: Data): Partial<Profile> {
  const patch: Data = {};
  for (const key of [
    'name',
    'timezone',
    'theme',
    'opening_balance',
    'opening_date',
    'visible_days',
    'trading_expanded',
  ])
    if (key in value) patch[key] = value[key];
  if ('visible_days' in patch) {
    if (
      !Array.isArray(patch.visible_days) ||
      !patch.visible_days.length ||
      new Set(patch.visible_days).size !== patch.visible_days.length ||
      patch.visible_days.some(
        (day: unknown) => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6,
      )
    )
      throw new Error('Choose at least one unique weekday.');
    patch.visible_days = patch.visible_days.map((day: number) => day + 1).sort();
  }
  return patch;
}
export function recordView(record: Entity, profile: Profile, includePages = true): Data {
  const d: Data = JSON.parse(JSON.stringify(record.data));
  for (const [flat, canonical] of Object.entries(renames))
    if (canonical in d) {
      d[flat] = d[canonical];
      delete d[canonical];
    }
  if (record.kind === 'account') {
    d.opening_balance = d.opening_cents;
    delete d.opening_cents;
  }
  if (record.kind === 'slot') d.day--;
  if (record.kind === 'subscription' && d.archived) d.status = 'Archived';
  if (record.kind === 'event') {
    d.date = d.all_day ? d.date : dayInZone(d.start_at, profile.timezone);
    d.time = d.all_day ? null : timeInZone(d.start_at, profile.timezone);
    d.end_time = d.all_day ? null : timeInZone(d.end_at, profile.timezone);
    d.end_date = d.all_day ? null : dayInZone(d.end_at, profile.timezone);
  }
  if (record.kind === 'reminder') {
    d.reminder_minutes ??= 0;
    const deadline = new Date(Date.parse(d.due_at) + d.reminder_minutes * 60_000).toISOString();
    d.date = dayInZone(deadline, profile.timezone);
    d.time = timeInZone(deadline, profile.timezone);
  }
  if (record.kind === 'note') {
    d.read_only = d.editor_version !== 2;
    if (!includePages) delete d.pages;
  }
  return {
    ...d,
    id: record.id,
    kind: sections[record.kind] || record.kind,
    owner_id: record.user_id,
    version: record.version,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

/** Merge PATCH fields with the canonical snapshot, preserving immutable server metadata. */
export function recordPayload(
  section: string,
  payload: Data,
  profile: Profile,
  previous?: Entity,
): Data {
  sectionKind(section);
  const kind = section as Section;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Invalid record.');
  if (Object.keys(payload).some((key) => !fields[kind].includes(key) && key !== 'version'))
    throw new Error('The form contains unsupported fields.');
  if (kind === 'notes' && previous && previous.data.editor_version !== 2)
    throw new Error(
      'This notebook uses the previous editor format and is read-only. Its original data has been kept.',
    );
  if (
    kind === 'finance' &&
    previous?.data.subscription_id &&
    Object.keys(payload).some((key) => !['status', 'version'].includes(key))
  )
    throw new Error('Linked payments preserve their amount and date. Change their status instead.');
  const data = previous ? JSON.parse(JSON.stringify(previous.data)) : {};
  for (const key of fields[kind])
    if (key in payload)
      data[
        kind === 'accounts' && key === 'opening_balance' ? 'opening_cents' : renames[key] || key
      ] = payload[key];
  const before = previous ? recordView(previous, profile) : {};
  const flat = { ...before, ...payload };
  if (['events', 'homework', 'tests', 'subscriptions'].includes(kind)) {
    data.reminder_minutes ??= null;
    data.alert_time ||= '08:00';
  }
  if (kind === 'events') {
    data.date = flat.date;
    if (!data.all_day) {
      // Editing a title must not shift an existing repeated-hour or multi-day event.
      const unchanged =
        previous &&
        ['date', 'time', 'end_time', 'all_day'].every((field) => flat[field] === before[field]);
      data.start_at = unchanged
        ? previous.data.start_at
        : localToUtc(flat.date, flat.time, profile.timezone);
      data.end_at = unchanged
        ? previous.data.end_at
        : localToUtc(flat.date, flat.end_time, profile.timezone);
      if (Date.parse(data.end_at) <= Date.parse(data.start_at))
        throw new Error('End time must be after start time.');
    } else {
      data.start_at = null;
      data.end_at = null;
    }
    delete data.time;
    delete data.end_time;
  }
  if (kind === 'reminders') {
    const minutes = flat.reminder_minutes ?? 0;
    if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 525_600)
      throw new Error('Choose a valid reminder interval.');
    const sameDeadline = previous && flat.date === before.date && flat.time === before.time;
    const deadline = sameDeadline
      ? Date.parse(previous.data.due_at) + (previous.data.reminder_minutes || 0) * 60_000
      : Date.parse(
          localToUtc(flat.date, flat.time || flat.alert_time || '08:00', profile.timezone),
        );
    data.due_at = new Date(deadline - minutes * 60_000).toISOString();
    data.reminder_minutes = minutes;
    delete data.date;
    delete data.time;
  }
  if (kind === 'timetable') {
    if (!Number.isInteger(flat.day) || flat.day < 0 || flat.day > 6)
      throw new Error('Choose a valid weekday.');
    data.day = flat.day + 1;
  }
  if (kind === 'subscriptions') {
    data.archived = flat.status === 'Archived';
    data.status = data.archived ? previous?.data.status || 'Active' : flat.status;
    if (!previous || ('next_date' in payload && previous.data.next_date !== payload.next_date))
      data.anchor_day = Number(data.next_date.slice(-2));
  }
  if (kind === 'trades') {
    if (data.risk_cents != null && data.risk_cents < 0)
      throw new Error('Initial risk cannot be negative.');
    if (data.quantity != null && data.quantity <= 0)
      throw new Error('Quantity must be greater than zero.');
    if (data.status === 'Closed' && Date.parse(data.closed_at) > Date.now())
      throw new Error('Closing time cannot be in the future.');
  }
  if (kind === 'notes') {
    data.editor_version = 2;
    data.subject_id ??= null;
    data.folder_id ??= null;
  }
  return data;
}
