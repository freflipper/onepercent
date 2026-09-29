import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Buffer } from 'node:buffer';
import { normaliseBasePath, packagePages } from '../scripts/package-pages.mjs';

const roots = [];
async function fixture(base = '') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'onepercent-pages-test-'));
  roots.push(root);
  await mkdir(path.join(root, 'icons'));
  for (const name of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'icon.svg'])
    await writeFile(path.join(root, 'icons', name), 'isolated packaging fixture');
  await writeFile(path.join(root, 'service-worker.js'), '// test worker');
  await writeFile(
    path.join(root, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="${base}/_expo/static/js/web/app.js"></script></body></html>`,
  );
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('onepercent-pages-test-')
    )
      throw new Error('Unsafe fixture cleanup path.');
    await rm(resolved, { recursive: true, force: true });
  }
});

describe('Static Pages artifact', () => {
  it.each(['', '/onepercent'])(
    'preserves callback routes, SPA fallbacks and assets at base %s',
    async (base) => {
      const directory = await fixture(base);
      const result = await packagePages({ directory, basePath: base });
      const html = await readFile(path.join(directory, 'index.html'), 'utf8');
      expect(await readFile(path.join(directory, '404.html'), 'utf8')).toBe(html);
      expect(await readFile(path.join(directory, 'auth', 'callback', 'index.html'), 'utf8')).toBe(
        html,
      );
      expect(html).toContain(`src="${base}/_expo/static/js/web/app.js"`);
      expect(html).toContain(`href="${base}/manifest.webmanifest"`);
      expect(html).not.toContain('location.replace');
      expect(result.callbackPath).toBe(`${base}/auth/callback/`);
      const manifest = JSON.parse(
        await readFile(path.join(directory, 'manifest.webmanifest'), 'utf8'),
      );
      expect(manifest).toMatchObject({
        start_url: `${base}/`,
        scope: `${base}/`,
        display: 'standalone',
      });
      expect(manifest.icons.every((icon) => icon.src.startsWith(`${base}/icons/`))).toBe(true);
      await packagePages({ directory, basePath: base });
      expect(
        (await readFile(path.join(directory, 'index.html'), 'utf8')).match(/rel="manifest"/g),
      ).toHaveLength(1);
    },
  );
  it('refuses an Expo build with a mismatched base path', async () => {
    await expect(
      packagePages({ directory: await fixture(), basePath: '/repository' }),
    ).rejects.toThrow('same EXPO_PUBLIC_BASE_PATH');
  });
  it.each([
    'https://example.com/repo',
    '../repo',
    '/repo/../other',
    '/repo?code=test',
    '/repo#hash',
    '/repo%2fother',
  ])('rejects unsafe base path %s', (value) => {
    expect(() => normaliseBasePath(value)).toThrow();
  });
  it('ships correctly sized PNG icons and a worker with no data caching or push subscription', async () => {
    for (const [name, size] of [
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['apple-touch-icon.png', 180],
    ]) {
      const bytes = await readFile(new URL(`../public/icons/${name}`, import.meta.url));
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(bytes.readUInt32BE(16)).toBe(size);
      expect(bytes.readUInt32BE(20)).toBe(size);
    }
    const worker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
    expect(worker).not.toMatch(/caches\.|pushManager|addEventListener\(['"]fetch/);
    expect(worker).toContain("new URL('notifications', self.registration.scope)");
  });
});
