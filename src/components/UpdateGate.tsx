// src/components/UpdateGate.tsx
//
// Puerta de actualización forzada (sideload). Al arrancar la app nativa comprueba
// version.json; si hay una versión mayor, muestra un modal (bloqueante si
// mandatory) → "Actualizar" descarga el APK y lanza el instalador de Android.
// En web no hace nada (checkForUpdate devuelve null). Se monta en main.tsx.

import { useEffect, useState } from 'react'
import { checkForUpdate, installUpdate, type RemoteVersion } from '../native/appUpdate'

const RECHECK_MS = 15 * 60 * 1000 // re-chequea cada 15 min por si sale versión estando abierta

export default function UpdateGate() {
  const [update, setUpdate] = useState<RemoteVersion | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const r = await checkForUpdate()
        if (alive && r) setUpdate(r.remote)
      } catch { /* silencioso */ }
    }
    void run()
    const id = window.setInterval(() => { void run() }, RECHECK_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  if (!update) return null

  const dismissable = !update.mandatory

  async function handleUpdate() {
    if (!update) return
    setInstalling(true); setError(null)
    try {
      await installUpdate(update.apkUrl)
      // Al volver del instalador, Android reemplaza la app; si el usuario cancela,
      // dejamos el botón listo para reintentar.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.')
      setInstalling(false)
    }
  }

  return (
    <div
      onClick={() => dismissable && setUpdate(null)}
      style={{
        position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(8,12,18,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0e1820', color: '#fff', borderRadius: 18, padding: 28, maxWidth: 380,
          width: '100%', textAlign: 'center', border: '1px solid rgba(255,255,255,0.10)',
        }}
      >
        <img src="/folvy-icon-192.png" alt="Folvy" width={56} height={56}
          style={{ borderRadius: 16, margin: '0 auto 12px' }} />
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px' }}>Nueva versión de Folvy</h2>
        <p style={{ fontSize: 14, color: '#9fb0c0', margin: '0 0 20px', lineHeight: 1.5 }}>
          Versión {update.versionName} disponible. Actualiza para seguir usando la app.
        </p>

        {error && (
          <div style={{
            background: 'rgba(224,73,46,0.15)', color: '#f2b8ae', border: '1px solid rgba(224,73,46,0.4)',
            borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 14, textAlign: 'left',
          }}>{error}</div>
        )}

        <button
          onClick={handleUpdate}
          disabled={installing}
          style={{
            width: '100%', padding: 14, borderRadius: 12, border: 'none',
            background: '#1F9D6B', color: '#fff', fontWeight: 700, fontSize: 15,
            cursor: installing ? 'default' : 'pointer', opacity: installing ? 0.7 : 1,
          }}
        >
          {installing ? 'Descargando…' : 'Actualizar'}
        </button>

        {dismissable && (
          <button
            onClick={() => setUpdate(null)}
            style={{
              width: '100%', padding: 10, marginTop: 8, borderRadius: 12, border: 'none',
              background: 'transparent', color: '#9fb0c0', fontSize: 13, cursor: 'pointer',
            }}
          >
            Ahora no
          </button>
        )}
      </div>
    </div>
  )
}
