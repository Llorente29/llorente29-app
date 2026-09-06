# RECON · Las tablets sólo se actualizan cuando les toca

**06/09/2026 · Code · sólo lectura, nada tocado.** Responde al §2 y al §2.bis del
encargo `ENCARGO_CODE_ota_tablets_ventana_propia_20260906.md`.

---

## 0 · La respuesta corta

**La pieza 1 existe y, por el camino normal, FUNCIONA.** Hay tres puertas
declaradas por las que se salta, y ninguna de las tres explica lo de «Pase».

**Y lo de «Pase» a las 14:18 es, casi con seguridad, una falsa alarma** — pero el
dato con el que se detectó **no puede probarlo ni en un sentido ni en el otro**, y
ése es el hallazgo que importa: `app_version_at` **no marca cuándo se aplicó un
bundle**. Marca cuándo arrancó la app. Son cosas distintas y hoy se confunden.

---

## 1 · Quién llama a `station_update_window`, con fichero y línea

| paso | dónde |
|---|---|
| Sondeo cada 60 s, **sólo si hay algo pendiente** | `src/components/UpdateGate.tsx:183-200` (la guarda de entrada, línea 184) |
| La llamada | `UpdateGate.tsx:187` → `fetchUpdateWindow(QUIET_MINUTES)` con `QUIET_MINUTES = 20` (línea 68) |
| La RPC | `src/native/appUpdate.ts:147` → `rpc('station_update_window', { p_device_token: getDeviceToken(), p_quiet_minutes })` |
| **La decisión** | `UpdateGate.tsx:209-211` |
| El acto | `UpdateGate.tsx:217-227` → `applyOtaBundle()` → `CapacitorUpdater.set()` + recarga |

La decisión, literal:

```ts
const ciego    = win?.unsupported === true || blind
const serverOk = !isStation || ciego ? true : win?.safe === true
const windowOpen = serverOk && idleOk
```

**Con `safe = false` → `serverOk = false` → `windowOpen = false` → no se aplica.**
El efecto de aplicar (línea 218) sale por `!windowOpen`. La guarda hace su trabajo.

## 1.bis · Las TRES puertas por las que se salta, todas a propósito

1. **`!isStation`** (`UpdateGate.tsx:203`, `getDeviceToken().length > 0`). Un
   dispositivo **sin token** → `serverOk = true` **incondicional**: sólo cuenta la
   inactividad táctil. Es deliberado —«un dispositivo sin token de estación no
   tiene cocina que interrumpir»— y **hoy no aplica**: las cuatro tablets de
   Foodint tienen token, incluida la inactiva de Plaza Castilla.
2. **`blind`** (`BLIND_LIMIT = 30`, línea 69). **30 sondeos seguidos sin
   respuesta = 30 minutos** de RPC muda → `ciego = true` → `serverOk = true`, y se
   aplica sin permiso del servidor. El motivo está escrito y es bueno («una
   migración olvidada dejaría a la flota sin poder actualizarse jamás, y en
   silencio»), pero **es una puerta real**: 30 minutos de red mala en pleno
   servicio abren la ventana.
3. **`unsupported`** — sólo si la RPC no existe en el proyecto. **Existe**, así que
   hoy no es ésta.

Y una cuarta condición que no es puerta pero sí es más débil de lo que parece:
**`idleOk` son 5 minutos sin tocar la pantalla** (`IDLE_MS`, línea 67). Una tablet
de **Pase** puede pasar cinco minutos sin que nadie la toque en pleno servicio: es
una pantalla que se mira, no que se usa.

## 2 · 🔴 `app_version_at` NO marca la recarga. Marca el arranque

Es la tercera hipótesis del §2.bis, y es la correcta.

- `report_device_app_version` hace `app_version_at = now()` **incondicionalmente**,
  cambie o no la versión. No compara nada.
- `reportAppVersion()` se llama **exactamente una vez**, desde
  `UpdateGate.tsx:122` — `useEffect(() => { void reportAppVersion() }, [])`. O sea:
  **en cada arranque de la app**.

Por tanto `app_version_at` = «la última vez que esta app arrancó y consiguió
reportar». **Una recarga por OTA y un reinicio cualquiera dejan exactamente la
misma fila.** No hay forma de distinguirlos con lo que hay guardado.

## 3 · Qué dicen los datos sobre «Pase», bundle 259, 14:18

| tablet | local | bundle | reportó (Madrid) |
|---|---|---|---|
| Cocina | Foodint Alcalá | 259 | **12:04:50** |
| Tablet camichi4 | Foodint Carabanchel | 259 | **12:04:44** |
| **Pase** | Foodint Alcalá | 259 | **14:18:08** |
| Tablet J | Plaza Castilla | — | (inactiva desde el 20/07) |

**Tres cosas apuntan a que a las 14:18 no se aplicó ningún bundle:**

1. **Cocina y camichi4 reportaron el 259 con SEIS SEGUNDOS de diferencia, en dos
   locales distintos.** Eso es el momento en que se publicó el bundle y las tablets
   lo cogieron, no dos ventanas de calma independientes que casualmente coinciden.
2. Las tres están en el **mismo bundle 259**. Pase no va por detrás ni por delante.
3. **La guarda, si se le hubiera preguntado a las 14:18, habría dicho que NO.**
   Medido: hay una venta en Alcalá a las **14:12:15**, seis minutos antes, y con
   `p_quiet_minutes = 20` eso da `venta_reciente` → `safe = false`.

Lo más probable es que **Pase aplicara el 259 hacia las 12:04 como las otras dos**,
y que a las 14:18 simplemente **arrancara** — Android la mató y la relanzó, alguien
la reabrió, volvió la red.

**Pero no se puede probar, y por eso esto no se cierra como «falsa alarma» a secas:
se cierra como “no hay registro de cuándo se aplica un bundle”.** Es lo primero que
la pieza 1 tiene que traer, y es barato: hoy el aplicar y el arrancar comparten un
único `now()`.

## 4 · Pieza 2 · cómo se calcula la versión, y por qué llega a la tablet todo

- **UNA sola entrada de Vite.** `index.html`, sin `rollupOptions.input` en
  `vite.config.ts`. **La tablet y la oficina son literalmente el mismo paquete.**
- **El OTA NO compara ningún hash de contenido.**
  `bundleId = ${{ github.run_number }}` (`.github/workflows/build-apk.yml:113`), un
  contador que sube en cada ejecución de CI. Y
  `checkForBundleUpdate` (`appUpdate.ts:245`) decide con
  `remote.bundleId > currentId`. **Un contador, no una huella.**
- El `sha256` de `bundle.json` (línea 120) **sí** existe, pero es el checksum de
  descarga que verifica Capgo — no decide si hay versión nueva.
- Lo único que filtra hoy es `paths-ignore: ['docs/**','**/*.md','supabase/**']`.
  Por rutas, y sólo esas tres. **Cualquier push a `main` que toque `src/` publica un
  bundle nuevo y las tres tablets lo ven**, aunque el cambio sea la Rentabilidad de
  Kitchen. La premisa del §1 del encargo queda confirmada tal cual.

## 5 · Un hallazgo que ahorra trabajo en la pieza 1: la banda ya está en la base

`business_hours` **existe y está cargada en los tres locales**:

| local | tramos | abre | cierra |
|---|---|---|---|
| Foodint Alcalá | 7 | 13:00 | **23:45** |
| Foodint Carabanchel | 11 | 13:00 | **23:45** |
| Foodint Plaza Castilla | 12 | 13:00 | **23:45** |

Con el margen que propone el §2 (cierre + 45 min → apertura − 45 min), la ventana de
mantenimiento sale **00:30 → 12:15**. **Que es exactamente la banda 12:15 → 23:45,
del revés.** La banda que Julio aplica a mano no es una convención: es el horario de
los locales, y ya está en la base. La pieza 1 no tiene que inventar política —
tiene que leer `business_hours`.

*(Y el `04:00 → 10:00` de reserva para un local sin horario sigue haciendo falta:
no por Foodint, sino por el cliente 2.)*

## 6 · Lo que esta RECON NO ha mirado

- **Qué pantallas usa de verdad la tablet.** Sé que `isPairedEstacion()` la abre en
  `/estacion` (`printWorker.ts:88`, `App.tsx:109`), pero **no he medido el grafo de
  importaciones** de esa entrada, que es lo que decide entre (a) huella por área y
  (b) dos paquetes. Es la siguiente medición y la pide el propio encargo.
- **Los modos B30/B31** (ciego / sin token) los he leído en el código, no
  reproducido en una tablet.

## 7 · Lo que yo propondría, con la decisión en manos de Julio

1. **Registrar cuándo se aplica un bundle, aparte de cuándo arranca la app.** Es la
   condición para poder verificar cualquiera de las dos piezas — y hoy no se puede
   verificar ninguna.
2. **Bajar la puerta `blind`**: 30 minutos de silencio abren la ventana en plena
   cena. Con `business_hours` en la mano, un ciego dentro del horario de apertura
   puede esperar; sólo fuera de él debería abrir.
3. **La pieza 1 sobre `business_hours`**, no sobre una constante nueva.


---

# 8 · LA PREDICCIÓN DEL §3.16 SALIÓ MAL. Medido, 06/09 20:46

Publiqué el bundle 260 a las **20:01:02** con esta predicción escrita: *ninguna
tablet se recarga en servicio; las tres aplican después del cierre.*

**Falsa.** A los 37 minutos:

| tablet | bundle | arrancó |
|---|---|---|
| **Cocina · Alcalá** | **260** | **20:38:23** ← se recargó EN SERVICIO |
| Pase · Alcalá | 259 | 14:18:08 |
| camichi4 · Carabanchel | 259 | 12:04:44 |

Es exactamente el criterio de desmentida que dejé escrito: `app_version` pasó de
259 a 260 antes de las 23:45. **Y Alcalá volvió a vender 17 segundos después de la
recarga** (20:38:40).

## 8.1 · Qué habría dicho la guarda en ese instante

Lo reconstruí antes de sacar conclusiones, porque había dos lecturas posibles y
llevan a sitios opuestos.

- **`venta_reciente`: NO era motivo.** La última venta de Alcalá antes de la
  recarga fue a las **20:12:07 — 26,3 minutos antes**, fuera de los 20 de
  `p_quiet_minutes`. Un bache de domingo por la noche, no un cierre.
- **`trabajos_de_impresion_vivos`: 0.**
- **`pedidos_en_curso`: SÍ era motivo.** Un pedido creado a las **18:38:54** seguía
  abierto: se marcó `completed` a las **20:40:04**, un minuto y 41 segundos DESPUÉS
  de la recarga.

**Conclusión: `station_update_window` habría devuelto `safe = false`, y la tablet
se recargó igual.** No es que la guarda se equivocara: **es que no la obedeció.**

*(Salvedad honesta: la reconstrucción de «pedidos en curso» se apoya en que
`updated_at` marque el cambio de estado. Es la mejor evidencia disponible y encaja
—un pedido abierto dos horas, cerrado a las 20:40— pero no es una prueba directa.)*

## 8.2 · Por cuál de las tres puertas entró: NO LO SÉ, y no lo puedo saber desde aquí

Las tres candidatas del §1.bis:
1. **`!isStation`** — Cocina tiene token en la base, pero `getDeviceToken()` lee del
   dispositivo. Si devolvió vacío en ese render, `serverOk = true`.
2. **`blind`** — 30 sondeos nulos seguidos = 30 min. El bundle salió a las 20:01 y
   la recarga fue a las 20:38: **37 minutos. Encaja con incomodidad.**
3. **`unsupported`** — la RPC existe. Pero **apliqué tres migraciones a las
   19:25-19:31**, y aplicar una migración recarga la caché de esquema de PostgREST:
   una llamada que caiga en esa ventana puede recibir `PGRST202`, que es justo lo
   que `appUpdate.ts:155-158` traduce a `unsupported` → ciego.

**La tercera me señala a mí** y por eso la escribo la primera de las tres. No la doy
por buena: las tres son hipótesis y ninguna se puede confirmar sin el estado local
de esa tablet.

## 8.3 · Lo que esto cambia, tenga la culpa quien la tenga

**Aunque la puerta hubiera estado cerrada, la guarda es demasiado floja.** Si el
pedido de las 18:38 se hubiera cerrado diez minutos antes, `safe` habría sido
**true** con toda legitimidad — y la recarga habría sido igual de inoportuna. **20
minutos sin ventas no es «cerrado»: es un bache.** El §5 de esta RECON ya tenía la
respuesta y no la usé para esto: **`business_hours` dice que Alcalá cierra a las
23:45.** Ninguna recarga debería poder ocurrir antes de esa hora, diga lo que diga
el contador de ventas.

## 8.4 · Pendiente

Pase y camichi4 siguen en 259 **y pueden hacer lo mismo esta noche**. La decisión de
si se para algo es de Julio; yo no toco nada — publicar otro bundle para revertir
provocaría más recargas, que es justo lo que hay que evitar.


---

# 9 · SEGUNDO CASO: Pase, 22:08:14. Misma firma exacta

| tablet | recarga | hueco de ventas antes | pedidos abiertos entonces | impresiones | lo que habría dicho la guarda |
|---|---|---|---|---|---|
| **Cocina** | 20:38:23 | 26,3 min (última 20:12:07) | **1** | 0 | **`safe = false`** |
| **Pase** | 22:08:14 | 28,8 min (última 21:39:25) | **2** | 0 | **`safe = false`** |

**Dos casos, misma firma, con 90 minutos de diferencia.** En los dos: el hueco de
ventas superaba los 20 minutos, así que `venta_reciente` NO frenaba; lo único que
cerraba la puerta eran los pedidos en curso; y la tablet se recargó igual.

Los pedidos de Pase eran de las **20:00:04** y **20:03:02**, cerrados a las
**22:10:07** y **22:10:11** — cuatro segundos entre ellos, dos minutos después de la
recarga. Dos horas abiertos y cerrados en bloque (encaja con el autocierre). El de
Cocina, igual: abierto a las 18:38:54, cerrado a las 20:40:04.

## 9.1 · Lo que queda descartado, y lo que no

| hipótesis | estado |
|---|---|
| `unsupported` — la RPC no existe | **descartada**: existe y responde bien |
| Permisos — la tablet no puede ejecutarla | **descartada**: `anon` y `authenticated` tienen EXECUTE en `station_update_window`, `kds_resolve_device` y `report_device_app_version` |
| `!isStation` — `getDeviceToken()` vacío en ese render | **no descartable desde aquí** |
| `blind` — 30 sondeos nulos seguidos | **no descartable desde aquí** |

**La hipótesis que mejor explica los dos casos es que `blind` esté permanentemente
activo** — si la llamada de la tablet falla siempre por lo que sea, tras 30 minutos
`ciego = true` para el resto de la sesión y **el único freno que queda es `idleOk`:
5 minutos sin tocar la pantalla**. Y eso encaja con los dos sucesos, porque los dos
ocurrieron en huecos largos, que es justo cuando nadie toca la tablet.

**No la doy por probada.** Hace falta el estado local del dispositivo (o un log del
lado tablet), y desde la base no se ve.

## 9.2 · Lo que esto implica para el arreglo

**El §5 de esta RECON proponía leer `business_hours` en la guarda. Con estos dos
casos delante, eso NO basta**: si la tablet no está honrando la respuesta del
servidor, da igual lo lista que sea la respuesta. Endurecer `station_update_window`
no arregla nada.

El arreglo tiene que estar **en el lado de la tablet**, y va en este orden:
1. **Que `blind` y `!isStation` no puedan abrir la ventana dentro del horario de
   apertura del local.** Hoy las dos rutas devuelven `serverOk = true` sin
   preguntar. Dejar la salida de emergencia sólo fuera de horario.
2. **Registrar por qué se aplicó** (`safe`, `blind`, `isStation`, `idleOk` en el
   momento del `set()`). Sin eso, esta misma investigación habrá que repetirla.
3. Y sólo después, la ventana de `business_hours` del §5.
