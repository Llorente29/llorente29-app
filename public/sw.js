// public/sw.js
// Service worker de Folvy — instalable + anti-bundle-viejo.
//
// Bump de versión para forzar byte-diff y que el navegador instale este SW.
const SW_VERSION = 'folvy-2026-07-03-checkout-fresh-lines';

// Objetivo: cumplir el requisito de Chrome/Android para que la app sea
// INSTALABLE (handler 'fetch' que llama de verdad a event.respondWith), y a la
// vez GARANTIZAR que nunca se sirve un index.html antiguo (que apuntaría a
// assets con hash viejo → marca/bundle obsoletos).
//
// NO hay caché offline a propósito: la app es de gestión en vivo (Supabase en
// tiempo real). El documento va SIEMPRE a red fresca; los estáticos con hash
// (immutables) van passthrough.

self.addEventListener('install', () => {
  // Activa de inmediato la nueva versión sin esperar a cerrar pestañas.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Purga CUALQUIER caché dejada por versiones anteriores del SW (si en algún
    // momento hubo un sw.js que cacheaba el shell, esto lo limpia de raíz para
    // los usuarios ya instalados).
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      // sin caches API o sin permisos → no bloquea
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return; // URL no parseable → que lo resuelva el navegador
  }

  // Solo GET del MISMO ORIGEN. Lo demás (Supabase cross-origin, POST/PUT/DELETE,
  // upgrade ws/wss) se deja pasar sin tocar → tiempo real intacto.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // DOCUMENTO / NAVEGACIÓN → red fresca SIN caché HTTP. Evita servir un
  // index.html viejo que referencie assets con hash antiguo. Si la red falla,
  // se intenta un fetch normal como último recurso.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => fetch(req))
    );
    return;
  }

  // Estáticos del mismo origen (JS/CSS con hash, immutables) → passthrough.
  event.respondWith(fetch(req));
});
