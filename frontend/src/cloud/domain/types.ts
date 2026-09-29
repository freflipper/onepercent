import { todayInZone } from './dates';
export const entityKinds = [
  'subject',
  'event',
  'reminder',
  'notification',
  'note',
  'folder',
  'grade',
  'homework',
  'test',
  'subscription',
  'transaction',
  'slot',
  'account',
  'cashflow',
  'trade',
  'screenshot',
  'strategy',
] as const;
export type EntityKind = (typeof entityKinds)[number];
export type Data = { [key: string]: any }; // Validated at the boundary by kind-specific schema and database constraints.
export interface Entity<K extends EntityKind = EntityKind> {
  id: string;
  user_id: string;
  kind: K;
  data: Data;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface Profile {
  id: string;
  name: string;
  timezone: string;
  theme: 'Light' | 'Dark' | 'System';
  opening_balance: number;
  opening_date: string;
  visible_days: number[];
  trading_expanded: boolean;
  created_at?: string;
  updated_at?: string;
}
export const defaultProfile = (id: string): Profile => ({
  id,
  name: 'Francesco',
  timezone: 'Europe/Rome',
  theme: 'System',
  opening_balance: 0,
  opening_date: todayInZone('Europe/Rome'),
  visible_days: [1, 2, 3, 4, 5, 6],
  trading_expanded: true,
});
export interface DataStore {
  records: Entity[];
  profile: Profile;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (kind: EntityKind, data: Data, existing?: Entity) => Promise<Entity>;
  remove: (record: Entity) => Promise<void>;
  updateProfile: (patch: Partial<Profile>, expectedUpdatedAt?: string) => Promise<Profile>;
  moveNotes: (ids: string[], folderId: string | null) => Promise<void>;
  paySubscription: (id: string, date: string) => Promise<void>;
}
