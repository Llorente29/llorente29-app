// src/modules/conta/libros/contexto.ts
//
// C05 · Lo que comparten las pantallas de Libros: la cuenta, la empresa, quién
// es, el ejercicio elegido (con su anterior, regla 8), locales y marcas
// (regla 10) y cómo recargar. Lo pone LibrosPage; cada acción lo lee.

import { createContext, useContext, useEffect, useState } from 'react'
import type { EjercicioLibros } from '@/modules/conta/services/librosService'

export interface ContextoLibros {
  accountId: string
  companyId: string
  quien: string | null
  movil: boolean
  ejercicios: EjercicioLibros[]
  ejercicio: EjercicioLibros
  anterior: EjercicioLibros | null
  locales: { id: string; nombre: string }[]
  marcas: { id: string; nombre: string }[]
  vuelta: number
  recargar: () => void
}

export const LibrosCtx = createContext<ContextoLibros | null>(null)

export function useLibros(): ContextoLibros {
  const c = useContext(LibrosCtx)
  if (!c) throw new Error('useLibros fuera de LibrosPage')
  return c
}

/** Leer algo con su estado de carga; `clave` resume de qué depende. */
export function useLeer<T>(leer: (() => Promise<T>) | null, clave: string): { datos: T | null; error: string | null; recargar: () => void } {
  const [r, setR] = useState<{ clave: string; datos: T | null; error: string | null }>({ clave: '', datos: null, error: null })
  const [vuelta, setVuelta] = useState(0)
  const k = `${clave}:${vuelta}`
  useEffect(() => {
    if (!leer) return
    let vivo = true
    leer().then((datos) => { if (vivo) setR({ clave: k, datos, error: null }) },
      (e: unknown) => { if (vivo) setR({ clave: k, datos: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `k` resume lo que se lee
  }, [k])
  const vale = r.clave === k
  return { datos: vale ? r.datos : null, error: vale ? r.error : null, recargar: () => setVuelta((v) => v + 1) }
}

/** El trimestre de una fecha ('YYYY-MM-DD') como rango, y el del ejercicio si cae fuera. */
export function trimestreDe(fecha: string): { desde: string; hasta: string; nombre: string } {
  const y = fecha.slice(0, 4)
  const t = Math.floor((Number(fecha.slice(5, 7)) - 1) / 3)
  const ini = String(t * 3 + 1).padStart(2, '0')
  const finMes = t * 3 + 3
  const fin = `${y}-${String(finMes).padStart(2, '0')}-${String(new Date(Number(y), finMes, 0).getDate()).padStart(2, '0')}`
  return { desde: `${y}-${ini}-01`, hasta: fin, nombre: `${t + 1}T ${y}` }
}
