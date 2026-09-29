import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Service = typeof import('../src/notifications.web');
let service: Service;
let notices: FakeNotification[];
let requestPermission = vi.fn<() => Promise<NotificationPermission>>();
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission: () => Promise<NotificationPermission>;
  tag: string;
  data: any;
  closed = false;
  onclose?: () => void;
  onclick?: () => void;
  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    this.tag = options.tag || '';
    this.data = options.data;
    notices.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
}
const due = (suffix = 'one', minutes = 0) => ({
  id: suffix,
  due_at: new Date(Date.now() + minutes * 60000).toISOString(),
  kind: 'reminders',
  source_id: suffix,
  source_version: 1,
  title: 'Private financial details must not appear',
});
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime('2026-09-29T12:00:00Z');
  vi.stubEnv('EXPO_PUBLIC_BASE_PATH', '/onepercent');
  notices = [];
  requestPermission = vi.fn<() => Promise<NotificationPermission>>().mockResolvedValue('granted');
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = requestPermission;
  const values: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
      Object.defineProperty(storage, key, { value, enumerable: true, configurable: true });
    },
    removeItem: (key: string) => {
      delete values[key];
      delete (storage as any)[key];
    },
  };
  vi.stubGlobal('window', {
    isSecureContext: true,
    localStorage: storage,
    focus: vi.fn(),
    location: { assign: vi.fn() },
  });
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('navigator', {});
  service = await import('../src/notifications.web');
});
afterEach(async () => {
  await service.clearNotifications();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('Emergent web reminders', () => {
  it('never asks permission on load or reconciliation', async () => {
    FakeNotification.permission = 'default';
    expect(await service.notificationStatus()).toMatchObject({ granted: false, canAskAgain: true });
    await service.syncNotifications([due()], 'owner');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(notices).toHaveLength(0);
    await service.enableNotifications();
    expect(requestPermission).toHaveBeenCalledOnce();
  });
  it('deduplicates repeated reconciliations and uses generic notification text', async () => {
    const alert = due();
    await service.syncNotifications([alert], 'owner');
    await service.syncNotifications([alert], 'owner');
    expect(notices).toHaveLength(1);
    expect(notices[0].options.body).not.toContain('financial');
    expect(notices[0].options.icon).toBe('/onepercent/icons/icon-192.png');
  });
  it('cancels pending alerts and displayed notifications when a reminder changes or logout occurs', async () => {
    await service.syncNotifications([due()], 'owner');
    await service.syncNotifications([due('later', 1)], 'owner');
    expect(notices[0].closed).toBe(true);
    await service.clearNotifications();
    await vi.advanceTimersByTimeAsync(120000);
    expect(notices).toHaveLength(1);
  });
  it('shows future alerts only while the app is active and does not replay stale backlogs', async () => {
    await service.syncNotifications([due('old', -10), due('later', 1)], 'owner');
    expect(notices).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(notices).toHaveLength(1);
    expect(notices[0].tag).toContain('later');
  });
  it('opens the owning alert and revokes it when the account changes', async () => {
    const open = vi.fn(),
      receive = vi.fn();
    const stop = service.observeNotifications(open, receive);
    const alert = due();
    await service.syncNotifications([alert], 'owner');
    notices[0].onclick?.();
    expect(open).toHaveBeenCalledWith(alert);
    await service.syncNotifications([], 'other');
    notices[0].onclick?.();
    expect(open).toHaveBeenCalledTimes(1);
    stop();
  });
  it('reports denied and unsupported permissions honestly', async () => {
    FakeNotification.permission = 'denied';
    expect(await service.notificationStatus()).toMatchObject({
      granted: false,
      canAskAgain: false,
    });
    await expect(service.sendTestNotification()).rejects.toThrow('Enable browser');
    vi.stubGlobal('Notification', undefined);
    expect(await service.notificationStatus()).toMatchObject({ supported: false, granted: false });
  });
  it('does not resurrect a pending service-worker alert after logout', async () => {
    let resolveRegistration!: (value: any) => void;
    const registration = new Promise((resolve) => {
      resolveRegistration = resolve;
    });
    const display = vi.fn(),
      getNotifications = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('navigator', {
      serviceWorker: { register: vi.fn().mockReturnValue(registration) },
    });
    const syncing = service.syncNotifications([due()], 'owner');
    const clearing = service.clearNotifications();
    resolveRegistration({ active: {}, showNotification: display, getNotifications });
    await Promise.all([syncing, clearing]);
    expect(display).not.toHaveBeenCalled();
    expect(notices).toHaveLength(0);
  });
});
