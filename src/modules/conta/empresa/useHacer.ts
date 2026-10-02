// src/modules/conta/empresa/useHacer.ts
//
// Hacer algo que importa y decir qué ha pasado (regla 8): o confirma con
// contenido («Cerrado septiembre: ya no se puede cambiar sin reabrirlo») o
// enseña el fallo en pantalla. Nunca calla.

import { useCallback, useState } from 'react'

export interface Hacer {
  guardando: boolean
  hecho: string | null
  fallo: string | null
  /** Devuelve true si salió bien. */
  hacer: (accion: () => Promise<void>, exito: string) => Promise<boolean>
  limpiar: () => void
}

export function useHacer(despues: () => void): Hacer {
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const hacer = useCallback(async (accion: () => Promise<void>, exito: string) => {
    setGuardando(true); setHecho(null); setFallo(null)
    try {
      await accion()
      setHecho(exito)
      despues()
      return true
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setGuardando(false)
    }
  }, [despues])
  const limpiar = useCallback(() => { setHecho(null); setFallo(null) }, [])
  return { guardando, hecho, fallo, hacer, limpiar }
}
