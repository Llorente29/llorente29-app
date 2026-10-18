// src/modules/conta/impuestos/useCalendario.ts
//
// I01b · Leer el calendario de impuestos de la empresa activa, con su error en
// palabras y «volver a leer» después de cada cambio.

import { useCallback, useEffect, useState } from 'react'
import { leerCalendario } from '@/modules/conta/services/impuestosService'
import type { Calendario } from './calendario'

export function useCalendario(companyId: string): { datos: Calendario | null; error: string | null; recargar: () => void } {
  const [datos, setDatos] = useState<Calendario | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  useEffect(() => {
    let vivo = true
    leerCalendario(companyId).then(
      (d) => { if (vivo) { setDatos(d); setError(null) } },
      (e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { vivo = false }
  }, [companyId, vuelta])
  return { datos, error, recargar }
}
