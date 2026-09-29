/** Browser reminders run only while this page is open. The worker has no timers or data cache. */
type Alert = {
  id: string;
  due_at: string;
  kind: string;
  source_id: string;
  source_version?: number;
};
const basePath = (process.env.EXPO_PUBLIC_BASE_PATH || '').replace(/^\/*|\/*$/g, '');
const scope = basePath ? `/${basePath}/` : '/';
const receiptPrefix = 'onepercent:browser-notice:';
let owner: string | null = null;
let generation = 0;
let syncRevision = 0;
let alerts: Alert[] = [];
let timer: ReturnType<typeof setInterval> | undefined;
let worker: Promise<ServiceWorkerRegistration | null> | undefined;
let deliveryError = '';
const visible = new Set<Notification>();
const memoryReceipts = new Set<string>();
const pending = new Set<string>();
const listeners = new Set<{ open: (data: Alert) => void; receive: () => void }>();

function supported() {
  return (
    typeof window !== 'undefined' && window.isSecureContext && typeof Notification !== 'undefined'
  );
}
async function registration() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  worker ||= navigator.serviceWorker
    .register(`${scope}service-worker.js`, { scope })
    .then(async (registration) => {
      if (registration.active) return registration;
      const candidate = registration.installing || registration.waiting;
      if (!candidate) return null;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          candidate.removeEventListener('statechange', changed);
          reject(new Error('Notification setup timed out.'));
        }, 10000);
        const changed = () => {
          if (candidate.state === 'activated' || candidate.state === 'redundant') {
            clearTimeout(timeout);
            candidate.removeEventListener('statechange', changed);
            if (candidate.state === 'activated') resolve();
            else reject(new Error('Notification worker unavailable.'));
          }
        };
        candidate.addEventListener('statechange', changed);
        changed();
      });
      return registration;
    })
    .catch(() => {
      worker = undefined;
      return null;
    });
  return worker;
}
export async function notificationStatus() {
  const available = supported();
  const permission = available ? Notification.permission : 'denied';
  return {
    supported: available,
    granted: permission === 'granted',
    canAskAgain: permission === 'default',
    label: !available
      ? 'System notifications unavailable in this browser'
      : deliveryError ||
        (permission === 'granted'
          ? 'Enabled while this app is open'
          : permission === 'denied'
            ? 'Permission denied in this browser'
            : 'Not enabled'),
  };
}
export async function enableNotifications() {
  if (!supported()) return notificationStatus();
  if (Notification.permission === 'default') await Notification.requestPermission();
  deliveryError = '';
  if (Notification.permission === 'granted') await registration();
  return notificationStatus();
}
function receiptKey(user: string, alert: Alert) {
  return `${receiptPrefix}${user}:${alert.id}:${alert.source_version ?? 0}:${alert.due_at}`;
}
function received(key: string) {
  if (memoryReceipts.has(key)) return true;
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}
function remember(key: string) {
  memoryReceipts.add(key);
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    /* Deduplication still protects this page. */
  }
}
async function show(alert: Alert | null, user: string, epoch: number) {
  const service = await registration();
  if (owner !== user || generation !== epoch || Notification.permission !== 'granted') return false;
  const tag = alert ? receiptKey(user, alert) : `${receiptPrefix}${user}:test`;
  const options: NotificationOptions = {
    body: alert
      ? 'You have something coming up. Open 1% for the details.'
      : 'Browser notifications are enabled. Reminders require the app to stay open.',
    tag,
    icon: `${scope}icons/icon-192.png`,
    data: { app: 'onepercent', owner: user },
    silent: false,
  };
  if (service?.active) {
    await service.showNotification(alert ? '1% · Reminder' : '1% · Test notification', options);
    if (owner !== user || generation !== epoch) {
      for (const notification of await service.getNotifications({ tag })) notification.close();
      return false;
    }
  } else {
    const notification = new Notification(
      alert ? '1% · Reminder' : '1% · Test notification',
      options,
    );
    visible.add(notification);
    notification.onclose = () => visible.delete(notification);
    notification.onclick = () => {
      notification.close();
      window.focus();
      if (owner !== user || generation !== epoch) return;
      if (alert) listeners.forEach((listener) => listener.open(alert));
      else window.location.assign(`${scope}notifications`);
    };
  }
  listeners.forEach((listener) => listener.receive());
  return true;
}
async function tick() {
  if (!owner || !supported() || Notification.permission !== 'granted') return;
  const user = owner,
    epoch = generation,
    now = Date.now();
  for (const alert of alerts) {
    const due = Date.parse(alert.due_at),
      key = receiptKey(user, alert);
    if (due > now || due < now - 300000 || received(key) || pending.has(key)) continue;
    const deliver = async () => {
      if (owner !== user || generation !== epoch || received(key)) return;
      if (await show(alert, user, epoch)) remember(key);
    };
    try {
      pending.add(key);
      if (navigator.locks?.request) await navigator.locks.request(key, deliver);
      else await deliver();
      deliveryError = '';
    } catch {
      deliveryError = 'Notification delivery failed. Check browser permission and retry the test.';
    } finally {
      pending.delete(key);
    }
  }
}
export async function syncNotifications(input: Alert[], user: string) {
  const request = ++syncRevision;
  if (owner !== user) {
    generation++;
    memoryReceipts.clear();
    // Preserve persistent receipts on reload; erase only the previous account on a switch.
    if (owner && typeof window !== 'undefined') {
      const previousPrefix = `${receiptPrefix}${owner}:`;
      try {
        for (const key of Object.keys(window.localStorage))
          if (key.startsWith(previousPrefix)) window.localStorage.removeItem(key);
      } catch {
        /* Storage may be blocked. */
      }
    }
    owner = user;
  }
  alerts = input
    .filter(
      (alert) =>
        alert &&
        typeof alert.id === 'string' &&
        typeof alert.kind === 'string' &&
        typeof alert.source_id === 'string' &&
        Number.isFinite(Date.parse(alert.due_at)),
    )
    .map((alert) => ({ ...alert }));
  if (!timer)
    timer = setInterval(() => {
      void tick();
    }, 15000);
  const expected = new Set(alerts.map((alert) => receiptKey(user, alert)));
  for (const notification of visible) if (!expected.has(notification.tag)) notification.close();
  const service = await registration();
  if (request !== syncRevision || owner !== user) return;
  if (service)
    for (const notification of await service.getNotifications()) {
      if (notification.data?.app === 'onepercent' && !expected.has(notification.tag))
        notification.close();
    }
  await tick();
}
export async function clearNotifications() {
  owner = null;
  alerts = [];
  generation++;
  syncRevision++;
  if (timer) clearInterval(timer);
  timer = undefined;
  for (const notification of visible) notification.close();
  visible.clear();
  memoryReceipts.clear();
  if (typeof window !== 'undefined') {
    try {
      for (const key of Object.keys(window.localStorage))
        if (key.startsWith(receiptPrefix)) window.localStorage.removeItem(key);
    } catch {
      /* Storage may be blocked. */
    }
  }
  const service = worker ? await worker : null;
  if (service)
    for (const notification of await service.getNotifications())
      if (notification.data?.app === 'onepercent') notification.close();
}
export async function sendTestNotification() {
  if (!(await notificationStatus()).granted) throw new Error('Enable browser notifications first.');
  if (!owner) throw new Error('Sign in and refresh your workspace before testing notifications.');
  try {
    if (!(await show(null, owner, generation))) throw new Error('Your session changed.');
    deliveryError = '';
  } catch {
    deliveryError =
      'This browser could not display a notification. Check site permissions or open the installed app.';
    throw new Error(deliveryError);
  }
}
export function observeNotifications(onOpen: (data: Alert) => void, onReceive: () => void) {
  const listener = { open: onOpen, receive: onReceive };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
