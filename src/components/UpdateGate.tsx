// src/components/UpdateGate.tsx
//
// Puerta de actualización A PRUEBA DE FALLOS — DOS canales (Capa 2, 31/07):
//   · NATIVO (APK sideload, Capa 1): version.json / EscposPrinter. Solo para
//     cambios que rompen compatibilidad (plugin nuevo, permisos, Capacitor).
//     Exige el toque de "Actualizar" + el instalador de Android (visible,
//     porque Android obliga a consentir instalar un APK de fuera de Play).
//   · OTA (bundle web, Capa 2): bundle.json / @capgo/capacitor-updater. Para
//     TODO cambio de código React/web (la inmensa mayoría de los pushes). Se
//     aplica SOLA — set()+reload, sin instalador, sin consentimiento que dar —
//     así que no necesita tarjeta ni interacción: solo espera su ventana segura.
//
// Principio rector (igual para los dos canales): una estación de cocina NUNCA
// debe quedar muerta —ni interrumpida— por culpa del actualizador.
//
//   · Nunca bloquea de forma irrecuperable: si la descarga/instalación NATIVA se
//     cuelga o falla, hay siempre una salida ("Seguir trabajando") y la app sigue
//     viva en la versión actual. Se reintenta sola en el siguiente chequeo.
//   · La OTA tiene su propia red de seguridad: si el bundle nuevo no llama a
//     notifyAppReady() a tiempo, Capgo hace ROLLBACK automático al bundle bueno
//     anterior (ver main.tsx) — la estación nunca se queda con un bundle roto.
//   · Actualización NO obligatoria (mandatory:false): tarjeta compacta, descartable,
//     SIN backdrop → la cocina sigue operando detrás. (Solo aplica al canal nativo:
//     la OTA no tiene tarjeta, ver arriba.)
//   · Actualización obligatoria (mandatory:true, solo cambios que rompen compat):
//     overlay que insiste, pero con escape de emergencia si la instalación se atasca.
//
// ── VENTANA DE ACTUALIZACIÓN SEGURA (26/07, COMPARTIDA por los dos canales) ──
// Antes, una versión nueva plantaba un modal encima de quien estuviera pasando
// pedidos. El actualizador SEPARA descargar de instalar/aplicar:
//
//   1. DESCARGA: en cuanto hay versión nueva (nativa u OTA), se baja SOLA, en
//      segundo plano, sin decir nada. Descargar no molesta a nadie.
//   2. INSTALAR/APLICAR: solo cuando la estación está en calma:
//        · sin trabajos de impresión vivos    ┐ RPC station_update_window
//        · sin pedidos en curso               │ (lo que sólo la BBDD sabe)
//        · sin ventas en los últimos N min    ┘
//        · y el dispositivo lleva ≥ IDLE_MIN sin que nadie lo toque (aquí).
//      Mientras no se cumpla: el canal nativo CALLA (o deja una tira discreta
//      si es obligatorio); el canal OTA simplemente espera en silencio — nunca
//      un modal ni un parón en mitad del pase.
//
// PRIORIDAD entre canales (§4 del encargo): si hay una actualización NATIVA
// pendiente (version.json con versionCode mayor), el bundle OTA se congela —
// no se comprueba ni se aplica — hasta que esa nativa se resuelva. Un cambio
// que toca lo nativo siempre viene acompañado del bundle equivalente ya
// horneado DENTRO del APK nuevo (CI sube las dos cosas juntas), así que no se
// pierde nada esperando.
//
// Un dispositivo SIN token de estación (móvil de equipo, navegador) no tiene
// cocina que interrumpir: para él sólo cuenta la inactividad táctil.
//
// En web ninguno de los dos canales hace nada (checkForUpdate/checkForBundleUpdate
// devuelven null). Se monta en main.tsx.

import { useEffect, useRef, useState } from 'react'
import {
  checkForUpdate, installUpdate, prefetchUpdate, isUpdateDownloaded,
  fetchUpdateWindow, reportAppVersion,
  checkForBundleUpdate, prefetchOtaBundle, applyOtaBundle,
  type RemoteVersion, type UpdateWindow,
} from '../native/appUpdate'
import { getDeviceToken } from '../native/print/printWorker'

const RECHECK_MS = 15 * 60 * 1000  // re-chequea version.json/bundle.json cada 15 min
const WINDOW_MS = 60 * 1000        // con update pendiente, mira la ventana cada minuto
const IDLE_MS = 5 * 60 * 1000      // nadie toca la tablet desde hace 5 min
const QUIET_MINUTES = 20           // minutos sin ventas que pide la RPC
const BLIND_LIMIT = 30             // sondeos seguidos sin respuesta → dejar de exigirla
const SLOW_MS = 20 * 1000          // si la instalación tarda esto, revela la salida de emergencia
const TIMEOUT_MS = 60 * 1000       // pasado esto damos la instalación por atascada (no colgamos)

type Phase = 'prompt' | 'installing' | 'failed'

// Corre una promesa con límite de tiempo. Si vence, rechaza con 'timeout' pero NO
// aborta el trabajo nativo (que sigue en 2º plano, inofensivo): solo libera la UI
// para que la estación no quede atrapada en "Descargando…".
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

// Motivo de espera en cristiano (para la tira discreta de las obligatorias).
function reasonText(w: UpdateWindow | null, idleOk: boolean): string {
  if (!idleOk) return 'Se instalará cuando la tablet quede libre.'
  if (!w) return 'Se instalará en cuanto la cocina esté en calma.'
  if (w.pendingJobs > 0) return 'Hay tickets imprimiéndose; se instalará al terminar.'
  if (w.activeOrders > 0) return 'Hay pedidos en curso; se instalará al terminar el servicio.'
  return 'Se instalará en cuanto la cocina esté en calma.'
}

export default function UpdateGate() {
  // ── Canal nativo (APK, Capa 1) ──────────────────────────────────────────
  const [update, setUpdate] = useState<RemoteVersion | null>(null)
  const [phase, setPhase] = useState<Phase>('prompt')
  const [error, setError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)     // instalación tardando → mostrar escape
  const [launched, setLaunched] = useState(false) // el instalador ya se abrió (nativo resolvió)
  const [downloaded, setDownloaded] = useState(false)
  const dismissedCode = useRef<number | null>(null) // versión nativa descartada esta sesión
  const prefetchedCode = useRef<number | null>(null) // versión nativa ya predescargada

  // ── Canal OTA (bundle web, Capa 2) ───────────────────────────────────────
  // Sin fase ni tarjeta: aplicar un bundle es set()+reload, nada que consentir.
  const [otaBundleId, setOtaBundleId] = useState<string | null>(null) // id LOCAL de Capgo, listo para set()
  const otaCheckedRemote = useRef<number | null>(null) // remote.bundleId ya intentado descargar
  const otaApplying = useRef(false) // evita disparar set() dos veces a la vez

  // ── Señales compartidas por los dos canales ──────────────────────────────
  const [win, setWin] = useState<UpdateWindow | null>(null)
  const [idleOk, setIdleOk] = useState(false)
  const [blind, setBlind] = useState(false) // el servidor lleva demasiado rato mudo
  const lastTouch = useRef<number>(0)
  const blindCount = useRef<number>(0)

  // Telemetría de flota: qué versión (+ bundle OTA activo) corre esta tablet.
  useEffect(() => { void reportAppVersion() }, [])

  // Inactividad táctil: la estación se considera "libre" tras IDLE_MS sin toques.
  useEffect(() => {
    lastTouch.current = Date.now()
    const touch = () => { lastTouch.current = Date.now(); setIdleOk(false) }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'wheel']
    for (const e of events) window.addEventListener(e, touch, { passive: true })
    const id = window.setInterval(() => {
      setIdleOk(Date.now() - lastTouch.current >= IDLE_MS)
    }, 15 * 1000)
    return () => {
      for (const e of events) window.removeEventListener(e, touch)
      window.clearInterval(id)
    }
  }, [])

  // Chequeo de versión NATIVA + predescarga silenciosa, y — solo si NO hay
  // actualización nativa pendiente (prioridad §4) — chequeo + predescarga del
  // bundle OTA. Ninguno de los dos "aplica" nada aquí, solo dejan lo nuevo listo.
  useEffect(() => {
    let alive = true
    const run = async () => {
      let hasNative = false
      try {
        const r = await checkForUpdate()
        if (alive && r) {
          hasNative = true
          // No pisar un intento en curso; y si el usuario descartó esta versión (y no
          // es obligatoria), no reabrir hasta el próximo arranque en frío.
          if (r.remote.mandatory || r.remote.versionCode !== dismissedCode.current) {
            setUpdate((prev) => prev ?? r.remote)
          }
          if (prefetchedCode.current !== r.remote.versionCode) {
            prefetchedCode.current = r.remote.versionCode
            const ok = await prefetchUpdate(r.remote.apkUrl)
            if (alive) setDownloaded(ok || await isUpdateDownloaded())
          }
        }
      } catch { /* silencioso */ }

      if (!alive || hasNative) return // con APK nativo pendiente, el bundle OTA espera

      try {
        const b = await checkForBundleUpdate()
        if (!alive || !b) return
        if (otaCheckedRemote.current !== b.remote.bundleId) {
          otaCheckedRemote.current = b.remote.bundleId
          const id = await prefetchOtaBundle(b.remote)
          if (alive) setOtaBundleId(id)
        }
      } catch { /* silencioso */ }
    }
    void run()
    const id = window.setInterval(() => { void run() }, RECHECK_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  // Con una actualización pendiente (nativa visible O bundle OTA descargado),
  // sondea la ventana segura (barato, 1/min) — MISMA señal para los dos canales.
  const otaPending = otaBundleId !== null
  useEffect(() => {
    if (!((update && phase === 'prompt') || otaPending)) return
    let alive = true
    const run = async () => {
      const w = await fetchUpdateWindow(QUIET_MINUTES)
      if (!alive) return
      setWin(w)
      // Si la RPC no contesta una y otra vez (permisos, red, proyecto raro), no
      // podemos dejar la tablet clavada en una versión vieja para siempre: tras
      // BLIND_LIMIT intentos dejamos de exigir el visto bueno del servidor y
      // volvemos a ofrecer (ofrecer no obliga a nadie).
      blindCount.current = w === null ? blindCount.current + 1 : 0
      setBlind(blindCount.current >= BLIND_LIMIT)
    }
    void run()
    const id = window.setInterval(() => { void run() }, WINDOW_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [update, phase, otaPending])

  const mandatory = update?.mandatory ?? false
  const isStation = getDeviceToken().length > 0
  // Ventana abierta = la BBDD dice que sí (o no aplica) Y nadie está usando la
  // tablet. Desconocido NO abre ventana en una estación: preferimos esperar a
  // interrumpir. Salvo que la BBDD no tenga la RPC (migración sin aplicar) o
  // lleve demasiado rato muda: ahí volvemos al comportamiento de siempre, para
  // que una tablet no se quede sin actualizar nunca y en silencio.
  const ciego = win?.unsupported === true || blind
  const serverOk = !isStation || ciego ? true : win?.safe === true
  const windowOpen = serverOk && idleOk

  // ── Aplicar OTA: SILENCIOSO, sin tarjeta — set()+reload no pide permiso a
  // nadie. Solo dispara si no hay update nativo (prioridad §4) y la ventana
  // está abierta. Si set() falla, se libera el flag y se reintenta en el
  // siguiente ciclo — la app nunca se queda a medias.
  useEffect(() => {
    if (!otaBundleId || update || !windowOpen || otaApplying.current) return
    otaApplying.current = true
    void applyOtaBundle(otaBundleId).catch(() => {
      otaApplying.current = false
      // El bundle no se pudo activar (raro: ya se verificó el checksum al
      // descargar). Se descarta para no reintentar en bucle con el mismo id
      // roto; el próximo bundle.json que salga se probará de cero.
      setOtaBundleId(null)
    })
  }, [otaBundleId, update, windowOpen])

  // Una vez el usuario empieza (o falla) el flujo NATIVO, la tarjeta se queda.
  const engaged = phase !== 'prompt'
  const visible = !!update && (windowOpen || engaged)

  // Salida de emergencia disponible cuando: no es obligatoria, o la instalación
  // falló, o está tardando demasiado, o el instalador ya se lanzó. Garantiza que
  // NUNCA hay pantalla muerta.
  const canEscape = !mandatory || phase === 'failed' || slow || launched

  function dismiss() {
    if (update) dismissedCode.current = update.versionCode
    setUpdate(null)
    setPhase('prompt')
    setError(null)
    setSlow(false)
    setLaunched(false)
  }

  async function handleUpdate() {
    if (!update) return
    setPhase('installing'); setError(null); setSlow(false); setLaunched(false)
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS)
    try {
      await withTimeout(installUpdate(update.apkUrl), TIMEOUT_MS)
      // El nativo resolvió: el instalador de Android ya se lanzó (o la app va a ser
      // reemplazada). Si el usuario lo cierra/cancela, vuelve aquí: dejamos una
      // salida clara en vez de quedar en un spinner eterno.
      setLaunched(true)
      setSlow(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo actualizar.'
      setError(
        msg === 'timeout'
          ? 'La descarga está tardando. Puedes seguir con la versión actual; se reintentará sola.'
          : msg,
      )
      setPhase('failed')
    } finally {
      window.clearTimeout(slowTimer)
    }
  }

  // Sin actualización NATIVA visible: la OTA nunca pinta nada (silenciosa por
  // diseño — ver cabecera). Nada que mostrar.
  if (!update) return null

  // ── Fuera de ventana ───────────────────────────────────────────────────────
  // No obligatoria: silencio absoluto (la cocina ni se entera).
  // Obligatoria: tira discreta que informa, sin capturar el pase.
  if (!visible) {
    if (!mandatory) return null
    return (
      <div
        style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 100000,
          maxWidth: 340, width: 'calc(100% - 32px)', pointerEvents: 'none',
          background: 'rgba(14,24,32,0.92)', color: '#cfe0ee',
          border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12,
          padding: '10px 14px', fontSize: 12.5, lineHeight: 1.45,
        }}
      >
        <b style={{ color: '#fff' }}>Actualización preparada{downloaded ? '' : '…'}</b>
        <div>{reasonText(win, idleOk)}</div>
      </div>
    )
  }

  // ── Contenido de la tarjeta (común a obligatoria/no obligatoria) ──────────────
  const card = (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: '#0e1820', color: '#fff', borderRadius: 18, padding: 24,
        maxWidth: 380, width: '100%', textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      }}
    >
      <img src="/folvy-icon-192.png" alt="Folvy" width={48} height={48}
        style={{ borderRadius: 14, margin: '0 auto 10px' }} />
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>
        {phase === 'installing'
          ? (launched ? 'Abriendo el instalador…' : (downloaded ? 'Preparando la instalación…' : 'Descargando actualización…'))
          : 'Nueva versión de Folvy'}
      </h2>
      <p style={{ fontSize: 13, color: '#9fb0c0', margin: '0 0 18px', lineHeight: 1.5 }}>
        {phase === 'installing'
          ? (launched
              ? 'Sigue las indicaciones del instalador. Si lo cerraste, puedes seguir con la versión actual.'
              : 'No cierres la app. Puedes seguir trabajando si tarda demasiado.')
          : `Versión ${update.versionName} disponible.${downloaded ? ' Ya descargada: se instala en segundos.' : ''}${mandatory ? ' Requerida para seguir usando la app.' : ''}`}
      </p>

      {error && (
        <div style={{
          background: 'rgba(224,73,46,0.15)', color: '#f2b8ae', border: '1px solid rgba(224,73,46,0.4)',
          borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 14, textAlign: 'left',
        }}>{error}</div>
      )}

      {phase !== 'installing' && (
        <button
          onClick={handleUpdate}
          style={{
            width: '100%', padding: 13, borderRadius: 12, border: 'none',
            background: '#1F9D6B', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
          }}
        >
          {phase === 'failed' ? 'Reintentar' : 'Actualizar ahora'}
        </button>
      )}

      {phase === 'installing' && !slow && (
        <div style={{ fontSize: 13, color: '#9fb0c0', padding: '10px 0' }}>Un momento…</div>
      )}

      {canEscape && (
        <button
          onClick={dismiss}
          style={{
            width: '100%', padding: 10, marginTop: 8, borderRadius: 12, border: 'none',
            background: 'transparent', color: '#9fb0c0', fontSize: 13, cursor: 'pointer',
          }}
        >
          {mandatory || phase !== 'prompt' ? 'Seguir trabajando' : 'Ahora no'}
        </button>
      )}
    </div>
  )

  // ── Obligatoria: overlay que insiste (con escape de emergencia si se atasca) ──
  if (mandatory) {
    return (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(8,12,18,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}
      >
        {card}
      </div>
    )
  }

  // ── No obligatoria: tarjeta compacta abajo-derecha, SIN backdrop → la cocina
  //    sigue plenamente operativa detrás. Solo la tarjeta captura clics.
  return (
    <div
      style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 100000,
        maxWidth: 360, width: 'calc(100% - 32px)', pointerEvents: 'none',
      }}
    >
      <div style={{ pointerEvents: 'auto' }}>{card}</div>
    </div>
  )
}
