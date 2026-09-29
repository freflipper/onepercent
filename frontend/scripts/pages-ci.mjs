import path from 'node:path';
import { appendFile, readFile, readdir, lstat, access } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import { normaliseBasePath } from './package-pages.mjs';

export function resolvePagesBasePath({ detected, override = 'auto' } = {}) {
  if (override === 'auto' || override === '') {
    if (typeof detected !== 'string')
      throw new Error('Pages metadata is missing. Enable GitHub Actions as the Pages publishing source.');
    return normaliseBasePath(detected);
  }
  return normaliseBasePath(override);
}

export function validatePublicConfiguration({ url, key } = {}) {
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(url))
    throw new Error('Set EXPO_PUBLIC_SUPABASE_URL to the HTTPS Supabase project origin in repository variables.');
  if (typeof key !== 'string' || key !== key.trim())
    throw new Error('Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to a public project key in repository variables.');
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  try {
    const parts = key.split('.');
    if (parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part)) &&
        JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'anon') return;
  } catch { /* Invalid JWTs fail the same public-key check without logging their contents. */ }
  throw new Error('Only a publishable key or legacy anon key may enter the public build. Never use a secret or service-role key.');
}

export async function verifyPagesArtifact({ directory = 'dist', maxBytes = 1_000_000_000 } = {}) {
  let bytes = 0, files = 0;
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const metadata = await lstat(path.join(directory, name));
      if (metadata.isSymbolicLink() || (metadata.isFile() && metadata.nlink > 1))
        throw new Error(`Pages artifact must not contain links: ${name}`);
      const allowedDotEntry = name === '.nojekyll' || name === 'assets/node_modules/.pnpm';
      if (entry.name.startsWith('.') && !allowedDotEntry)
        throw new Error(`Unexpected hidden file or directory in public artifact: ${name}`);
      if (/\.(?:pem|key|p12|pfx)$/i.test(entry.name))
        throw new Error(`Private credential file is not allowed in public artifact: ${name}`);
      if (metadata.isDirectory()) await visit(name);
      else if (metadata.isFile()) {
        bytes += metadata.size; files++;
        if (bytes > maxBytes) throw new Error('Pages artifact exceeds the 1 GB published-site limit.');
      } else throw new Error(`Unsupported artifact entry: ${name}`);
    }
  }
  await visit();
  for (const file of ['index.html', '404.html', 'auth/callback/index.html', 'manifest.webmanifest', 'service-worker.js', '.nojekyll'])
    await access(path.join(directory, file));
  const html = await readFile(path.join(directory, 'index.html'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.webmanifest'), 'utf8'));
  const base = normaliseBasePath(manifest.scope);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const link = match[1];
    if (!link.startsWith(`${base}/`) || /^(?:https?:)?\/\//.test(link)) continue;
    const relative = decodeURIComponent(link.slice(base.length + 1).split(/[?#]/)[0]);
    const target = path.resolve(directory, relative), root = path.resolve(directory);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Artifact link escapes the output directory.');
    await access(target);
  }
  return { files, bytes, basePath: base };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const command = process.argv[2];
    if (command === 'configure') {
      validatePublicConfiguration({ url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
      const base = resolvePagesBasePath({ detected: process.env.PAGES_DETECTED_BASE_PATH, override: process.env.PAGES_BASE_PATH_OVERRIDE });
      if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV is required for this CI configuration step.');
      await appendFile(process.env.GITHUB_ENV, `EXPO_PUBLIC_BASE_PATH=${base}\n`);
      console.log(`Pages base path: ${base || '/'}. Public configuration validated without displaying key values.`);
    } else if (command === 'verify') {
      const result = await verifyPagesArtifact();
      console.log(`Pages artifact checked: ${result.files} files, ${result.bytes} bytes, base ${result.basePath || '/'}.`);
    } else throw new Error('Use node scripts/pages-ci.mjs configure|verify.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Pages configuration failed.');
    process.exitCode = 1;
  }
}
