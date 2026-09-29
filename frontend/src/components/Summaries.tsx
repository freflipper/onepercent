import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';
import { useStore } from '@/src/store';
import { makeStyles, useTheme } from '@/src/theme';
import { money, number2, parseDate, dateInput, dayjs } from '@/src/dates';
import { api } from '@/src/api';
import { go } from './Shell';
import { Button, Card, ErrorMessage, Input, Label } from './ui';

export function LineChart({ values, testID }: { values: number[]; testID: string }) {
  const { colors } = useTheme();
  if (!values.length) return null;
  const min = Math.min(0, ...values), max = Math.max(1, ...values), y = (v: number) => 85 - (v - min) / (max - min) * 70;
  const points = values.map((v, i) => `${12 + i / Math.max(1, values.length - 1) * 276},${y(v)}`).join(' ');
  return <View testID={testID} style={{ height: 100, overflow: 'hidden' }}><Svg width="100%" height="100%" viewBox="0 0 300 100"><Line x1="10" y1={y(0)} x2="290" y2={y(0)} stroke={colors.borderStrong} strokeDasharray="3 4" /><Polyline points={points} fill="none" stroke={colors.brandPrimary} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /></Svg></View>;
}
export function Summary({ kind, filtered }: any) {
  const { data, records } = useStore(), s = useStyles(), { colors } = useTheme();
  if (!data) return null;
  if (kind === 'grades') {
    const subjects = records('subjects').filter((subject: any) => filtered.some((r: any) => r.subject_id === subject.id));
    if (!subjects.length) return <Card><Label weight="600">No grades yet</Label><Label size={13} muted>Your averages appear after your first grade.</Label></Card>;
    return <View style={{ gap: 12 }}>{subjects.map((subject: any) => { const grades = filtered.filter((g: any) => g.subject_id === subject.id); const avg = (type?: string) => { const values = grades.filter((g: any) => !type || g.type === type); return values.length ? values.reduce((n: number, g: any) => n + g.value, 0) / values.length : null; }; return <Card key={subject.id} testID={`grade-summary-${subject.id}`}><View style={s.row}><Label size={16} weight="600">{subject.name}</Label><Label size={12} muted>{grades.length} grades</Label></View><View style={s.row}>{[['Written', avg('Written')], ['Oral', avg('Oral')], ['Overall', avg()]].map(([label, value]) => <View key={label as string}><Label size={23} weight="600" testID={`grade-average-${String(label).toLowerCase()}`}>{number2(value as number)}</Label><Label size={11} muted>{label} average</Label></View>)}</View></Card>; })}</View>;
  }
  if (kind === 'subscriptions') return <Card><Label size={12} muted>ACTIVE SUBSCRIPTIONS · EUR</Label><View style={s.row}><View><Label size={27} weight="600">{money(data.subscriptions.monthly_equivalent)}</Label><Label muted size={12}>Monthly equivalent</Label></View><View><Label size={22} weight="600">{money(data.subscriptions.annual_equivalent)}</Label><Label muted size={12}>Annual equivalent</Label></View></View><Label muted size={12}>Normalised costs, not actual charges. Paid renewals appear in Finance.</Label></Card>;
  if (kind === 'finance') return <FinanceSummary />;
  if (kind === 'accounts') return <Card><Label weight="600">Separate from your personal finances</Label><Label size={13} muted>Balances include recorded deposits, withdrawals and realised net P&L after each account’s opening date. Open trades do not change the balance.</Label></Card>;
  if (kind === 'trades') return <Card style={{ backgroundColor: colors.brandTertiary }}><Label size={13} weight="600">A journal, not a trading platform.</Label><Label size={12} muted>Log results manually. Net P&L = gross − commission + swap.</Label><Button title="View P&L" testID="trades-view-pnl" variant="ghost" onPress={() => go('pnl')} /></Card>;
  return null;
}
function FinanceSummary() {
  const { data, user } = useStore(), s = useStyles();
  const [target, setTarget] = useState(dateInput(data.finance.horizon)), [result, setResult] = useState<any>(null), [error, setError] = useState('');
  const f = result || data.finance;
  async function project() { try { setError(''); setResult(await api('/finance/summary?horizon=' + parseDate(target))); } catch (e: any) { setError(e.message); } }
  return <View style={{ gap: 14 }}><Card testID="finance-summary"><Label size={12} muted>CURRENT BALANCE · EUR</Label><Label size={38} weight="600" testID="finance-current-balance">{money(data.finance.current)}</Label><View style={s.row}><View><Label size={18} weight="600">{money(data.finance.month_income)}</Label><Label muted size={12}>Recorded income this month</Label></View><View style={{ flexShrink: 1 }}><Label size={18} weight="600">{money(data.finance.month_expense)}</Label><Label muted size={12}>Recorded expenses this month</Label></View></View><Label muted size={12}>Opening balance {money(user.opening_balance)} before movements on {dayjs(user.opening_date).format('D MMM YYYY')}.</Label><Button title="Set opening balance" testID="finance-opening-settings" variant="secondary" onPress={() => go('settings')} /></Card>
    <Card><Label size={14} weight="600">Look ahead</Label><Label size={29} weight="600" testID="finance-projected-balance">{money(f.projected)}</Label><Label muted size={12}>Projected through {dayjs(f.horizon).format('D MMM YYYY')}, including unpaid renewals and unrecorded plans.</Label><Input label="Projection date · DD/MM/YYYY" testID="finance-projection-date" value={target} onChangeText={setTarget} /><Button title="Update projection" testID="finance-project" variant="secondary" onPress={project} />{f.overdue.length > 0 && <Label size={12}>Includes {f.overdue.length} overdue plans, not automatically paid.</Label>}{!!error && <ErrorMessage message={error} />}</Card>
    <Card><Label weight="600">Monthly cashflow</Label><Label size={12} muted>Recorded income minus expenses · last 6 months</Label><LineChart testID="finance-month-chart" values={data.finance.chart.map((m: any) => m.income - m.expense)} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 20 }}>{data.finance.chart.map((m: any) => <View key={m.month}><Label size={11} muted>{dayjs(m.month + '-01').format('MMM')}</Label><Label size={11}>{money(m.income - m.expense)}</Label></View>)}</ScrollView></Card>
    {f.upcoming_subscriptions.length > 0 && <Card><Label weight="600">Unpaid renewals in projection</Label>{f.upcoming_subscriptions.slice(0, 8).map((r: any) => <View key={r.id} style={s.row}><Label size={12} style={{ flex: 1 }}>{r.title} · {dayjs(r.date).format('D MMM')}</Label><Label size={12}>{money(r.amount)}</Label></View>)}</Card>}
  </View>;
}
const useStyles = makeStyles(() => ({ row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 } }));