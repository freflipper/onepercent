import type { Session } from '@supabase/supabase-js';
import { backend, friendlyError, scopedBackend } from './client';
import type { Data, Entity, EntityKind, Profile } from './domain/types';
import { profilePatch, profileView, recordPayload, recordView, sectionKind } from './records';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
interface Cache {
  owner: string | null;
  generation: number;
  revision: number;
  reads: number;
  profileRevision: number;
  changes: Map<string, number>;
  records: Map<string, Entity>;
  imageCleanup: Map<string, Entity>;
  profile: Profile | null;
}
const cache: Cache = {
  owner: null,
  generation: 0,
  revision: 0,
  reads: 0,
  profileRevision: 0,
  changes: new Map(),
  records: new Map(),
  imageCleanup: new Map(),
  profile: null,
};
export function clearCloudCache() {
  cache.owner = null;
  cache.generation++;
  cache.revision++;
  cache.profileRevision++;
  cache.changes.clear();
  cache.records.clear();
  cache.imageCleanup.clear();
  cache.profile = null;
}
export interface CloudContext {
  session: Session;
  generation: number;
  client: ReturnType<typeof scopedBackend>;
}
export async function context(): Promise<CloudContext> {
  const { data, error } = await backend().auth.getSession();
  if (error || !data.session) throw new ApiError('Sign in again to open your workspace.', 401);
  if (cache.owner !== data.session.user.id) {
    clearCloudCache();
    cache.owner = data.session.user.id;
  }
  return {
    session: data.session,
    generation: cache.generation,
    client: scopedBackend(data.session.access_token),
  };
}
export async function current(ctx: CloudContext) {
  const { data, error } = await backend().auth.getSession();
  if (error || cache.generation !== ctx.generation || data.session?.user.id !== ctx.session.user.id)
    throw new ApiError('Your session changed. Reopen this screen after signing in.', 401);
}
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const value = error as { code?: string; status?: number; name?: string };
  const status = ['40001', '23505'].includes(value?.code || '')
    ? 409
    : value?.code === '42501'
      ? 403
      : value?.status || 422;
  return new ApiError(
    value?.name === 'AbortError'
      ? 'The request timed out. Check your connection and try again.'
      : friendlyError(error),
    status,
  );
}
// Scoped clients pin each request to its original user, including Storage calls.
export async function query<T>(ctx: CloudContext, builder: any): Promise<T> {
  await current(ctx);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const { data, error } = await builder.abortSignal(controller.signal);
    if (error) throw asApiError(error);
    await current(ctx);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}
function owned(ctx: CloudContext, row: Entity) {
  if (!row || row.user_id !== ctx.session.user.id)
    throw new ApiError('This record is not available in your workspace.', 403);
  return row;
}
export async function readProfile(ctx: CloudContext, fresh = false): Promise<Profile> {
  if (!fresh && cache.profile) {
    await current(ctx);
    return cache.profile;
  }
  const revision = cache.profileRevision;
  const profile = await query<Profile>(
    ctx,
    ctx.client.from('profiles').select('*').eq('id', ctx.session.user.id).single(),
  );
  if (profile?.id !== ctx.session.user.id)
    throw new ApiError('Your profile is not available.', 403);
  if (cache.profile) {
    const savedAt = cache.profile.updated_at || '',
      receivedAt = profile.updated_at || '';
    const older =
      Date.parse(receivedAt) < Date.parse(savedAt) ||
      (Date.parse(receivedAt) === Date.parse(savedAt) && receivedAt < savedAt);
    if (cache.profileRevision !== revision || older) return cache.profile;
  }
  cache.profile = profile;
  return profile;
}
export async function readRecords(ctx: CloudContext, kind?: EntityKind): Promise<Entity[]> {
  const sequence = ++cache.reads,
    revision = cache.revision;
  const rows: Entity[] = [];
  let after: string | null = null;
  for (;;) {
    let request = ctx.client
      .from('records')
      .select('*')
      .eq('user_id', ctx.session.user.id)
      .order('id')
      .limit(500);
    if (kind) request = request.eq('kind', kind);
    if (after) request = request.gt('id', after);
    const page = await query<Entity[]>(ctx, request);
    for (const row of page) rows.push(owned(ctx, row));
    if (page.length < 500) break;
    after = page[page.length - 1].id;
  }
  // Keep local commits that completed while this paginated snapshot was in flight.
  const merged = new Map(rows.map((row) => [row.id, row]));
  for (const [id, changedAt] of cache.changes)
    if (changedAt > revision) {
      const saved = cache.records.get(id);
      if (saved && (!kind || saved.kind === kind)) merged.set(id, saved);
      else merged.delete(id);
    }
  for (const [id, row] of merged) {
    const saved = cache.records.get(id);
    if (saved && saved.version > row.version) merged.set(id, saved);
  }
  const latest = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (sequence === cache.reads) {
    if (!kind) cache.records.clear();
    else for (const [id, row] of cache.records) if (row.kind === kind) cache.records.delete(id);
    for (const row of latest) cache.records.set(row.id, row);
  }
  return latest;
}
export async function readRecord(
  ctx: CloudContext,
  id: string,
  kind?: EntityKind,
  fresh = false,
): Promise<Entity> {
  const existing = cache.records.get(id);
  if (existing && !fresh) {
    await current(ctx);
    if (kind && existing.kind !== kind) throw new ApiError('Record not found.', 404);
    return existing;
  }
  const revision = cache.revision;
  let request = ctx.client
    .from('records')
    .select('*')
    .eq('id', id)
    .eq('user_id', ctx.session.user.id);
  if (kind) request = request.eq('kind', kind);
  const row = await query<Entity | null>(ctx, request.maybeSingle());
  if (!row) throw new ApiError('Record not found.', 404);
  owned(ctx, row);
  const saved = cache.records.get(id);
  if (!saved && (cache.changes.get(id) || 0) > revision)
    throw new ApiError('Record not found.', 404);
  if (saved && saved.version >= row.version) return saved;
  cache.records.set(row.id, row);
  return row;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new ApiError(
      'Reload this record before changing it. Its saved revision is missing.',
      409,
    );
  return value as number;
}
export async function rpcRecord(ctx: CloudContext, name: string, args: Data): Promise<Entity> {
  const result = await query<Entity | Entity[]>(ctx, ctx.client.rpc(name, args));
  const row = owned(ctx, Array.isArray(result) ? result[0] : result);
  cache.revision++;
  cache.changes.set(row.id, cache.revision);
  cache.records.set(row.id, row);
  return row;
}
export async function saveRecord(ctx: CloudContext, section: string, value: Data, id?: string) {
  const kind = sectionKind(section),
    profile = await readProfile(ctx);
  const previous = id ? await readRecord(ctx, id, kind) : undefined;
  const expected = id ? revision(value.version) : null;
  if (previous && expected !== previous.version)
    throw new ApiError('This item changed on another device. Reload it before saving.', 409);
  if (!id && kind === 'screenshot')
    throw new ApiError('Upload an image to create a screenshot.', 422);
  const data = recordPayload(section, value, profile, previous);
  const row = await rpcRecord(ctx, 'save_record', {
    p_kind: kind,
    p_data: data,
    p_id: id || null,
    p_expected_version: expected,
  });
  return recordView(row, profile);
}
export async function deleteRecord(ctx: CloudContext, section: string, id: string, value: Data) {
  const kind = sectionKind(section),
    expected = revision(value?.version);
  const pending = kind === 'screenshot' ? cache.imageCleanup.get(id) : undefined;
  const previous = pending || (await readRecord(ctx, id, kind));
  if (previous.version !== expected)
    throw new ApiError('This item changed on another device. Reload it before deleting.', 409);
  if (!pending) {
    await query(ctx, ctx.client.rpc('delete_record', { p_id: id, p_expected_version: expected }));
    cache.revision++;
    cache.changes.set(id, cache.revision);
    cache.records.delete(id);
    if (kind === 'screenshot') cache.imageCleanup.set(id, previous);
  }
  if (kind === 'screenshot') {
    await current(ctx);
    const { error } = await ctx.client.storage.from('screenshots').remove([previous.data.path]);
    if (error)
      throw new ApiError(
        'The screenshot record was deleted, but its private image could not be removed. Keep this dialog open and retry to finish deleting it.',
        502,
      );
    await current(ctx);
    cache.imageCleanup.delete(id);
  }
  return { ok: true };
}
export async function updateProfile(ctx: CloudContext, value: Data, preference = false) {
  const previous = await readProfile(ctx);
  const expected = preference ? (value.updated_at ?? previous.updated_at) : value.updated_at;
  if (typeof expected !== 'string')
    throw new ApiError('Reopen Settings before saving to load its latest revision.', 409);
  const patch = profilePatch(preference ? { theme: value.theme } : value);
  const result = await query<Profile | null>(
    ctx,
    ctx.client
      .from('profiles')
      .update(patch)
      .eq('id', ctx.session.user.id)
      .eq('updated_at', expected)
      .select('*')
      .maybeSingle(),
  );
  if (!result)
    throw new ApiError('Settings changed on another device. Reload them before saving.', 409);
  cache.profileRevision++;
  cache.profile = result;
  return profileView(result, ctx.session.user);
}
