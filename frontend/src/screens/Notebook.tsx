import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useStore } from '@/src/store';
import { makeStyles, useTheme } from '@/src/theme';
import { newId } from '@/src/dates';
import { api } from '@/src/api';
import { Button, Confirm, ErrorMessage, Icon, IconButton, Label, Sheet } from '@/src/components/ui';
import { Choice } from '@/src/components/Form';
import Paper from '@/src/notes/Paper';
import { useNotebook } from '@/src/notes/useNotebook';
import { PAGE_W } from '@/src/notes/geometry';
import { prepareNotebookExport } from '@/src/notes/export';

const TOOLS = [
  ['Navigate', 'hand-left-outline'],
  ['Select', 'navigate-outline'],
  ['Text', 'text-outline'],
  ['Pen', 'pencil-outline'],
  ['Highlighter', 'brush-outline'],
  ['Stroke Eraser', 'bandage-outline'],
];
export default function Notebook() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useStore();
  return <NotebookView key={`${user?.user_id}:${id}`} id={id} />;
}
function NotebookView({ id }: { id: string }) {
  const book = useNotebook(id),
    { note, status, error, commit, flush } = book,
    navigation = useNavigation(),
    store = useStore(),
    s = useStyles(),
    { colors } = useTheme();
  const [pageIndex, setPageIndex] = useState(0),
    [tool, setTool] = useState('Navigate'),
    [selection, setSelection] = useState<string | null>(null),
    [width, setWidth] = useState(350),
    [zoom, setZoom] = useState(1),
    [options, setOptions] = useState(false),
    [removePage, setRemovePage] = useState(false),
    [busy, setBusy] = useState(false),
    [brush, setBrush] = useState<any>({
      color: colors.paperInk,
      size: 3,
      textSize: 20,
      bold: false,
      italic: false,
      underline: false,
      align: 'left',
    });
  const [leaving, setLeaving] = useState(false);
  const exportJob = useRef<ReturnType<typeof prepareNotebookExport> | null>(null);
  useEffect(() => () => exportJob.current?.cancel(), []);
  usePreventRemove(
    !leaving && (status === 'Unsaved changes' || status === 'Saving'),
    ({ data }) => {
      flush()
        .then(() => {
          setLeaving(true);
          requestAnimationFrame(() => navigation.dispatch(data.action));
        })
        .catch(() => {});
    },
  );
  const index = Math.min(pageIndex, (note?.pages?.length || 1) - 1),
    page = note?.pages[index]!,
    selected = page?.objects.find((o: any) => o.id === selection);
  const changePage = (next: any) => {
    if (note) commit({ pages: note.pages.map((p: any, i: number) => (i === index ? next : p)) });
  };
  function styleSelection(key: string, value: any) {
    setBrush((b: any) => ({
      ...b,
      [key === 'size' && selected?.type === 'text' ? 'textSize' : key]: value,
    }));
    if (selected)
      changePage({
        ...page,
        objects: page.objects.map((o: any) => (o.id === selection ? { ...o, [key]: value } : o)),
      });
  }
  function textSize(value: number) {
    setBrush((current: any) => ({ ...current, textSize: value }));
    if (selected?.type === 'text') styleSelection('size', value);
  }
  async function back() {
    try {
      await flush();
      if (router.canGoBack()) router.back();
      else router.replace('/notes' as any);
    } catch {
      /* Stay on the notebook until its pending changes can be saved. */
    }
  }
  async function switchPage(i: number) {
    try {
      await flush();
      setPageIndex(i);
      setSelection(null);
    } catch {
      /* Unsaved changes remain visible with Retry. */
    }
  }
  async function pdf() {
    let job: ReturnType<typeof prepareNotebookExport> | undefined;
    setBusy(true);
    try {
      job = prepareNotebookExport();
      exportJob.current = job;
      const saved = await flush();
      if (saved) await job.complete(saved);
      else job.cancel();
    } catch (e: any) {
      job?.cancel();
      book.setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveCopy() {
    if (!note) return;
    setBusy(true);
    try {
      const copy = await api('/records/notes', 'POST', {
        title: `${note.title} · copy`.slice(0, 180),
        subject_id: note.subject_id,
        folder_id: note.folder_id,
        pages: note.pages,
      });
      await store.refresh();
      store.setNotice('A separate copy has been saved. Your original is unchanged.');
      setLeaving(true);
      requestAnimationFrame(() => router.replace(`/note/${copy.id}` as any));
    } catch (e: any) {
      book.setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={s.header}>
          <IconButton
            name="chevron-back"
            testID="notebook-back"
            label="Back to notes"
            onPress={back}
          />
          <View style={{ flex: 1 }}>
            <TextInput
              testID="note-title"
              accessibilityLabel="Notebook title"
              editable={!!note}
              value={note?.title || ''}
              maxLength={180}
              onChangeText={(title) => commit({ title })}
              placeholder="Notebook title"
              placeholderTextColor={colors.placeholder}
              style={s.title}
            />
            <Label testID="note-save-state" size={11} muted>
              {status}
              {status === 'Saved' ? ' · All changes saved' : ''}
            </Label>
          </View>
          <IconButton
            name="ellipsis-horizontal"
            testID="notebook-options"
            label="Notebook options"
            onPress={() => setOptions(true)}
          />
        </View>
        {!note ? (
          <View style={s.loading}>
            {error ? (
              <ErrorMessage message={error} retry={book.legacy ? undefined : book.reload} />
            ) : (
              <ActivityIndicator color={colors.brandPrimary} />
            )}
          </View>
        ) : (
          <>
            <View style={s.toolbar}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.tools}
              >
                {TOOLS.map(([name, icon]) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={name}
                    key={name}
                    testID={`tool-${name.toLowerCase().replace(/ /g, '-')}`}
                    onPress={() => {
                      setTool(name);
                      if (name === 'Highlighter')
                        setBrush((b: any) => ({ ...b, color: colors.highlight }));
                    }}
                    style={[s.tool, name === tool && s.activeTool]}
                  >
                    <Icon
                      name={icon}
                      size={20}
                      color={name === tool ? colors.brandPrimary : colors.muted}
                    />
                    <Label size={9} style={name === tool && { color: colors.brandPrimary }}>
                      {name}
                    </Label>
                  </Pressable>
                ))}
                <IconButton
                  name="arrow-undo-outline"
                  testID="note-undo"
                  label="Undo"
                  onPress={() => book.history.undo && book.undo()}
                  color={book.history.undo ? colors.onSurface : colors.muted}
                />
                <IconButton
                  name="arrow-redo-outline"
                  testID="note-redo"
                  label="Redo"
                  onPress={() => book.history.redo && book.redo()}
                  color={book.history.redo ? colors.onSurface : colors.muted}
                />
              </ScrollView>
            </View>
            <View style={s.formatbar}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.formatTools}
              >
                {[
                  colors.paperInk,
                  colors.inkBlue,
                  colors.inkRed,
                  colors.inkGreen,
                  colors.highlight,
                ].map((color) => (
                  <Pressable
                    key={color}
                    testID={`ink-${color.slice(1)}`}
                    accessibilityLabel={`Ink ${color}`}
                    onPress={() => styleSelection('color', color)}
                    style={s.colorTarget}
                  >
                    <View
                      style={[
                        s.swatch,
                        {
                          backgroundColor: color,
                          borderColor:
                            brush.color === color ? colors.onSurface : colors.transparent,
                        },
                      ]}
                    />
                  </Pressable>
                ))}
                {[2, 4, 8].map((size) => (
                  <Pressable
                    key={size}
                    testID={`pen-size-${size}`}
                    accessibilityLabel={`${size} point pen`}
                    onPress={() => {
                      setBrush((b: any) => ({ ...b, size }));
                      if (selected?.type === 'stroke') styleSelection('size', size);
                    }}
                    style={s.smallTool}
                  >
                    <Label size={12}>{size}pt</Label>
                  </Pressable>
                ))}
                {[
                  ['bold', 'B'],
                  ['italic', 'I'],
                  ['underline', 'U'],
                ].map(([key, label]) => (
                  <Pressable
                    key={key}
                    testID={`text-${key}`}
                    onPress={() =>
                      styleSelection(
                        key,
                        !(selected?.[key as 'bold' | 'italic' | 'underline'] ?? brush[key]),
                      )
                    }
                    style={[
                      s.smallTool,
                      (selected?.[key as 'bold' | 'italic' | 'underline'] ?? brush[key]) &&
                        s.activeTool,
                    ]}
                  >
                    <Label size={16} weight="600">
                      {label}
                    </Label>
                  </Pressable>
                ))}
                <IconButton
                  name="remove"
                  testID="text-size-down"
                  label="Smaller text"
                  onPress={() =>
                    textSize(
                      Math.max(
                        10,
                        (selected?.type === 'text' ? selected.size : brush.textSize) - 2,
                      ),
                    )
                  }
                />
                <IconButton
                  name="add"
                  testID="text-size-up"
                  label="Larger text"
                  onPress={() =>
                    textSize(
                      Math.min(
                        64,
                        (selected?.type === 'text' ? selected.size : brush.textSize) + 2,
                      ),
                    )
                  }
                />
                {selected && (
                  <IconButton
                    name="trash-outline"
                    testID="delete-note-object"
                    label="Delete selected object"
                    onPress={() => {
                      changePage({
                        ...page,
                        objects: page.objects.filter((o: any) => o.id !== selection),
                      });
                      setSelection(null);
                    }}
                  />
                )}
              </ScrollView>
            </View>
            <View style={s.modeHint}>
              <Label size={11} muted>
                {tool === 'Navigate'
                  ? 'Navigation mode · scroll without drawing'
                  : tool === 'Text'
                    ? 'Tap the sheet to add text. Tap text to edit.'
                    : tool === 'Select'
                      ? 'Tap and drag an object to move it.'
                      : tool === 'Stroke Eraser'
                        ? 'Erase entire strokes · text stays untouched'
                        : `${tool} mode · switch to Navigate to scroll`}
              </Label>
            </View>
            {!!error && (
              <View style={s.error}>
                <ErrorMessage message={error} retry={() => flush().catch(() => {})} />
                <Button
                  title="Save a separate copy"
                  testID="note-save-copy"
                  variant="ghost"
                  onPress={saveCopy}
                  busy={busy}
                />
              </View>
            )}
            <View
              style={{ flex: 1 }}
              onLayout={(e) => setWidth(Math.max(240, e.nativeEvent.layout.width - 32))}
            >
              <ScrollView
                scrollEnabled={tool === 'Navigate'}
                contentContainerStyle={s.paperVertical}
                keyboardShouldPersistTaps="handled"
              >
                <ScrollView
                  horizontal
                  scrollEnabled={tool === 'Navigate'}
                  showsHorizontalScrollIndicator={zoom > 1}
                  contentContainerStyle={s.paperHorizontal}
                  keyboardShouldPersistTaps="handled"
                >
                  <Paper
                    page={page}
                    scale={(Math.min(width, 680) / PAGE_W) * zoom}
                    tool={tool}
                    brush={brush}
                    selection={selection}
                    onSelect={setSelection}
                    onChange={changePage}
                  />
                </ScrollView>
              </ScrollView>
            </View>
            <View style={s.pageBar}>
              <IconButton
                name="chevron-back"
                testID="note-previous-page"
                label="Previous page"
                onPress={() => index > 0 && switchPage(index - 1)}
              />
              <Label testID="note-page-count" size={12}>
                Page {index + 1} of {note.pages.length}
              </Label>
              <IconButton
                name="chevron-forward"
                testID="note-next-page"
                label="Next page"
                onPress={() => index < note.pages.length - 1 && switchPage(index + 1)}
              />
              <View style={{ flex: 1 }} />
              <Pressable
                testID="note-zoom"
                onPress={() => setZoom(zoom >= 2 ? 1 : zoom + 0.5)}
                style={s.zoom}
              >
                <Label size={12}>{Math.round(zoom * 100)}%</Label>
              </Pressable>
              <IconButton
                name="add-outline"
                testID="note-add-page"
                label="Add page"
                disabled={note.pages.length >= 100}
                onPress={() => {
                  const next = {
                    id: newId(),
                    background: page.background,
                    spacing: page.spacing,
                    objects: [],
                  };
                  commit({ pages: [...note.pages, next] });
                  setPageIndex(note.pages.length);
                  setSelection(null);
                }}
              />
            </View>
          </>
        )}
        <Sheet
          visible={options && !!note}
          title="Notebook options"
          onClose={() => setOptions(false)}
        >
          {note && (
            <>
              <Choice
                label="Paper"
                testID="note-background"
                value={page.background}
                options={['Blank', 'Ruled', 'Grid'].map((v) => ({ value: v, label: v }))}
                onChange={(background: string) => changePage({ ...page, background })}
              />
              <Choice
                label="Line / grid spacing"
                testID="note-spacing"
                value={page.spacing}
                options={[
                  { label: '24 pt · narrow', value: 24 },
                  { label: '36 pt · wide', value: 36 },
                ]}
                onChange={(spacing: number) => changePage({ ...page, spacing })}
              />
              <Choice
                label="Subject"
                testID="note-subject"
                value={note.subject_id || ''}
                options={[
                  { label: 'None', value: '' },
                  ...store.records('subjects').map((r: any) => ({ label: r.name, value: r.id })),
                ]}
                onChange={(subject_id: string) => commit({ subject_id: subject_id || null })}
              />
              <Choice
                label="Folder"
                testID="note-folder"
                value={note.folder_id || ''}
                options={[
                  { label: 'Unfiled', value: '' },
                  ...store.records('folders').map((r: any) => ({ label: r.name, value: r.id })),
                ]}
                onChange={(folder_id: string) => commit({ folder_id: folder_id || null })}
              />
              <Choice
                label="Text alignment"
                testID="note-alignment"
                value={selected?.align || brush.align}
                options={['left', 'center', 'right'].map((v) => ({ label: v, value: v }))}
                onChange={(v: string) => styleSelection('align', v)}
              />
              {selected?.type === 'text' && (
                <Choice
                  label="Text box width"
                  testID="note-text-width"
                  value={selected.width}
                  options={[160, 260, 400, 560].map((v) => ({ value: v, label: `${v} pt` }))}
                  onChange={(v: number) => {
                    const width = Math.min(v, PAGE_W - selected.x);
                    changePage({
                      ...page,
                      objects: page.objects.map((o: any) =>
                        o.id === selection ? { ...o, width } : o,
                      ),
                    });
                  }}
                />
              )}
              <Button
                title="Fit to width"
                testID="note-fit-width"
                variant="secondary"
                onPress={() => {
                  setZoom(1);
                  setOptions(false);
                }}
                style={s.optionButton}
              />
              <Button
                title="Print / Export PDF"
                testID="note-export"
                icon="share-outline"
                onPress={pdf}
                busy={busy}
                style={s.optionButton}
              />
              <Label size={12} muted>
                Exports all pages, paper backgrounds, editable text content and drawings. The
                exported PDF is a separate document.
              </Label>
              <Button
                title="Delete current page"
                testID="note-delete-page"
                variant="danger"
                disabled={note.pages.length <= 1}
                onPress={() => {
                  setOptions(false);
                  setRemovePage(true);
                }}
                style={s.optionButton}
              />
            </>
          )}
        </Sheet>
        <Confirm
          visible={removePage}
          title="Delete this page?"
          message="Text and drawings on this page will be removed."
          onCancel={() => setRemovePage(false)}
          onConfirm={() => {
            if (!note) return;
            commit({ pages: note.pages.filter((_: any, i: number) => i !== index) });
            setPageIndex(Math.max(0, index - 1));
            setSelection(null);
            setRemovePage(false);
          }}
        />
        <Sheet visible={!!book.recovery} title="Unsaved draft found" onClose={() => {}}>
          <Label>
            Your last unsaved changes are available on this device. If the server version changed,
            recovery creates a separate notebook to avoid overwriting it.
          </Label>
          <Button
            title="Recover draft"
            testID="note-recover"
            style={{ marginTop: 24 }}
            onPress={async () => {
              try {
                const copyId = await book.recover();
                if (copyId) router.push(`/note/${copyId}` as any);
              } catch (e: any) {
                book.setError(e.message);
              }
            }}
          />
        </Sheet>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surfaceTertiary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    minHeight: 70,
    backgroundColor: c.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  title: { fontSize: 18, fontWeight: '600', color: c.onSurface, paddingVertical: 4 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  toolbar: { backgroundColor: c.surfaceSecondary, height: 66 },
  tools: { paddingHorizontal: 10, alignItems: 'center', gap: 4 },
  tool: {
    width: 65,
    height: 55,
    borderRadius: 12,
    gap: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTool: { backgroundColor: c.brandSecondary },
  formatbar: {
    height: 48,
    backgroundColor: c.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  formatTools: { paddingHorizontal: 8, alignItems: 'center' },
  colorTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 2 },
  smallTool: {
    minWidth: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  modeHint: { paddingHorizontal: 16, minHeight: 34, justifyContent: 'center' },
  paperVertical: { paddingBottom: 20, flexGrow: 1 },
  paperHorizontal: {
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    flexGrow: 1,
    justifyContent: 'center',
  },
  pageBar: {
    backgroundColor: c.surfaceSecondary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: c.border,
    minHeight: 54,
  },
  zoom: { padding: 12, minHeight: 44 },
  optionButton: { marginTop: 14, marginBottom: 14 },
  error: { backgroundColor: c.surfaceSecondary, paddingHorizontal: 16, maxHeight: 220 },
}));
