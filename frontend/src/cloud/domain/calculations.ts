import { addDays, dayInZone, isLocalDate } from './dates';
import type { Entity, Profile } from './types';

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function gradeStats(grades: Entity[]) {
  const items = grades.filter((g) => g.kind === 'grade');
  return {
    written: mean(items.filter((g) => g.data.type === 'Written').map((g) => g.data.value)),
    oral: mean(items.filter((g) => g.data.type === 'Oral').map((g) => g.data.value)),
    overall: mean(items.map((g) => g.data.value)),
    count: items.length,
  };
}
export function netPnl(trade: Entity): number | null {
  return trade.data.status === 'Closed'
    ? trade.data.gross_cents - (trade.data.commission_cents ?? 0) + (trade.data.swap_cents ?? 0)
    : null;
}
export function rMultiple(trade: Entity): number | null {
  const net = netPnl(trade);
  return net !== null && trade.data.risk_cents > 0 ? net / trade.data.risk_cents : null;
}

function occurrenceAt(subscription: Entity, index: number): string {
  const { next_date, frequency } = subscription.data;
  if (frequency === 'Weekly') return addDays(next_date, index * 7);
  const [year, month, day] = next_date.split('-').map(Number);
  const months = frequency === 'Quarterly' ? 3 : frequency === 'Yearly' ? 12 : 1;
  const d = new Date(Date.UTC(year, month - 1 + months * index, 1, 12));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
  d.setUTCDate(Math.min(subscription.data.anchor_day || day, last));
  // next_date is the first actual date, even when a user changes it independently of anchor_day.
  return index === 0 ? next_date : d.toISOString().slice(0, 10);
}
export function subscriptionOccurrences(subscription: Entity, from: string, to: string): string[] {
  if (subscription.data.status !== 'Active' || subscription.data.archived || from > to) return [];
  if (![from, to, subscription.data.next_date].every(isLocalDate))
    throw new Error('Invalid subscription date.');
  const result: string[] = [];
  const next = subscription.data.next_date as string;
  if (next > to) return result;
  // Jump near the requested period instead of enumerating decades of history.
  let index = 0;
  if (from > next) {
    if (subscription.data.frequency === 'Weekly')
      index = Math.max(0, Math.floor((Date.parse(from) - Date.parse(next)) / 604_800_000) - 1);
    else {
      const months =
        (Number(from.slice(0, 4)) - Number(next.slice(0, 4))) * 12 +
        Number(from.slice(5, 7)) -
        Number(next.slice(5, 7));
      index = Math.max(
        0,
        Math.floor(
          months /
            (subscription.data.frequency === 'Quarterly'
              ? 3
              : subscription.data.frequency === 'Yearly'
                ? 12
                : 1),
        ) - 1,
      );
    }
  }
  for (;;) {
    const date = occurrenceAt(subscription, index++);
    if (date > to) break;
    if (date >= from) result.push(date);
    if (result.length > 10_000) throw new Error('Choose a shorter date range.');
  }
  return result;
}
export function monthlyEquivalent(subscription: Entity): number {
  if (subscription.data.status !== 'Active' || subscription.data.archived) return 0;
  return (
    subscription.data.amount_cents *
    ({ Weekly: 52 / 12, Monthly: 1, Quarterly: 1 / 3, Yearly: 1 / 12 }[
      subscription.data.frequency as string
    ] ?? 0)
  );
}
export type UpcomingExpense = {
  date: string;
  amount_cents: number;
  title: string;
  source_id: string;
  kind: 'transaction' | 'subscription';
};
export function financeSummary(
  records: Entity[],
  profile: Profile,
  today: string,
  through: string,
) {
  const transactions = records.filter((r) => r.kind === 'transaction');
  const eligible = transactions.filter((t) => t.data.date >= profile.opening_date);
  const actual = eligible.filter((t) => t.data.status === 'Recorded' && t.data.date <= today);
  const current =
    profile.opening_balance +
    actual.reduce((sum, t) => sum + (t.data.type === 'Income' ? 1 : -1) * t.data.amount_cents, 0);
  const monthly = transactions.filter(
    (t) =>
      t.data.status === 'Recorded' &&
      t.data.date <= today &&
      t.data.date.slice(0, 7) === today.slice(0, 7),
  );
  const monthlyIncome = monthly
    .filter((t) => t.data.type === 'Income')
    .reduce((s, t) => s + t.data.amount_cents, 0);
  const monthlyExpense = monthly
    .filter((t) => t.data.type === 'Expense')
    .reduce((s, t) => s + t.data.amount_cents, 0);
  const planned = eligible.filter((t) => t.data.status === 'Planned' && t.data.date <= through);
  const plannedIncome = planned
    .filter((t) => t.data.type === 'Income')
    .reduce((s, t) => s + t.data.amount_cents, 0);
  const plannedExpense = planned
    .filter((t) => t.data.type === 'Expense')
    .reduce((s, t) => s + t.data.amount_cents, 0);
  const occupied = new Set(
    transactions
      .filter((t) => t.data.status !== 'Cancelled' && t.data.subscription_id)
      .map((t) => `${t.data.subscription_id}/${t.data.occurrence_date}`),
  );
  const upcoming: UpcomingExpense[] = planned
    .filter((t) => t.data.type === 'Expense')
    .map((t) => ({
      date: t.data.date,
      amount_cents: t.data.amount_cents,
      title: t.data.description || t.data.category || 'Planned expense',
      source_id: t.id,
      kind: 'transaction',
    }));
  let subscriptionExpense = 0;
  let overduePlanned = planned
    .filter((t) => t.data.date < today)
    .reduce((s, t) => s + t.data.amount_cents, 0);
  for (const subscription of records.filter((r) => r.kind === 'subscription')) {
    for (const date of subscriptionOccurrences(subscription, profile.opening_date, through)) {
      if (occupied.has(`${subscription.id}/${date}`)) continue;
      subscriptionExpense += subscription.data.amount_cents;
      if (date < today) overduePlanned += subscription.data.amount_cents;
      upcoming.push({
        date,
        amount_cents: subscription.data.amount_cents,
        title: subscription.data.name,
        source_id: subscription.id,
        kind: 'subscription',
      });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return {
    current,
    projected: current + plannedIncome - plannedExpense - subscriptionExpense,
    monthlyIncome,
    monthlyExpense,
    income: monthlyIncome,
    expenses: monthlyExpense,
    plannedIncome,
    plannedExpense,
    subscriptionExpense,
    overduePlanned,
    upcoming,
  };
}
export function accountBalance(
  account: Entity,
  records: Entity[],
  today: string,
  timezone: string,
): number {
  let total = account.data.opening_cents;
  for (const record of records.filter((r) => r.data.account_id === account.id)) {
    if (
      record.kind === 'cashflow' &&
      record.data.date >= account.data.opening_date &&
      record.data.date <= today
    )
      total += (record.data.type === 'Deposit' ? 1 : -1) * record.data.amount_cents;
    if (record.kind === 'trade' && record.data.status === 'Closed') {
      const date = dayInZone(record.data.closed_at, timezone);
      if (date >= account.data.opening_date && date <= today) total += netPnl(record) ?? 0;
    }
  }
  return total;
}
export function tradingStats(trades: Entity[], accounts: Entity[], timezone: string) {
  const groups = new Map<string, Entity[]>();
  for (const trade of trades.filter((t) => t.kind === 'trade' && t.data.status === 'Closed')) {
    const account = accounts.find((a) => a.id === trade.data.account_id);
    if (!account) continue; // Never invent a currency when a referenced account is unavailable.
    const currency = account.data.currency as string;
    groups.set(currency, [...(groups.get(currency) ?? []), trade]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, rows]) => {
      const totals = new Map<string, number>();
      for (const trade of rows) {
        const date = dayInZone(trade.data.closed_at, timezone);
        totals.set(date, (totals.get(date) ?? 0) + (netPnl(trade) ?? 0));
      }
      let cumulative = 0;
      const daily = [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, net]) => ({ date, net, cumulative: (cumulative += net) }));
      const wins = rows.filter((t) => (netPnl(t) ?? 0) > 0).length;
      return {
        currency,
        net: cumulative,
        closed: rows.length,
        wins,
        breakEven: rows.filter((t) => netPnl(t) === 0).length,
        winRate: rows.length ? (wins / rows.length) * 100 : null,
        averageR: mean(rows.map(rMultiple).filter((r): r is number => r !== null)),
        daily,
      };
    });
}
