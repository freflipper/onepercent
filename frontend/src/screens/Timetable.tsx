import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useStore } from '@/src/store';
import { dayjs } from '@/src/dates';
import { makeStyles, useTheme } from '@/src/theme';
import { Shell, go } from '@/src/components/Shell';
import { Button, Card, Chips, ErrorMessage, Icon, Label, Sheet } from '@/src/components/ui';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export default function Timetable() {
  const { user, records, mutate } = useStore(), s = useStyles(), { colors } = useTheme();
  const now = dayjs().tz(user.timezone), todayDay = (now.day() + 6) % 7;
  const [day, setDay] = useState(user.visible_days.includes(todayDay) ? todayDay : user.visible_days[0]), [hour, setHour] = useState<number | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const slots = records('timetable'), subjects = records('subjects');
  async function choose(subject_id: string | null) {
    if (hour == null) return;
    setBusy(true); setError('');
    const existing = slots.find((r: any) => r.day === day && r.hour === hour);
    try { if (subject_id) await mutate(`/records/timetable${existing ? '/' + existing.id : ''}`, existing ? 'PATCH' : 'POST', { day, hour, subject_id, ...(existing ? { version: existing.version } : {}) }); else if (existing) await mutate('/records/timetable/' + existing.id, 'DELETE', { version: existing.version }); setHour(null); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return <Shell title="Weekly Subjects" section="timetable" chrome={<Chips options={user.visible_days.map((d: number) => ({ label: DAYS[d], value: d }))} value={day} onChange={setDay} testID="timetable-day" />}>
    <ScrollView contentContainerStyle={s.content}><View style={s.heading}><Label size={20} weight="600">{DAYS[day]}</Label><Button title="Manage subjects" testID="timetable-subjects" variant="ghost" onPress={() => go('subjects')} /></View><Label size={13} muted>Your recurring school timetable. Separate from Calendar.</Label>
      {Array.from({ length: 6 }, (_, i) => i + 8).map(h => { const slot = slots.find((r: any) => r.day === day && r.hour === h), subject = subjects.find((r: any) => r.id === slot?.subject_id), active = todayDay === day && now.hour() === h; return <Pressable key={h} testID={`timetable-slot-${h}`} onPress={() => { setHour(h); setError(''); }}><Card style={[s.slot, active && { borderColor: colors.brandPrimary }]}><View style={s.times}><Label weight="600" size={15}>{String(h).padStart(2, '0')}:00</Label><Label muted size={12}>{String(h + 1).padStart(2, '0')}:00</Label></View><View style={[s.line, { backgroundColor: subject?.color || colors.border }]} /><View style={{ flex: 1 }}><Label weight={subject ? '600' : '400'} muted={!subject}>{subject?.name || 'Add a subject'}</Label>{active && <Label size={11} style={{ color: colors.brandPrimary }}>Current lesson</Label>}</View><Icon name={subject ? 'create-outline' : 'add-outline'} size={19} color={colors.muted} /></Card></Pressable>; })}
      <Button title="Choose visible days" testID="timetable-visible-days" variant="secondary" onPress={() => go('settings')} />
    </ScrollView>
    <Sheet visible={hour != null} title={`Assign ${hour == null ? '' : String(hour).padStart(2, '0') + ':00'} lesson`} onClose={() => setHour(null)}>{subjects.filter((r: any) => !r.archived).map((subject: any) => <Button key={subject.id} title={subject.name} testID={`assign-subject-${subject.id}`} variant="ghost" onPress={() => choose(subject.id)} busy={busy} style={{ justifyContent: 'flex-start', marginBottom: 8 }} />)}{!subjects.length && <Button title="Create a subject first" testID="timetable-create-subject" onPress={() => { setHour(null); go('subjects'); }} />}<Button title="Remove lesson" testID="timetable-remove-lesson" variant="danger" onPress={() => choose(null)} busy={busy} />{!!error && <ErrorMessage message={error} />}</Sheet>
  </Shell>;
}
const useStyles = makeStyles(c => ({ content: { padding: 20, paddingBottom: 32, gap: 16, maxWidth: 760, width: '100%', alignSelf: 'center' }, heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, slot: { flexDirection: 'row', alignItems: 'center', minHeight: 96, gap: 16 }, times: { width: 48, gap: 4 }, line: { width: 3, height: 44, borderRadius: 2 } }));