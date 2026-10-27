// src/modules/conta/hooks/useIvaPresentado.ts
//
// V04 · Respuesta 5 · Los periodos con el IVA presentado de una empresa, para el
// candado de las pantallas. Si no se pueden leer, se dice (regla 8) y la
// pantalla sigue: la base para igual lo prohibido.

import { useEffect, useState } from 'react'
import type { PeriodoPresentado } from '@/modules/conta/lib/ivaPresentado'
import { leerIvaPresentadosDe } from '@/modules/conta/services/ivaPresentadoService'

export function useIvaPresentado(companyId: string | null | undefined, ejercicios: readonly number[]): {
  presentados: PeriodoPresentado[]; error: string | null; listo: boolean
} {
  const clave = `${companyId ?? ''}:${[...new Set(ejercicios)].sort().join(',')}`
  const [r, setR] = useState<{ clave: string; presentados: PeriodoPresentado[]; error: string | null }>({ clave: '', presentados: [], error: null })
  useEffect(() => {
    if (!companyId || ejercicios.length === 0) return
    let vivo = true
    leerIvaPresentadosDe(companyId, ejercicios)
      .then((p) => { if (vivo) setR({ clave, presentados: p, error: null }) },
        (e: unknown) => { if (vivo) setR({ clave, presentados: [], error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la clave ya lleva la empresa y los ejercicios
  }, [clave])
  const listo = r.clave === clave
  return { presentados: listo ? r.presentados : [], error: listo ? r.error : null, listo }
}
