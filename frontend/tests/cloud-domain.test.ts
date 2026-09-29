import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertPlans,
  bootstrapView,
  calendarView,
  financeView,
  tradingView,
} from '../src/cloud/calculations';
import {
  kinds,
  profilePatch,
  profileView,
  recordPayload,
  recordView,
  sectionKind,
} from '../src/cloud/records';
import { defaultProfile, type Data, type Entity, type EntityKind } from '../src/cloud/domain/types';
const OWNER = '11111111-1111-4111-8111-111111111111';
const profile = { ...defaultProfile(OWNER), opening_date: '2026-01-01', opening_balance: 10_000 };
const entity = (kind: EntityKind, data: Data, id = `${kind}-fixture`): Entity => ({
  id,
  kind,
  data,
  user_id: OWNER,
  version: 3,
  created_at: '2026-09-29T10:00:00Z',
  updated_at: '2026-09-29T10:00:00Z',
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());
describe('Emergent contracts mapped to Supabase', () => {
  it.each(Object.entries(kinds))('maps %s to %s', (section, kind) => {
    expect(sectionKind(section)).toBe(kind);
  });
  it('rejects inherited section keys', () => {
    expect(() => sectionKind('__proto__')).toThrow();
  });
  it('round-trips all seven weekdays, including Sunday', () => {
    const patch = profilePatch({ visible_days: [0, 5, 6] });
    expect(patch.visible_days).toEqual([1, 6, 7]);
    expect(profileView({ ...profile, ...patch }).visible_days).toEqual([0, 5, 6]);
    const data = recordPayload('timetable', { day: 6, hour: 9, subject_id: 'subject' }, profile);
    expect(data.day).toBe(7);
    expect(recordView(entity('slot', data), profile).day).toBe(6);
    expect(() => profilePatch({ visible_days: [6, 6] })).toThrow();
  });
  it('uses integer cents without multiplying them again', () => {
    const data = recordPayload(
      'trades',
      {
        initial_risk: 500,
        gross_pnl: 200,
        commission: 20,
        swap: -5,
        notes: 'Plan',
        status: 'Closed',
        closed_at: '2026-09-28T09:00:00Z',
      },
      profile,
    );
    expect(data).toMatchObject({
      risk_cents: 500,
      gross_cents: 200,
      commission_cents: 20,
      swap_cents: -5,
      note: 'Plan',
    });
    expect(recordView(entity('trade', data), profile)).toMatchObject({
      initial_risk: 500,
      gross_pnl: 200,
      commission: 20,
      swap: -5,
      notes: 'Plan',
    });
    expect(recordPayload('accounts', { opening_balance: 12345 }, profile).opening_cents).toBe(
      12345,
    );
  });
  it('converts event wall times to UTC and rejects the spring DST gap', () => {
    const data = recordPayload(
      'events',
      { title: 'Event', date: '2026-09-29', all_day: false, time: '15:00', end_time: '16:00' },
      profile,
    );
    expect(data.start_at).toBe('2026-09-29T13:00:00.000Z');
    expect(data.end_at).toBe('2026-09-29T14:00:00.000Z');
    expect(recordView(entity('event', data), profile)).toMatchObject({
      date: '2026-09-29',
      time: '15:00',
      end_time: '16:00',
    });
    expect(() =>
      recordPayload(
        'events',
        { date: '2027-03-28', all_day: false, time: '02:30', end_time: '04:00' },
        profile,
      ),
    ).toThrow();
  });
  it('preserves reminder deadlines and advance intervals', () => {
    const data = recordPayload(
      'reminders',
      {
        title: 'Deadline',
        date: '2026-09-29',
        time: '15:00',
        reminder_minutes: 30,
        status: 'Pending',
      },
      profile,
    );
    expect(data.due_at).toBe('2026-09-29T12:30:00.000Z');
    const row = entity('reminder', data);
    expect(recordView(row, profile)).toMatchObject({
      date: '2026-09-29',
      time: '15:00',
      reminder_minutes: 30,
    });
    expect(alertPlans([row], profile)[0].due_at).toBe(data.due_at);
  });
  it('stores archive state independently and retains the subscription anchor', () => {
    const old = entity('subscription', {
      name: 'Subscription',
      status: 'Paused',
      next_date: '2026-01-31',
      anchor_day: 31,
      amount_cents: 100,
    });
    const archived = recordPayload('subscriptions', { status: 'Archived' }, profile, old);
    expect(archived).toMatchObject({ status: 'Paused', archived: true, anchor_day: 31 });
    expect(recordView(entity('subscription', archived), profile).status).toBe('Archived');
    expect(
      recordPayload(
        'subscriptions',
        { status: 'Active' },
        profile,
        entity('subscription', archived),
      ).archived,
    ).toBe(false);
  });
  it('keeps historical payment amount and occurrence immutable in a PATCH', () => {
    const old = entity('transaction', {
      type: 'Expense',
      amount_cents: 999,
      subscription_id: 'sub',
      occurrence_date: '2026-09-29',
      date: '2026-09-29',
      status: 'Recorded',
    });
    expect(
      recordPayload('finance', { status: 'Cancelled', version: 3 }, profile, old),
    ).toMatchObject({
      amount_cents: 999,
      subscription_id: 'sub',
      occurrence_date: '2026-09-29',
      status: 'Cancelled',
    });
    expect(() => recordPayload('finance', { amount: 1, version: 3 }, profile, old)).toThrow(
      /preserve/,
    );
  });
  it('preserves native pages without silently converting legacy notebooks', () => {
    const pages = [
      {
        id: 'page',
        background: 'Grid',
        spacing: 36,
        objects: [{ id: 'text', type: 'text', text: 'Editable' }],
      },
    ];
    const data = recordPayload('notes', { title: 'Note', pages }, profile);
    expect(data).toMatchObject({ editor_version: 2, pages });
    expect(recordView(entity('note', data), profile).read_only).toBe(false);
    const legacy = entity('note', { ...data, editor_version: 1 });
    expect(recordView(legacy, profile).read_only).toBe(true);
    expect(() => recordPayload('notes', { editor_version: 2, pages }, profile, legacy)).toThrow(
      /read-only/,
    );
    const projected = recordView(entity('note', data), profile);
    projected.pages[0].background = 'Blank';
    expect(data.pages[0].background).toBe('Grid');
  });
});
describe('Canonical calculations exposed in the Emergent summary shapes', () => {
  it('preserves existing repeated-hour and multi-day instants during non-time edits', () => {
    const repeated = entity('event', {
      title: 'Original',
      date: '2026-10-25',
      all_day: false,
      start_at: '2026-10-25T01:15:00.000Z',
      end_at: '2026-10-25T01:45:00.000Z',
    });
    expect(
      recordPayload('events', { title: 'Renamed', version: 3 }, profile, repeated),
    ).toMatchObject({ start_at: repeated.data.start_at, end_at: repeated.data.end_at });
    const multiday = entity('event', {
      title: 'Trip',
      date: '2026-09-29',
      all_day: false,
      start_at: '2026-09-29T18:00:00.000Z',
      end_at: '2026-09-30T06:00:00.000Z',
    });
    expect(recordView(multiday, profile).end_date).toBe('2026-09-30');
    expect(recordPayload('events', { title: 'Trip renamed' }, profile, multiday).end_at).toBe(
      multiday.data.end_at,
    );
    const reminder = entity('reminder', {
      title: 'Later hour',
      due_at: '2026-10-25T01:30:00.000Z',
      reminder_minutes: 0,
      status: 'Pending',
    });
    expect(recordPayload('reminders', { status: 'Completed' }, profile, reminder).due_at).toBe(
      reminder.data.due_at,
    );
  });
  it('deduplicates paid renewals and restores the 31st after February', () => {
    const sub = entity('subscription', {
      name: 'Monthly',
      amount_cents: 1000,
      next_date: '2026-01-31',
      anchor_day: 31,
      status: 'Active',
      frequency: 'Monthly',
      archived: false,
    });
    const payment = entity('transaction', {
      amount_cents: 1000,
      type: 'Expense',
      status: 'Recorded',
      subscription_id: sub.id,
      occurrence_date: '2026-02-28',
      date: '2026-02-28',
    });
    expect(
      calendarView([sub, payment], profile, '2026-01-01', '2026-03-31').map((row) => row.date),
    ).toEqual(['2026-01-31', '2026-03-31']);
  });
  it('deduplicates planned linked payments and accepts old or future opening dates', () => {
    const sub = entity('subscription', {
      name: 'Monthly',
      amount_cents: 1000,
      next_date: '2026-09-29',
      anchor_day: 29,
      status: 'Active',
      frequency: 'Monthly',
    });
    const planned = entity('transaction', {
      amount_cents: 700,
      type: 'Expense',
      status: 'Planned',
      subscription_id: sub.id,
      occurrence_date: '2026-09-29',
      date: '2026-09-29',
    });
    const result = financeView(
      [sub, planned],
      { ...profile, opening_date: '2000-01-01' },
      '2026-09-30',
    );
    expect(result.current).toBe(10000);
    expect(result.projected).toBe(9300);
    expect(result.upcoming_subscriptions).toEqual([]);
    expect(financeView([], { ...profile, opening_date: '2027-01-01' }).current).toBe(10000);
  });
  it('keeps currencies separate and calculates net P&L, break-even and R', () => {
    const usd = entity(
      'account',
      { currency: 'USD', opening_cents: 1000, opening_date: '2026-01-01' },
      'usd',
    );
    const eur = entity(
      'account',
      { currency: 'EUR', opening_cents: 2000, opening_date: '2026-01-01' },
      'eur',
    );
    const trade = (id: string, account_id: string, gross_cents: number) =>
      entity(
        'trade',
        {
          account_id,
          status: 'Closed',
          closed_at: '2026-09-29T09:00:00Z',
          gross_cents,
          commission_cents: 20,
          swap_cents: -5,
          risk_cents: 50,
        },
        id,
      );
    const result = tradingView([usd, eur, trade('a', 'usd', 125), trade('b', 'eur', 25)], profile);
    expect(result.currencies).toMatchObject([
      { currency: 'EUR', net: 0, break_even: 1, average_r: 0 },
      { currency: 'USD', net: 100, win_rate: 100, average_r: 2 },
    ]);
    expect(result.accounts).toEqual([
      { id: 'usd', balance: 1100 },
      { id: 'eur', balance: 2000 },
    ]);
  });
  it('supplies real empty states without fixtures in bootstrap', () => {
    const output = bootstrapView([], profile);
    expect(output.records).toEqual([]);
    expect(output.alerts).toEqual([]);
    expect(output.finance.current).toBe(10000);
    expect(output.grades).toEqual([]);
    expect(output.recap).toMatchObject({ events: 0, closed_trades: 0, pnl: {} });
  });
});
