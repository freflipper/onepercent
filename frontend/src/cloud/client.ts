import { createClient } from '@supabase/supabase-js';
import { secureStorage } from './secure-storage';
import { authStorageKey } from './sign-out';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
export const configurationIssues: string[] = [];
if (!url || !/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(url))
  configurationIssues.push('Set EXPO_PUBLIC_SUPABASE_URL to your Supabase HTTPS project URL.');
if (!key)
  configurationIssues.push('Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the public project key.');
if (key.startsWith('sb_secret_'))
  configurationIssues.push('A secret key is not allowed in the app. Use the publishable key.');
if (key.startsWith('eyJ')) {
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role !== 'anon')
      configurationIssues.push('Only an anonymous legacy key or a publishable key is allowed.');
  } catch {
    configurationIssues.push('The public project key format is invalid.');
  }
}
export const supabase = configurationIssues.length
  ? null
  : createClient(url, key, {
      auth: {
        storage: secureStorage,
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        storageKey: authStorageKey,
        detectSessionInUrl: false,
      },
    });
export function backend() {
  if (!supabase)
    throw new Error(
      'Configuration required. Set the public Supabase environment variables and restart the app.',
    );
  return supabase;
}
/** Bind in-flight record and Storage requests to the owner who started them. */
export function scopedBackend(accessToken: string) {
  backend();
  return createClient(url, key, { accessToken: async () => accessToken });
}
export function friendlyError(error: unknown): string {
  const e = error as { message?: string; code?: string };
  if (
    e?.code === '40001' ||
    e?.message?.includes('revision') ||
    e?.message?.includes('version conflict')
  )
    return 'This record changed on another device. Reload it before saving again.';
  if (e?.code === '23505')
    return 'This entry already exists. Refresh to see the latest saved record.';
  if (e?.code === '42501') return 'You do not have permission to access this record.';
  if (e?.message?.includes('Network') || e?.message?.includes('fetch'))
    return 'Could not reach the server. Check your connection and retry.';
  return e?.message?.slice(0, 400) || 'The operation could not be completed. Please retry.';
}
