const CACHE = 'mindvault-v2';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== 'mindvault-data').map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

self.addEventListener('periodicsync', e => {
  if (e.tag === 'mindvault-daily-reminder') {
    e.waitUntil(showPeriodicReminder());
  }
});

async function showPeriodicReminder() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.some(c => c.visibilityState === 'visible')) return;
  try {
    const cache = await caches.open('mindvault-data');
    const resp = await cache.match('reminder-data');
    if (!resp) return;
    const data = await resp.json();
    if (!data.enabled || data.activeCount === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    if (data.lastShown === today) return;
    const [h, m] = data.time.split(':').map(Number);
    const now = new Date();
    if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return;
    const n = data.activeCount;
    const word = n === 1 ? 'мысль' : n < 5 ? 'мысли' : 'мыслей';
    await self.registration.showNotification('MindVault', {
      body: `${n} незакрытых ${word} ждут тебя`,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'daily-reminder',
      renotify: true
    });
  } catch(e) {}
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});
