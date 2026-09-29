import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function normaliseBasePath(input = '') {
  const value = input.trim().replace(/^\/+|\/+$/g, '');
  if (!value) return '';
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value))
    throw new Error(
      'EXPO_PUBLIC_BASE_PATH must be a path such as /repository, without a host, query or traversal.',
    );
  return `/${value}`;
}

export async function packagePages({
  directory = 'dist',
  basePath = process.env.EXPO_PUBLIC_BASE_PATH || '',
} = {}) {
  const output = path.resolve(directory),
    base = normaliseBasePath(basePath),
    scope = `${base}/`;
  let html = await readFile(path.join(output, 'index.html'), 'utf8');
  if (!/<head[^>]*>/i.test(html) || !/<\/head>/i.test(html))
    throw new Error('Expo export did not contain a valid HTML document.');
  if (base && /(?:src|href)=["']\/(?:_expo|assets)\//.test(html))
    throw new Error(
      'Build Expo with the same EXPO_PUBLIC_BASE_PATH before packaging GitHub Pages.',
    );
  // Keep the callback query intact. A static directory handles Google return paths;
  // the 404 copy also supports bookmarks to dynamic note routes without a redirect.
  const head = `<meta name="theme-color" content="#4c1d95"><meta name="referrer" content="no-referrer"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><link rel="manifest" href="${scope}manifest.webmanifest"><link rel="apple-touch-icon" href="${scope}icons/apple-touch-icon.png"><link rel="icon" type="image/svg+xml" href="${scope}icons/icon.svg">`;
  html = html
    .replace(
      /<meta\b[^>]*name=["'](?:theme-color|referrer|apple-mobile-web-app-capable|apple-mobile-web-app-status-bar-style)["'][^>]*>/gi,
      '',
    )
    .replace(/<link\b[^>]*rel=["'](?:manifest|apple-touch-icon|icon)["'][^>]*>/gi, '')
    .replace(/<\/head>/i, `${head}</head>`);
  const manifest = {
    id: scope,
    name: '1%',
    short_name: '1%',
    description: 'Your plans, notes, school and money in a private workspace.',
    start_url: scope,
    scope,
    display: 'standalone',
    background_color: '#F6F7F3',
    theme_color: '#4c1d95',
    lang: 'en-GB',
    icons: [192, 512].map((size) => ({
      src: `${scope}icons/icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any maskable',
    })),
  };
  for (const name of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'icon.svg'])
    await access(path.join(output, 'icons', name));
  await access(path.join(output, 'service-worker.js'));
  await mkdir(path.join(output, 'auth', 'callback'), { recursive: true });
  await Promise.all([
    writeFile(path.join(output, 'index.html'), html),
    writeFile(path.join(output, '404.html'), html),
    writeFile(path.join(output, 'auth', 'callback', 'index.html'), html),
    writeFile(path.join(output, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(path.join(output, '.nojekyll'), ''),
    writeFile(path.join(output, '_redirects'), `${scope}* ${scope}index.html 200\n`),
  ]);
  return { basePath: base, callbackPath: `${scope}auth/callback/`, directory: output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await packagePages();
  console.log(
    `Pages artifact ready at ${result.directory}; base path ${result.basePath || '/'}. Nothing was published.`,
  );
}
