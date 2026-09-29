import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clearCloudCache } from '../src/api';

const mock = vi.hoisted(() => ({
  owner: '11111111-1111-4111-8111-111111111111' as string | null,
  profiles: {} as Record<string, any>,
  rows: [] as any[],
  calls: [] as any[],
  next: 1,
  gate: null as null | (() => Promise<void>),
  resultGate: null as null | (() => Promise<void>),
  removeFails: false,
  invokeFails: false,
}));
vi.mock('../src/cloud/client', () => {
  const execute = async (
    owner: string,
    table: string,
    filters: any[],
    patch: any,
    single: boolean,
    limit: number,
    rpc?: { name: string; args: any },
  ) => {
    if (mock.gate) {
      const gate = mock.gate;
      mock.gate = null;
      await gate();
    }
    if (rpc) {
      mock.calls.push({ type: 'rpc', owner, ...rpc });
      if (rpc.name === 'save_record') {
        const old = mock.rows.find((row) => row.id === rpc.args.p_id && row.user_id === owner);
        if (rpc.args.p_id && (!old || old.version !== rpc.args.p_expected_version))
          return { data: null, error: { code: '40001', message: 'revision conflict' } };
        const row = {
          id: old?.id || `00000000-0000-4000-8000-${String(mock.next++).padStart(12, '0')}`,
          user_id: owner,
          kind: rpc.args.p_kind,
          data: structuredClone(rpc.args.p_data),
          version: (old?.version || 0) + 1,
          created_at: old?.created_at || '2026-09-29T10:00:00Z',
          updated_at: '2026-09-29T11:00:00Z',
        };
        mock.rows = [...mock.rows.filter((item) => item.id !== row.id), row];
        return { data: structuredClone(row), error: null };
      }
      if (rpc.name === 'delete_record') {
        const row = mock.rows.find((item) => item.id === rpc.args.p_id && item.user_id === owner);
        if (!row || row.version !== rpc.args.p_expected_version)
          return { data: null, error: { code: '40001', message: 'revision conflict' } };
        mock.rows = mock.rows.filter((item) => item.id !== row.id);
        return { data: null, error: null };
      }
      if (rpc.name === 'pay_subscription')
        return {
          data: {
            id: 'payment',
            user_id: owner,
            kind: 'transaction',
            version: 1,
            data: {
              status: 'Recorded',
              subscription_id: rpc.args.p_id,
              occurrence_date: rpc.args.p_date,
              amount_cents: 100,
            },
          },
          error: null,
        };
      return { data: null, error: null };
    }
    mock.calls.push({ type: 'query', owner, table, filters, patch });
    let rows =
      table === 'profiles'
        ? [mock.profiles[owner]].filter(Boolean)
        : mock.rows.filter((row) => row.user_id === owner);
    for (const [operator, key, value] of filters)
      rows = rows.filter((row) => (operator === 'gt' ? row[key] > value : row[key] === value));
    rows = rows.sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
    if (patch)
      for (const row of rows) Object.assign(row, patch, { updated_at: '2026-09-29T12:00:00Z' });
    const result = { data: structuredClone(single ? rows[0] || null : rows), error: null };
    if (mock.resultGate) {
      const gate = mock.resultGate;
      mock.resultGate = null;
      await gate();
    }
    return result;
  };
  const builder = (owner: string, table: string, rpc?: { name: string; args: any }) => {
    const filters: any[] = [];
    let patch: any,
      single = false,
      count = Infinity;
    const query: any = {
      select: () => query,
      order: () => query,
      limit: (value: number) => {
        count = value;
        return query;
      },
      eq: (key: string, value: any) => {
        filters.push(['eq', key, value]);
        return query;
      },
      gt: (key: string, value: any) => {
        filters.push(['gt', key, value]);
        return query;
      },
      single: () => {
        single = true;
        return query;
      },
      maybeSingle: () => {
        single = true;
        return query;
      },
      update: (value: any) => {
        patch = value;
        return query;
      },
      abortSignal: () => query,
      then: (resolve: any, reject: any) =>
        execute(owner, table, filters, patch, single, count, rpc).then(resolve, reject),
    };
    return query;
  };
  const scopedBackend = (token: string) => {
    const owner = token.slice('token:'.length);
    return {
      from: (table: string) => builder(owner, table),
      rpc: (name: string, args: any) => builder(owner, '', { name, args }),
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string, ttl: number) => {
            mock.calls.push({ type: 'sign', bucket, owner, path, ttl });
            return { data: { signedUrl: 'https://example.test/private-image' }, error: null };
          },
          remove: async (paths: string[]) => {
            mock.calls.push({ type: 'remove', bucket, owner, paths });
            const fail = mock.removeFails;
            mock.removeFails = false;
            return { data: null, error: fail ? new Error('Temporary storage failure') : null };
          },
        }),
      },
      functions: {
        invoke: async (name: string, options: any) => {
          mock.calls.push({ type: 'invoke', name, owner });
          return {
            data: {
              path: `${owner}/00000000-0000-4000-8000-000000000099.png`,
              mime: options.body.mime,
              size: atob(options.body.base64).length,
            },
            error: mock.invokeFails ? new Error('Upload failed') : null,
          };
        },
      },
    };
  };
  return {
    scopedBackend,
    backend: () => ({
      auth: {
        getSession: async () => ({
          data: {
            session: mock.owner
              ? {
                  access_token: `token:${mock.owner}`,
                  user: { id: mock.owner, email: 'fixture@example.test' },
                }
              : null,
          },
          error: null,
        }),
      },
    }),
    friendlyError: (error: any) => error.message || 'Request failed',
  };
});
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222';
const profile = (id: string) => ({
  id,
  name: 'Fixture',
  timezone: 'Europe/Rome',
  theme: 'System',
  opening_balance: 0,
  opening_date: '2026-01-01',
  visible_days: [1, 2, 3, 4, 5, 6],
  trading_expanded: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-09-29T10:00:00Z',
});
const row = (id: string, kind = 'subject', data: any = { name: 'Fixture' }, owner = A) => ({
  id,
  kind,
  data,
  user_id: owner,
  version: 2,
  created_at: '2026-09-29T10:00:00Z',
  updated_at: '2026-09-29T10:00:00Z',
});
beforeEach(() => {
  clearCloudCache();
  mock.owner = A;
  mock.profiles = { [A]: profile(A), [B]: profile(B) };
  mock.rows = [];
  mock.calls = [];
  mock.next = 1;
  mock.gate = null;
  mock.resultGate = null;
  mock.removeFails = false;
  mock.invokeFails = false;
});
function delayReadResult() {
  let started!: () => void, release!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.resultGate = async () => {
    started();
    await gate;
  };
  return { began, release };
}
describe('Supabase facade uses real RPC contracts, without the Emergent proxy', () => {
  it('reads only the current account and maps profile weekdays', async () => {
    mock.rows = [row('a'), row('b', 'subject', { name: 'Other' }, B)];
    expect((await api('/records/subjects')).map((record: any) => record.id)).toEqual(['a']);
    expect(await api('/auth/me')).toMatchObject({ user_id: A, visible_days: [0, 1, 2, 3, 4, 5] });
    expect(
      mock.calls.filter((call) => call.type === 'query').every((call) => call.owner === A),
    ).toBe(true);
  });
  it('rejects missing sessions and unknown external routes without a request', async () => {
    mock.owner = null;
    await expect(api('/bootstrap')).rejects.toMatchObject({ status: 401 });
    mock.owner = A;
    await expect(api('https://external.test/api')).rejects.toMatchObject({ status: 400 });
    expect(mock.calls).toEqual([]);
  });
  it('creates and patches through save_record with canonical cents and expected revisions', async () => {
    const saved = await api('/records/finance', 'POST', {
      type: 'Expense',
      amount: 1234,
      date: '2026-09-29',
      status: 'Planned',
    });
    expect(saved).toMatchObject({ kind: 'finance', amount: 1234, version: 1 });
    const changed = await api(`/records/finance/${saved.id}`, 'PATCH', {
      description: 'Changed',
      version: 1,
    });
    expect(changed).toMatchObject({ amount: 1234, description: 'Changed', version: 2 });
    expect(mock.calls.filter((call) => call.type === 'rpc').at(-1).args).toMatchObject({
      p_kind: 'transaction',
      p_id: saved.id,
      p_expected_version: 1,
      p_data: { amount_cents: 1234 },
    });
    await expect(
      api(`/records/finance/${saved.id}`, 'PATCH', { description: 'Stale', version: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('never invents a current revision for a destructive action', async () => {
    mock.rows = [row('subject')];
    await expect(api('/records/subjects/subject', 'DELETE')).rejects.toMatchObject({ status: 409 });
    expect(mock.calls.some((call) => call.type === 'rpc')).toBe(false);
    await api('/records/subjects/subject', 'DELETE', { version: 2 });
    expect(mock.rows).toEqual([]);
  });
  it('uses the Settings form baseline even after a fresher profile read', async () => {
    const initial = await api('/auth/me');
    mock.profiles[A].updated_at = '2026-09-29T11:00:00Z';
    await api('/auth/me');
    await expect(
      api('/auth/profile', 'PUT', { name: 'Stale name', updated_at: initial.updated_at }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mock.profiles[A].name).toBe('Fixture');
    await api('/auth/preferences', 'PATCH', { theme: 'Dark' });
    expect(mock.profiles[A].theme).toBe('Dark');
  });
  it('uses an explicit theme baseline without advancing a stale Settings form', async () => {
    const initial = await api('/auth/me');
    mock.profiles[A].name = 'Updated on another device';
    mock.profiles[A].updated_at = '2026-09-29T11:00:00Z';
    const current = await api('/auth/me');
    await expect(
      api('/auth/preferences', 'PATCH', {
        theme: 'Dark',
        updated_at: initial.updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mock.profiles[A]).toMatchObject({ theme: 'System', name: 'Updated on another device' });
    expect(
      await api('/auth/preferences', 'PATCH', {
        theme: 'Dark',
        updated_at: current.updated_at,
      }),
    ).toMatchObject({ theme: 'Dark', name: 'Updated on another device' });
  });
  it('returns the committed profile when an older profile request finishes after saving', async () => {
    const initial = await api('/auth/me');
    const delayed = delayReadResult();
    const pending = api('/auth/me');
    await delayed.began;
    const saved = await api('/auth/profile', 'PUT', {
      name: 'Saved name',
      updated_at: initial.updated_at,
    });
    delayed.release();
    expect(await pending).toMatchObject({ name: 'Saved name', updated_at: saved.updated_at });
    expect(await api('/auth/preferences', 'PATCH', { theme: 'Dark' })).toMatchObject({
      name: 'Saved name',
      theme: 'Dark',
    });
  });
  it('does not replace a fresher profile read with an older response', async () => {
    await api('/auth/me');
    const delayed = delayReadResult();
    const pending = api('/auth/me');
    await delayed.began;
    mock.profiles[A].name = 'Latest';
    mock.profiles[A].updated_at = '2026-09-29T11:00:00Z';
    await api('/auth/me');
    delayed.release();
    expect(await pending).toMatchObject({ name: 'Latest' });
  });
  it('preserves the latest record revision when a detail read finishes after saving', async () => {
    mock.rows = [row('subject')];
    await api('/records/subjects/subject');
    const delayed = delayReadResult();
    const pending = api('/records/subjects/subject');
    await delayed.began;
    await api('/records/subjects/subject', 'PATCH', { name: 'Saved', version: 2 });
    delayed.release();
    expect(await pending).toMatchObject({ name: 'Saved', version: 3 });
    expect(
      await api('/records/subjects/subject', 'PATCH', { name: 'Saved again', version: 3 }),
    ).toMatchObject({ name: 'Saved again', version: 4 });
  });
  it('does not resurrect a deleted record from an in-flight detail read', async () => {
    mock.rows = [row('subject')];
    await api('/records/subjects/subject');
    const delayed = delayReadResult();
    const pending = api('/records/subjects/subject');
    await delayed.began;
    await api('/records/subjects/subject', 'DELETE', { version: 2 });
    delayed.release();
    await expect(pending).rejects.toMatchObject({ status: 404 });
    await expect(
      api('/records/subjects/subject', 'PATCH', { name: 'Resurrected', version: 2 }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('merges concurrent saves, creations and deletions into an older list snapshot', async () => {
    mock.rows = [row('a'), row('b')];
    await api('/records/subjects');
    const delayed = delayReadResult();
    const pending = api('/records/subjects');
    await delayed.began;
    await api('/records/subjects/a', 'PATCH', { name: 'Changed', version: 2 });
    await api('/records/subjects/b', 'DELETE', { version: 2 });
    const created = await api('/records/subjects', 'POST', { name: 'Created' });
    delayed.release();
    const rows = await pending;
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a', name: 'Changed', version: 3 }),
        expect.objectContaining({ id: created.id, name: 'Created', version: 1 }),
      ]),
    );
    expect(
      await api('/records/subjects/a', 'PATCH', { name: 'Changed again', version: 3 }),
    ).toMatchObject({ version: 4 });
  });
  it('discards in-flight data and cached records when the owner changes', async () => {
    let started!: () => void, release!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.gate = async () => {
      started();
      await gate;
    };
    const pending = api('/auth/me');
    await began;
    mock.owner = B;
    clearCloudCache();
    release();
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect((await api('/auth/me')).user_id).toBe(B);
  });
  it('delegates payment and folder operations to their atomic RPCs', async () => {
    await api('/notes/move', 'POST', { ids: ['note-a', 'note-b'], folder_id: 'folder' });
    await api('/subscriptions/subscription/pay/2026-09-29', 'POST');
    expect(
      mock.calls.filter((call) => call.type === 'rpc').map((call) => [call.name, call.args]),
    ).toEqual([
      ['move_notes', { p_ids: ['note-a', 'note-b'], p_folder_id: 'folder' }],
      ['pay_subscription', { p_id: 'subscription', p_date: '2026-09-29' }],
    ]);
  });
  it('keeps legacy note updates blocked while returning their original document', async () => {
    mock.rows = [
      row('legacy', 'note', {
        title: 'Legacy',
        editor_version: 1,
        pages: [{ id: 'old', width: 794, height: 1123, objects: [] }],
      }),
    ];
    const legacy = await api('/records/notes/legacy');
    expect(legacy.read_only).toBe(true);
    await expect(
      api('/records/notes/legacy', 'PATCH', {
        title: 'Overwrite',
        editor_version: 2,
        pages: [],
        version: 2,
      }),
    ).rejects.toThrow(/read-only/);
    expect(mock.calls.some((call) => call.type === 'rpc')).toBe(false);
  });
  it('signs private image URLs for five minutes and retries interrupted image deletion', async () => {
    const path = `${A}/image.png`;
    mock.rows = [row('image', 'screenshot', { title: 'Image', path })];
    expect(await api('/screenshots/image/url')).toEqual({
      url: 'https://example.test/private-image',
    });
    expect(mock.calls.find((call) => call.type === 'sign')).toMatchObject({
      owner: A,
      bucket: 'screenshots',
      ttl: 300,
    });
    mock.removeFails = true;
    await expect(api('/records/screenshots/image', 'DELETE', { version: 2 })).rejects.toMatchObject(
      { status: 502 },
    );
    expect(mock.rows).toEqual([]);
    await api('/records/screenshots/image', 'DELETE', { version: 2 });
    expect(
      mock.calls.filter((call) => call.type === 'rpc' && call.name === 'delete_record'),
    ).toHaveLength(1);
    expect(mock.calls.filter((call) => call.type === 'remove')).toHaveLength(2);
  });
  it('uploads privately, then creates metadata; an upload failure creates no record', async () => {
    const form = new FormData();
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(20).fill(0)]);
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'fixture.png');
    form.append('title', 'Fixture');
    const created = await api('/screenshots/upload', 'POST', form);
    expect(created.kind).toBe('screenshots');
    expect(
      mock.calls.filter((call) => ['invoke', 'rpc'].includes(call.type)).map((call) => call.type),
    ).toEqual(['invoke', 'rpc']);
    mock.calls = [];
    mock.invokeFails = true;
    await expect(api('/screenshots/upload', 'POST', form)).rejects.toMatchObject({ status: 502 });
    expect(mock.calls.some((call) => call.type === 'rpc')).toBe(false);
  });
});
