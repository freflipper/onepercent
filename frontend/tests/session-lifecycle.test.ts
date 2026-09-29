import { describe, expect, it } from 'vitest';
import { createSessionLifecycle } from '../src/cloud/session-lifecycle';
const a = { user: { id: 'a' } };
const b = { user: { id: 'b' } };
describe('Private session lifecycle', () => {
  it('remembers a restored owner and clears that user on automatic sign-out', async () => {
    const cleared: (string | undefined)[] = [];
    const published: unknown[] = [];
    const gate = createSessionLifecycle(
      async (id) => {
        cleared.push(id);
      },
      (session, loading) => published.push({ session, loading }),
    );
    await gate.apply(a, gate.begin());
    expect(cleared).toEqual([]);
    await gate.transition(null);
    expect(cleared).toEqual(['a']);
    expect(published.at(-1)).toEqual({ session: null, loading: false });
  });
  it('cannot republish an old session after a newer logout, even when cleanup is delayed', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const published: unknown[] = [];
    const gate = createSessionLifecycle(
      async () => blocked,
      (session, loading) => published.push({ session, loading }),
    );
    await gate.transition(a);
    const switching = gate.transition(b);
    await Promise.resolve();
    const logout = gate.transition(null);
    release();
    await Promise.all([switching, logout]);
    expect(published.at(-1)).toEqual({ session: null, loading: false });
    expect(published).not.toContainEqual({ session: b, loading: false });
  });
  it('does not unmount the private UI or clear drafts for same-owner token refresh', async () => {
    const published: unknown[] = [];
    let cleanups = 0;
    const gate = createSessionLifecycle(
      async () => {
        cleanups++;
      },
      (session, loading) => published.push({ session, loading }),
    );
    await gate.transition(a);
    published.length = 0;
    await gate.transition({ user: { id: 'a' } });
    expect(cleanups).toBe(0);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ loading: false });
  });
  it('keeps another account hidden if private-data cleanup fails', async () => {
    const published: unknown[] = [];
    const gate = createSessionLifecycle(
      async () => {
        throw new Error('Native cleanup failed');
      },
      (session, loading) => published.push({ session, loading }),
    );
    await gate.transition(a);
    await expect(gate.transition(b)).rejects.toThrow('cleanup');
    expect(published.at(-1)).toEqual({ session: null, loading: true });
  });
});
