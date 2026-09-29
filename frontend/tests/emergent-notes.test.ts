import { describe, expect, it, vi } from 'vitest';
import { NotebookSession, type NotebookServices } from '../src/notes/NotebookSession';
import {
  validateNotebook,
  validateNotePayload,
  type NotebookRecord,
  type NotePayload,
} from '../src/notes/document';

const note = (): NotebookRecord => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  version: 1,
  title: 'Draft test',
  subject_id: null,
  folder_id: null,
  editor_version: 2,
  pages: [
    {
      id: 'p1',
      background: 'Grid',
      spacing: 36,
      objects: [
        {
          id: 's1',
          type: 'stroke',
          x: 1,
          y: 2,
          size: 3,
          color: '#123456',
          points: [
            [0, 0, 0.5],
            [20, 40, 1],
          ],
          opacity: 0.32,
        },
        {
          id: 't1',
          type: 'text',
          x: 20,
          y: 20,
          size: 20,
          color: '#102030',
          text: 'Editable <script>text</script>',
          width: 260,
        },
      ],
    },
  ],
});
const services = (extra: Partial<NotebookServices> = {}): NotebookServices => ({
  save: vi.fn(async (payload, version) => ({ ...payload, id: note().id, version: version + 1 })),
  draft: vi.fn(async () => true),
  clearDraft: vi.fn(async () => true),
  changed: vi.fn(),
  ...extra,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('Emergent notebook boundaries', () => {
  it('round-trips editable text and native pressure points without conversion', () => {
    expect(validateNotebook(JSON.parse(JSON.stringify(note())))).toEqual(note());
    expect(() => validateNotebook({ ...note(), editor_version: 1 })).toThrow('previous 1% editor');
    expect(() => validateNotebook({ ...note(), read_only: true })).toThrow('previous 1% editor');
  });
  it.each([
    (value: any) => {
      value.pages[0].objects[0].points = [[0, 0, 2]];
    },
    (value: any) => {
      value.pages[0].objects[0].url = 'https://example.test';
    },
    (value: any) => {
      value.pages[0].objects[1].color = 'red;left:0';
    },
    (value: any) => {
      value.pages[0].objects[1].x = Infinity;
    },
    (value: any) => {
      value.pages[0].objects[1].id = 's1';
    },
    (value: any) => {
      value.pages[0].spacing = 32;
    },
    (value: any) => {
      value.pages[0].objects[1].text = 'x'.repeat(20001);
    },
    (value: any) => {
      value.pages[0].width = 794;
    },
  ])('rejects unsafe or unsupported drafts before rendering', (mutate) => {
    const value = note();
    mutate(value);
    expect(() => validateNotebook(value)).toThrow();
  });
});

describe('Emergent notebook save lifecycle', () => {
  it('coalesces simultaneous flushes and preserves edits made before the acknowledgement', async () => {
    const first = deferred<NotebookRecord>(),
      writes: [NotePayload, number][] = [];
    const ports = services({
      save: vi.fn(async (payload, version) => {
        writes.push([payload, version]);
        return writes.length === 1
          ? first.promise
          : { ...payload, id: note().id, version: version + 1 };
      }),
    });
    const session = new NotebookSession(note(), ports);
    session.update({ title: 'First edit' });
    const a = session.flush(),
      b = session.flush();
    expect(a).toBe(b);
    await tick();
    session.update({ title: 'Edit while saving' });
    first.resolve({ ...writes[0][0], id: note().id, version: 2 });
    await Promise.all([a, b]);
    expect(writes.map(([payload, version]) => [payload.title, version])).toEqual([
      ['First edit', 1],
      ['Edit while saving', 2],
    ]);
    expect(session.note.title).toBe('Edit while saving');
    expect(session.note.version).toBe(3);
    expect(session.dirty).toBe(false);
    expect(ports.changed).toHaveBeenLastCalledWith(session.note, 'Saved');
  });
  it('keeps the draft and original revision on conflict, allowing retry or a separate copy', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('Changed on another device'))
      .mockImplementation(async (payload, version) => ({
        ...payload,
        id: note().id,
        version: version + 1,
      }));
    const ports = services({ save });
    const session = new NotebookSession(note(), ports);
    session.update({ title: 'Unsaved edit' });
    await expect(session.flush()).rejects.toThrow('Changed');
    expect(session.dirty).toBe(true);
    expect(session.note.version).toBe(1);
    expect(ports.clearDraft).not.toHaveBeenCalled();
    await session.flush();
    expect(save.mock.calls.map((call) => call[1])).toEqual([1, 1]);
    expect(session.dirty).toBe(false);
  });
  it('never clears an edit made while draft cleanup is pending', async () => {
    const clear = deferred<boolean>();
    let cleanups = 0;
    const ports = services({
      clearDraft: vi.fn(async () => (++cleanups === 1 ? clear.promise : true)),
    });
    const session = new NotebookSession(note(), ports);
    session.update({ title: 'One' });
    const running = session.flush();
    await tick();
    session.update({ title: 'Two' });
    clear.resolve(true);
    await running;
    expect(ports.save).toHaveBeenCalledTimes(2);
    expect(session.note.title).toBe('Two');
    expect(session.note.version).toBe(3);
    expect(session.dirty).toBe(false);
  });
  it('reports unavailable emergency storage, yet still permits a successful remote save', async () => {
    const ports = services({ draft: vi.fn(async () => false) });
    const session = new NotebookSession(note(), ports);
    session.update({ title: 'Remote copy' });
    await tick();
    expect(ports.changed).toHaveBeenCalledWith(
      session.note,
      'Unsaved changes',
      expect.stringContaining('emergency draft'),
    );
    await session.flush();
    expect(session.dirty).toBe(false);
    expect(ports.changed).toHaveBeenLastCalledWith(session.note, 'Saved');
  });
  it('stops queued writes after logout or unmount and never switches owners', async () => {
    const draft = deferred<boolean>(),
      ports = services({ draft: () => draft.promise });
    const session = new NotebookSession(note(), ports);
    session.update({ title: 'Old user' });
    const work = session.flush();
    await tick();
    session.stop();
    draft.resolve(true);
    await expect(work).rejects.toThrow('session is closed');
    expect(ports.save).not.toHaveBeenCalled();
    expect(() => session.update({ title: 'New user' })).toThrow('session is closed');
  });
  it('preserves an empty title as a recoverable draft but does not save invalid content', async () => {
    const ports = services(),
      session = new NotebookSession(note(), ports);
    session.update({ title: '' });
    await tick();
    expect(ports.draft).toHaveBeenCalled();
    await expect(session.flush()).rejects.toThrow('title');
    expect(ports.save).not.toHaveBeenCalled();
    const { id: _id, version: _version, ...payload } = session.note;
    expect(() => validateNotePayload(payload, true)).not.toThrow();
  });
});
