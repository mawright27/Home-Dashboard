/* ══════════════════════════════════════════════════════════════
   Service worker

   Shell files are cached so the dashboard still draws after a
   router reboot or power cut. Data requests (Firebase, weather)
   always try the network first and fall back to the last copy.

   Bump CACHE_VERSION whenever you change index/styles/app —
   otherwise the panel will keep showing the old build.
   ══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'dash-v13';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;

const SHELL = [
  './',
  './index.html',
  './list.html',
  './list.css',
  './list.js',
  './list-manifest.json',
  './icon-list-192.png',
  './icon-list-512.png',
  './styles.css',
  './app.js',
  './config.js',
  './firebase-config.js',
  './store.js',
  './calendar.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Live data — always try the network, fall back to the last good copy.
const DATA_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'openweathermap.org'
];

// Fonts and the Firebase SDK are shell: cache them so the panel
// still draws with the right typeface after a router reboot.
const SHELL_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

// Never cache the Google auth/API surface.
const NEVER_CACHE = ['accounts.google.com', 'www.googleapis.com', 'oauth2.googleapis.com', 'docs.google.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(CACHE_VERSION))
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Auth traffic must never be replayed from cache.
  if (url.pathname.includes('/__/auth/')) return;
  if (NEVER_CACHE.includes(url.hostname)) return;

  const isShellHost = SHELL_HOSTS.includes(url.hostname);
  const isData = !isShellHost && DATA_HOSTS.some(h => url.hostname.endsWith(h));

  if (isData){
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(req){
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (err){
    const hit = await cache.match(req);
    if (hit) return hit;
    return new Response(JSON.stringify({ offline:true }), {
      status: 503,
      headers: { 'Content-Type':'application/json' }
    });
  }
}

// Fonts and shell: draw instantly from cache, refresh in the background.
async function staleWhileRevalidate(req){
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch:false });

  const network = fetch(req)
    .then(res => {
      if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (hit) return hit;

  const res = await network;
  if (res) return res;

  // Nothing cached, no network: for a navigation, show the shell we have.
  if (req.mode === 'navigate'){
    const shell = await cache.match(
      req.url.includes('list.html') ? './list.html' : './index.html');
    if (shell) return shell;
  }
  return new Response('', { status:504, statusText:'Offline' });
}

// Lets you force an update from the page if you ever want to:
//   navigator.serviceWorker.controller.postMessage({ type:'SKIP_WAITING' })
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
