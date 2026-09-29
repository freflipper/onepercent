import { completeOAuth, resetOAuth } from './oauth';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { backend, supabase, friendlyError } from './client';
import { clearNotifications } from '../notifications';
import { clearCloudCache } from '../api';
import { signOutOnDevice } from './sign-out';
import { secureStorage } from './secure-storage';

import { createSessionLifecycle } from './session-lifecycle';
import {
  oauthRedirect,
  prepareSignIn,
  openOAuth,
  subscribeCallbacks,
  clearPrivateImages,
} from './auth-platform';

export { completeOAuth } from './oauth';

export async function clearPrivateDeviceData(_userId?: string) {
  clearCloudCache();
  const results = await Promise.allSettled([
    clearNotifications(),
    clearPrivateImages(),
  ]);
  const keys = await AsyncStorage.getAllKeys();
  const own = keys.filter(
    (k) =>
      k.startsWith('note-draft-') ||
      k.startsWith('onepercent:draft:') ||
      k.startsWith('onepercent:private:') ||
      k.startsWith('onepercent:notifications:'),
  );
  if (own.length) await AsyncStorage.multiRemove(own);
  if (results.some((result) => result.status === 'rejected'))
    throw new Error(
      'Some private device data could not be cleared. Retry before signing in to another account.',
    );
}
interface Auth {
  session: Session | null;
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
}
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const loginPending = useRef(false);
  const [signingIn, setSigningIn] = useState(false);
  const [lifecycle] = useState(() =>
    createSessionLifecycle<Session>(clearPrivateDeviceData, (next, pending) => {
      setSession(next);
      setLoading(pending);
    }),
  );
  const restore = useCallback(async () => {
    const gate = lifecycle;
    const ticket = gate.begin();
    setError(null);
    try {
      if (!supabase) {
        gate.fail(ticket);
        return;
      }
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (data.session) {
        const { data: user, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (user.user?.id !== data.session.user.id)
          throw new Error('Your session could not be verified. Please sign in again.');
      }
      await gate.apply(data.session, ticket);
    } catch (e) {
      if (gate.current(ticket)) {
        setError(friendlyError(e));
        gate.fail(ticket);
      }
    }
  }, [lifecycle]);
  useEffect(() => {
    const gate = lifecycle;
    gate.activate();
    void Promise.resolve().then(restore);
    if (!supabase) return;
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'INITIAL_SESSION') return;
      // Capture order now; defer work until the Supabase callback has released its auth lock.
      // Token refreshes for the same owner must not unmount an active note editor.
      const ticket = gate.begin(gate.owner() !== next?.user.id);
      setTimeout(() => {
        void gate.apply(next, ticket).catch((e) => {
          if (gate.current(ticket)) {
            setError(friendlyError(e));
            gate.fail(ticket);
          }
        });
      }, 0);
    });
    const refresh = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase?.auth.startAutoRefresh();
      else supabase?.auth.stopAutoRefresh();
    });
    const stopCallbacks = subscribeCallbacks(completeOAuth, (e) => {
      setError(friendlyError(e));
    });
    return () => {
      gate.dispose();
      listener.subscription.unsubscribe();
      refresh.remove();
      stopCallbacks();
    };
  }, [lifecycle, restore]);
  async function signIn() {
    if (loginPending.current) return;
    loginPending.current = true;
    setSigningIn(true);
    setError(null);
    try {
      prepareSignIn();
      const { data, error: authError } = await backend().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: oauthRedirect(),
          skipBrowserRedirect: true,
          scopes: 'openid email profile',
        },
      });
      if (authError) throw authError;
      if (!data.url) throw new Error('Google sign-in is not configured in Supabase.');
      const callback = await openOAuth(data.url);
      if (callback) await completeOAuth(callback);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      loginPending.current = false;
      setSigningIn(false);
    }
  }
  async function signOut() {
    const gate = lifecycle;
    let ticket = gate.begin();
    setError(null);
    try {
      // Revoke the local session even if device cleanup subsequently fails.
      const { revocationFailed } = await signOutOnDevice(backend().auth, secureStorage);
      resetOAuth();
      if (!gate.current(ticket)) ticket = gate.begin();
      await gate.apply(null, ticket);
      if (revocationFailed) setError('Signed out on this device. The server could not confirm session revocation because it was unreachable.');
    } catch (e) {
      setError(friendlyError(e));
      gate.fail(ticket);
      throw e;
    }
  }
  return (
    <Context.Provider
      value={{ session, loading, signingIn, error, signIn, signOut, retry: restore }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthProvider is missing.');
  return value;
}
