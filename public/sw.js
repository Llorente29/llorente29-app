// public/sw.js
// Service worker mínimo de Folvy.
//
// Objetivo: cumplir el requisito de Chrome/Android para que la app sea
// INSTALABLE (mostrar el prompt nativo "Instalar app"). Chrome exige un service
// worker registrado con un handler de 'fetch' QUE NO ESTÉ VACÍO: ignora los
// handlers no-op (un `return;` sin `event.respondWith(...)` cuenta como vacío)
// para castigar el truco de "handler hueco solo para aprobar el examen". Por eso
// aquí el handler llama de verdad a event.respondWith().
//
// NO implementa caché offline a propósito: la app es de gestión en vivo (datos
// de Supabase en tiempo real), y cachear respuestas mostraría datos obsoletos.
// El handler es un PASSTHROUGH real a la red. Si en el futuro se quiere modo
// offline, se añade aquí una estrategia de caché controlada.

self.addEventListener('install', () => {
  // Activar de inmediato la nueva versión sin esperar a que se cierren pestañas.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Tomar control de las páginas abiertas cuanto antes.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return; // URL no parseable → que lo resuelva el navegador
  }

  // Solo gestionamos GET del MISMO ORIGEN (el shell de la app + estáticos).
  // Todo lo demás se deja pasar SIN tocar:
  //   · API de Supabase (cross-origin) → datos siempre frescos, sin caché.
  //   · POST/PUT/DELETE → no se reescriben.
  //   · WebSocket del realtime → el evento 'fetch' ni siquiera se dispara para
  //     el upgrade ws/wss, así que el tiempo real no se ve afectado.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return; // sin respondWith → comportamiento normal del navegador
  }

  // Passthrough REAL a la red. Llamar a respondWith con una respuesta de red
  // hace que Chrome considere el handler "no vacío" → la app es INSTALABLE.
  // No cacheamos: pedimos a la red tal cual.
  event.respondWith(fetch(req));
});
