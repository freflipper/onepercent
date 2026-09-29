import * as Notifications from 'expo-notifications';
import { Platform, Linking } from 'react-native';
import { storage } from '@/src/utils/storage';

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });
const granted = (p: Notifications.NotificationPermissionsStatus) => p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL || p.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;
export async function notificationStatus() {
  const p = await Notifications.getPermissionsAsync();
  const attempts = (await storage.getItem('notification-requests', 0)) || 0;
  return { supported: true, granted: granted(p), canAskAgain: p.canAskAgain && attempts < 2, label: granted(p) ? 'Enabled on this device' : p.status === 'denied' ? 'Permission denied' : 'Not enabled' };
}
export async function enableNotifications() {
  const previous = await notificationStatus();
  if (previous.granted) return previous;
  if (!previous.canAskAgain) { await Linking.openSettings(); return previous; }
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('reminders', { name: 'Personal reminders', importance: Notifications.AndroidImportance.HIGH, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE });
  await storage.setItem('notification-requests', ((await storage.getItem('notification-requests', 0)) || 0) + 1);
  await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return notificationStatus();
}
let syncQueue: Promise<any> = Promise.resolve();
export function syncNotifications(alerts: any[], owner: string) {
  const work = async () => {
    if (!(await notificationStatus()).granted) return;
    const future = alerts.filter(a => new Date(a.due_at).getTime() > Date.now()).slice(0, 60);
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    const expected = new Map(future.map(a => [`1percent:${owner}:${a.id}`, a]));
    const keep = new Set<string>();
    for (const notification of pending) {
      if (!notification.identifier.startsWith('1percent:')) continue;
      const value = expected.get(notification.identifier);
      if (!value || notification.content.data?.due_at !== value.due_at) await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      else keep.add(notification.identifier);
    }
    for (const [id, value] of expected) {
      if (keep.has(id)) continue;
      await Notifications.scheduleNotificationAsync({ identifier: id,
        content: { title: '1% · Reminder', body: 'You have something coming up. Open 1% to see the details.', sound: 'default', data: { due_at: value.due_at, kind: value.kind, source_id: value.source_id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(value.due_at), channelId: 'reminders' } });
    }
  };
  syncQueue = syncQueue.catch(() => {}).then(work);
  return syncQueue;
}
export async function clearNotifications() {
  await syncQueue.catch(() => {});
  for (const n of await Notifications.getAllScheduledNotificationsAsync()) if (n.identifier.startsWith('1percent:')) await Notifications.cancelScheduledNotificationAsync(n.identifier);
}
export async function sendTestNotification() {
  if (!(await notificationStatus()).granted) throw new Error('Enable notifications first.');
  await Notifications.scheduleNotificationAsync({ identifier: '1percent:test', content: { title: '1% · Test notification', body: 'Your device reminders are ready.', sound: 'default' }, trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: 'reminders' } });
}
export function observeNotifications(onOpen: (data: any) => void, onReceive: () => void) {
  const receive = Notifications.addNotificationReceivedListener(onReceive);
  const open = Notifications.addNotificationResponseReceivedListener(r => onOpen(r.notification.request.content.data));
  Notifications.getLastNotificationResponseAsync().then(r => { if (r) { onOpen(r.notification.request.content.data); Notifications.clearLastNotificationResponseAsync(); } }).catch(() => {});
  return () => { receive.remove(); open.remove(); };
}