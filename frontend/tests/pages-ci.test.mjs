import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, link } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { packagePages } from '../scripts/package-pages.mjs';
import { resolvePagesBasePath, validatePublicConfiguration, verifyPagesArtifact } from '../scripts/pages-ci.mjs';

const execute = promisify(execFile), roots = [];
const publicConfig = { url: 'https://fixture-project.supabase.co', key: 'sb_publishable_ISOLATED_TEST_FIXTURE' };
const legacyKey = role => [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ role })).toString('base64url'), 'ISOLATED_TEST_SIGNATURE'].join('.');
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('onepercent-pages-ci-test-'))
      throw new Error('Unsafe fixture cleanup path.');
    await rm(resolved, { recursive: true, force: true });
  }
});
async function temporaryDirectory() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'onepercent-pages-ci-test-'));
  roots.push(root);
  return root;
}
async function artifact(base = '') {
  const directory = await temporaryDirectory();
  await mkdir(path.join(directory, 'icons'));
  await mkdir(path.join(directory, 'assets/node_modules/.pnpm/icons/Fonts'), { recursive: true });
  await mkdir(path.join(directory, '_expo/static/js/web'), { recursive: true });
  for (const name of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'icon.svg'])
    await writeFile(path.join(directory, 'icons', name), 'isolated icon');
  await writeFile(path.join(directory, 'assets/node_modules/.pnpm/icons/Fonts/font.ttf'), 'isolated font');
  await writeFile(path.join(directory, '_expo/static/js/web/app.js'), '/* isolated bundle */');
  await writeFile(path.join(directory, 'service-worker.js'), '/* isolated worker */');
  await writeFile(path.join(directory, 'index.html'), `<html><head></head><body><script src="${base}/_expo/static/js/web/app.js"></script></body></html>`);
  await packagePages({ directory, basePath: base });
  return directory;
}

describe('GitHub Pages build configuration', () => {
  it('uses Pages metadata for project, owner root and custom-domain sites', () => {
    expect(resolvePagesBasePath({ detected: '/onepercent' })).toBe('/onepercent');
    expect(resolvePagesBasePath({ detected: '' })).toBe('');
    expect(resolvePagesBasePath({ detected: '/', override: '' })).toBe('');
    expect(resolvePagesBasePath({ detected: '/onepercent', override: '/' })).toBe('');
    expect(resolvePagesBasePath({ detected: '', override: '/chosen-project/' })).toBe('/chosen-project');
    expect(() => resolvePagesBasePath()).toThrow('Pages metadata');
  });
  it.each(['../escape', '/project/../escape', '/repo\nINJECTED=value', 'https://outside.example', '/repo?code=anything'])(
    'rejects invalid Pages override %s', override => expect(() => resolvePagesBasePath({ detected: '', override })).toThrow(),
  );
  it('accepts only public Supabase key kinds without contacting a server', () => {
    expect(() => validatePublicConfiguration(publicConfig)).not.toThrow();
    expect(() => validatePublicConfiguration({ ...publicConfig, key: legacyKey('anon') })).not.toThrow();
    for (const key of ['', 'sb_secret_DO_NOT_PUBLISH', legacyKey('service_role'), legacyKey('authenticated'), 'eyJ.malformed.jwt', ` ${publicConfig.key}`])
      expect(() => validatePublicConfiguration({ ...publicConfig, key })).toThrow();
    for (const url of ['http://fixture-project.supabase.co', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?key=secret'])
      expect(() => validatePublicConfiguration({ ...publicConfig, url })).toThrow();
  });
  it('writes only the normalised base path into GITHUB_ENV and never logs a key', async () => {
    const directory = await temporaryDirectory(), envFile = path.join(directory, 'github-env');
    const result = await execute(process.execPath, [fileURLToPath(new URL('../scripts/pages-ci.mjs', import.meta.url)), 'configure'], {
      windowsHide: true, env: { ...process.env, GITHUB_ENV: envFile, EXPO_PUBLIC_SUPABASE_URL: publicConfig.url,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicConfig.key, PAGES_DETECTED_BASE_PATH: '/onepercent', PAGES_BASE_PATH_OVERRIDE: 'auto' },
    });
    expect(await readFile(envFile, 'utf8')).toBe('EXPO_PUBLIC_BASE_PATH=/onepercent\n');
    expect(result.stdout).not.toContain(publicConfig.key);
    expect(result.stderr).toBe('');
  });
});

describe('Pages public artifact gate', () => {
  it.each(['', '/onepercent'])('preserves the complete Expo export including .pnpm fonts at %s', async basePath => {
    const result = await verifyPagesArtifact({ directory: await artifact(basePath) });
    expect(result.basePath).toBe(basePath);
    expect(result.files).toBe(13);
    expect(result.bytes).toBeGreaterThan(0);
  });
  it.each(['.env', 'assets/.env.local', 'assets/node_modules/.pnpm/.env', 'private.key', '.git/config'])(
    'refuses accidental private file %s before include-hidden-files upload', async name => {
      const directory = await artifact();
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), 'ISOLATED_PRIVATE_FILE_FIXTURE');
      await expect(verifyPagesArtifact({ directory })).rejects.toThrow(/Unexpected hidden|Private credential/);
    },
  );
  it('rejects a missing entry bundle, oversize output and hard links', async () => {
    const directory = await artifact();
    await expect(verifyPagesArtifact({ directory, maxBytes: 10 })).rejects.toThrow('1 GB');
    await link(path.join(directory, 'service-worker.js'), path.join(directory, 'linked-worker.js'));
    await expect(verifyPagesArtifact({ directory })).rejects.toThrow('links');
    const missing = await artifact('/project');
    await rm(path.join(missing, '_expo/static/js/web/app.js'));
    await expect(verifyPagesArtifact({ directory: missing })).rejects.toThrow();
  });
});
