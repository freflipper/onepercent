import http from 'node:http';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normaliseBasePath } from './package-pages.mjs';

export const SERVER_MARKER = 'onepercent-emergent-web-v1';
export const MARKER_PATH = '/__onepercent_emergent_web__';
const defaultDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
};
function privatePath(relative) {
  const parts = relative.replace(/^\//, '').split('/');
  // Expo preserves pnpm's directory name in published font and image paths.
  return parts.some((part, index) => part.startsWith('.') &&
    !(part === '.pnpm' && index === 2 && parts[0] === 'assets' && parts[1] === 'node_modules'));
}

export async function loadWebBuild({ directory = defaultDirectory, basePath } = {}) {
  const files = new Map();
  async function visit(relative = '') {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries) {
      // The public export must not expose dotfiles or follow links outside dist.
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (privatePath(name)) continue;
      if (entry.isSymbolicLink()) throw new Error(`La build contiene un collegamento non supportato: ${name}`);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.set(`/${name}`, await readFile(path.join(directory, name)));
    }
  }
  try { await visit(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Build web non trovata. Dalla cartella frontend esegui pnpm build:web, poi riapri Apri-1percent.cmd.');
  }
  if (!files.has('/index.html') || !files.has('/manifest.webmanifest'))
    throw new Error('Build web incompleta. Dalla cartella frontend esegui pnpm build:web.');
  const manifest = JSON.parse(files.get('/manifest.webmanifest').toString('utf8'));
  if (typeof manifest.scope !== 'string') throw new Error('Il manifest della build non indica il percorso di base. Ricompila con pnpm build:web.');
  const base = normaliseBasePath(manifest.scope);
  if (basePath !== undefined && normaliseBasePath(basePath) !== base)
    throw new Error('EXPO_PUBLIC_BASE_PATH non corrisponde alla build. Usa il percorso compilato oppure ricompila prima di avviare.');
  const hash = createHash('sha256').update(JSON.stringify([SERVER_MARKER, base]));
  for (const [name, body] of [...files].sort(([a], [b]) => a.localeCompare(b)))
    hash.update(JSON.stringify([name, body.length])).update(body);
  // Keep one immutable snapshot so a rebuild cannot mix bundles in this process.
  return { files, basePath: base, sha256: hash.digest('hex') };
}

export function createWebServer(build) {
  const marker = Buffer.from(JSON.stringify({ app: SERVER_MARKER, sha256: build.sha256, basePath: build.basePath }));
  const server = http.createServer((req, res) => {
    const port = server.address()?.port;
    if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(req.headers.host)) {
      res.writeHead(403, headers).end(); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end(); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400, headers).end(); return; }
    if (pathname.includes('\\') || pathname.includes('\0')) {
      res.writeHead(403, headers).end(); return;
    }
    let body, contentType;
    if (pathname === MARKER_PATH) {
      body = marker; contentType = types['.json'];
    } else {
      const base = build.basePath;
      if (base && pathname !== base && !pathname.startsWith(`${base}/`)) {
        res.writeHead(404, headers).end(); return;
      }
      const relative = pathname.slice(base.length) || '/';
      if (privatePath(relative)) { res.writeHead(403, headers).end(); return; }
      body = build.files.get(relative);
      let file = relative;
      if (!body && !path.posix.extname(relative)) {
        file = relative.replace(/\/$/, '') + '/index.html';
        body = build.files.get(file);
        if (!body) { file = '/index.html'; body = build.files.get(file); }
      }
      if (!body) { res.writeHead(404, headers).end(); return; }
      contentType = types[path.posix.extname(file)] || 'application/octet-stream';
    }
    res.writeHead(200, { ...headers, 'Content-Type': contentType, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return server;
}

export async function identifyExistingServer(port, expected) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${MARKER_PATH}`, {
      signal: AbortSignal.timeout(1500), redirect: 'error',
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return 'other';
    const marker = await response.json();
    if (marker?.app !== SERVER_MARKER) return 'other';
    return marker.sha256 === expected.sha256 && marker.basePath === expected.basePath ? 'same' : 'outdated';
  } catch { return 'other'; }
}

function openBrowser(url) {
  // Only the explicit --open launcher action opens a browser. There is no autorun.
  if (process.platform !== 'win32') { console.log(`Apri nel browser: ${url}`); return; }
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url.replace(/'/g, "''")}'`], { stdio: 'ignore', windowsHide: true });
  const manual = () => console.log(`Apri manualmente ${url}`);
  child.on('error', manual);
  child.on('exit', code => { if (code) manual(); });
}

export async function launchWeb({ directory, basePath, port = 8081, open = false, openUrl = openBrowser } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT deve essere un numero intero fra 1 e 65535.');
  const build = await loadWebBuild({ directory, basePath });
  const server = createWebServer(build);
  try {
    await new Promise((resolve, reject) => {
      const fail = error => { server.removeListener('listening', ready); reject(error); };
      const ready = () => { server.removeListener('error', fail); resolve(); };
      server.once('error', fail);
      server.once('listening', ready);
      server.listen(port, '127.0.0.1');
    });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const existing = await identifyExistingServer(port, build);
    if (existing !== 'same') throw new Error(existing === 'outdated'
      ? `Sulla porta ${port} è aperta una build diversa di 1%. Chiudi la sua console con Ctrl+C e riapri Apri-1percent.cmd. La vecchia build non è stata aperta.`
      : `La porta ${port} è occupata da un altro programma o da un server 1% precedente senza identificazione. Chiudi manualmente la sua console prima di riprovare. Nessun processo è stato arrestato e la porta non è stata cambiata.`);
    const url = `http://localhost:${port}${build.basePath}/`;
    console.log(`Questa stessa build di 1% è già aperta nella sua console: ${url}`);
    if (open) openUrl(url);
    return { alreadyRunning: true, server: null, sha256: build.sha256, url };
  }
  const url = `http://localhost:${server.address().port}${build.basePath}/`;
  console.log(`1% disponibile su ${url}\nMantieni aperta questa console. Ctrl+C arresta il server.\nGoogle, dati e allegati richiedono Internet e usano Supabase.\nBuild SHA-256: ${build.sha256.slice(0, 16)}…`);
  if (open) openUrl(url);
  return { alreadyRunning: false, server, sha256: build.sha256, url };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--open')) throw new Error('Opzione non riconosciuta. Usa node scripts/serve-web.mjs [--open].');
    const port = process.env.PORT === undefined ? 8081 : Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve essere un numero intero fra 1 e 65535.');
    await launchWeb({ port, basePath: process.env.EXPO_PUBLIC_BASE_PATH, open: args.includes('--open') });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Avvio non riuscito.');
    process.exitCode = 1;
  }
}
