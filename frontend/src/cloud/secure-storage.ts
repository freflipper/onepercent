import * as SecureStore from 'expo-secure-store';
export { processLock as sessionLock } from '@supabase/supabase-js';

type Manifest = { generation: string; count: number };
type Journal = { previous: Manifest | null; next: Manifest };
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const keyFor = (key: string) => `onepercent.${key.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.catch(() => {});
  return next;
}
function isManifest(value: unknown): value is Manifest {
  const m = value as Manifest | null;
  return (
    !!m &&
    typeof m.generation === 'string' &&
    /^[a-zA-Z0-9-]{1,100}$/.test(m.generation) &&
    Number.isInteger(m.count) &&
    m.count >= 1 &&
    m.count <= 1000
  );
}
async function readManifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(key, options);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (isManifest(parsed)) return parsed;
  } catch {
    /* Remove an invalid manifest so a new sign-in can recover. */
  }
  await SecureStore.deleteItemAsync(key, options);
  return null;
}
async function deleteChunks(key: string, m: Manifest | null) {
  if (m)
    await Promise.all(
      Array.from({ length: m.count }, (_, i) =>
        SecureStore.deleteItemAsync(`${key}.${m.generation}.${i}`, options),
      ),
    );
}
/** The journal makes interrupted refresh writes discoverable and removable on the next launch. */
async function recover(key: string) {
  const active = await readManifest(key);
  const raw = await SecureStore.getItemAsync(`${key}.pending`, options);
  if (!raw) return active;
  let journal: Journal | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (isManifest(parsed.next) && (parsed.previous === null || isManifest(parsed.previous)))
      journal = parsed;
  } catch {
    /* Corrupt journal is not a session. */
  }
  if (journal) {
    if (journal.next.generation !== active?.generation) await deleteChunks(key, journal.next);
    if (journal.previous?.generation !== active?.generation)
      await deleteChunks(key, journal.previous);
  }
  await SecureStore.deleteItemAsync(`${key}.pending`, options);
  return active;
}
export const secureStorage = {
  getItem: (key: string) =>
    serial(async () => {
      const k = keyFor(key),
        m = await recover(k);
      if (!m) return null;
      const parts = await Promise.all(
        Array.from({ length: m.count }, (_, i) =>
          SecureStore.getItemAsync(`${k}.${m.generation}.${i}`, options),
        ),
      );
      if (parts.some((p) => p === null)) {
        await SecureStore.deleteItemAsync(k, options);
        await deleteChunks(k, m);
        return null;
      }
      return parts.join('');
    }),
  setItem: (key: string, value: string) =>
    serial(async () => {
      const k = keyFor(key),
        previous = await recover(k),
        generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const parts = value.match(/[\s\S]{1,450}/g) || [''];
      if (parts.length > 1000)
        throw new Error('The authentication session is too large to store securely.');
      const next = { generation, count: parts.length };
      await SecureStore.setItemAsync(`${k}.pending`, JSON.stringify({ previous, next }), options);
      try {
        for (let i = 0; i < parts.length; i++)
          await SecureStore.setItemAsync(`${k}.${generation}.${i}`, parts[i], options);
        await SecureStore.setItemAsync(k, JSON.stringify(next), options);
      } catch (error) {
        await recover(k);
        throw error;
      }
      await deleteChunks(k, previous);
      await SecureStore.deleteItemAsync(`${k}.pending`, options);
    }),
  removeItem: (key: string) =>
    serial(async () => {
      const k = keyFor(key),
        m = await recover(k);
      await SecureStore.deleteItemAsync(k, options);
      await deleteChunks(k, m);
    }),
};
