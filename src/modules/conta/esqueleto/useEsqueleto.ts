// src/modules/conta/esqueleto/useEsqueleto.ts
//
// S01 · El estado del esqueleto: las preferencias de la persona (de la base) y
// lo que decide qué sale en esta empresa (hostelería, Diez, interruptores).
//
//   · Las preferencias se enseñan al momento y se guardan detrás; si la base
//     dice que no, vuelven a como estaban y el aviso lo dice (regla 8: un
//     cambio que no se guarda no se calla).
//   · La primera vez que alguien entra sin fila, se trae lo que el M01 dejó
//     en su navegador (densidad, barra, documento) y se guarda en la base.
//   · Mientras se lee la empresa, nada de hostelería ni de Diez: mejor que
//     salga un momento tarde que un momento de más.

import { useCallback, useEffect, useState } from 'react'
import { guardarPreferencias, leerContexto, leerPreferencias } from '@/modules/conta/services/esqueletoService'
import { DE_SERIE, deNavegador, type Preferencias } from './preferencias'
import type { Contexto } from './productos'

const almacen = (): Storage | null => { try { return window.localStorage } catch { return null } }

export const CONTEXTO_VACIO: Contexto = { hosteleria: false, diez: false, interruptores: new Set() }

export interface Aviso { texto: string; tono: 'ok' | 'falta' }

export function usePreferenciasEsqueleto(accountId: string | null, userId: string | null) {
  const clave = accountId && userId ? `${accountId}:${userId}` : null
  const [estado, setEstado] = useState<{ clave: string | null; prefs: Preferencias; cargadas: boolean }>({ clave: null, prefs: DE_SERIE, cargadas: false })
  const [aviso, setAviso] = useState<Aviso | null>(null)

  useEffect(() => {
    if (!accountId || !userId || !clave) return
    let vivo = true
    ;(async () => {
      try {
        const guardadas = await leerPreferencias(accountId, userId)
        const prefs = guardadas ?? await guardarPreferencias(accountId, userId, { ...DE_SERIE, ...deNavegador(userId, almacen()) })
        if (vivo) setEstado({ clave, prefs, cargadas: true })
      } catch (e) {
        if (!vivo) return
        // Sin poder leer, se trabaja con lo de serie y se dice.
        setEstado({ clave, prefs: { ...DE_SERIE, ...deNavegador(userId, almacen()) }, cargadas: true })
        setAviso({ texto: `${e instanceof Error ? e.message : String(e)}. Mientras, ves las de serie.`, tono: 'falta' })
      }
    })()
    return () => { vivo = false }
  }, [accountId, userId, clave])

  const cambiar = useCallback((cambio: Partial<Preferencias>, dicho?: string) => {
    if (!accountId || !userId) return
    // Lo de antes, para volver si la base dice que no (se coge en el mismo cambio).
    let antes: Preferencias = DE_SERIE
    setEstado((e) => {
      antes = e.clave === clave ? e.prefs : DE_SERIE
      return { clave, prefs: { ...antes, ...cambio }, cargadas: true }
    })
    guardarPreferencias(accountId, userId, cambio)
      .then((prefs) => {
        setEstado({ clave, prefs, cargadas: true })
        if (dicho) setAviso({ texto: dicho, tono: 'ok' })
      })
      .catch((e: unknown) => {
        setEstado({ clave, prefs: antes, cargadas: true })
        setAviso({ texto: `${e instanceof Error ? e.message : String(e)}. No ha cambiado nada.`, tono: 'falta' })
      })
  }, [accountId, userId, clave])

  const prefs = estado.clave === clave ? estado.prefs : DE_SERIE
  return { prefs, cargadas: estado.clave === clave && estado.cargadas, cambiar, aviso, quitarAviso: () => setAviso(null) }
}

export function useContextoEsqueleto(accountId: string | null, companyId: string | null) {
  const clave = accountId ? `${accountId}:${companyId ?? ''}` : null
  const [estado, setEstado] = useState<{ clave: string | null; ctx: Contexto; error: string | null }>({ clave: null, ctx: CONTEXTO_VACIO, error: null })
  useEffect(() => {
    if (!accountId || !clave) return
    let vivo = true
    leerContexto(accountId, companyId)
      .then((ctx) => { if (vivo) setEstado({ clave, ctx, error: null }) })
      .catch((e: unknown) => { if (vivo) setEstado({ clave, ctx: CONTEXTO_VACIO, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, companyId, clave])
  const alDia = estado.clave === clave
  return { ctx: alDia ? estado.ctx : CONTEXTO_VACIO, error: alDia ? estado.error : null }
}
