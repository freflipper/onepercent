import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaperGesture } from '../src/notes/PaperGesture';
import { notebookHTML, prepareNotebookExport } from '../src/notes/export';
import { validateNotebook } from '../src/notes/document';

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
}));
vi.mock('expo-print', () => ({}));
vi.mock('expo-sharing', () => ({}));
vi.mock('@/src/theme', () => ({ themes: { light: { paper: '#ffffff', paperLine: '#cccccc' } } }));

const page = () => ({
  id: 'page1',
  background: 'Ruled',
  spacing: 24,
  objects: [
    {
      id: 'text1',
      type: 'text',
      x: 20,
      y: 20,
      width: 260,
      size: 20,
      color: '#112233',
      text: 'Text <script> & "quotes"',
    },
    {
      id: 'stroke1',
      type: 'stroke',
      x: 0,
      y: 0,
      size: 3,
      color: '#123456',
      points: [
        [0, 0, 0.5],
        [10, 10, 0.8],
      ],
      opacity: 0.32,
    },
  ],
});
const note = () => ({
  id: 'test-note',
  version: 1,
  editor_version: 2,
  title: 'Printing <test>',
  subject_id: null,
  folder_id: null,
  pages: [page(), { ...page(), id: 'page2', background: 'Grid' }],
});
afterEach(() => vi.unstubAllGlobals());

describe('Preserved Emergent gestures', () => {
  it('commits pressure points as editable native strokes with the selected highlighter style', () => {
    const controller = new PaperGesture(),
      onChange = vi.fn(),
      live = vi.fn();
    controller.configure(
      {
        page: page(),
        tool: 'Highlighter',
        brush: { size: 4, color: '#aabbcc' },
        onSelect: vi.fn(),
        onChange,
      },
      (event) => event.point,
      live,
      vi.fn(),
    );
    const handlers = controller.responder.panHandlers as any;
    handlers.onPanResponderGrant({ point: [20, 30, 0.25] });
    handlers.onPanResponderMove({ point: [40, 60, 0.75] });
    handlers.onPanResponderRelease();
    const changed = onChange.mock.calls[0][0],
      stroke = changed.objects.at(-1);
    expect(stroke).toMatchObject({
      type: 'stroke',
      x: 20,
      y: 30,
      points: [
        [0, 0, 0.25],
        [20, 30, 0.75],
      ],
      size: 20,
      opacity: 0.32,
      color: '#aabbcc',
    });
    expect(() => validateNotebook({ ...note(), pages: [changed] })).not.toThrow();
    expect(live).toHaveBeenLastCalledWith([]);
  });
  it('stroke eraser preserves editable text and cancelled gestures never commit', () => {
    const controller = new PaperGesture(),
      onChange = vi.fn();
    controller.configure(
      { page: page(), tool: 'Stroke Eraser', brush: {}, onSelect: vi.fn(), onChange },
      (event) => event.point,
      vi.fn(),
      vi.fn(),
    );
    const handlers = controller.responder.panHandlers as any;
    handlers.onPanResponderGrant({ point: [5, 5, 0.5] });
    handlers.onPanResponderRelease();
    expect(onChange.mock.calls[0][0].objects.map((item: any) => item.id)).toEqual(['text1']);
    onChange.mockClear();
    handlers.onPanResponderGrant({ point: [5, 5, 0.5] });
    handlers.onPanResponderTerminate();
    handlers.onPanResponderRelease();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Browser export', () => {
  it('prints every page and escapes user text while keeping native strokes', () => {
    const html = notebookHTML(note());
    expect(html.match(/<section>/g)).toHaveLength(2);
    expect(html).toContain('Text &lt;script&gt; &amp; &quot;quotes&quot;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<path transform="translate(0,0)"');
    expect(() =>
      notebookHTML({
        ...note(),
        pages: [{ ...page(), objects: [{ ...page().objects[0], x: '0;position:fixed' }] }],
      }),
    ).toThrow();
  });
  it('reserves a popup synchronously, waits for layout resources, and severs the opener', async () => {
    let ready!: () => void;
    const fonts = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const preview = {
      opener: {},
      closed: false,
      document: {
        title: '',
        body: { textContent: '' },
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        fonts: { ready: fonts },
      },
      close: vi.fn(),
      focus: vi.fn(),
      print: vi.fn(),
      addEventListener: vi.fn(),
    };
    const open = vi.fn(() => preview);
    vi.stubGlobal('window', { open });
    const job = prepareNotebookExport();
    expect(open).toHaveBeenCalledOnce();
    expect(preview.opener).toBeNull();
    const completion = job.complete(note());
    expect(preview.print).not.toHaveBeenCalled();
    ready();
    await completion;
    expect(preview.document.write.mock.calls[0][0]).toContain('Content-Security-Policy');
    expect(preview.print).toHaveBeenCalledOnce();
    job.cancel();
    expect(preview.close).toHaveBeenCalledOnce();
  });
  it('rejects blocked or cancelled print windows without writing the document', async () => {
    vi.stubGlobal('window', { open: () => null });
    expect(() => prepareNotebookExport()).toThrow('Allow the print window');
  });
});
