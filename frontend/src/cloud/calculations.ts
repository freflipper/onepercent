import {
  accountBalance,
  financeSummary,
  gradeStats,
  monthlyEquivalent,
  netPnl,
  subscriptionOccurrences,
  tradingStats,
} from './domain/calculations';
import { addDays, dayInZone, isLocalDate, monthEnd, todayInZone } from './domain/dates';
import { reminderPlans } from './domain/deadlines';
import type { Data, Entity, Profile } from './domain/types';
import { recordView, sections } from './records';

export function validateRange(start: string, end: string, bounded = true) {
  if (
    !isLocalDate(start) ||
    !isLocalDate(end) ||
    end < start ||
    (bounded && Date.parse(end) - Date.parse(start) > 3660 * 86_400_000)
  )
    throw new Error('Choose a valid date range of up to 10 years.');
}
export function calendarView(
  records: Entity[],
  profile: Profile,
  start: string,
  end: string,
  bounded = true,
): Data[] {
  validateRange(start, end, bounded);
  const paid = new Set(
    records
      .filter((record) => record.kind === 'transaction' && record.data.status === 'Recorded')
      .map((record) => `${record.data.subscription_id}/${record.data.occurrence_date}`),
  );
  const items: Data[] = [];
  for (const record of records) {
    if (['event', 'homework', 'test', 'reminder'].includes(record.kind)) {
      const value = recordView(record, profile);
      if (value.date >= start && value.date <= end) items.push({ ...value, source_id: record.id });
    }
    if (record.kind === 'subscription')
      for (const date of subscriptionOccurrences(record, start, end)) {
        if (!paid.has(`${record.id}/${date}`))
          items.push({
            id: `${record.id}:${date}`,
            source_id: record.id,
            kind: 'subscriptions',
            title: record.data.name,
            date,
            amount: record.data.amount_cents,
            reminder_minutes: record.data.reminder_minutes,
            alert_time: record.data.alert_time,
          });
      }
  }
  return items.sort((a, b) =>
    `${a.date}/${a.time || '00:00'}`.localeCompare(`${b.date}/${b.time || '00:00'}`),
  );
}
export function financeView(
  records: Entity[],
  profile: Profile,
  horizon = monthEnd(todayInZone(profile.timezone)),
) {
  const today = todayInZone(profile.timezone);
  validateRange(today, horizon);
  const summary = financeSummary(records, profile, today, horizon);
  const transactions = records
    .filter((record) => record.kind === 'transaction')
    .map((record) => recordView(record, profile));
  const chart = [];
  const [year, month] = today.split('-').map(Number);
  for (let offset = 5; offset >= 0; offset--) {
    const key = new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 7);
    const selected = transactions.filter(
      (transaction) =>
        transaction.status === 'Recorded' &&
        transaction.date.startsWith(key) &&
        transaction.date <= today,
    );
    chart.push({
      month: key,
      income: selected
        .filter((transaction) => transaction.type === 'Income')
        .reduce((sum, transaction) => sum + transaction.amount, 0),
      expense: selected
        .filter((transaction) => transaction.type === 'Expense')
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    });
  }
  const planned = transactions.filter(
    (transaction) =>
      transaction.status === 'Planned' &&
      transaction.date >= profile.opening_date &&
      transaction.date <= horizon,
  );
  const occupied = new Set(
    transactions
      .filter((transaction) => transaction.status !== 'Cancelled' && transaction.subscription_id)
      .map((transaction) => `${transaction.subscription_id}/${transaction.occurrence_date}`),
  );
  const upcomingSubscriptions = (
    profile.opening_date > horizon
      ? []
      : calendarView(records, profile, profile.opening_date, horizon, false)
  ).filter(
    (item) => item.kind === 'subscriptions' && !occupied.has(`${item.source_id}/${item.date}`),
  );
  return {
    current: summary.current,
    projected: summary.projected,
    horizon,
    month_income: summary.monthlyIncome,
    month_expense: summary.monthlyExpense,
    overdue: [...planned, ...upcomingSubscriptions].filter((item) => item.date < today),
    upcoming_subscriptions: upcomingSubscriptions,
    chart,
  };
}
export function tradingView(records: Entity[], profile: Profile, filters: Data = {}) {
  let trades = records.filter((record) => record.kind === 'trade');
  for (const field of ['account_id', 'instrument', 'direction', 'strategy_id'])
    if (filters[field]) trades = trades.filter((record) => record.data[field] === filters[field]);
  const start = filters.start || '0001-01-01',
    end = filters.end || '9999-12-31';
  validateRange(start, end, false);
  trades = trades.filter(
    (record) =>
      record.data.status === 'Closed' &&
      dayInZone(record.data.closed_at, profile.timezone) >= start &&
      dayInZone(record.data.closed_at, profile.timezone) <= end,
  );
  const accounts = records.filter((record) => record.kind === 'account');
  return {
    currencies: tradingStats(trades, accounts, profile.timezone).map((value) => ({
      currency: value.currency,
      net: value.net,
      count: value.closed,
      win_rate: value.winRate,
      break_even: value.breakEven,
      average_r: value.averageR,
      chart: value.daily.map((point) => ({
        date: point.date,
        daily: point.net,
        cumulative: point.cumulative,
      })),
    })),
    accounts: accounts.map((record) => ({
      id: record.id,
      balance: accountBalance(record, records, todayInZone(profile.timezone), profile.timezone),
    })),
  };
}
export function recapView(records: Entity[], profile: Profile) {
  const today = todayInZone(profile.timezone);
  const onToday = (instant: unknown) =>
    typeof instant === 'string' &&
    Number.isFinite(Date.parse(instant)) &&
    dayInZone(instant, profile.timezone) === today;
  const closed = records.filter(
    (record) =>
      record.kind === 'trade' && record.data.status === 'Closed' && onToday(record.data.closed_at),
  );
  const pnl: Record<string, number> = {};
  for (const trade of closed) {
    const account = records.find(
      (record) => record.id === trade.data.account_id && record.kind === 'account',
    );
    if (account)
      pnl[account.data.currency] = (pnl[account.data.currency] || 0) + (netPnl(trade) || 0);
  }
  const finance = records.filter(
    (record) =>
      record.kind === 'transaction' &&
      record.data.status === 'Recorded' &&
      onToday(record.data.recorded_at),
  );
  return {
    events: records.filter(
      (record) => record.kind === 'event' && recordView(record, profile).date === today,
    ).length,
    homework_completed: records.filter(
      (record) => record.kind === 'homework' && onToday(record.data.completed_at),
    ).length,
    homework_pending: records.filter(
      (record) => record.kind === 'homework' && record.data.status === 'To do',
    ).length,
    tests: records.filter(
      (record) =>
        record.kind === 'test' &&
        record.data.status === 'Scheduled' &&
        record.data.date >= today &&
        record.data.date <= addDays(today, 7),
    ).length,
    notes: records.filter((record) => record.kind === 'note' && onToday(record.updated_at)).length,
    grades: records.filter((record) => record.kind === 'grade' && onToday(record.created_at))
      .length,
    closed_trades: closed.length,
    pnl,
    income: finance
      .filter((record) => record.data.type === 'Income')
      .reduce((sum, record) => sum + record.data.amount_cents, 0),
    expense: finance
      .filter((record) => record.data.type === 'Expense')
      .reduce((sum, record) => sum + record.data.amount_cents, 0),
  };
}
export function alertPlans(records: Entity[], profile: Profile) {
  return reminderPlans(records, profile);
}
export function bootstrapView(records: Entity[], profile: Profile) {
  const today = todayInZone(profile.timezone);
  const monthly = records
    .filter((record) => record.kind === 'subscription')
    .reduce((sum, record) => sum + monthlyEquivalent(record), 0);
  return {
    records: records
      .filter((record) => record.kind !== 'notification')
      .map((record) => recordView(record, profile, false)),
    today,
    alerts: alertPlans(records, profile).map((plan) => ({
      ...plan,
      id: `${plan.source_id}/${plan.occurrence}`,
      kind: sections[plan.source_kind],
    })),
    notifications: records
      .filter(
        (record) =>
          record.kind === 'notification' && record.data.due_at <= new Date().toISOString(),
      )
      .map((record) => ({
        ...record.data,
        id: record.id,
        kind: sections[record.data.source_kind as Entity['kind']],
        due_at: String(record.data.due_at),
        read: !!record.data.read_at,
        version: record.version,
        created_at: record.created_at,
      }))
      .sort((a, b) => b.due_at.localeCompare(a.due_at)),
    grades: records
      .filter((record) => record.kind === 'subject')
      .map((subject) => ({
        subject_id: subject.id,
        name: subject.data.name,
        ...gradeStats(
          records.filter(
            (record) => record.kind === 'grade' && record.data.subject_id === subject.id,
          ),
        ),
      })),
    finance: financeView(records, profile),
    trading: tradingView(records, profile),
    recap: recapView(records, profile),
    upcoming: calendarView(records, profile, today, addDays(today, 90)),
    subscriptions: { monthly_equivalent: monthly, annual_equivalent: monthly * 12 },
  };
}
