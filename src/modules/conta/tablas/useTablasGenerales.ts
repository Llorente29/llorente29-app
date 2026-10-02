// src/modules/conta/tablas/useTablasGenerales.ts
//
// Carga las tablas generales de la empresa activa y lo que hace falta para
// saber cuáles usa. Una sola vez para las nueve: el menú lleva sus cifras.

import { useCallback, useEffect, useState } from 'react'
import { cargarContextoUso, cargarTablasGenerales, type FilasPorTabla } from '@/modules/conta/services/tablasService'
import type { ContextoUso } from '@/modules/conta/tablas/usadas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'

interface Carga {
  clave: string | null
  filas: FilasPorTabla
  ctx: ContextoUso | null
  error: string | null
}

export interface EstadoTablas {
  cargando: boolean
  error: string | null
  filas: FilasPorTabla
  ctx: ContextoUso | null
  recargar: () => void
}

export function useTablasGenerales(accountId: string | null, companyId: string | null): EstadoTablas {
  const [carga, setCarga] = useState<Carga>({ clave: null, filas: {}, ctx: null, error: null })
  const [vuelta, setVuelta] = useState(0)
  const clave = accountId && companyId ? `${accountId}:${companyId}:${vuelta}` : null

  useEffect(() => {
    if (!accountId || !companyId || !clave) return
    let vivo = true
    Promise.all([cargarTablasGenerales(companyId), cargarContextoUso(accountId, companyId, hoyEnMadrid())])
      .then(([filas, ctx]) => { if (vivo) setCarga({ clave, filas, ctx, error: null }) })
      .catch((e: unknown) => { if (vivo) setCarga({ clave, filas: {}, ctx: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, companyId, clave])

  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  const alDia = carga.clave === clave && clave !== null
  // Al recargar después de guardar se sigue enseñando lo de antes (no parpadea a esqueleto).
  const hayAlgo = carga.ctx !== null && carga.clave?.startsWith(`${accountId}:${companyId}:`) === true
  return {
    cargando: !alDia && !hayAlgo,
    error: alDia ? carga.error : null,
    filas: hayAlgo || alDia ? carga.filas : {},
    ctx: hayAlgo || alDia ? carga.ctx : null,
    recargar,
  }
}
