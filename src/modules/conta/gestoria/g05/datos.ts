// src/modules/conta/gestoria/g05/datos.ts
//
// G05 · Tarea 4 · Lo que lee y hace «Revisar el cobro».
//   · Leer: UNA llamada, ya agregada en la base (conta_pantalla_cobro, 1006):
//     el mes, los ajustes, la conexión y los recibos (regla de Julio: toda
//     pantalla abre en menos de 1 s, con una sola lectura).
//   · Preparar y enviar: la función conta-cobro (el servidor calcula los
//     recibos con los núcleos y manda a GoCardless, solo con una conexión de
//     pruebas). Lo que se cobra nunca sale del navegador.
//   · Decidir: «Aprobar» / «Este mes no» (conta_cobro_decidir) y «Aprobar los
//     N» iguales (conta_cobro_aprobar_iguales). Cada una devuelve su frase.

import { rpc } from '@/modules/conta/services/bd'
import { supabase } from '@/lib/supabase'
import type { DatosCobro } from './modeloCobro'
import type { DatosFichaRecibo } from './modeloFicha'

type Fila = Record<string, unknown>

export async function leerCobro(cuenta: string, empresa: string, mes: string): Promise<DatosCobro> {
  const d = (await rpc<Fila | null>('conta_pantalla_cobro', { p_cuenta: cuenta, p_company: empresa, p_mes: mes })) ?? {}
  return {
    mes: (d.mes as DatosCobro['mes']) ?? null,
    ajustes: (d.ajustes as DatosCobro['ajustes']) ?? null,
    conexion: (d.conexion as DatosCobro['conexion']) ?? null,
    recibos: Array.isArray(d.recibos) ? (d.recibos as DatosCobro['recibos']) : [],
  }
}

/** Llama a conta-cobro y devuelve su frase; si falla, el porqué que da (regla 8). */
async function cobro(body: Record<string, unknown>, que: string): Promise<string> {
  if (!supabase) throw new Error(`${que}: no hay conexión con la base.`)
  const { data, error } = await supabase.functions.invoke('conta-cobro', { body })
  if (!error) return String((data as Fila | null)?.frase ?? `${que}: hecho.`)
  const ctx = (error as { context?: Response }).context
  const cuerpo = ctx && typeof ctx.json === 'function' ? ((await ctx.clone().json().catch(() => null)) as Fila | null) : null
  const porque = typeof cuerpo?.error === 'string' ? cuerpo.error : null
  throw new Error(porque ?? `${que}: ${ctx?.status === 404 ? 'el cobro aún no está publicado en este entorno' : error.message}`)
}

export const prepararCobro = (empresa: string, mes: string) => cobro({ accion: 'preparar', empresa, mes }, 'No se ha preparado el cobro')
export const enviarCobro = (empresa: string, mes: string) => cobro({ accion: 'enviar', empresa, mes }, 'No se ha enviado el cobro')

export async function decidir(recibo: string, decision: 'pendiente' | 'aprobado' | 'este_mes_no'): Promise<string> {
  const r = await rpc<Fila>('conta_cobro_decidir', { p_recibo: recibo, p_decision: decision })
  return String(r?.frase ?? 'Hecho.')
}

/** nº 46 · «Volver a cobrar»: la gestoría deshace lo que paró el cliente desde el portal (conta_recibo_reanudar). */
export async function reanudar(recibo: string): Promise<string> {
  const r = await rpc<Fila>('conta_recibo_reanudar', { p_recibo: recibo })
  return String(r?.frase ?? 'Hecho.')
}

export async function aprobarIguales(empresa: string, mes: string): Promise<string> {
  const r = await rpc<Fila>('conta_cobro_aprobar_iguales', { p_company: empresa, p_mes: mes })
  return String(r?.frase ?? 'Hecho.')
}

/**
 * La ficha de una factura que sale de un recibo, en UNA lectura
 * (conta_pantalla_factura_recibo, 1403): su recibo, lo que le ha pasado, su
 * Verifactu y sus asientos con los apuntes. Null si no sale de un recibo.
 */
export async function leerFichaRecibo(cuenta: string, factura: string): Promise<DatosFichaRecibo | null> {
  const d = await rpc<DatosFichaRecibo | null>('conta_pantalla_factura_recibo', { p_cuenta: cuenta, p_factura: factura })
  return d && d.recibo ? { ...d, eventos: d.eventos ?? [], asientos: d.asientos ?? [] } : null
}
