// src/modules/multitenancy/services/marcasLastService.ts
//
// F01 · Marcas de Last: leer las marcas de las cartas de Last de la cuenta y
// darlas de alta en una sola llamada. La lógica vive en la base
// (20261027T1320_f01_marcas_last.sql); las frases, en lib/marcasLast.ts.

import { rpcSinTipar } from '@/lib/rpcSinTipar'
import { leerAlta, leerMarcas, type MarcaLast, type ResultadoAlta } from '../lib/marcasLast'

/** Las marcas de Last de la cuenta, en sus locales activos. Vacío si no administras la cuenta. */
export async function leerMarcasLast(accountId: string): Promise<MarcaLast[]> {
  return leerMarcas(await rpcSinTipar<unknown>('f01_marcas_last', { p_account: accountId }))
}

export interface DatosAlta {
  accountId: string
  org: string
  nombreLast: string
  nombre: string
  propia: boolean
  socio: string | null
}

/** Lo que haría el alta, sin tocar nada (el panel lo enseña antes del botón). */
export async function ensayarAlta(d: DatosAlta): Promise<ResultadoAlta> {
  return leerAlta(await rpcSinTipar<unknown>('f01_alta_marca', {
    p_account: d.accountId, p_org: d.org, p_nombre_last: d.nombreLast, p_nombre: d.nombre,
    p_propia: d.propia, p_socio: d.socio, p_ensayo: true,
  }))
}

/** El alta de verdad: marca, socio, locales, plataformas, vínculo, carta y lo vendido antes. */
export async function darDeAlta(d: DatosAlta): Promise<ResultadoAlta> {
  return leerAlta(await rpcSinTipar<unknown>('f01_alta_marca', {
    p_account: d.accountId, p_org: d.org, p_nombre_last: d.nombreLast, p_nombre: d.nombre,
    p_propia: d.propia, p_socio: d.socio, p_ensayo: false,
  }))
}

/** «No la uso» (ocultar = true) o «Volver a mostrar» (false). Devuelve la frase que se enseña (regla 8). */
export async function ocultarMarca(accountId: string, org: string, nombreLast: string, ocultar: boolean): Promise<string> {
  const r = await rpcSinTipar<{ frase?: string }>('f01_ocultar_marca', { p_account: accountId, p_org: org, p_nombre_last: nombreLast, p_ocultar: ocultar })
  return r?.frase ?? (ocultar ? `${nombreLast} oculta.` : `${nombreLast} vuelve a salir.`)
}
