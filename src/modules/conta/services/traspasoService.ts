// src/modules/conta/services/traspasoService.ts
//
// C12 (Julio, 24/10) · Traspasar el mes a Diez, desde Contabilidad › Cierre.
// Nombres dentro de cadenas (regla 40), los de 20261024T1250_c12_traspaso_mensual
// y la función conta-diez-traspaso: conta_traspaso_revisar, conta_traspaso_confirmar,
// conta_diez_traspaso (detalle y cuadre) y conta-diez-traspaso (tanda y comprobar).
// B01r26: y las acciones excel, crear_subcuentas e importado de conta-diez-traspaso.

import { supabase } from '@/lib/supabase'
import { hayBase, rpc, tabla } from '@/modules/conta/services/bd'
import type { Cuadre, FalloTraspaso, Revision, Traspaso } from '@/modules/conta/lib/traspaso'

const sinPrefijo = (e: unknown): Error => new Error((e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, ''))

/** Lo que falta, lo que va y cómo está el traspaso del mes. */
export async function revisarMes(companyId: string, mes: string): Promise<Revision> {
  try { return await rpc<Revision>('conta_traspaso_revisar', { p_company: companyId, p_mes: mes }) } catch (e) { throw sinPrefijo(e) }
}

/** Confirmar el traspaso después de ver el resumen: queda quién y cuándo (la autorización de Julio para Diez real). */
export async function confirmarTraspaso(companyId: string, mes: string): Promise<{ id: string; van: number; faltaban: number }> {
  try { return await rpc('conta_traspaso_confirmar', { p_company: companyId, p_mes: mes }) } catch (e) { throw sinPrefijo(e) }
}

/** El traspaso entero, con lo que no ha llegado y el cuadre (para el informe). */
export async function leerTraspaso(companyId: string, mes: string): Promise<Traspaso | null> {
  const { data, error } = await tabla('conta_diez_traspaso')
    .select('id, mes, estado, confirmado_por_nombre, confirmado_en, faltaba, resumen, van, llegaron, no_llegaron, detalle, cuadre, cuadra, mes_cerrado, cierre_motivo, terminado_en')
    .eq('company_id', companyId).eq('mes', mes).maybeSingle()
  if (error) throw new Error(`No se ha podido leer el traspaso: ${error.message}`)
  return (data as Traspaso | null) ?? null
}

export type ResultadoTanda = { llegaron: number; llegaron_total: number; van: number; no_llegaron: number; fallaron: FalloTraspaso[]; quedan: number; por_excel?: number }
export type ResultadoComprobar = { cuadra: boolean | null; cuadre: Cuadre; mes_cerrado: boolean; motivo: string | null }

async function llamar<T>(body: Record<string, unknown>): Promise<T> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-diez-traspaso', { body })
  if (!error) return data as T
  // La función contestó con un error: su cuerpo dice por qué, en palabras.
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const cuerpo = await ctx.clone().json().catch(() => null) as { error?: string } | null
    throw new Error(cuerpo?.error ?? (ctx.status === 404 ? 'el traspaso a Diez aún no está publicado en este entorno' : `la función ha contestado ${ctx.status}`))
  }
  throw new Error(`no se ha podido hablar con el traspaso a Diez (${error.message})`)
}

/** Una tanda: manda a Diez los siguientes del mes. */
export const traspasarTanda = (companyId: string, mes: string) => llamar<ResultadoTanda>({ company_id: companyId, mes, accion: 'tanda' })
/** El cuadre con Diez y, si llegó todo y cuadra, el mes cerrado. */
export const comprobarConDiez = (companyId: string, mes: string) => llamar<ResultadoComprobar>({ company_id: companyId, mes, accion: 'comprobar' })

// ── B01r26 · Las facturas por Excel, con su PDF ──────────────────────────────

export type SubcuentaQueFalta = { codigo: string; nombre: string }
export type PorLaApi = { entry_id: string; numero: string; motivo: string }
/** Una fila del Excel tal como llega (las fechas, en texto ISO: las convierte el libro). */
export type FilaExcel = (string | number)[]
export type ResultadoExcel = { base: string; faltan: SubcuentaQueFalta[]; comprobadas: number; emitidas?: FilaExcel[]; recibidas?: FilaExcel[]; por_la_api: PorLaApi[] }
export type ResultadoSubcuentas = { base: string; intentadas?: number; creadas: (SubcuentaQueFalta & { recortado?: boolean })[]; no_creadas?: (SubcuentaQueFalta & { porque: string })[]; faltan: SubcuentaQueFalta[]; otra_vez?: number }
export type ResultadoImportado = { van_por_excel: number; enlazadas: number; faltan: { entry_id: string; numero: string }[]; dobles: string[]; dias_sin_leer?: string[] }

/** «2 · Descarga los dos Excel»: comprueba las subcuentas en Diez y, si están todas, da las filas. */
export const prepararExcel = (companyId: string, mes: string) => llamar<ResultadoExcel>({ company_id: companyId, mes, accion: 'excel' })
/** «Crearlas en Diez»: las subcuentas que faltan, con el nombre de Sumied (queda quién y cuándo). */
export const crearSubcuentasEnDiez = (companyId: string, mes: string) => llamar<ResultadoSubcuentas>({ company_id: companyId, mes, accion: 'crear_subcuentas' })
/** «3 · Ya lo he importado»: lee las facturas del mes en Diez y enlaza cada una con la suya. */
export const yaLoHeImportado = (companyId: string, mes: string) => llamar<ResultadoImportado>({ company_id: companyId, mes, accion: 'importado' })
