import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { schemas } from '@/src/schema';
import RecordList from '@/src/screens/RecordList';
import Home from '@/src/screens/Home';
import Calendar from '@/src/screens/Calendar';
import Notes from '@/src/screens/Notes';
import Timetable from '@/src/screens/Timetable';
import Pnl from '@/src/screens/Pnl';
import Settings from '@/src/screens/Settings';
import Notifications from '@/src/screens/Notifications';
import Screenshots from '@/src/screens/Screenshots';

const screens: Record<string, React.ComponentType> = { calendar: Calendar, notes: Notes, timetable: Timetable, pnl: Pnl, settings: Settings, notifications: Notifications, screenshots: Screenshots };
export default function Section() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const Screen = screens[section];
  if (Screen) return <Screen key={section} />;
  if (schemas[section]) return <RecordList kind={section} key={section} />;
  return <Home />;
}