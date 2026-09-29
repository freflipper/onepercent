import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { launchWeb, loadWebBuild, identifyExistingServer, MARKER_PATH, SERVER_MARKER } from '../scripts/serve-web.mjs';

const execute = promisify(execFile), roots = [], servers = [];
beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('onepercent-server-test-'))
      throw new Error('Unsafe fixture cleanup path.');
    await rm(resolved, { force: true, recursive: true });
  }
  vi.restoreAllMocks();
});
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'onepercent-server-test-'));
  roots.push(directory);
  return directory;
}
async function fixture(basePath = '') {
  const directory = await temporaryDirectory();
  await mkdir(path.join(directory, 'assets'));
  await mkdir(path.join(directory, 'assets/node_modules/.pnpm/vector-icons/Fonts'), { recursive: true });
  await mkdir(path.join(directory, 'auth/callback'), { recursive: true });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>1% fixture</title>');
  await writeFile(path.join(directory, 'auth/callback/index.html'), '<!doctype html><title>Callback fixture</title>');
  await writeFile(path.join(directory, 'assets/app.js'), 'console.log("isolated fixture");');
  await writeFile(path.join(directory, 'assets/node_modules/.pnpm/vector-icons/Fonts/icons.ttf'), 'PUBLIC_EXPO_FONT');
  await writeFile(path.join(directory, 'assets/node_modules/.pnpm/.env'), 'DO_NOT_SERVE_NESTED_FIXTURE');
  await writeFile(path.join(directory, '.env'), 'DO_NOT_SERVE_TEST_FIXTURE');
  await writeFile(path.join(directory, 'manifest.webmanifest'), JSON.stringify({ scope: `${basePath}/` }));
  return directory;
}
async function start(directory, options = {}) {
  const result = await launchWeb({ directory, port: 0, ...options });
  if (result.server) servers.push(result.server);
  return result;
}
function request(server, route, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, ...options }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: chunks.map(chunk => chunk.toString('utf8')).join('') }));
    });
    request.on('error', reject);
    request.end();
  });
}

describe('Explicit loopback web launcher', () => {
  it.each(['', '/onepercent'])('serves assets, callback query and SPA bookmarks at base %s', async basePath => {
    const opened = vi.fn(), { server, url } = await start(await fixture(basePath), { open: true, openUrl: opened });
    expect(server.address().address).toBe('127.0.0.1');
    expect(url).toMatch(new RegExp(`^http://localhost:\\d+${basePath}/$`));
    expect(opened).toHaveBeenCalledExactlyOnceWith(url);
    expect((await request(server, `${basePath}/notes/fixture-id?tab=paper`)).body).toContain('1% fixture');
    expect((await request(server, `${basePath}/auth/callback?code=TEST_ONLY_CODE&state=TEST_STATE`)).body).toContain('Callback fixture');
    expect((await request(server, `${basePath}/auth/callback/?code=TEST_ONLY_CODE`)).status).toBe(200);
    const asset = await request(server, `${basePath}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.headers['cache-control']).toBe('no-store');
    expect(asset.headers['referrer-policy']).toBe('no-referrer');
    const font = await request(server, `${basePath}/assets/node_modules/.pnpm/vector-icons/Fonts/icons.ttf`);
    expect(font.body).toBe('PUBLIC_EXPO_FONT');
    expect(font.headers['content-type']).toBe('font/ttf');
    const head = await request(server, `${basePath}/assets/app.js`, { method: 'HEAD' });
    expect(head.body).toBe('');
    expect(head.headers['content-length']).toBe(asset.headers['content-length']);
    expect((await request(server, `${basePath}/assets/missing.js`)).status).toBe(404);
    if (basePath) expect((await request(server, '/auth/callback')).status).toBe(404);
  });

  it('rejects foreign hosts, writes, malformed paths and hidden files', async () => {
    const opened = vi.fn(), { server } = await start(await fixture(), { openUrl: opened });
    expect(opened).not.toHaveBeenCalled();
    expect((await request(server, '/', { headers: { Host: 'unrelated.example' } })).status).toBe(403);
    const post = await request(server, '/', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
    expect((await request(server, '/%E0%A4')).status).toBe(400);
    for (const route of ['/.env', '/%2eenv', '/assets/..%5c.env', '/%00', '/assets/%2e%2e%2f.env', '/assets/node_modules/.pnpm/.env', '/assets/.pnpm/private.ttf'])
      expect((await request(server, route)).status).toBe(403);
  });

  it('reuses only the identical app and build, without starting another server', async () => {
    const directory = await fixture(), first = await start(directory);
    const port = first.server.address().port, opened = vi.fn();
    const second = await start(directory, { port, open: true, openUrl: opened });
    expect(second).toMatchObject({ alreadyRunning: true, server: null, sha256: first.sha256, url: first.url });
    expect(opened).toHaveBeenCalledExactlyOnceWith(first.url);
    const marker = JSON.parse((await request(first.server, MARKER_PATH)).body);
    expect(marker).toEqual({ app: SERVER_MARKER, sha256: first.sha256, basePath: '' });
  });

  it('detects changed bundle bytes and keeps the running build immutable', async () => {
    const directory = await fixture(), first = await start(directory);
    const port = first.server.address().port, opened = vi.fn();
    const initialAsset = (await request(first.server, '/assets/app.js')).body;
    await writeFile(path.join(directory, 'assets/app.js'), 'console.log("a different build");');
    const newBuild = await loadWebBuild({ directory });
    expect(newBuild.sha256).not.toBe(first.sha256);
    expect(await identifyExistingServer(port, newBuild)).toBe('outdated');
    await expect(start(directory, { port, open: true, openUrl: opened })).rejects.toThrow('build diversa');
    expect(opened).not.toHaveBeenCalled();
    expect((await request(first.server, '/assets/app.js')).body).toBe(initialAsset);
  });

  it('refuses another server or a legacy server without a marker without opening it', async () => {
    const other = http.createServer((_request, response) => response.writeHead(200, { 'Content-Type': 'text/html' }).end('Another app'));
    await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
    servers.push(other);
    const opened = vi.fn();
    await expect(start(await fixture(), { port: other.address().port, open: true, openUrl: opened })).rejects.toThrow('occupata');
    expect(opened).not.toHaveBeenCalled();
    expect((await request(other, '/')).body).toBe('Another app');
  });

  it('fails clearly before binding if the build is absent or the base path differs', async () => {
    const empty = await temporaryDirectory();
    await expect(loadWebBuild({ directory: path.join(empty, 'missing') })).rejects.toThrow('Build web non trovata');
    await expect(loadWebBuild({ directory: empty })).rejects.toThrow('Build web incompleta');
    await expect(start(await fixture('/repo'), { basePath: '' })).rejects.toThrow('non corrisponde');
    await expect(start(await fixture(), { port: 65536 })).rejects.toThrow('PORT');
  });

  it('a separate process hands off to the existing instance and then exits', async () => {
    const directory = await fixture(), first = await start(directory);
    const moduleUrl = new URL('../scripts/serve-web.mjs', import.meta.url).href;
    const code = `import { launchWeb } from ${JSON.stringify(moduleUrl)}; await launchWeb(${JSON.stringify({ directory, port: first.server.address().port })});`;
    const child = await execute(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, timeout: 5000 });
    expect(child.stdout).toContain('stessa build');
    expect(child.stderr).toBe('');
    expect((await request(first.server, '/')).status).toBe(200);
  });

  it('CLI rejects invalid options without starting a server', async () => {
    const script = fileURLToPath(new URL('../scripts/serve-web.mjs', import.meta.url));
    await expect(execute(process.execPath, [script, '--unknown'], { windowsHide: true, timeout: 5000 })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Opzione non riconosciuta') });
    await expect(execute(process.execPath, [script], { env: { ...process.env, PORT: '0' }, windowsHide: true, timeout: 5000 })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('PORT') });
  });

  it.skipIf(process.platform !== 'win32')('Windows double-click entry passes the right script and --open from a path with spaces', async () => {
    const temporary = await temporaryDirectory(), directory = path.join(temporary, 'App con spazi & simboli');
    await mkdir(path.join(directory, 'frontend/scripts'), { recursive: true });
    const launcher = await readFile(new URL('../../Apri-1percent.cmd', import.meta.url), 'utf8');
    await writeFile(path.join(directory, 'Apri-1percent.cmd'), launcher);
    // This isolated stand-in records startup only; it never opens a real browser.
    await writeFile(path.join(directory, 'frontend/scripts/serve-web.mjs'), 'console.log(JSON.stringify({ args: process.argv.slice(2), port: process.env.PORT, cwd: process.cwd() }));');
    const result = await execute('cmd.exe', ['/d', '/c', 'Apri-1percent.cmd'], {
      cwd: directory, windowsHide: true, timeout: 5000,
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` },
    });
    const recorded = JSON.parse(result.stdout.trim());
    expect(recorded).toEqual({ args: ['--open'], port: '8081', cwd: directory });
    expect(result.stderr).toBe('');
  });
});
