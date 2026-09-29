import React, { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Field, schemas, singular } from '@/src/schema';
import { useStore } from '@/src/store';
import { makeStyles, useTheme } from '@/src/theme';
import { dateInput, dateTimeInput, dayjs, newId, parseDate, parseDateTime } from '@/src/dates';
import { Button, ErrorMessage, Icon, Input, Label, Sheet } from './ui';

export function Choice({ label, value, options, onChange, testID }: any) {
  const [open, setOpen] = useState(false), s = useStyles();
  return <View style={s.field}><Label size={13} weight="600">{label}</Label><Pressable testID={testID} accessibilityRole="button" onPress={() => setOpen(!open)} style={s.choice}><Label style={{ flex: 1 }}>{options.find((o: any) => o.value === value)?.label || 'Choose…'}</Label><Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} /></Pressable>{open && <View style={s.options}>{options.map((o: any) => <Pressable accessibilityRole="button" testID={`${testID}-${o.value}`} key={String(o.value)} onPress={() => { onChange(o.value); setOpen(false); }} style={s.option}><Label style={{ flex: 1 }}>{o.label}</Label>{o.value === value && <Icon name="checkmark" size={18} />}</Pressable>)}</View>}</View>;
}
export function EditorForm({ kind, record, seed = {}, onClose, onSaved }: any) {
  const store = useStore(), { colors } = useTheme(), s = useStyles();
  const fields = schemas[kind] || [];
  const [values, setValues] = useState<any>(() => Object.fromEntries(fields.map(f => {
    let v = record?.[f.key] ?? seed[f.key] ?? f.default;
    if (f.type === 'date') v = dateInput(v || store.data?.today || dayjs().format('YYYY-MM-DD'));
    if (f.type === 'datetime') v = dateTimeInput(v || (f.required ? new Date().toISOString() : ''), store.user.timezone);
    if (f.type === 'money') v = v == null ? '' : (v / 100).toFixed(2);
    if (f.type === 'checklist') v = (v || []).join('\n');
    return [f.key, v ?? (f.type === 'boolean' ? false : '')];
  })));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [subjectName, setSubjectName] = useState(''), [addingSubject, setAddingSubject] = useState(false);
  const change = (key: string, value: any) => setValues((v: any) => ({ ...v, [key]: value }));
  async function addSubject() {
    setBusy(true); setError('');
    try { const value = await store.mutate('/records/subjects', 'POST', { name: subjectName }); change('subject_id', value.id); setAddingSubject(false); setSubjectName(''); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const payload: any = {};
      for (const f of fields) {
        let v = values[f.key];
        if (f.required && (v == null || String(v).trim() === '')) throw new Error(`${f.label} is required.`);
        if (f.type === 'date') v = parseDate(v);
        else if (f.type === 'datetime') v = v ? parseDateTime(v, store.user.timezone) : null;
        else if (f.type === 'money') {
          if (v === '') v = null;
          else { const text = String(v).trim().replace(',', '.'); if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error(`${f.label}: use a number with up to two decimal places.`); v = Math.round(Number(text) * 100); }
        } else if (f.type === 'number' || f.type === 'reminder') {
          if (v === '' || v == null || v === -1) v = null;
          else { v = Number(String(v).replace(',', '.')); if (!Number.isFinite(v)) throw new Error(`${f.label} must be a valid number.`); }
        } else if (f.type === 'reference') v = v || null;
        else if (f.type === 'checklist') v = v.split('\n').map((x: string) => x.trim()).filter(Boolean);
        else if (f.key === 'time' || f.key === 'end_time') v = v || null;
        else if (typeof v === 'string') v = v.trim();
        payload[f.key] = v;
      }
      if (kind === 'notes' && !record) payload.pages = [{ id: newId(), background: 'Blank', spacing: 24, objects: [] }];
      if (record) payload.version = record.version;
      const body = record?.subscription_id ? { status: payload.status, version: record.version } : payload;
      const result = await store.mutate(`/records/${kind}${record ? '/' + record.id : ''}`, record ? 'PATCH' : 'POST', body);
      onSaved?.(result); onClose();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  function renderField(f: Field) {
    if (kind === 'events' && values.all_day && ['time', 'end_time'].includes(f.key)) return null;
    if (kind === 'trades' && values.status === 'Open' && ['closed_at', 'gross_pnl', 'exit_price'].includes(f.key)) return null;
    if (record?.subscription_id && f.key !== 'status') return null;
    const label = `${f.label}${f.required ? ' *' : ''}`, id = `form-${f.key.replace(/_/g, '-')}`, value = values[f.key];
    let field;
    if (f.type === 'choice' || f.type === 'reference') {
      const options = f.type === 'choice' ? f.choices?.map(x => ({ label: x, value: x })) : [...(!f.required ? [{ label: 'None', value: '' }] : []), ...store.records(f.ref).filter((r: any) => !r.archived || r.id === value).map((r: any) => ({ label: r.name || r.title || `${r.instrument} · ${r.direction}`, value: r.id }))];
      field = <Choice label={label} value={value} options={options || []} testID={id} onChange={(v: any) => change(f.key, v)} />;
    } else if (f.type === 'boolean') field = <View style={s.toggle}><Label>{label}</Label><Switch testID={id} value={!!value} onValueChange={v => change(f.key, v)} trackColor={{ false: colors.borderStrong, true: colors.brand }} /></View>;
    else if (f.type === 'color') field = <View style={s.field}><Label size={13} weight="600">{label}</Label><View style={s.palette}>{[colors.inkGreen, colors.inkBlue, colors.inkRed, colors.highlight, colors.paperInk].map(c => <Pressable accessibilityLabel={c} testID={`${id}-${c.slice(1)}`} key={c} onPress={() => change(f.key, c)} style={[s.swatch, { backgroundColor: c, borderColor: value === c ? colors.onSurface : colors.transparent }]} />)}</View></View>;
    else if (f.type === 'reminder') field = <><Choice label={label} value={value === '' || value == null ? -1 : [0, 15, 60, 1440].includes(Number(value)) ? Number(value) : 'custom'} options={[{ label: 'No reminder', value: -1 }, { label: 'At time', value: 0 }, { label: '15 minutes before', value: 15 }, { label: '1 hour before', value: 60 }, { label: '1 day before', value: 1440 }, { label: 'Custom minutes before', value: 'custom' }]} testID={id} onChange={(v: any) => change(f.key, v === 'custom' ? '30' : v === -1 ? '' : v)} />{value !== '' && ![0, 15, 60, 1440].includes(Number(value)) && <Input label="Custom minutes" testID="form-custom-reminder" keyboardType="numeric" value={value} onChangeText={(v: string) => change(f.key, v)} />}</>;
    else field = <Input label={label} testID={id} value={value} onChangeText={(v: string) => change(f.key, v)} multiline={f.type === 'long' || f.type === 'checklist'} keyboardType={['money', 'number'].includes(f.type || '') ? 'numbers-and-punctuation' : undefined} placeholder={f.type === 'date' ? 'DD/MM/YYYY' : f.type === 'datetime' ? 'DD/MM/YYYY HH:mm' : undefined} />;
    return <View key={f.key}>{field}{f.hint && <Label size={12} muted style={s.hint}>{f.hint}</Label>}{f.key === 'subject_id' && <View style={s.subjectArea}>{addingSubject ? <><Input label="New subject name" testID="new-subject-name" value={subjectName} onChangeText={setSubjectName} /><Button title="Create subject" testID="new-subject-save" variant="secondary" onPress={addSubject} busy={busy} /></> : <Button title="Add a subject" testID="new-subject-button" variant="ghost" icon="add" onPress={() => setAddingSubject(true)} />}</View>}</View>;
  }
  return <Sheet visible title={`${record ? 'Edit' : 'New'} ${singular[kind] || kind}`} onClose={busy ? () => {} : onClose} footer={<Button title={record ? 'Save changes' : `Create ${singular[kind] || kind}`} testID="form-save" onPress={save} busy={busy} />}>
    <Label muted size={12} style={{ marginBottom: 20 }}>Dates in DD/MM/YYYY · Times in {store.user.timezone}</Label>
    {record?.subscription_id && <Label muted style={{ marginBottom: 20 }}>This payment is linked to a renewal. Its original amount and date are preserved.</Label>}
    {fields.map(renderField)}{error ? <ErrorMessage message={error} /> : null}
  </Sheet>;
}
const useStyles = makeStyles(c => ({ field: { gap: 8, marginBottom: 18 }, choice: { minHeight: 50, backgroundColor: c.surfaceTertiary, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.border }, options: { borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden' }, option: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', gap: 8, borderBottomWidth: 0.5, borderBottomColor: c.border }, toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }, palette: { flexDirection: 'row', gap: 10 }, swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 3 }, hint: { marginTop: -10, marginBottom: 20 }, subjectArea: { marginTop: -8, marginBottom: 16 } }));