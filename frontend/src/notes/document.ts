export interface NoteObject {
  id: string;
  type: 'text' | 'stroke';
  x: number;
  y: number;
  size: number;
  color: string;
  text?: string;
  width?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  opacity?: number;
  points?: number[][];
}
export interface NotePage {
  id: string;
  background: 'Blank' | 'Ruled' | 'Grid';
  spacing: 24 | 36;
  width?: 600;
  height?: 840;
  objects: NoteObject[];
}
export interface NotePayload {
  title: string;
  subject_id: string | null;
  folder_id: string | null;
  editor_version: 2;
  pages: NotePage[];
}
export interface NotebookRecord extends NotePayload {
  id: string;
  version: number;
}
export const LEGACY_NOTE_MESSAGE =
  'This notebook uses the previous 1% editor. Its original content is preserved and cannot be edited here. Open it in the previous app, or create a new notebook.';
const fail = (message: string): never => {
  throw new Error(message);
};
const object = (value: unknown): value is Record<string, any> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: Record<string, any>, allowed: string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail('The notebook contains unsupported fields.');
};
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const number = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const uuid = (value: unknown) =>
  value === null ||
  (typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));

/** Validate server responses and emergency drafts before they reach SVG, text styles or print HTML. */
export function validateNotePayload(value: unknown, allowEmptyTitle = false): NotePayload {
  if (!object(value)) return fail('Invalid notebook.');
  keys(value, ['title', 'subject_id', 'folder_id', 'editor_version', 'pages']);
  if (value.editor_version !== 2) return fail(LEGACY_NOTE_MESSAGE);
  if (
    typeof value.title !== 'string' ||
    value.title.length > 180 ||
    (!allowEmptyTitle && !value.title.trim())
  )
    return fail('Enter a notebook title (up to 180 characters).');
  if (!uuid(value.subject_id) || !uuid(value.folder_id))
    return fail('Invalid linked subject or folder.');
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 100)
    return fail('Use between 1 and 100 pages.');
  const pages = new Set<string>();
  for (const page of value.pages) {
    if (!object(page)) return fail('Invalid notebook page.');
    keys(page, ['id', 'background', 'spacing', 'objects', 'width', 'height']);
    if (!identifier(page.id) || pages.has(page.id)) return fail('Each page needs a unique ID.');
    pages.add(page.id);
    if (
      !['Blank', 'Ruled', 'Grid'].includes(page.background) ||
      ![24, 36].includes(page.spacing) ||
      ('width' in page && page.width !== 600) ||
      ('height' in page && page.height !== 840)
    )
      return fail('Invalid paper settings.');
    if (!Array.isArray(page.objects) || page.objects.length > 2000)
      return fail('Use up to 2,000 objects per page.');
    const ids = new Set<string>();
    for (const item of page.objects) {
      if (!object(item)) return fail('Invalid notebook object.');
      keys(item, [
        'id',
        'type',
        'x',
        'y',
        'size',
        'color',
        'text',
        'width',
        'bold',
        'italic',
        'underline',
        'align',
        'opacity',
        'points',
      ]);
      if (!identifier(item.id) || ids.has(item.id)) return fail('Each object needs a unique ID.');
      ids.add(item.id);
      if (
        !['text', 'stroke'].includes(item.type) ||
        !number(item.x, 0, 600) ||
        !number(item.y, 0, 840) ||
        !number(item.size, 1, 100) ||
        typeof item.color !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(item.color)
      )
        return fail('Invalid text or stroke.');
      if (('width' in item || item.type === 'text') && !number(item.width, 20, 600))
        return fail('Invalid text width.');
      if ('opacity' in item && !number(item.opacity, 0, 1)) return fail('Invalid stroke opacity.');
      if (
        ('text' in item || item.type === 'text') &&
        (typeof item.text !== 'string' || item.text.length > 20000)
      )
        return fail('Use up to 20,000 characters per text box.');
      if (
        ['bold', 'italic', 'underline'].some(
          (key) => key in item && typeof item[key] !== 'boolean',
        ) ||
        ('align' in item && !['left', 'center', 'right'].includes(item.align))
      )
        return fail('Invalid text style.');
      if ('points' in item || item.type === 'stroke') {
        if (
          !Array.isArray(item.points) ||
          item.points.length > 20000 ||
          (item.type === 'stroke' && !item.points.length)
        )
          return fail('Use between 1 and 20,000 points per stroke.');
        for (const point of item.points)
          if (
            !Array.isArray(point) ||
            ![2, 3].includes(point.length) ||
            point.some((p) => !number(p, -10000, 10000)) ||
            (point.length === 3 && !number(point[2], 0, 1))
          )
            return fail('Invalid stroke coordinates.');
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 5 * 1024 * 1024)
    return fail('This notebook exceeds 5 MB. Split it into smaller notebooks.');
  return value as NotePayload;
}
export function notePayload(value: any): NotePayload {
  return {
    title: value.title,
    subject_id: value.subject_id || null,
    folder_id: value.folder_id || null,
    editor_version: value.editor_version ?? 2,
    pages: value.pages,
  };
}
export function validateNotebook(value: any): NotebookRecord {
  if (value?.editor_version === 1 || value?.read_only) return fail(LEGACY_NOTE_MESSAGE);
  if (
    !object(value) ||
    !identifier(value.id) ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  )
    return fail('Invalid notebook revision. Reload and try again.');
  return { ...value, ...validateNotePayload(notePayload(value)) } as NotebookRecord;
}
