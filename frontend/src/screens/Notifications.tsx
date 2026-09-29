import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useStore } from '@/src/store';
import { dayjs } from '@/src/dates';
import { makeStyles, useTheme } from '@/src/theme';
import { Shell, go } from '@/src/components/Shell';
import { Card, Chips, Empty, ErrorMessage, Icon, Label } from '@/src/components/ui';

export default function Notifications() {
  const { data, user, mutate } = useStore(), s = useStyles(), { colors } = useTheme(), [filter, setFilter] = useState('Unread'), [error, setError] = useState('');
  const notifications = (data?.notifications || []).filter((r: any) => filter === 'All' || !r.read);
  async function open(n: any) { try { await mutate(`/notifications/${encodeURIComponent(n.id)}/read`, 'POST'); if (n.source_id) go(n.kind, { item: n.source_id }); } catch (e: any) { setError(e.message); } }
  return <Shell title="Notifications" section="notifications" chrome={<Chips options={['Unread', 'All']} value={filter} onChange={setFilter} testID="notification-filter" />}><ScrollView contentContainerStyle={s.content}>{!!error && <ErrorMessage message={error} />}{notifications.length ? notifications.map((n: any) => <Pressable key={n.id} testID={`notification-${n.id}`} onPress={() => open(n)}><Card style={s.row}><Icon name={n.read ? 'notifications-outline' : 'notifications'} color={colors.brandPrimary} /><View style={{ flex: 1, gap: 5 }}><Label weight={n.read ? '400' : '600'}>{n.title}</Label><Label size={12} muted>{dayjs(n.due_at).tz(user.timezone).format('D MMM · HH:mm')}</Label></View><Icon name="chevron-forward" size={15} /></Card></Pressable>) : <Empty title="You’re all caught up" detail="Due reminders appear here. Enable device notifications in Settings to receive local alerts." icon="notifications-outline" action={() => go('settings')} actionLabel="Notification settings" />}</ScrollView></Shell>;
}
const useStyles = makeStyles(() => ({ content: { padding: 20, paddingBottom: 32, gap: 14, maxWidth: 760, width: '100%', alignSelf: 'center' }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 } }));