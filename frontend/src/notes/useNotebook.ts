import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { api } from '@/src/api';
import { storage } from '@/src/utils/storage';
import { useStore } from '@/src/store';
import { NotebookSession } from './NotebookSession';
import {
  LEGACY_NOTE_MESSAGE,
  notePayload,
  validateNotebook,
  validateNotePayload,
  type NotePayload,
  type NotebookRecord,
} from './document';

type Draft = { payload: NotePayload; version: number };
export function useNotebook(id: string) {
  const { user, refresh } = useStore();
  const [note, setNote] = useState<NotebookRecord | null>(null),
    [status, setStatus] = useState('Loading'),
    [error, setError] = useState(''),
    [recovery, setRecovery] = useState<Draft | null>(null),
    [legacy, setLegacy] = useState(false);
  const session = useRef<NotebookSession | null>(null),
    generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    past = useRef<NotePayload[]>([]),
    future = useRef<NotePayload[]>([]),
    refreshRef = useRef(refresh);
  const [history, setHistory] = useState({ undo: false, redo: false });
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const draftKey = `note-draft-${user.user_id}-${id}`;
  const load = useCallback(async () => {
    if (session.current?.dirty) {
      setError('Save your changes or a separate copy before reloading.');
      return;
    }
    const epoch = ++generation.current;
    session.current?.stop();
    session.current = null;
    setNote(null);
    setStatus('Loading');
    setLegacy(false);
    setError('');
    setRecovery(null);
    past.current = [];
    future.current = [];
    setHistory({ undo: false, redo: false });
    try {
      const raw = await api(`/records/notes/${id}`);
      if (epoch !== generation.current) return;
      if (raw.editor_version === 1 || raw.read_only) {
        setLegacy(true);
        setStatus('Read only');
        setError(LEGACY_NOTE_MESSAGE);
        return;
      }
      const value = validateNotebook(raw);
      session.current = new NotebookSession(value, {
        save: (payload, version) => api(`/records/notes/${id}`, 'PATCH', { ...payload, version }),
        draft: (payload, version) =>
          storage.setItem(draftKey, JSON.stringify({ payload, version })),
        clearDraft: () => storage.removeItem(draftKey),
        changed: (current, state, problem) => {
          if (epoch !== generation.current) return;
          setNote(current);
          setStatus(state);
          setError(problem || '');
        },
      });
      setNote(value);
      setStatus('Saved');
      const rawDraft = await storage.getItem(draftKey, '');
      if (epoch !== generation.current || !rawDraft) return;
      try {
        const draft = JSON.parse(rawDraft);
        if (!Number.isSafeInteger(draft.version) || draft.version < 1)
          throw new Error('Invalid draft revision.');
        draft.payload = validateNotePayload(
          { ...draft.payload, editor_version: draft.payload.editor_version ?? 2 },
          true,
        );
        if (JSON.stringify(draft.payload) !== JSON.stringify(notePayload(value)))
          setRecovery(draft);
        else if (!(await storage.removeItem(draftKey)))
          setError('The saved notebook is safe, but its old draft could not be removed.');
      } catch {
        setError('An invalid emergency draft was ignored. The saved notebook is unchanged.');
      }
    } catch (problem) {
      if (epoch !== generation.current) return;
      setError(problem instanceof Error ? problem.message : 'Unable to load the notebook.');
      setStatus('Unable to load');
    }
  }, [id, draftKey]);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const current = session.current;
    if (!current) return;
    await current.flush();
    void refreshRef.current().catch(() => {});
    return current.note;
  }, []);
  const commit = useCallback(
    (value: Partial<NotePayload>, remember = true) => {
      const current = session.current;
      if (!current) return;
      const previous = notePayload(current.note);
      try {
        current.update(value);
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : 'Invalid notebook change.');
        return;
      }
      if (remember) {
        past.current.push(previous);
        if (past.current.length > 60) past.current.shift();
        future.current = [];
      }
      setHistory({ undo: !!past.current.length, redo: !!future.current.length });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush().catch(() => {});
      }, 900);
    },
    [flush],
  );
  function undo() {
    const value = past.current.pop();
    if (value && session.current) {
      future.current.push(notePayload(session.current.note));
      commit(value, false);
    }
  }
  function redo() {
    const value = future.current.pop();
    if (value && session.current) {
      past.current.push(notePayload(session.current.note));
      commit(value, false);
    }
  }
  const closeSession = useCallback(() => {
    generation.current++;
    session.current?.stop();
    session.current = null;
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush().catch(() => {});
    });
    const unload = (event: BeforeUnloadEvent) => {
      if (session.current?.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') void flush().catch(() => {});
    };
    if (Platform.OS === 'web') {
      window.addEventListener('beforeunload', unload);
      document.addEventListener('visibilitychange', hidden);
    }
    return () => {
      active = false;
      closeSession();
      app.remove();
      if (Platform.OS === 'web') {
        window.removeEventListener('beforeunload', unload);
        document.removeEventListener('visibilitychange', hidden);
      }
      if (timer.current) clearTimeout(timer.current);
      // Normal navigation flushes first. Logout/unmount stops further writes; the owner-scoped draft already exists.
    };
  }, [load, flush, closeSession]);
  async function recover() {
    const current = session.current,
      epoch = generation.current;
    if (!recovery || !current) return;
    if (recovery.version === current.note.version) {
      commit(recovery.payload);
      setRecovery(null);
    } else {
      const copy = validateNotebook(
        await api('/records/notes', 'POST', {
          ...recovery.payload,
          title: (recovery.payload.title + ' · recovered').slice(0, 180),
        }),
      );
      if (epoch !== generation.current) return;
      if (!(await storage.removeItem(draftKey)))
        throw new Error('The recovered copy is saved, but its old draft could not be removed.');
      setRecovery(null);
      await refreshRef.current();
      return copy.id;
    }
  }
  return {
    note,
    status,
    error,
    setError,
    commit,
    flush,
    undo,
    redo,
    history,
    recovery,
    recover,
    reload: load,
    legacy,
  };
}
