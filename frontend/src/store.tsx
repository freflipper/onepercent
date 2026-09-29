import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import { api, clearCloudCache } from './api';
import { useAuth } from './cloud/auth';
import { setColorScheme } from './theme';
import { clearNotifications, observeNotifications, syncNotifications } from './notifications';

const Store = createContext<any>(null);
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth(), owner = auth.session?.user.id;
  const [profile, setProfile] = useState<any>(null), [profileLoading, setProfileLoading] = useState(false), [profileError, setProfileError] = useState('');
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [notice, setNotice] = useState('');
  const ownerRef = useRef(owner), request = useRef(0), mounted = useRef(true), profileRef = useRef<any>(null);
  const preferenceQueue = useRef<Promise<any>>(Promise.resolve());
  const invalidateRequests = useCallback(() => { request.current++; }, []);
  const user = owner && profile?.user_id === owner ? profile : null;
  useLayoutEffect(() => { ownerRef.current = owner; profileRef.current = user; }, [owner, user]);
  const publishProfile = useCallback((value: any) => {
    if (!value || ownerRef.current !== value.user_id || !mounted.current) return;
    setProfile(value);
    setColorScheme(value.theme === 'System' ? null : value.theme.toLowerCase());
  }, []);
  const refresh = useCallback(async () => {
    const capturedOwner = ownerRef.current, id = ++request.current;
    if (!capturedOwner) return;
    setLoading(true);
    try {
      const [nextProfile, result] = await Promise.all([api('/auth/me'), api('/bootstrap')]);
      if (!mounted.current || id !== request.current || ownerRef.current !== capturedOwner) return;
      publishProfile(nextProfile); setData(result); setError(''); setProfileError('');
      if (result.notification_error) setNotice(result.notification_error);
      await syncNotifications(result.alerts, capturedOwner).catch(() => {
        if (ownerRef.current === capturedOwner) setNotice('Your data is saved. Device reminders could not be updated. Open Settings to retry.');
      });
      return result;
    } catch (e: any) {
      if (mounted.current && id === request.current && ownerRef.current === capturedOwner) {
        setError(e.message);
        if (!profileRef.current) setProfileError(e.message);
      }
      throw e;
    } finally {
      if (mounted.current && id === request.current) { setLoading(false); setProfileLoading(false); }
    }
  }, [publishProfile]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; invalidateRequests(); }; }, [invalidateRequests]);
  useEffect(() => {
    request.current++; clearCloudCache();
    let activeOwner = true;
    void Promise.resolve().then(() => {
      if (!activeOwner) return;
      setProfile(null); setData(null); setNotice(''); setError(''); setProfileError('');
      if (!owner) { setProfileLoading(false); setLoading(false); return; }
      setProfileLoading(true);
      void refresh().catch(() => {});
    });
    const active = () => { if (AppState.currentState === 'active') void refresh().catch(() => {}); };
    const listener = AppState.addEventListener('change', state => { if (state === 'active') active(); });
    const timer = setInterval(active, 30000);
    const stop = observeNotifications(value => {
      if (value.kind && value.source_id) router.push({ pathname: '/[section]', params: { section: value.kind, item: value.source_id } });
    }, active);
    if (Platform.OS === 'web') window.addEventListener('focus', active);
    return () => { activeOwner = false; listener.remove(); clearInterval(timer); stop(); if (Platform.OS === 'web') window.removeEventListener('focus', active); };
  }, [owner, refresh]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); } }, [notice]);
  async function mutate(path: string, method: string, body?: any) {
    const capturedOwner = ownerRef.current;
    const result = await api(path, method, body);
    if (capturedOwner !== ownerRef.current) throw new Error('Your session changed. Please sign in again.');
    await refresh().catch(() => setNotice('Saved in your account. Refresh to update the latest summaries.'));
    return result;
  }
  function saveProfile(value: any) {
    const capturedOwner = ownerRef.current;
    const work = preferenceQueue.current.catch(() => {}).then(async () => {
      if (!capturedOwner || capturedOwner !== ownerRef.current) throw new Error('Your session changed. Please sign in again.');
      invalidateRequests();
      try {
        const result = await api('/auth/profile', 'PUT', value);
        if (capturedOwner === ownerRef.current) publishProfile(result);
        return result;
      } finally {
        if (capturedOwner === ownerRef.current) {
          invalidateRequests();
          await refresh().catch(() => {});
        }
      }
    });
    preferenceQueue.current = work.catch(() => {});
    return work;
  }
  function setThemePreference(theme: 'Light' | 'Dark' | 'System', updatedAt?: string) {
    const capturedOwner = ownerRef.current;
    const work = preferenceQueue.current.catch(() => {}).then(async () => {
      if (!capturedOwner || capturedOwner !== ownerRef.current) throw new Error('Your session changed. Please sign in again.');
      // Discard background reads started before or during this save, so an older
      // profile cannot revert the saved appearance. A fresh read also ends loading on failure.
      invalidateRequests();
      try {
        const result = await api('/auth/preferences', 'PATCH', { theme, updated_at: updatedAt });
        if (capturedOwner === ownerRef.current) { publishProfile(result); setNotice('Appearance saved.'); }
        return result;
      } finally {
        if (capturedOwner === ownerRef.current) {
          invalidateRequests();
          await refresh().catch(() => {});
        }
      }
    });
    preferenceQueue.current = work.catch(() => {});
    return work;
  }
  async function logout() {
    request.current++; clearCloudCache();
    await auth.signOut();
    setProfile(null); setData(null); setNotice('');
    await clearNotifications();
  }
  const records = (kind: string) => (user ? data?.records || [] : []).filter((r: any) => r.kind === kind);
  return <Store.Provider value={{ user, authLoading: auth.loading || auth.signingIn || profileLoading || (!!owner && !user && !profileError), authError: auth.error || profileError, signIn: auth.signIn, logout, retry: owner ? refresh : auth.retry, data: user ? data : null, loading, error, refresh, mutate, saveProfile, setThemePreference, records, notice, setNotice }}>{children}</Store.Provider>;
}
export const useStore = () => useContext(Store);
