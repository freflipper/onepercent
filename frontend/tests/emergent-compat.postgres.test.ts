/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
type Row = { id: string; version: number; data: Record<string, any> };
let db: PGlite;
const compatibilityMigration = readFileSync(
  new URL('../../supabase/migrations/202609290001_emergent_compat.sql', import.meta.url),
  'utf8',
);
async function baselineDatabase() {
  const database = new PGlite();
  await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
  await database.exec(readFileSync(new URL('./fixtures/core-schema.sql', import.meta.url), 'utf8'));
  return database;
}
const owner = async (id = A) => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
};
const save = async (kind: string, data: object, prior?: Row) =>
  (
    await db.query<Row>('select * from public.save_record($1,$2::jsonb,$3::uuid,$4::bigint)', [
      kind,
      JSON.stringify(data),
      prior?.id ?? null,
      prior?.version ?? null,
    ])
  ).rows[0];
const text = () => ({
  id: 'text1',
  type: 'text',
  x: 20,
  y: 30,
  text: 'Editable <script>text</script>',
  width: 260,
  size: 20,
  color: '#203020',
  bold: false,
  italic: true,
  underline: false,
  align: 'left',
});
const stroke = () => ({
  id: 'stroke1',
  type: 'stroke',
  x: 10,
  y: 10,
  size: 3,
  color: '#123456',
  opacity: 0.32,
  points: [
    [0, 0, 0.5],
    [10, 20, 1],
  ],
});
const v2 = (): any => ({
  title: 'Emergent test',
  subject_id: null,
  folder_id: null,
  editor_version: 2,
  pages: [{ id: 'p1', background: 'Grid', spacing: 36, objects: [text(), stroke()] }],
});
const v1 = (): any => ({
  title: 'Original Fabric note',
  subject_id: null,
  folder_id: null,
  editor_version: 1,
  pages: [
    {
      id: 'v1page',
      width: 794,
      height: 1123,
      background: 'Ruled',
      spacing: 32,
      objects: [{ type: 'Textbox', text: 'Keep this editable in the old app.' }],
    },
  ],
});

describe('Additive Emergent SQL compatibility with real PostgreSQL (local PGlite)', () => {
  beforeAll(async () => {
    db = await baselineDatabase();
    await db.query('insert into auth.users(id) values($1),($2)', [A, B]);
    await owner();
    const old = await save('note', v1());
    await db.exec('reset role');
    await db.exec(compatibilityMigration);
    await owner();
    expect(
      (await db.query<Row>('select * from public.records where id=$1', [old.id])).rows[0].data,
    ).toEqual(old.data);
  }, 120000);
  afterAll(async () => {
    await db?.close();
  });
  it('refuses a changed baseline atomically and preserves the independent validator', async () => {
    const isolated = await baselineDatabase();
    try {
      const baseline = (
        await isolated.query<{ definition: string; checksum: string }>(`
          select pg_get_functiondef(oid) as definition, md5(prosrc) as checksum
          from pg_proc where oid='private.validate_record(text,jsonb,uuid)'::regprocedure`)
      ).rows[0];
      expect(baseline.checksum).toBe('161e61cc0c5f01910b1bec8081b643d9');
      const changed = baseline.definition.replace(
        'declare key text;',
        '-- Independent database validation change.\ndeclare key text;',
      );
      expect(changed).not.toBe(baseline.definition);
      await isolated.exec(changed);
      await isolated.query('insert into auth.users(id) values($1)', [A]);
      const snapshot = async () => ({
        functions: (
          await isolated.query(`select p.proname, p.prosrc from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='private' order by p.proname`)
        ).rows,
        constraints: (
          await isolated.query(`select conname, pg_get_constraintdef(oid) from pg_constraint
            where conrelid='public.profiles'::regclass order by conname`)
        ).rows,
        triggers: (
          await isolated.query(`select tgname, pg_get_triggerdef(oid) from pg_trigger
            where tgrelid in ('public.profiles'::regclass,'public.records'::regclass)
            order by tgname`)
        ).rows,
        profiles: (await isolated.query('select * from public.profiles order by id')).rows,
      });
      const before = await snapshot();
      await expect(isolated.exec(compatibilityMigration)).rejects.toMatchObject({
        code: '55000',
        message:
          'Database validation differs from the expected core baseline. Review the database before applying the Emergent compatibility migration.',
      });
      await isolated.exec('rollback');
      expect(await snapshot()).toEqual(before);
      expect(
        (
          await isolated.query(
            `select to_regprocedure('private.validate_emergent_note(jsonb,uuid)') as helper`,
          )
        ).rows[0],
      ).toEqual({ helper: null });
      await expect(
        isolated.query('update public.profiles set visible_days=$1 where id=$2', [[7], A]),
      ).rejects.toThrow('check constraint');
    } finally {
      await isolated.close();
    }
  });
  it('round-trips v2 text and pressure points and retains editable v1', async () => {
    const record = await save('note', v2());
    expect(record.data).toEqual(v2());
    const legacy = await save('note', v1());
    expect(
      (await save('note', { ...legacy.data, title: 'Old app may still save v1' }, legacy)).data
        .pages,
    ).toEqual(v1().pages);
    await expect(save('note', v2(), legacy)).rejects.toThrow('changed on another device');
    const freshLegacy = await save('note', v1());
    await expect(save('note', v2(), freshLegacy)).rejects.toThrow('cannot change editor format');
    await expect(save('note', v1(), record)).rejects.toThrow('cannot change editor format');
  });
  it('retains CAS, owner isolation and atomic moves across both note formats', async () => {
    const folder = await save('folder', { name: 'Both formats' }),
      first = await save('note', v2()),
      old = await save('note', v1());
    const updated = await save('note', { ...first.data, title: 'Second revision' }, first);
    await expect(save('note', first.data, first)).rejects.toThrow('changed on another device');
    await owner(B);
    expect(
      (await db.query('select * from public.records where id=$1', [first.id])).rows,
    ).toHaveLength(0);
    await expect(save('note', { ...v2(), folder_id: folder.id })).rejects.toThrow('not available');
    await expect(save('note', updated.data, updated)).rejects.toThrow('Record not found');
    await owner();
    await expect(
      db.query('select public.move_notes($1::uuid[],$2::uuid)', [[first.id, B], folder.id]),
    ).rejects.toThrow('not available');
    expect(
      (await db.query<Row>('select * from public.records where id=$1', [first.id])).rows[0].data
        .folder_id,
    ).toBeNull();
    await db.query('select public.move_notes($1::uuid[],$2::uuid)', [
      [first.id, old.id],
      folder.id,
    ]);
    await db.query('select public.delete_record($1::uuid,$2::bigint)', [folder.id, folder.version]);
    const moved = (
      await db.query<Row>('select * from public.records where id=any($1::uuid[])', [
        [first.id, old.id],
      ])
    ).rows;
    expect(moved.every((row) => row.data.folder_id === null)).toBe(true);
    expect(moved.map((row) => row.data.editor_version).sort()).toEqual([1, 2]);
  });
  it.each([
    [
      'unknown note field',
      (note: any) => {
        note.html = '<script/>';
      },
    ],
    [
      'duplicate page IDs',
      (note: any) => {
        note.pages.push(note.pages[0]);
      },
    ],
    [
      'unsupported page dimensions',
      (note: any) => {
        note.pages[0].width = 794;
      },
    ],
    [
      'unsupported paper spacing',
      (note: any) => {
        note.pages[0].spacing = 32;
      },
    ],
    [
      'unknown object properties',
      (note: any) => {
        note.pages[0].objects[0].src = 'https://invalid.test';
      },
    ],
    [
      'unknown object types',
      (note: any) => {
        note.pages[0].objects[0].type = 'image';
      },
    ],
    [
      'duplicate object IDs',
      (note: any) => {
        note.pages[0].objects[1].id = 'text1';
      },
    ],
    [
      'invalid style injection',
      (note: any) => {
        note.pages[0].objects[0].color = 'red; background:url(x)';
      },
    ],
    [
      'invalid pressure',
      (note: any) => {
        note.pages[0].objects[1].points = [[0, 0, 2]];
      },
    ],
    [
      'missing stroke points',
      (note: any) => {
        delete note.pages[0].objects[1].points;
      },
    ],
    [
      'bad numeric values',
      (note: any) => {
        note.pages[0].objects[0].x = '10';
      },
    ],
    [
      'oversized text',
      (note: any) => {
        note.pages[0].objects[0].text = 'x'.repeat(20001);
      },
    ],
    [
      'too many points',
      (note: any) => {
        note.pages[0].objects[1].points = Array.from({ length: 20001 }, () => [0, 0]);
      },
    ],
  ])('rejects %s on the server', async (_name, mutate) => {
    const note = v2();
    mutate(note);
    await expect(save('note', note)).rejects.toThrow();
  });
  it('accepts optional exact dimensions while retaining the overall size limit', async () => {
    const note = v2();
    note.pages[0].width = 600;
    note.pages[0].height = 840;
    expect((await save('note', note)).data.pages[0].width).toBe(600);
    note.pages[0].objects = Array.from({ length: 280 }, (_, i) => ({
      ...text(),
      id: `t${i}`,
      text: 'x'.repeat(20000),
    }));
    await expect(save('note', note)).rejects.toThrow('too large');
  });
  it('supports Sunday without weakening slot uniqueness, references or hours', async () => {
    const subject = await save('subject', { name: 'Sunday subject' });
    expect((await save('slot', { day: 7, hour: 8, subject_id: subject.id })).data.day).toBe(7);
    await expect(save('slot', { day: 7, hour: 8, subject_id: subject.id })).rejects.toThrow(
      'duplicate key',
    );
    await expect(save('slot', { day: 8, hour: 8, subject_id: subject.id })).rejects.toThrow(
      'Invalid day',
    );
    await expect(save('slot', { day: 7, hour: 14, subject_id: subject.id })).rejects.toThrow(
      'Invalid hour',
    );
    await expect(save('slot', { day: 7, hour: 9, subject_id: B })).rejects.toThrow('not available');
  });
  it('accepts seven unique profile days and rejects duplicates, empty and out-of-range days', async () => {
    expect(
      (
        await db.query<{ visible_days: number[] }>(
          'select visible_days from public.profiles where id=$1',
          [A],
        )
      ).rows[0].visible_days,
    ).toEqual([1, 2, 3, 4, 5, 6]);
    await db.query('update public.profiles set visible_days=$1 where id=$2', [
      [1, 2, 3, 4, 5, 6, 7],
      A,
    ]);
    for (const days of [[1, 1], [0], [8], [], [null]])
      await expect(
        db.query('update public.profiles set visible_days=$1 where id=$2', [days, A]),
      ).rejects.toThrow();
    await owner(B);
    await db.query('update public.profiles set visible_days=$1 where id=$2', [[7], A]);
    await owner();
    expect(
      (
        await db.query<{ visible_days: number[] }>(
          'select visible_days from public.profiles where id=$1',
          [A],
        )
      ).rows[0].visible_days,
    ).toHaveLength(7);
  });
  it('retains unrelated validation and keeps private validators inaccessible', async () => {
    await expect(
      save('account', {
        name: 'bad currency',
        type: 'Personal',
        currency: 'EUR<script>',
        opening_cents: 0,
        opening_date: '2026-01-01',
      }),
    ).rejects.toThrow('currency');
    await expect(
      save('event', {
        title: 'Invalid chronology',
        date: '2026-01-01',
        all_day: false,
        start_at: '2026-01-01T10:00:00Z',
        end_at: '2026-01-01T09:00:00Z',
      }),
    ).rejects.toThrow('End time');
    await expect(
      db.query('select private.validate_emergent_note($1::jsonb,$2::uuid)', [
        JSON.stringify(v2()),
        A,
      ]),
    ).rejects.toThrow('permission denied');
    await db.exec('reset role;set role anon');
    await expect(save('note', v2())).rejects.toThrow('permission denied');
    await owner();
  });
});
