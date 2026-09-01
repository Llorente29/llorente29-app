# RECON — El service worker y el bundle viejo

**01/09/2026.** Síntoma: en incógnito el arreglo se ve, en el navegador normal no. Y la tablet
«Cocina» lleva en el bundle 185 desde el 27/08. Sospecha de partida: `sw.js` sirviendo assets
viejos.

**Adelanto: el `sw.js` no cachea nada.** La sospecha de partida no se sostiene, y la causa más
probable es otra y más simple. Lo que sigue es lo medido.

---

## 1 · Cómo se registra

`src/main.tsx:105-112`:

```js
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] No se pudo registrar el service worker:', err)
    })
  })
}
```

Lo que **no** hay, y es la mitad del RECON:

- Ni `registration.update()` en ningún sitio.
- Ni `updatefound`, ni `controllerchange`, ni `statechange`.
- Ni `updateViaCache`.
- **Ni un solo mecanismo que le diga a la app «hay una versión nueva».** Búsqueda hecha:
  `location.reload()` aparece 2 veces en todo `src/`, y las dos son de otra cosa (el botón de
  reintentar del error boundary y el login).
- Un fallo al registrar termina en `console.warn`. Nadie lo ve.

## 2 · Qué cachea

**Nada.** `grep` sobre `public/sw.js`: cero `caches.put`, cero `caches.open`, cero `cache.add`.
Lo único que hace con la Cache API es **borrarla entera** en cada `activate`.

## 3 · Con qué estrategia

| Petición | Qué hace |
|---|---|
| No-GET, o de otro origen (Supabase, ws) | Passthrough sin `respondWith` — tiempo real intacto |
| Navegación / documento | `fetch(req, { cache: 'no-store' })` → **red fresca, salta el caché HTTP** |
| Resto de GET del mismo origen (JS/CSS con hash) | `event.respondWith(fetch(req))` → fetch normal, **sí usa el caché HTTP** |

`install` hace `skipWaiting()`; `activate` borra todas las cachés y hace `clients.claim()`.

## 4 · Por qué no se renueva al desplegar

Aquí están los dos hallazgos.

### 4.a · El servidor está bien. Medido, no supuesto

Cabeceras reales de producción (`folvy-app.vercel.app`, 01/09 05:39):

| Recurso | `cache-control` |
|---|---|
| `/sw.js` | `public, max-age=0, must-revalidate` |
| `/index.html` | `public, max-age=0, must-revalidate` |

Las dos correctas: el navegador revalida en cada carga. **No es un problema de cabeceras.**
`vercel.json` no declara ninguna, así que esto es el defecto de Vercel y es el bueno.

Y producción está al día: el último despliegue con `target: production` es `be64527` (el mosaico
del Inicio), de las 05:25 de hoy. **No hay retraso de despliegue.**

### 4.b · El `sw.js` no cambia nunca

El fichero se renueva **solo si alguien sube a mano `SW_VERSION`**. Lo dice él mismo:

```js
// Bump de versión para forzar byte-diff y que el navegador instale este SW.
const SW_VERSION = 'folvy-2026-07-03-free-item-gift';
```

- El valor apunta al **3 de julio**.
- El fichero se tocó por última vez el **22/08** (commit `5284ec6`), hace 9 días.
- Desde entonces han entrado **124 commits en main**.

O sea: 124 despliegues sirviendo un `sw.js` byte a byte idéntico. El navegador lo revalida, ve que
no ha cambiado, y **no instala nada**. `activate` no vuelve a ejecutarse, así que la purga de
cachés heredadas tampoco.

Esto importa menos de lo que parece —porque el SW actual no cachea— pero deja el mecanismo de
renovación muerto para el día que sí haga falta.

## 5 · La causa más probable del síntoma, y no es el SW

Con lo anterior medido, la explicación que encaja con TODO:

> **Nada obliga a la app a volver a pedir `index.html`.**

Folvy es una SPA. El documento se pide **una vez**, al cargar la pestaña. A partir de ahí se
navega por rutas internas, que no son navegaciones del navegador: no hay nuevo `fetch` del
documento, y por tanto no se leen los nuevos hashes de `/assets/index-<hash>.js`. El JS viejo
sigue vivo en memoria mientras la pestaña siga abierta.

Eso explica las dos observaciones sin necesidad de ningún caché:

- **Incógnito sí / normal no.** Incógnito es una pestaña nueva: pide `index.html`, se lleva los
  hashes nuevos. La pestaña normal llevaba abierta desde antes del despliegue.
- **La tablet de Cocina en el bundle 185 desde el 27/08.** Es el caso extremo del mismo
  mecanismo: una pestaña que **nunca se cierra ni se recarga**. Cinco días sin volver a pedir el
  documento. Y como no hay `registration.update()` ni aviso de versión nueva, nada la va a sacar
  de ahí salvo que alguien la recargue a mano.

**Predicción que lo confirma o lo tumba**, y es barata: en el navegador normal, sin borrar nada,
un **recargar normal** (F5) debería bastar para ver el arreglo. Si con F5 aparece, es esto y el SW
es inocente. Si hace falta Ctrl+Shift+R o borrar datos del sitio, entonces sí hay un caché por
medio y hay que seguir tirando.

## 6 · Lo que NO he podido medir, y quién puede

No hay `.env` ni credenciales en este entorno, así que **no puedo abrir la app ni inspeccionar el
estado de un cliente**. Todo lo de arriba sale del código, de las cabeceras reales y del historial
de despliegues. Lo que falta, y solo se ve desde un navegador con sesión:

1. **Qué SW controla hoy la pestaña normal.** `chrome://serviceworker-internals`, o en DevTools →
   Application → Service Workers: ver el *script URL*, el estado y la fecha de instalación.
2. **Si hay cachés vivas.** DevTools → Application → Cache Storage. Si hay alguna, la dejó un
   `sw.js` anterior y el `activate` actual nunca llegó a correr en ese cliente — que sería la
   prueba del 4.b mordiendo de verdad.
3. **La tablet.** Lo mismo, y ahí es donde más falta hace.

## 7 · Por dónde iría el arreglo (a decidir, nada construido)

En orden de «arregla más por menos»:

1. **Un aviso de versión nueva.** Que la app pregunte cada N minutos si hay build nueva y ofrezca
   recargar. Es lo único que arregla la tablet de verdad, y no depende del service worker.
2. **`registration.update()` periódico**, para que el navegador al menos mire.
3. **Que `SW_VERSION` deje de subirse a mano.** Un `sw.js` que no cambia nunca es un mecanismo de
   renovación apagado; que lo escriba el build con el hash del bundle.

Ninguna de las tres se toca sin que Julio elija.
