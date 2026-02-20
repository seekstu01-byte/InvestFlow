// AURUM Service Worker v2.4
const CACHE_NAME = 'aurum-v2.4';
const RUNTIME_CACHE = 'aurum-runtime';

// 需要快取的靜態資源
const STATIC_ASSETS = [
  '/',
  '/landing.html',
  '/app.html',
  '/manifest.json'
];

// 安裝事件 - 快取靜態資源
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// 激活事件 - 清理舊快取
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch 事件 - 網路優先，失敗時使用快取
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跳過 Chrome extensions 和非 http(s) 請求
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 跳過 Google Apps Script API 呼叫（這些必須連網）
  if (url.hostname.includes('script.google.com') || 
      url.hostname.includes('googleapis.com')) {
    return event.respondWith(fetch(request));
  }

  // 靜態資源：快取優先
  if (STATIC_ASSETS.some(asset => url.pathname.includes(asset))) {
    event.respondWith(
      caches.match(request)
        .then(response => {
          if (response) {
            console.log('[SW] Serving from cache:', url.pathname);
            return response;
          }
          return fetch(request).then(response => {
            // 快取新的回應
            return caches.open(CACHE_NAME).then(cache => {
              cache.put(request, response.clone());
              return response;
            });
          });
        })
    );
    return;
  }

  // 其他請求：網路優先，失敗時使用快取
  event.respondWith(
    fetch(request)
      .then(response => {
        // 快取成功的回應
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 網路失敗，嘗試從快取取得
        return caches.match(request).then(response => {
          if (response) {
            console.log('[SW] Network failed, serving from cache:', url.pathname);
            return response;
          }
          // 如果是頁面請求且沒有快取，返回離線頁面
          if (request.mode === 'navigate') {
            return caches.match('/landing.html');
          }
          return new Response('離線中，無法載入此資源', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        });
      })
  );
});

// 訊息事件 - 允許頁面控制 Service Worker
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(name => caches.delete(name))
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});

// 推播通知支援（未來可用）
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : '您有新的通知',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [200, 100, 200]
  };
  
  event.waitUntil(
    self.registration.showNotification('AURUM', options)
  );
});
