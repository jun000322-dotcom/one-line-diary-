// 한 줄 일기 서비스 워커: 오프라인에서도 앱 화면이 열리게 합니다.
// - 앱 파일(같은 출처)은 네트워크를 먼저 쓰고, 실패하면 캐시로 대신합니다. 그래서 새 버전이 올라가면 바로 반영됩니다.
// - 뉴스·번역 같은 외부 요청은 건드리지 않습니다.
// 캐시할 파일 목록을 바꾸면 CACHE 버전을 올립니다.
const CACHE = 'one-line-diary-app-v1';
const FILES = ['./', './index.html', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })
      .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
