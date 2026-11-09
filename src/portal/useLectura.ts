// src/portal/useLectura.ts
//
// GP · Tarea 3 · Una lectura por pantalla (la regla del segundo): la función
// conta_portal_* que la prepara en la base, una vez al abrir y otra cuando lo
// pide la pantalla (después de hacer algo). Mide lo que tarda y lo deja en
// window.__portalTiempos, para la e2e de la tarea 5 (menos de 1 s).

import { useCallback, useEffect, useState } from 'react'
import { leer } from './cliente'

export interface Lectura<T> { datos: T | null; error: string | null; cargando: boolean; recargar: () => void }

declare global { interface Window { __portalTiempos?: Record<string, number> } }

export function useLectura<T>(fn: string, cliente: string): Lectura<T> {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    let vivo = true
    const t0 = performance.now()
    leer<T>(fn, { p_party: cliente })
      .then((d) => { if (vivo) { setDatos(d); setError(null) } })
      .catch((e: Error) => { if (vivo) setError(e.message) })
      .finally(() => {
        if (!vivo) return
        setCargando(false)
        window.__portalTiempos = { ...(window.__portalTiempos ?? {}), [fn]: Math.round(performance.now() - t0) }
      })
    return () => { vivo = false }
  }, [fn, cliente, vuelta])
  const recargar = useCallback(() => { setCargando(true); setVuelta((v) => v + 1) }, [])
  return { datos, error, cargando, recargar }
}
