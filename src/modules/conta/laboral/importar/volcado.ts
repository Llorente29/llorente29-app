// src/modules/conta/laboral/importar/volcado.ts
//
// N1 · PR 1 (01/11/2026) · De las filas de Cegid a las fichas y los contratos
// (lab_volcar_lote, 1938). Antes, cada centro de Cegid con su local, propuesto
// por el nombre y confirmado por el administrador (respuesta 3 de Julio): sin
// confirmar, nadie de ese centro entra.
//
// Lo que dice la pantalla al acabar sale de resumenVolcado, con números (regla
// 8) y sin esconder nada (regla 7): los avisos, uno por uno, y lo que cobra que
// no cuadra con la última nómina de Cegid, con las dos cifras y la diferencia.

import { supabase } from '@/lib/supabase'
import { mensajeDeError } from './importarService'

export interface CentroDelLote {
  centro: string
  personas: number
  propuesto: { id: string; nombre: string } | null
  confirmado: { id: string; nombre: string } | null
}

export interface NoCuadra { persona: string; cegid: number; conceptos: number }

export interface ResultadoVolcado {
  personas: number
  nuevasDeBaja: number
  yaEstaban: number
  contratos: number
  trabajadoresEnCegid: number
  contratosEnCegid: number
  avisos: number
  errores: number
  centrosSinConfirmar: string[]
  noCuadra: NoCuadra[]
  mensajes: string[]
}

// lab_centros_del_lote, lab_confirmar_centro y lab_volcar_lote son de la 1938 y
// aún no están en database.ts. Se llaman como método de supabase (con su
// «this»): suelto, rpc falla antes de salir a la red (e2e del LAB2, 30/10).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nombre: string, args: object) => (supabase!.rpc as any)(nombre, args) as Promise<{ data: unknown; error: { message?: string } | null }>

function aCentros(data: unknown): CentroDelLote[] {
  return ((data ?? []) as CentroDelLote[]).map((c) => ({
    centro: c.centro, personas: Number(c.personas ?? 0), propuesto: c.propuesto ?? null, confirmado: c.confirmado ?? null,
  }))
}

export async function centrosDelLote(loteId: string): Promise<CentroDelLote[]> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await rpc('lab_centros_del_lote', { p_lote: loteId })
  if (error) throw new Error(mensajeDeError(error))
  return aCentros(data)
}

export async function confirmarCentro(loteId: string, centro: string, locationId: string): Promise<CentroDelLote[]> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await rpc('lab_confirmar_centro', { p_lote: loteId, p_centro: centro, p_location_id: locationId })
  if (error) throw new Error(mensajeDeError(error))
  return aCentros(data)
}

export async function volcarLote(loteId: string): Promise<ResultadoVolcado> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await rpc('lab_volcar_lote', { p_lote: loteId })
  if (error) throw new Error(mensajeDeError(error))
  const r = (data ?? {}) as Record<string, unknown>
  const n = (k: string) => Number(r[k] ?? 0)
  return {
    personas: n('personas'), nuevasDeBaja: n('nuevas_de_baja'), yaEstaban: n('ya_estaban'), contratos: n('contratos'),
    trabajadoresEnCegid: n('trabajadores_en_cegid'), contratosEnCegid: n('contratos_en_cegid'),
    avisos: n('avisos'), errores: n('errores'),
    centrosSinConfirmar: (r.centros_sin_confirmar as string[] | undefined) ?? [],
    noCuadra: ((r.no_cuadra as NoCuadra[] | undefined) ?? []).map((x) => ({ persona: x.persona, cegid: Number(x.cegid), conceptos: Number(x.conceptos) })),
    mensajes: (r.mensajes as string[] | undefined) ?? [],
  }
}

const ENTERO = new Intl.NumberFormat('es-ES', { useGrouping: 'always' })
const EUROS = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' })
const plural = (n: number, uno: string, varios: string) => `${ENTERO.format(n)} ${n === 1 ? uno : varios}`

/** La frase de arriba: cuántas personas y contratos quedan al día, y de cuántos trae Cegid. */
export function resumenVolcado(r: ResultadoVolcado): string {
  const cabeza = `${plural(r.personas, 'persona', 'personas')} y ${plural(r.contratos, 'contrato', 'contratos')} al día desde Cegid`
  const detalle = [
    r.yaEstaban ? `${plural(r.yaEstaban, 'ya estaba', 'ya estaban')} en el equipo` : null,
    r.nuevasDeBaja ? `${plural(r.nuevasDeBaja, 'entra como baja', 'entran como bajas')}` : null,
  ].filter(Boolean).join(' · ')
  const fuera = r.trabajadoresEnCegid - r.personas
  const cola = fuera > 0
    ? `De las ${ENTERO.format(r.trabajadoresEnCegid)} de Cegid, ${plural(fuera, 'no ha entrado', 'no han entrado')}: abajo, el porqué.`
    : r.avisos + r.errores > 0 ? 'Mira los avisos de abajo.' : 'Sin avisos.'
  return `${cabeza}${detalle ? ` (${detalle})` : ''}. ${cola}`
}

/** Una línea por persona cuyo bruto no cuadra con su última nómina de Cegid. */
export function lineaNoCuadra(x: NoCuadra): string {
  const dif = x.conceptos - x.cegid
  return `${x.persona}: su última nómina de Cegid, ${EUROS.format(x.cegid)} brutos; sus conceptos (convenio + pactado), ${EUROS.format(x.conceptos)}. Diferencia: ${dif > 0 ? '+' : ''}${EUROS.format(dif)}.`
}
