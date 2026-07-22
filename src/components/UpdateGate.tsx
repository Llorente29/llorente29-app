// src/components/UpdateGate.tsx
//
// Puerta de actualización (sideload) A PRUEBA DE FALLOS. Al arrancar la app nativa
// comprueba version.json; si hay una versión mayor avisa. Principio rector: una
// estación de cocina NUNCA debe quedar muerta por culpa del actualizador.
//
//   · Nunca bloquea de forma irrecuperable: si la descarga/instalación se cuelga o
//     falla, hay siempre una salida ("Seguir trabajando") y la app sigue viva en la
//     versión actual (el vínculo de estación vive en localStorage y sobrevive; no
//     hay que re-vincular). Se reintenta sola en el siguiente chequeo.
//   · Actualización NO obligatoria (mandatory:false): tarjeta compacta, descartable,
//     SIN backdrop → la cocina sigue operando detrás. Se aplica en reposo/reinicio.
//   · Actualización obligatoria (mandatory:true, solo cambios que rompen compat):
//     overlay que insiste, pero con escape de emergencia si la instalación se atasca.
//
// En web no hace nada (checkForUpdate devuelve null). Se monta en main.tsx.

import { useEffect, useRef, useState } from 'react'
import { checkForUpdate, installUpdate, type RemoteVersion } from '../native/appUpdate'

const RECHECK_MS = 15 * 60 * 1000  // re-chequea cada 15 min por si sale versión estando abierta
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

export default function UpdateGate() {
  const [update, setUpdate] = useState<RemoteVersion | null>(null)
  const [phase, setPhase] = useState<Phase>('prompt')
  const [error, setError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)     // instalación tardando → mostrar escape
  const [launched, setLaunched] = useState(false) // el instalador ya se abrió (nativo resolvió)
  // Versión descartada en esta sesión (no re-molestar con la MISMA si no es obligatoria).
  const dismissedCode = useRef<number | null>(null)

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
      } catch { /* silencioso */ }
    }
    void run()
    const id = window.setInterval(() => { void run() }, RECHECK_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  if (!update) return null

  const mandatory = update.mandatory
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
        {phase === 'installing' ? (launched ? 'Abriendo el instalador…' : 'Descargando actualización…') : 'Nueva versión de Folvy'}
      </h2>
      <p style={{ fontSize: 13, color: '#9fb0c0', margin: '0 0 18px', lineHeight: 1.5 }}>
        {phase === 'installing'
          ? (launched
              ? 'Sigue las indicaciones del instalador. Si lo cerraste, puedes seguir con la versión actual.'
              : 'No cierres la app. Puedes seguir trabajando si tarda demasiado.')
          : `Versión ${update.versionName} disponible.${mandatory ? ' Requerida para seguir usando la app.' : ' Se aplicará cuando te venga bien.'}`}
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
          {phase === 'failed' ? 'Reintentar' : 'Actualizar'}
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
