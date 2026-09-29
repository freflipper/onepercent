import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '@/src/api';
import { useStore } from '@/src/store';
import { makeStyles, useTheme } from '@/src/theme';
import { dateLabel } from '@/src/dates';
import { Shell } from '@/src/components/Shell';
import {
  Button,
  Card,
  Confirm,
  Empty,
  ErrorMessage,
  IconButton,
  Input,
  Label,
  Sheet,
} from '@/src/components/ui';
import { Choice, EditorForm } from '@/src/components/Form';

function PrivateImage({ id, large }: { id: string; large?: boolean }) {
  const { user } = useStore(),
    { colors } = useTheme();
  const [uri, setUri] = useState(''),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0),
    [loadedKey, setLoadedKey] = useState('');
  const cacheKey = `${user?.user_id}:${id}:${retry}`;
  useEffect(() => {
    let active = true,
      request = 0;
    const renew = async () => {
      const current = ++request;
      try {
        const result = await api('/screenshots/' + encodeURIComponent(id) + '/url');
        if (typeof result?.url !== 'string' || new URL(result.url).protocol !== 'https:')
          throw new Error('Invalid private image link.');
        if (active && current === request) {
          setLoadedKey(cacheKey);
          setUri(result.url);
          setError(false);
        }
      } catch {
        if (active && current === request) {
          setLoadedKey(cacheKey);
          setError(true);
        }
      }
    };
    void renew();
    // Supabase links last five minutes; renew while the preview remains mounted.
    const timer = setInterval(() => void renew(), 4 * 60 * 1000);
    return () => {
      active = false;
      request++;
      clearInterval(timer);
    };
  }, [id, cacheKey]);
  if (error && loadedKey === cacheKey)
    return (
      <>
        <Label muted size={12}>
          Image unavailable. Check your connection and retry.
        </Label>
        <Button
          title="Retry image"
          variant="ghost"
          onPress={() => setRetry((value) => value + 1)}
        />
      </>
    );
  if (!uri || loadedKey !== cacheKey) return <ActivityIndicator color={colors.brandPrimary} />;
  return (
    <Image
      testID={`screenshot-image-${id}`}
      source={{ uri }}
      onError={() => setError(true)}
      resizeMode="contain"
      style={{
        width: '100%',
        height: large ? 420 : 170,
        backgroundColor: colors.surfaceTertiary,
        borderRadius: 12,
      }}
    />
  );
}
export default function Screenshots() {
  const params = useLocalSearchParams(),
    { records, mutate, refresh, setNotice } = useStore(),
    s = useStyles();
  const [trade, setTrade] = useState(String(params.trade || '')),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<any>(null),
    [editing, setEditing] = useState<any>(null),
    [deleting, setDeleting] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [storageStatus, setStorageStatus] = useState<any>(null);
  useEffect(() => {
    api('/storage/status')
      .then(setStorageStatus)
      .catch((e) => setError(e.message));
  }, []);
  async function upload() {
    setError('');
    if (!storageStatus?.enabled) {
      setError(
        'Private uploads are unavailable. Check your connection and the Supabase storage configuration.',
      );
      return;
    }
    setBusy(true);
    try {
      // The system document picker grants access to the chosen file only. It does not require broad photo-library permission.
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/webp'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      if (file.size && file.size > 10 * 1024 * 1024)
        throw new Error('Choose an image of 10 MB or smaller.');
      const form = new FormData();
      if (Platform.OS === 'web')
        form.append('file', await (await fetch(file.uri)).blob(), file.name);
      else
        form.append('file', {
          uri: file.uri,
          name: file.name,
          type: file.mimeType || 'image/png',
        } as any);
      form.append('title', file.name.replace(/\.[^.]+$/, '').slice(0, 180));
      if (trade) form.append('trade_id', trade);
      const r = await api('/screenshots/upload', 'POST', form);
      await refresh();
      setEditing(r);
      setNotice('Image uploaded privately.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const items = records('screenshots').filter(
    (r: any) =>
      (!trade || r.trade_id === trade) && r.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Shell
      title="Screenshots"
      section="screenshots"
      right={
        <IconButton
          name="add"
          testID="screenshots-upload"
          label="Upload screenshot"
          onPress={upload}
        />
      }
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Label muted size={13}>
          Your visual trading journal. PNG, JPEG or WebP, up to 10 MB per image.
        </Label>
        {storageStatus && !storageStatus.enabled && (
          <Card>
            <Label weight="600">Private storage not activated</Label>
            <Label muted size={13}>
              Private Supabase storage is not available. Check the project configuration before
              uploading an image.
            </Label>
          </Card>
        )}
        <Input label="Search" testID="screenshots-search" value={search} onChangeText={setSearch} />
        <Choice
          label="Trade"
          testID="screenshots-trade-filter"
          value={trade}
          options={[
            { label: 'All screenshots', value: '' },
            ...records('trades').map((r: any) => ({
              label: `${r.instrument} · ${dateLabel(r.opened_at)}`,
              value: r.id,
            })),
          ]}
          onChange={setTrade}
        />
        {busy && <ActivityIndicator />}
        {!!error && <ErrorMessage message={error} />}
        {!items.length ? (
          <Empty
            title="Keep the full picture"
            detail="Attach your own chart images to trades or keep them in your private gallery."
            icon="images-outline"
            action={upload}
            actionLabel="Upload screenshot"
          />
        ) : (
          items.map((r: any) => (
            <Pressable key={r.id} testID={`screenshot-${r.id}`} onPress={() => setSelected(r)}>
              <Card>
                <PrivateImage id={r.id} />
                <Label weight="600">{r.title}</Label>
                <Label muted size={12}>
                  {dateLabel(r.date)}
                </Label>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
      <Sheet
        visible={!!selected}
        title={selected?.title || 'Screenshot'}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <PrivateImage id={selected.id} large />
            <Label style={{ marginTop: 16 }}>{selected.notes}</Label>
            <Button
              title="Edit details"
              testID="screenshot-edit"
              variant="secondary"
              onPress={() => {
                setEditing(selected);
                setSelected(null);
              }}
              style={{ marginTop: 20 }}
            />
            <Button
              title="Delete screenshot"
              testID="screenshot-delete"
              variant="danger"
              onPress={() => {
                setDeleting(selected);
                setSelected(null);
              }}
            />
          </>
        )}
      </Sheet>
      {editing && (
        <EditorForm kind="screenshots" record={editing} onClose={() => setEditing(null)} />
      )}
      <Confirm
        visible={!!deleting}
        title="Delete this screenshot?"
        message="The image will no longer be accessible from your account. Its trade is kept."
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await mutate('/records/screenshots/' + deleting.id, 'DELETE', {
              version: deleting.version,
            });
            setDeleting(null);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
        busy={busy}
        error={error}
      />
    </Shell>
  );
}
const useStyles = makeStyles(() => ({
  content: {
    padding: 20,
    paddingBottom: 32,
    gap: 16,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
}));
