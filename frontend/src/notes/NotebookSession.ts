import {
  notePayload,
  validateNotebook,
  validateNotePayload,
  type NotebookRecord,
  type NotePayload,
} from './document';

export type NotebookStatus = 'Saved' | 'Saving' | 'Unsaved changes';
export interface NotebookServices {
  save(payload: NotePayload, version: number): Promise<NotebookRecord>;
  draft(payload: NotePayload, version: number): Promise<boolean>;
  clearDraft(): Promise<boolean>;
  changed(note: NotebookRecord, status: NotebookStatus, error?: string): void;
}
/** One owner and note for the lifetime of a session; writes and draft cleanup share a single queue. */
export class NotebookSession {
  note: NotebookRecord;
  private saved: string;
  private running: Promise<void> | null = null;
  private draftQueue: Promise<unknown> = Promise.resolve();
  private active = true;
  private failure = '';
  constructor(
    note: NotebookRecord,
    private services: NotebookServices,
  ) {
    this.note = validateNotebook(note);
    this.saved = JSON.stringify(notePayload(note));
  }
  get dirty() {
    return JSON.stringify(notePayload(this.note)) !== this.saved;
  }
  stop() {
    this.active = false;
  }
  update(value: Partial<NotePayload>) {
    if (!this.active) throw new Error('This notebook session is closed.');
    const next = { ...this.note, ...value };
    validateNotePayload(notePayload(next), true);
    this.note = next;
    this.failure = '';
    this.services.changed(next, this.dirty ? 'Unsaved changes' : 'Saved');
    void this.persistDraft();
  }
  private persistDraft() {
    const payload = notePayload(this.note),
      version = this.note.version;
    this.draftQueue = this.draftQueue
      .catch(() => {})
      .then(async () => {
        if (!this.active) return;
        if (!(await this.services.draft(payload, version)))
          throw new Error(
            'The emergency draft could not be saved on this device. Keep this page open and retry saving.',
          );
      })
      .catch((error) => {
        if (this.active)
          this.services.changed(
            this.note,
            this.dirty ? 'Unsaved changes' : 'Saved',
            error instanceof Error ? error.message : 'Emergency draft unavailable.',
          );
      });
    return this.draftQueue;
  }
  flush(): Promise<void> {
    if (!this.active) return Promise.reject(new Error('This notebook session is closed.'));
    if (this.running) return this.running;
    if (!this.dirty) return Promise.resolve();
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async drain() {
    try {
      while (this.active) {
        while (this.dirty && this.active) {
          const payload = validateNotePayload(notePayload(this.note));
          const signature = JSON.stringify(payload),
            version = this.note.version;
          this.services.changed(this.note, 'Saving');
          await this.persistDraft();
          if (!this.active) throw new Error('This notebook session is closed.');
          const response = validateNotebook(await this.services.save(payload, version));
          if (!this.active) throw new Error('This notebook session is closed.');
          if (response.id !== this.note.id || response.version <= version)
            throw new Error(
              'The server returned an invalid notebook revision. Reload before saving again.',
            );
          this.saved = signature;
          this.note = { ...this.note, version: response.version };
        }
        if (!this.active) throw new Error('This notebook session is closed.');
        // Queue removal after all prior writes, then check for edits made while cleanup was pending.
        this.draftQueue = this.draftQueue
          .catch(() => {})
          .then(async () => {
            if (this.active && !this.dirty && !(await this.services.clearDraft()))
              throw new Error(
                'Your notebook is saved, but its old emergency draft could not be removed.',
              );
          });
        await this.draftQueue;
        if (this.dirty) continue;
        this.services.changed(this.note, 'Saved');
        return;
      }
    } catch (error) {
      this.failure = error instanceof Error ? error.message : 'Unable to save the notebook.';
      if (this.active)
        this.services.changed(this.note, this.dirty ? 'Unsaved changes' : 'Saved', this.failure);
      throw error;
    }
  }
}
