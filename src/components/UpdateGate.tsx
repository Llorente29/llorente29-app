// src/components/UpdateGate.tsx
//
// Puerta de actualización (sideload) A PRUEBA DE FALLOS. Al arrancar la app nativa
// comprueba version.json; si hay una versión mayor avisa. Principio rector: una
// estación de cocina NUNCA debe quedar muerta —ni interrumpida— por culpa del
// actualizador.
//
//   · Nunca bloquea de forma irrecuperable: si la descarga/instalación se cuelga o
//     falla, hay siempre una salida ("Seguir trabajando") y la app sigue viva en la
//     versión actual (el vínculo de estación vive en localStorage y sobrevive; no
//     hay que re-vincular). Se reintenta sola en el siguiente chequeo.
//   · Actualización NO obligatoria (mandatory:false): tarjeta compacta, descartable,
//     SIN backdrop → la cocina sigue operando detrás.
//   · Actualización obligatoria (mandatory:true, solo cambios que rompen compat):
//     overlay que insiste, pero con escape de emergencia si la instalación se atasca.
//
// ── VENTANA DE ACTUALIZACIÓN SEGURA (26/07) ─────────────────────────────────
// Antes, una versión nueva plantaba un modal encima de quien estuviera pasando
// pedidos. Ahora el actualizador SEPARA descargar de instalar:
//
//   1. DESCARGA: en cuanto hay versión nueva, el APK se baja SOLO, en segundo
//      plano, sin decir nada (prefetchUpdate). Descargar no molesta a nadie.
//   2. INSTALACIÓN: sólo se OFRECE cuando la estación está en calma:
//        · sin trabajos de impresión vivos    ┐ RPC station_update_window
//        · sin pedidos en curso               │ (lo que sólo la BBDD sabe)
//        · sin ventas en los últimos N min    ┘
//        · y el dispositivo lleva ≥ IDLE_MIN sin que nadie lo toque (aquí).
//      Mientras no se cumpla, el actualizador CALLA (o deja una tira discreta si
//      la versión es obligatoria). Nunca un modal en mitad del pase.
//
// Un dispositivo SIN token de estación (móvil de equipo, navegador) no tiene
// cocina que interrumpir: para él sólo cuenta la inactividad táctil.
//
// En web no hace nada (checkForUpdate devuelve null). Se monta en main.tsx.

import { useEffect, useRef, useState } from 'react'
import {
  checkForUpdate, installUpdate, prefetchUpdate, isUpdateDownloaded,
  fetchUpdateWindow, reportAppVersion,
  type RemoteVersion, type UpdateWindow,
} from '../native/appUpdate'
import { getDeviceToken } from '../native/print/printWorker'

const RECHECK_MS = 15 * 60 * 1000  // re-chequea version.json cada 15 min
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
  const [update, setUpdate] = useState<RemoteVersion | null>(null)
  const [phase, setPhase] = useState<Phase>('prompt')
  const [error, setError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)     // instalación tardando → mostrar escape
  const [launched, setLaunched] = useState(false) // el instalador ya se abrió (nativo resolvió)
  const [downloaded, setDownloaded] = useState(false)
  const [win, setWin] = useState<UpdateWindow | null>(null)
  const [idleOk, setIdleOk] = useState(false)
  // El servidor lleva demasiado rato mudo → dejamos de exigirle permiso.
  const [blind, setBlind] = useState(false)
  // Versión descartada en esta sesión (no re-molestar con la MISMA si no es obligatoria).
  const dismissedCode = useRef<number | null>(null)
  // Versión ya predescargada (para no bajarla en bucle).
  const prefetchedCode = useRef<number | null>(null)
  // 0 = aún sin marcar; lo fija el efecto de inactividad al montar.
  const lastTouch = useRef<number>(0)
  // Sondeos seguidos sin respuesta del servidor (ver BLIND_LIMIT).
  const blindCount = useRef<number>(0)

  // Telemetría de flota: qué versión corre esta tablet (best-effort, silencioso).
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

  // Chequeo de versión + PREDESCARGA silenciosa (no muestra nada por sí sola).
  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const r = await checkForUpdate()
        if (!alive || !r) return
        // No pisar un intento en curso; y si el usuario descartó esta versión (y no
        // es obligatoria), no reabrir hasta el próximo arranque en frío.
        if (r.remote.mandatory || r.remote.versionCode !== dismissedCode.current) {
          setUpdate((prev) => prev ?? r.remote)
        }
        // Descargar SIEMPRE por detrás, aunque todavía no toque instalar.
        if (prefetchedCode.current !== r.remote.versionCode) {
          prefetchedCode.current = r.remote.versionCode
          const ok = await prefetchUpdate(r.remote.apkUrl)
          if (alive) setDownloaded(ok || await isUpdateDownloaded())
        }
      } catch { /* silencioso */ }
    }
    void run()
    const id = window.setInterval(() => { void run() }, RECHECK_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  // Con una actualización pendiente, sondea la ventana segura (barato, 1/min).
  useEffect(() => {
    if (!update || phase !== 'prompt') return
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
  }, [update, phase])

  if (!update) return null

  const mandatory = update.mandatory
  const isStation = getDeviceToken().length > 0
  // Ventana abierta = la BBDD dice que sí (o no aplica) Y nadie está usando la
  // tablet. Desconocido NO abre ventana en una estación: preferimos esperar a
  // interrumpir. Salvo que la BBDD no tenga la RPC (migración sin aplicar) o
  // lleve demasiado rato muda: ahí volvemos al comportamiento de siempre, para
  // que una tablet no se quede sin actualizar nunca y en silencio.
  const ciego = win?.unsupported === true || blind
  const serverOk = !isStation || ciego ? true : win?.safe === true
  const windowOpen = serverOk && idleOk
  // Una vez el usuario empieza (o falla), la tarjeta se queda: ya la vio él.
  const engaged = phase !== 'prompt'
  const visible = windowOpen || engaged

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
