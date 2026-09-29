export const authStorageKey = 'onepercent-emergent-auth';

/** Remove this device's session even if the network cannot revoke its refresh token. */
export async function signOutOnDevice(
  auth: { signOut(options: { scope: 'local' }): Promise<{ error: unknown }>; stopAutoRefresh(): Promise<void> },
  storage: { removeItem(key: string): Promise<void> },
) {
  let revocationFailed = false;
  try { const result = await auth.signOut({ scope: 'local' }); revocationFailed = !!result.error; }
  catch { revocationFailed = true; }
  if (revocationFailed) await auth.stopAutoRefresh();
  for (const key of [authStorageKey, `${authStorageKey}-code-verifier`, `${authStorageKey}-user`])
    await storage.removeItem(key);
  return { revocationFailed };
}
