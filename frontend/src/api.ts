import {
  alertPlans,
  bootstrapView,
  calendarView,
  financeView,
  tradingView,
} from './cloud/calculations';
import { imageUrl, storageStatus, uploadImage } from './cloud/attachments';
import { recordView, profileView, sectionKind } from './cloud/records';
import {
  ApiError,
  asApiError,
  context,
  current,
  deleteRecord,
  query,
  readProfile,
  readRecord,
  readRecords,
  rpcRecord,
  saveRecord,
  updateProfile,
} from './cloud/repository';

export { ApiError, clearCloudCache } from './cloud/repository';

/** Keeps the Emergent screen contract; only Supabase receives authenticated data requests. */
export async function api(path: string, method = 'GET', body?: any): Promise<any> {
  try {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new ApiError('Invalid workspace request.', 400);
    const [pathname, search = ''] = path.split('?'),
      params = new URLSearchParams(search);
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const ctx = await context();
    if (pathname === '/auth/me' && method === 'GET')
      return profileView(await readProfile(ctx, true), ctx.session.user);
    if (pathname === '/auth/profile' && method === 'PUT') return updateProfile(ctx, body);
    if (pathname === '/auth/preferences' && method === 'PATCH')
      return updateProfile(ctx, body, true);
    if (pathname === '/storage/status' && method === 'GET') return storageStatus;
    if (pathname === '/screenshots/upload' && method === 'POST') return uploadImage(ctx, body);
    if (parts[0] === 'screenshots' && parts[2] === 'url' && method === 'GET')
      return imageUrl(ctx, parts[1]);
    if (parts[0] === 'records') {
      const [, section, id] = parts,
        kind = sectionKind(section);
      if (method === 'GET') {
        const profile = await readProfile(ctx);
        return id
          ? recordView(await readRecord(ctx, id, kind, true), profile)
          : (await readRecords(ctx, kind)).map((record) => recordView(record, profile, false));
      }
      if (method === 'POST' && !id) return saveRecord(ctx, section, body);
      if (method === 'PATCH' && id) return saveRecord(ctx, section, body, id);
      if (method === 'DELETE' && id) return deleteRecord(ctx, section, id, body);
    }
    if (pathname === '/notes/move' && method === 'POST') {
      if (!Array.isArray(body?.ids) || !body.ids.length || body.ids.length > 500)
        throw new ApiError('Select between 1 and 500 notes.', 422);
      await query(
        ctx,
        ctx.client.rpc('move_notes', { p_ids: body.ids, p_folder_id: body.folder_id || null }),
      );
      return { ok: true };
    }
    if (parts[0] === 'reminders' && parts[2] === 'snooze' && method === 'POST') {
      const record = await readRecord(ctx, parts[1], 'reminder');
      const row = await rpcRecord(ctx, 'save_record', {
        p_kind: 'reminder',
        p_id: record.id,
        p_expected_version: record.version,
        p_data: {
          ...record.data,
          due_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          reminder_minutes: 0,
          status: 'Pending',
          completed_at: null,
        },
      });
      return recordView(row, await readProfile(ctx));
    }
    if (parts[0] === 'subscriptions' && parts[2] === 'pay' && method === 'POST')
      return recordView(
        await rpcRecord(ctx, 'pay_subscription', { p_id: parts[1], p_date: parts[3] }),
        await readProfile(ctx),
      );
    if (parts[0] === 'notifications' && parts[2] === 'read' && method === 'POST') {
      const record = await readRecord(ctx, parts[1], 'notification');
      await rpcRecord(ctx, 'save_record', {
        p_kind: 'notification',
        p_id: record.id,
        p_expected_version: record.version,
        p_data: { ...record.data, read_at: new Date().toISOString() },
      });
      return { ok: true };
    }
    if (
      method === 'GET' &&
      ['/bootstrap', '/calendar', '/finance/summary', '/trading/summary'].includes(pathname)
    ) {
      const profile = await readProfile(ctx, true),
        records = await readRecords(ctx);
      if (pathname === '/calendar')
        return calendarView(records, profile, params.get('start') || '', params.get('end') || '');
      if (pathname === '/finance/summary')
        return financeView(records, profile, params.get('horizon') || undefined);
      if (pathname === '/trading/summary')
        return tradingView(records, profile, Object.fromEntries(params));
      let notificationError = '';
      try {
        await query(
          ctx,
          ctx.client.rpc('sync_notifications', { p_items: alertPlans(records, profile) }),
        );
      } catch (error) {
        notificationError = asApiError(error).message;
      }
      await current(ctx);
      const notifications = await readRecords(ctx, 'notification');
      return {
        ...bootstrapView(
          [...records.filter((record) => record.kind !== 'notification'), ...notifications],
          profile,
        ),
        notification_error: notificationError,
      };
    }
    throw new ApiError('This workspace action is not supported.', 404);
  } catch (error) {
    throw asApiError(error);
  }
}
