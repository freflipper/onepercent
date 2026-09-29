import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { getHomeTime } from '@/src/homeTime';

export function useHomeTime(zone: string, interval = 60000) {
  const [instant, setInstant] = useState(() => new Date()), focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const tick = () => {
      stop(); setInstant(new Date());
      timer = setTimeout(tick, interval - Date.now() % interval);
    };
    if (AppState.currentState === 'active' || AppState.currentState == null) tick();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') tick(); else stop(); });
    return () => { stop(); listener.remove(); };
  }, [focused, interval, zone]);
  return getHomeTime(instant, zone);
}