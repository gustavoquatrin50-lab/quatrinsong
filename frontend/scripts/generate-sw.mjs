import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const walk = (dir) =>
  readdirSync(root + dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`],
  );
const files = walk("").filter((f) => f !== "sw.js" && !f.endsWith(".map"));
const hash = createHash("sha256");
for (const file of files) hash.update(readFileSync(root + file));
const name = `riffsync-${hash.digest("hex").slice(0, 12)}`;
writeFileSync(
  root + "sw.js",
  `const CACHE=${JSON.stringify(name)};
const FILES=${JSON.stringify(files.map((f) => "./" + f))};
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('riffsync-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match(new URL('./index.html', self.location.href)))); return; }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
`,
);
