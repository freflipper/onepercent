import {
  type CloudContext,
  ApiError,
  current,
  readProfile,
  readRecord,
  rpcRecord,
} from './repository';
import { recordView } from './records';
import { todayInZone } from './domain/dates';

export const storageStatus = {
  enabled: true,
  max_file_bytes: 10 * 1024 * 1024,
  formats: ['PNG', 'JPEG', 'WebP'],
};
export async function imageUrl(ctx: CloudContext, id: string) {
  const record = await readRecord(ctx, id, 'screenshot');
  await current(ctx);
  const { data, error } = await ctx.client.storage
    .from('screenshots')
    .createSignedUrl(record.data.path, 300);
  if (error || !data?.signedUrl)
    throw new ApiError('The private image could not be opened. Please try again.', 502);
  await current(ctx);
  return { url: data.signedUrl };
}
export async function uploadImage(ctx: CloudContext, body: FormData) {
  const file = body.get('file');
  if (!(file instanceof Blob) || file.size < 1 || file.size > storageStatus.max_file_bytes)
    throw new ApiError('Choose a PNG, JPEG or WebP image up to 10 MB.', 422);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png =
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.length >= 16 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : null;
  if (!mime) throw new ApiError('Choose a valid PNG, JPEG or WebP image.', 422);
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += 24_576)
    parts.push(btoa(String.fromCharCode(...bytes.subarray(index, index + 24_576))));
  const title = String(body.get('title') || 'Screenshot').trim(),
    tradeId = body.get('trade_id');
  if (!title || title.length > 180) throw new ApiError('Add a title of 1–180 characters.', 422);
  if (tradeId) await readRecord(ctx, String(tradeId), 'trade');
  const profile = await readProfile(ctx);
  await current(ctx);
  const { data, error } = await ctx.client.functions.invoke('upload-screenshot', {
    body: { base64: parts.join(''), mime },
    headers: { Authorization: `Bearer ${ctx.session.access_token}` },
  });
  if (error)
    throw new ApiError(
      'The image could not be uploaded. Check your connection and try again.',
      502,
    );
  if (
    !data ||
    typeof data.path !== 'string' ||
    !data.path.startsWith(`${ctx.session.user.id}/`) ||
    data.mime !== mime ||
    data.size !== bytes.length
  )
    throw new ApiError('The image service returned an invalid response.', 502);
  try {
    await current(ctx);
    const row = await rpcRecord(ctx, 'save_record', {
      p_kind: 'screenshot',
      p_data: {
        title,
        date: todayInZone(profile.timezone),
        note: '',
        trade_id: tradeId || null,
        path: data.path,
        mime: data.mime,
        size: data.size,
      },
      p_id: null,
      p_expected_version: null,
    });
    return recordView(row, profile);
  } catch (failure) {
    // Storage refuses removal if the record committed but its response was interrupted.
    const { error: cleanup } = await ctx.client.storage.from('screenshots').remove([data.path]);
    if (cleanup)
      throw new ApiError(
        'The screenshot could not be confirmed. Refresh before retrying: its private image may already have been saved.',
        502,
      );
    throw failure;
  }
}
