// Service worker – offline működéshez. A JT AppKreator készítette.
// FONTOS: ha bármelyik fájlt módosítod, emeld meg a VERZIO értékét (az app-update.bat ezt megteszi),
// különben a telepített app a régi fájlokat használja tovább.

const VERZIO = 'hangjegyzetpwa-v1.00';

const FAJLOK = [
  './',
  'css/style.css',
  'ikon/ikon-192.png',
  'ikon/ikon-512.png',
  'ikon/ikon-maskable-512.png',
  'index.html',
  'js/app.js',
  'js/telepites.js',
  'manifest.json'
];

// Telepítéskor: minden fájl a gyorsítótárba.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERZIO).then(c => c.addAll(FAJLOK)));
  self.skipWaiting();
});

// Aktiváláskor: a régi verziók gyorsítótárának törlése.
self.addEventListener('activate', e => {
  e.waitUntil(
  caches.keys().then(kulcsok =>
    Promise.all(kulcsok.filter(k => k !== VERZIO).map(k => caches.delete(k)))
  )
  );
  self.clients.claim();
});

// Kéréskor: előbb a gyorsítótár, ha nincs benne, akkor a hálózat.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
  caches.match(e.request).then(talalat => talalat || fetch(e.request))
  );
});
