// public/sw.js
// Service worker mínimo de Folvy.
//
// Su único objetivo aquí es cumplir el requisito de Chrome/Android para que la
// app sea INSTALABLE (mostrar el prompt "Instalar app" / "Añadir a pantalla de
// inicio"): hace falta un service worker registrado con un handler de 'fetch'.
//
// NO implementa caché offline agresiva a propósito: la app es de gestión en vivo
// (datos de Supabase en tiempo real), y cachear respuestas podría mostrar datos
// obsoletos. Si en el futuro se quiere modo offline, se añade aquí una estrategia
// de caché controlada (network-first para datos, cache-first para estáticos).

self.addEventListener('install', (event) => {
  // Activar de inmediato la nueva versión sin esperar a que se cierren pestañas.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Tomar control de las páginas abiertas cuanto antes.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Passthrough: dejamos pasar todas las peticiones a la red tal cual.
  // (La presencia de este handler es lo que Chrome exige para "instalable".)
  // No interceptamos ni cacheamos: la app necesita datos frescos del servidor.
  return;
});
