import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useStore } from '@/src/store';
import { api } from '@/src/api';
import { money, number2, parseDate, dateLabel } from '@/src/dates';
import { makeStyles, useTheme } from '@/src/theme';
import { Shell, go } from '@/src/components/Shell';
import { Button, Card, Empty, ErrorMessage, IconButton, Input, Label, Sheet } from '@/src/components/ui';
import { Choice } from '@/src/components/Form';
import { LineChart } from '@/src/components/Summaries';

export default function Pnl() {
  const { data, records } = useStore(), s = useStyles(), { colors } = useTheme();
  const [filters, setFilters] = useState<any>({}), [draft, setDraft] = useState<any>({}), [result, setResult] = useState<any>(null), [open, setOpen] = useState(false), [error, setError] = useState('');
  useEffect(() => { let live = true; const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as any).toString(); api('/trading/summary?' + params).then(v => { if (live) { setResult(v); setError(''); } }).catch(e => live && setError(e.message)); return () => { live = false; }; }, [filters, data]);
  const currencies = result?.currencies || [];
  return <Shell title="P&L" section="pnl" right={<IconButton name="options-outline" testID="pnl-filters" label="Filter P&L" onPress={() => { setDraft(filters); setOpen(true); }} />}>
    <ScrollView contentContainerStyle={s.content}><Label muted size={13}>Realised results only, grouped by closing date. Currencies are never combined.</Label>{!!error && <ErrorMessage message={error} />}{!result && <ActivityIndicator color={colors.brandPrimary} />}
      {!currencies.some((r: any) => r.count) && <Empty title="Your results, without the guesswork" detail="Close a trade with a manual gross result to see your P&L." icon="stats-chart-outline" action={() => go('trades')} actionLabel="Open trading journal" />}
      {currencies.filter((r: any) => r.count).map((r: any) => <View key={r.currency} style={{ gap: 16 }}><Card><Label muted size={12}>NET P&L · {r.currency}</Label><Label size={36} weight="600" testID={`pnl-net-${r.currency}`}>{money(r.net, r.currency)}</Label><View style={s.row}><View><Label weight="600" size={23}>{r.count}</Label><Label muted size={11}>Closed trades</Label></View><View><Label weight="600" size={23}>{number2(r.win_rate)}%</Label><Label muted size={11}>Win rate</Label></View><View><Label weight="600" size={23}>{number2(r.average_r)}</Label><Label muted size={11}>Average R</Label></View></View><Label size={12} muted>{r.break_even} break-even trades · R uses only trades with positive initial risk.</Label></Card><Card><Label weight="600">Daily net P&L</Label><LineChart testID={`pnl-daily-chart-${r.currency}`} values={r.chart.map((x: any) => x.daily)} /></Card><Card><Label weight="600">Cumulative realised P&L</Label><Label size={12} muted>Sum of closed results. Excludes deposits and open positions.</Label><LineChart testID={`pnl-cumulative-chart-${r.currency}`} values={r.chart.map((x: any) => x.cumulative)} />{r.chart.map((point: any) => <View key={point.date} style={s.row}><Label size={12} muted>{dateLabel(point.date)}</Label><Label size={12}>{money(point.daily, r.currency)}</Label><Label weight="600" size={12}>{money(point.cumulative, r.currency)}</Label></View>)}</Card></View>)}
    </ScrollView>
    <Sheet visible={open} title="P&L filters" onClose={() => setOpen(false)} footer={<Button title="Apply filters" testID="pnl-apply" onPress={() => { try { setFilters({ ...draft, start: draft.startText ? parseDate(draft.startText) : '', end: draft.endText ? parseDate(draft.endText) : '' }); setOpen(false); } catch (e: any) { setError(e.message); } }} />}>
      <Choice label="Account" testID="pnl-account" value={draft.account_id || ''} options={[{ value: '', label: 'All accounts · grouped by currency' }, ...records('accounts').map((r: any) => ({ value: r.id, label: `${r.name} · ${r.currency}` }))]} onChange={(v: any) => setDraft({ ...draft, account_id: v })} />
      <Choice label="Strategy" testID="pnl-strategy" value={draft.strategy_id || ''} options={[{ value: '', label: 'All strategies' }, ...records('strategies').map((r: any) => ({ value: r.id, label: r.name }))]} onChange={(v: any) => setDraft({ ...draft, strategy_id: v })} />
      <Choice label="Direction" testID="pnl-direction" value={draft.direction || ''} options={['', 'Long', 'Short'].map(v => ({ value: v, label: v || 'Both' }))} onChange={(v: any) => setDraft({ ...draft, direction: v })} />
      <Input label="Instrument" testID="pnl-instrument" value={draft.instrument || ''} onChangeText={(v: any) => setDraft({ ...draft, instrument: v })} /><Input label="From · DD/MM/YYYY" testID="pnl-start" value={draft.startText || ''} onChangeText={(v: any) => setDraft({ ...draft, startText: v })} /><Input label="To · DD/MM/YYYY" testID="pnl-end" value={draft.endText || ''} onChangeText={(v: any) => setDraft({ ...draft, endText: v })} /><Button title="Clear filters" testID="pnl-clear" variant="secondary" onPress={() => setDraft({})} />
    </Sheet>
  </Shell>;
}
const useStyles = makeStyles(() => ({ content: { padding: 20, paddingBottom: 32, gap: 18, maxWidth: 760, width: '100%', alignSelf: 'center' }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 } }));