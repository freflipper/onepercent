import { describe, expect, it, vi } from 'vitest';
import { authStorageKey, signOutOnDevice } from '../src/cloud/sign-out';
describe('Device logout', () => {
  it.each([false, true])('clears session, verifier and cached identity even when revocation fails=%s', async (fails) => {
    const removed: string[] = [];
    const auth = { signOut: vi.fn(async () => ({ error: fails ? new Error('offline') : null })), stopAutoRefresh: vi.fn(async () => {}) };
    expect(await signOutOnDevice(auth, { removeItem: async key => { removed.push(key); } })).toEqual({ revocationFailed: fails });
    expect(removed).toEqual([authStorageKey, `${authStorageKey}-code-verifier`, `${authStorageKey}-user`]);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(fails ? 1 : 0);
  });
  it('reports storage cleanup failure instead of claiming a completed logout', async () => {
    await expect(signOutOnDevice({ signOut: async () => ({ error: null }), stopAutoRefresh: async () => {} }, { removeItem: async () => { throw new Error('blocked storage'); } })).rejects.toThrow('blocked storage');
  });
});
