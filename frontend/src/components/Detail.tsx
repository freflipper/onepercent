import React, { useState } from 'react';
import { View } from 'react-native';
import { schemas, singular } from '@/src/schema';
import { useStore } from '@/src/store';
import { dateLabel, dateTimeInput, money, number2 } from '@/src/dates';
import { makeStyles } from '@/src/theme';
import { Button, Card, ErrorMessage, Label, Sheet } from './ui';
import { go } from './Shell';

export function Detail({ kind, record, onClose, onEdit, onDelete }: any) {
  const { records, data, user, mutate } = useStore(), s = useStyles(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const current = records(kind).find((r: any) => r.id === record.id) || record;
  const change = async (payload: any, path?: string) => { setBusy(true); setError(''); try { await mutate(path || `/records/${kind}/${current.id}`, path ? 'POST' : 'PATCH', path ? undefined : { ...payload, version: current.version }); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const account = kind === 'trades' ? records('accounts').find((r: any) => r.id === current.account_id) : current;
  const currency = account?.currency || 'EUR';
  const net = (current.gross_pnl || 0) - (current.commission || 0) + (current.swap || 0);
  const subOccurrences = kind === 'subscriptions' ? [...(data?.finance?.upcoming_subscriptions || []), ...(data?.upcoming || [])].filter((r: any, i: number, array: any[]) => r.kind === 'subscriptions' && r.source_id === current.id && array.findIndex(x => x.id === r.id) === i).sort((a: any, b: any) => a.date.localeCompare(b.date)) : [];
  const paid = kind === 'subscriptions' ? records('finance').filter((r: any) => r.subscription_id === current.id && r.status === 'Recorded') : [];
  return <Sheet visible title={current.title || current.name || (kind === 'grades' ? 'Grade details' : current.instrument || 'Details')} onClose={onClose} footer={<View style={s.row}><Button title="Edit" testID="detail-edit" variant="secondary" icon="create-outline" onPress={onEdit} style={{ flex: 1 }} /><Button title="Delete" testID="detail-delete" variant="danger" onPress={onDelete} /></View>}>
    {schemas[kind]?.map(field => {
      let value = current[field.key];
      if (value == null || value === '' || field.type === 'color' || field.type === 'boolean') return null;
      if (field.type === 'reference') { const r = records(field.ref).find((r: any) => r.id === value); value = r?.name || r?.title || r?.instrument || '—'; }
      else if (field.type === 'money') value = money(value, currency);
      else if (field.type === 'date') value = dateLabel(value);
      else if (field.type === 'datetime') value = dateTimeInput(value, user.timezone);
      else if (field.type === 'checklist') value = value.map((x: string) => `□ ${x}`).join('\n');
      else if (field.type === 'reminder') value = value === 0 ? 'At time' : `${value} minutes before`;
      return <View key={field.key} style={s.field}><Label muted size={12}>{field.label}</Label><Label size={15}>{String(value)}</Label></View>;
    })}
    {kind === 'trades' && current.status === 'Closed' && <Card><Label testID="trade-net-pnl" size={25} weight="600">{money(net, currency)}</Label><Label muted size={12}>Net P&L · after commission and swap</Label><Label testID="trade-r-multiple">R multiple: {current.initial_risk > 0 ? number2(net / current.initial_risk) : '—'}</Label></Card>}
    {kind === 'trades' && <Button title={`Screenshots (${records('screenshots').filter((r: any) => r.trade_id === current.id).length})`} testID="trade-screenshots" variant="secondary" onPress={() => { onClose(); go('screenshots', { trade: current.id }); }} style={s.action} />}
    {kind === 'accounts' && <><Card><Label muted size={12}>ACCOUNT BALANCE · {currency}</Label><Label size={28} weight="600">{money(data.trading.accounts.find((a: any) => a.id === current.id)?.balance || 0, currency)}</Label></Card><Button title="Deposits & withdrawals" testID="account-cashflows" variant="secondary" onPress={() => { onClose(); go('cashflows', { account: current.id }); }} style={s.action} /><Button title="View trades" testID="account-trades" variant="secondary" onPress={() => { onClose(); go('trades', { account: current.id }); }} style={s.action} /></>}
    {['homework', 'tests', 'reminders'].includes(kind) && <Button title={['Done', 'Completed'].includes(current.status) ? 'Reopen' : 'Mark as done'} testID="detail-complete" icon="checkmark-outline" onPress={() => change({ status: ['Done', 'Completed'].includes(current.status) ? ({ homework: 'To do', tests: 'Scheduled', reminders: 'Pending' } as any)[kind] : kind === 'homework' ? 'Done' : 'Completed' })} busy={busy} style={s.action} />}
    {kind === 'reminders' && current.status === 'Pending' && <Button title="Snooze 10 minutes" testID="detail-snooze" variant="secondary" onPress={() => change({}, `/reminders/${current.id}/snooze`)} busy={busy} style={s.action} />}
    {kind === 'finance' && current.status === 'Planned' && <Button title="Mark as recorded" testID="detail-record" onPress={() => change({ status: 'Recorded' })} busy={busy} style={s.action} />}
    {['subjects', 'accounts', 'strategies'].includes(kind) && <Button title={current.archived ? 'Unarchive' : `Archive ${singular[kind]}`} testID="detail-archive" variant="secondary" onPress={() => change({ archived: !current.archived })} busy={busy} style={s.action} />}
    {kind === 'subscriptions' && <View style={{ gap: 14, marginTop: 16 }}><Label weight="600">Unpaid renewals</Label>{subOccurrences.length ? subOccurrences.slice(0, 12).map((r: any) => <Card key={r.id}><View style={s.row}><Label size={14}>{dateLabel(r.date)}</Label><Label weight="600">{money(r.amount)}</Label></View>{r.date <= data.today ? <Button title="Mark as paid" testID={`pay-${r.date}`} busy={busy} onPress={() => change({}, `/subscriptions/${current.id}/pay/${r.date}`)} /> : <Label size={12} muted>Planned · not charged to your balance</Label>}</Card>) : <Label muted size={13}>No unpaid renewal in the current 90-day overview.</Label>}<Label weight="600">Payment history</Label>{paid.length ? paid.map((p: any) => <View key={p.id} style={s.row}><Label size={13}>{dateLabel(p.date)}</Label><Label size={13}>{money(p.amount)}</Label></View>) : <Label size={13} muted>No payments recorded.</Label>}</View>}
    {!!error && <ErrorMessage message={error} />}
  </Sheet>;
}
const useStyles = makeStyles(() => ({ row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, field: { gap: 4, marginBottom: 18 }, action: { marginTop: 12 } }));