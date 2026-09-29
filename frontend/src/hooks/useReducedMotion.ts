import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

let reduced = true;
const listeners = new Set<() => void>();
let detach: (() => void) | undefined;
const update = (value: boolean) => { if (value !== reduced) { reduced = value; listeners.forEach(fn => fn()); } };
function subscribe(callback: () => void) {
  listeners.add(callback);
  if (listeners.size === 1) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      const change = () => update(media.matches);
      media.addEventListener('change', change); change();
      detach = () => media.removeEventListener('change', change);
    } else {
      const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', update);
      AccessibilityInfo.isReduceMotionEnabled().then(update).catch(() => {});
      detach = () => subscription.remove();
    }
  }
  return () => { listeners.delete(callback); if (!listeners.size) { detach?.(); detach = undefined; } };
}
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => reduced, () => true);