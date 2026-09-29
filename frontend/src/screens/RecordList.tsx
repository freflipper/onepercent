import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useStore } from '@/src/store';
import { sections, singular } from '@/src/schema';
import { makeStyles, useTheme } from '@/src/theme';
import { dateLabel, dayjs, money, parseDate } from '@/src/dates';
import { Shell, go } from '@/src/components/Shell';
import { Button, Card, Chips, Confirm, Empty, ErrorMessage, Icon, IconButton, Input, Label, Sheet } from '@/src/components/ui';
import { Choice, EditorForm } from '@/src/components/Form';
import { Detail } from '@/src/components/Detail';
import { Summary } from '@/src/components/Summaries';

const FILTERS: Record<string, string[]> = { homework: ['All', 'To do', 'Done', 'Overdue'], tests: ['Upcoming', 'All', 'Completed', 'Past'], reminders: ['Today', 'Upcoming', 'Overdue', 'Completed', 'All'], trades: ['All', 'Open', 'Closed'], subscriptions: ['Active', 'All', 'Paused', 'Cancelled', 'Archived'], finance: ['All', 'Recorded', 'Planned', 'Overdue', 'Cancelled'], subjects: ['Active', 'All', 'Archived'], accounts: ['Active', 'All', 'Archived'], strategies: ['Active', 'All', 'Archived'] };
export default function RecordList({ kind }: { kind: string }) {
  const params = useLocalSearchParams(), store = useStore(), { data, records, refresh, loading, error, mutate } = store, s = useStyles(), { colors } = useTheme();
  const [status, setStatus] = useState(FILTERS[kind]?.[0] || 'All'), [search, setSearch] = useState(''), [filtersOpen, setFiltersOpen] = useState(false), [filter, setFilter] = useState<any>({ account_id: params.account || '' }), [filterError, setFilterError] = useState('');
  const routeItem = typeof params.item === 'string' ? params.item : null;
  const [selection, setSelection] = useState({ routeItem, id: routeItem });
  if (selection.routeItem !== routeItem) setSelection({ routeItem, id: routeItem });
  const [editing, setEditing] = useState<any>(undefined), [deleting, setDeleting] = useState<any>(null), [deleteError, setDeleteError] = useState(''), [busy, setBusy] = useState(false);
  const title = sections.find(x => x.key === kind)?.title || ({ subjects: 'Manage Subjects', cashflows: 'Deposits & Withdrawals' } as any)[kind] || kind;
  const rows = records(kind), all = data?.records || [];
  const detail = rows.find((record: any) => record.id === selection.id) || null;
  function setDetail(record: any) { setSelection({ routeItem, id: record?.id || null }); }
  const filtered = useMemo(() => rows.filter((r: any) => {
    const text = [r.title, r.name, r.instrument, r.description, r.category, records('subjects').find((x: any) => x.id === r.subject_id)?.name].filter(Boolean).join(' ').toLowerCase();
    if (search && !text.includes(search.toLowerCase())) return false;
    if (status === 'Active' && (r.archived || r.status && r.status !== 'Active')) return false;
    if (status === 'Archived' && !r.archived && r.status !== 'Archived') return false;
    if (status === 'Today' && (r.date !== data?.today || r.status === 'Completed')) return false;
    if (status === 'Upcoming' && (r.date < data?.today || ['Completed', 'Done'].includes(r.status))) return false;
    if (status === 'Past' && r.date >= data?.today) return false;
    if (status === 'Overdue' && !(r.date < data?.today && ['Pending', 'To do', 'Planned'].includes(r.status))) return false;
    if (!['All', 'Active', 'Archived', 'Today', 'Upcoming', 'Past', 'Overdue'].includes(status) && r.status !== status) return false;
    for (const key of ['subject_id', 'account_id', 'direction', 'strategy_id', 'type']) if (filter[key] && r[key] !== filter[key]) return false;
    const day = r.closed_at || r.opened_at ? dayjs(r.closed_at || r.opened_at).tz(store.user.timezone).format('YYYY-MM-DD') : (r.date || r.next_date || '');
    if (filter.startISO && day < filter.startISO || filter.endISO && day > filter.endISO) return false;
    return true;
  }).sort((a: any, b: any) => ['homework', 'tests', 'reminders'].includes(kind) ? a.date.localeCompare(b.date) : b.updated_at.localeCompare(a.updated_at)), [rows, search, status, filter, data?.today, records, kind, store.user.timezone]);
  async function remove() { setBusy(true); setDeleteError(''); try { await mutate(`/records/${kind}/${deleting.id}`, 'DELETE', { version: deleting.version }); setDeleting(null); } catch (e: any) { setDeleteError(e.message); } finally { setBusy(false); } }
  function rowTitle(r: any) { return r.name || r.title || (kind === 'grades' ? `${records('subjects').find((x: any) => x.id === r.subject_id)?.name || 'Subject'} · ${r.value}` : kind === 'trades' ? `${r.instrument} · ${r.direction}` : r.description || r.type || 'Transaction'); }
  function rowMeta(r: any) { if (kind === 'folders') return `${records('notes').filter((n: any) => n.folder_id === r.id).length} notes · ${dateLabel([...records('notes').filter((n: any) => n.folder_id === r.id).map((n: any) => n.updated_at), r.updated_at].sort().pop())}`; return [r.type !== r.title ? r.type : '', r.status, r.archived ? 'Archived' : '', r.date || r.next_date ? dateLabel(r.date || r.next_date) : '', r.time].filter(Boolean).join(' · '); }
  return <Shell title={title} section={kind} right={<IconButton name="add" label={`Add ${singular[kind]}`} testID={`add-${kind}`} onPress={() => setEditing(null)} />} chrome={<>
    <View style={s.toolbar}><View style={{ flex: 1 }}><Input label="" testID="record-search" placeholder={`Search ${title.toLowerCase()}`} value={search} onChangeText={setSearch} /></View><IconButton name="options-outline" label="Filters" testID="record-filters" onPress={() => setFiltersOpen(true)} /></View>
    {FILTERS[kind] && <Chips options={FILTERS[kind]} value={status} onChange={setStatus} testID="status-filter" />}
    {['grades', 'homework', 'tests'].includes(kind) && <View style={s.manage}><Button title="Manage subjects" testID="manage-subjects" variant="ghost" icon="color-palette-outline" onPress={() => go('subjects')} /></View>}
  </>}>
    <ScrollView testID="record-list-scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => refresh().catch(() => {})} />}>
      {!!error && <ErrorMessage message={error} retry={() => refresh().catch(() => {})} />}
      <Summary key={`${kind}-${data?.finance?.current}-${data?.records?.length}`} kind={kind} filtered={filtered} />
      {kind === 'folders' && <Pressable testID="folder-unfiled" onPress={() => go('notes', { folder: 'unfiled' })}><Card><View style={s.row}><Icon name="file-tray-outline" color={colors.brandPrimary} /><View><Label weight="600">Unfiled</Label><Label size={12} muted>{records('notes').filter((n: any) => !n.folder_id).length} notes</Label></View><Icon name="chevron-forward" size={16} /></View></Card></Pressable>}
      <View style={s.row}><Label size={12} muted>{filtered.length} {filtered.length === 1 ? singular[kind] : title.toLowerCase()}</Label><View style={{ flex: 1 }} />{kind === 'finance' && <Label size={11} muted>EUR · manual ledger</Label>}</View>
      {!data && loading ? <ActivityIndicator color={colors.brandPrimary} /> : !filtered.length ? <Empty title={all.some((r: any) => r.kind === kind) ? 'No matching items' : `Your ${title.toLowerCase()} start here`} detail={all.some((r: any) => r.kind === kind) ? 'Try a different filter or search.' : `Add your first ${singular[kind]} to make this space your own.`} icon={sections.find(x => x.key === kind)?.icon || 'file-tray-outline'} action={() => setEditing(null)} actionLabel={`Add ${singular[kind]}`} /> : filtered.map((r: any) => <Pressable accessibilityRole="button" key={r.id} testID={`record-${r.id}`} onPress={() => kind === 'folders' ? go('notes', { folder: r.id }) : setDetail(r)} style={({ pressed }) => [s.listCard, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={[s.recordIcon, { backgroundColor: colors.brandTertiary }]}><Icon name={sections.find(x => x.key === kind)?.icon || 'ellipse-outline'} size={21} color={r.color || colors.brandPrimary} /></View>
        <View style={{ flex: 1, gap: 4 }}><Label weight="600" size={15}>{rowTitle(r)}</Label><Label size={12} muted>{rowMeta(r)}</Label>{r.date < data?.today && ['To do', 'Pending', 'Planned'].includes(r.status) && <Label size={11} style={{ color: colors.warning }}>Overdue · not completed</Label>}{kind === 'accounts' && <Label size={17} weight="600">{money(data.trading.accounts.find((a: any) => a.id === r.id)?.balance || 0, r.currency)}</Label>}{kind === 'trades' && r.status === 'Closed' && <Label size={14} weight="600">{money((r.gross_pnl || 0) - r.commission + r.swap, records('accounts').find((a: any) => a.id === r.account_id)?.currency || 'USD')}</Label>}{r.amount != null && <Label size={16} weight="600">{money(r.amount, kind === 'cashflows' ? records('accounts').find((a: any) => a.id === r.account_id)?.currency || 'USD' : 'EUR')}</Label>}</View>
        {kind === 'folders' ? <IconButton name="ellipsis-horizontal" testID={`folder-options-${r.id}`} label="Folder options" onPress={() => setDetail(r)} /> : <Icon name="chevron-forward" size={15} color={colors.muted} />}
      </Pressable>)}
    </ScrollView>
    {editing !== undefined && <EditorForm kind={kind} record={editing} seed={filter.account_id ? { account_id: filter.account_id } : {}} onClose={() => setEditing(undefined)} />}
    {detail && <Detail kind={kind} record={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null); }} onDelete={() => { setDeleting(detail); setDeleteError(''); setDetail(null); }} />}
    <Confirm visible={!!deleting} title={`Delete ${singular[kind]}?`} message={kind === 'folders' ? 'Your notes will be moved to Unfiled. No notes will be deleted.' : 'This action cannot be undone. Linked summaries will update automatically.'} error={deleteError} busy={busy} onCancel={() => setDeleting(null)} onConfirm={remove} />
    <Sheet visible={filtersOpen} title="Filter records" onClose={() => setFiltersOpen(false)} footer={<Button title="Apply filters" testID="apply-filters" onPress={() => { try { setFilter({ ...filter, startISO: filter.start ? parseDate(filter.start) : '', endISO: filter.end ? parseDate(filter.end) : '' }); setFilterError(''); setFiltersOpen(false); } catch (e: any) { setFilterError(e.message); } }} />}>
      {['grades', 'homework', 'tests'].includes(kind) && <Choice label="Subject" testID="filter-subject" value={filter.subject_id || ''} options={[{ value: '', label: 'All subjects' }, ...records('subjects').map((r: any) => ({ value: r.id, label: r.name }))]} onChange={(v: any) => setFilter({ ...filter, subject_id: v })} />}
      {['trades', 'cashflows'].includes(kind) && <Choice label="Account" testID="filter-account" value={filter.account_id || ''} options={[{ value: '', label: 'All accounts' }, ...records('accounts').map((r: any) => ({ value: r.id, label: r.name }))]} onChange={(v: any) => setFilter({ ...filter, account_id: v })} />}
      {kind === 'trades' && <><Choice label="Direction" testID="filter-direction" value={filter.direction || ''} options={['', 'Long', 'Short'].map(v => ({ value: v, label: v || 'Both directions' }))} onChange={(v: any) => setFilter({ ...filter, direction: v })} /><Choice label="Strategy" testID="filter-strategy" value={filter.strategy_id || ''} options={[{ value: '', label: 'All strategies' }, ...records('strategies').map((r: any) => ({ value: r.id, label: r.name }))]} onChange={(v: any) => setFilter({ ...filter, strategy_id: v })} /></>}
      {['grades', 'tests', 'finance'].includes(kind) && <Choice label="Type" testID="filter-type" value={filter.type || ''} options={['', ...(kind === 'finance' ? ['Income', 'Expense'] : ['Written', 'Oral'])].map(v => ({ value: v, label: v || 'All types' }))} onChange={(v: any) => setFilter({ ...filter, type: v })} />}
      <Input label="From · DD/MM/YYYY" testID="filter-start" value={filter.start || ''} onChangeText={(v: string) => setFilter({ ...filter, start: v })} /><Input label="To · DD/MM/YYYY" testID="filter-end" value={filter.end || ''} onChangeText={(v: string) => setFilter({ ...filter, end: v })} />
      <Button title="Clear all filters" testID="clear-filters" variant="secondary" onPress={() => { setFilter({}); setStatus('All'); setSearch(''); }} />{!!filterError && <ErrorMessage message={filterError} />}
    </Sheet>
  </Shell>;
}
const useStyles = makeStyles(c => ({ toolbar: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, height: 65, overflow: 'hidden' }, manage: { paddingHorizontal: 10 }, content: { padding: 20, paddingBottom: 32, gap: 14, width: '100%', maxWidth: 760, alignSelf: 'center' }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, listCard: { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, borderRadius: 17, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13 }, recordIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' } }));
