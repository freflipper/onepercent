/** Browser-owned session persistence. Unlike native SecureStore, this is not encrypted storage. */
import { navigatorLock, processLock } from '@supabase/supabase-js';
export const sessionLock =
  typeof navigator !== 'undefined' && navigator.locks ? navigatorLock : processLock;
export const secureStorage = {
  async getItem(key: string) {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string) {
    window.localStorage.setItem(key, value);
  },
  async removeItem(key: string) {
    window.localStorage.removeItem(key);
  },
};
