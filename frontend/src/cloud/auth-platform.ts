import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Image } from 'expo-image';

WebBrowser.maybeCompleteAuthSession();
export const oauthRedirect = () => 'onepercent://auth/callback';
export function validateCallback(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'onepercent:' || `${parsed.host}${parsed.pathname}` !== 'auth/callback')
    throw new Error('Invalid authentication callback.');
  return parsed;
}
export function prepareSignIn() {
  if (Constants.appOwnership === 'expo')
    throw new Error('Google sign-in requires a development build with the onepercent scheme.');
}
export async function openOAuth(url: string) {
  const result = await WebBrowser.openAuthSessionAsync(url, oauthRedirect());
  if (result.type === 'success') return result.url;
  if (result.type === 'cancel' || result.type === 'dismiss')
    throw new Error('Sign-in cancelled. You can try again.');
  return null;
}
export function subscribeCallbacks(
  receive: (url: string) => Promise<void>,
  fail: (e: unknown) => void,
) {
  const handle = (url: string | null) => {
    if (url?.startsWith(oauthRedirect())) void receive(url).catch(fail);
  };
  const listener = Linking.addEventListener('url', ({ url }) => handle(url));
  void Linking.getInitialURL().then(handle).catch(fail);
  return () => listener.remove();
}
export function clearCallbackLocation() {}
export async function clearPrivateImages() {
  const cleared = await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
  if (cleared.some((value) => !value)) throw new Error('Private image cache could not be cleared.');
}
