// Service worker: interfaz en caché (se actualiza en segundo plano), datos "red primero",
// audios/imágenes "caché primero" (sus nombres son únicos). Los mosaicos del mapa NO se guardan.
importScripts('files-list.js');
const VERSION = 'v1';
const CACHE_APP = `audioguia-app-${VERSION}`;
const CACHE_MEDIOS = 'audioguia-medios-v1';
const CACHE_DATOS = 'audioguia-datos-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(CACHE_APP).then((c) => c.addAll(self.APP_FILES)),
    // Copia de los datos para poder abrir sin conexión aunque la primera carga no pasara por el SW.
    caches.open(CACHE_DATOS).then((c) => fetch('data/project.json', { cache: 'no-cache' }).then((r) => r.ok && c.put(new URL('data/project.json', self.registration.scope).pathname, r))).catch(() => {}),
  ]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('audioguia-app-') && k !== CACHE_APP).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // mosaicos y demás: directo a la red
  if (req.headers.has('range')) return; // pedidos parciales de audio: los maneja el navegador
  const ruta = url.pathname;
  if (ruta.endsWith('/data/project.json')) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE_DATOS).then((k) => k.put(url.pathname, c)); } return r; })
      .catch(() => caches.match(url.pathname, { cacheName: CACHE_DATOS }).then((r) => r || Response.error())));
    return;
  }
  if (ruta.includes('/data/media/')) {
    e.respondWith(caches.match(req, { cacheName: CACHE_MEDIOS, ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }
  // Interfaz: stale-while-revalidate
  e.respondWith(caches.open(CACHE_APP).then(async (c) => {
    const enCache = await c.match(req, { ignoreSearch: true });
    const red = fetch(req).then((r) => { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; }).catch(() => enCache || Response.error());
    return enCache || red;
  }));
});
