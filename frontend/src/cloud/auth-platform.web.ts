import { callbackPath } from './paths';

export const oauthRedirect = () => `${window.location.origin}${callbackPath}`;
const isCallbackPath = (pathname: string) => pathname.replace(/\/$/, '') === callbackPath;
export function validateCallback(url: string) {
  const parsed = new URL(url);
  if (parsed.origin !== window.location.origin || !isCallbackPath(parsed.pathname) || parsed.username || parsed.password)
    throw new Error('Invalid authentication callback.');
  return parsed;
}
export function prepareSignIn() {
  if (!['http:', 'https:'].includes(window.location.protocol))
    throw new Error('Open the website over HTTPS, or use the local app launcher.');
  if (!window.isSecureContext) throw new Error('Google sign-in requires HTTPS or localhost.');
  try {
    window.localStorage.setItem('onepercent-emergent-storage-check', '1');
    window.localStorage.removeItem('onepercent-emergent-storage-check');
  } catch { throw new Error('Allow storage for this site before signing in.'); }
}
export async function openOAuth(url: string): Promise<string | null> {
  const destination = new URL(url);
  if (destination.protocol !== 'https:') throw new Error('Invalid sign-in destination.');
  window.location.assign(destination.href);
  return null;
}
export function subscribeCallbacks(receive: (url: string) => Promise<void>, fail: (e: unknown) => void) {
  let active = true;
  if (isCallbackPath(window.location.pathname)) {
    const url = window.location.href;
    void Promise.resolve().then(() => { if (active) return receive(url); }).catch(e => { if (active) fail(e); });
  }
  return () => { active = false; };
}
export function clearCallbackLocation() {
  if (isCallbackPath(window.location.pathname))
    window.history.replaceState(window.history.state, '', callbackPath);
}
export async function clearPrivateImages() {
  // Images are unmounted on account change; no persistent browser image cache is created by the app.
}
