/** A Pages project may live under /repository; never derive this from an OAuth URL. */
export function normaliseBasePath(value: string) {
  const path = value.replace(/\/$/, '');
  if (!path || path === '/') return '';
  if (!/^\/(?:[a-zA-Z0-9_-]+\/?)+$/.test(path)) throw new Error('Invalid public base path.');
  return path;
}
export const basePath = normaliseBasePath(process.env.EXPO_PUBLIC_BASE_PATH || '');
export const callbackPath = `${basePath}/auth/callback`;
