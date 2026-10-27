// src/modules/conta/services/reaperturaIvaService.ts
//
// V04 · Respuesta 5, punto 3 · «Reabrir para corregir» un periodo con el IVA
// presentado. Escribe solo por las funciones de la base (1408), que deciden
// quién puede y lo marcan todo. Nombres dentro de cadenas (regla 40), de la
// 1408: conta_iva_reaperturas(p_company, p_year), conta_iva_puede_reabrir(p_company),
// conta_iva_reabrir(p_return, p_motivo, p_tipo, p_quien_nombre),
// conta_iva_reapertura_presentada(p_reopening, p_csv, p_fecha, p_resultado,
// p_importe, p_quien_nombre); y las tablas vat_reopening_entry (entry_id,
// action, at, by_name, reopening_id) y vat_reopening (reason, period,
// fiscal_year, kind; su nueva declaración por vat_reopening_new_return_id_fkey).

import { supabase } from '@/lib/supabase'
import { hayBase, rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { ErrorDeBase } from '@/modules/conta/lib/errorBase'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export interface Presentacion { id: string; secuencia: number; estado: string; presentada: string | null; csv: string | null; importe: number | null; resultado: string | null }
export interface Reapertura {
  id: string; periodo: string; ejercicio: number; tipo: 'complementary' | 'substitutive'; motivo: string
  abierta: string; por: string | null; cerrada: string | null; cerradaPor: string | null; dias: number; asientos: number
  original: Presentacion; nueva: Presentacion
}

const aPresentacion = (f: Fila): Presentacion => ({
  id: String(f.id), secuencia: Number(f.secuencia), estado: String(f.estado), presentada: s(f.presentada), csv: s(f.csv),
  importe: f.importe === null || f.importe === undefined ? null : Number(f.importe), resultado: s(f.resultado),
})

/** Si la base aún no tiene la 1408, no hay reaperturas (y nadie puede reabrir). */
async function llamar<T>(nombre: string, args: Record<string, unknown>, siFalta: T): Promise<T> {
  hayBase()
  const cliente = supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: ErrorDeBase | null }> }
  const { data, error } = await cliente.rpc(nombre, args)
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message)) return siFalta
    throw new Error(mensaje('No he podido leer las reaperturas del IVA', error))
  }
  return data as T
}

export async function leerReaperturas(companyId: string, ejercicio: number): Promise<Reapertura[]> {
  const filas = await llamar<Fila[]>('conta_iva_reaperturas', { p_company: companyId, p_year: ejercicio }, [])
  return (Array.isArray(filas) ? filas : []).map((f) => ({
    id: String(f.id), periodo: String(f.periodo), ejercicio: Number(f.ejercicio), tipo: f.tipo === 'substitutive' ? 'substitutive' : 'complementary',
    motivo: String(f.motivo ?? ''), abierta: String(f.abierta), por: s(f.por), cerrada: s(f.cerrada), cerradaPor: s(f.cerrada_por),
    dias: Number(f.dias ?? 0), asientos: Number(f.asientos ?? 0), original: aPresentacion(f.original as Fila), nueva: aPresentacion(f.nueva as Fila),
  }))
}

export async function puedeReabrir(companyId: string): Promise<boolean> {
  return (await llamar<boolean>('conta_iva_puede_reabrir', { p_company: companyId }, false)) === true
}

export async function reabrir(declaracionId: string, motivo: string, tipo: 'complementary' | 'substitutive', quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_iva_reabrir', { p_return: declaracionId, p_motivo: motivo, p_tipo: tipo, p_quien_nombre: quien })
  return r.texto
}

export async function apuntarNuevaPresentacion(reaperturaId: string, csv: string, fecha: string, resultado: string, importe: number, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_iva_reapertura_presentada', {
    p_reopening: reaperturaId, p_csv: csv, p_fecha: fecha, p_resultado: resultado, p_importe: importe, p_quien_nombre: quien,
  })
  return r.texto
}

export interface MarcaReapertura { accion: string; en: string; por: string | null; motivo: string; periodo: string; ejercicio: number; tipo: 'complementary' | 'substitutive'; secuencia: number }

/** Las marcas de un asiento: qué se hizo con él mientras su periodo estaba reabierto. Sin la 1408, ninguna. */
export async function marcasDelAsiento(accountId: string, entryId: string): Promise<MarcaReapertura[]> {
  const { data, error } = await tabla('vat_reopening_entry')
    .select('action, at, by_name, vat_reopening(reason, period, fiscal_year, kind, nueva:tax_return!vat_reopening_new_return_id_fkey(sequence))')
    .eq('account_id', accountId).eq('entry_id', entryId).order('at')
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message)) return []
    throw new Error(mensaje('No he podido leer si se cambió con el periodo reabierto', error))
  }
  return ((data ?? []) as Fila[]).map((f) => {
    const o = (f.vat_reopening ?? {}) as Fila
    return { accion: String(f.action), en: String(f.at), por: s(f.by_name), motivo: String(o.reason ?? ''), periodo: String(o.period ?? ''),
      ejercicio: Number(o.fiscal_year ?? 0), tipo: o.kind === 'substitutive' ? 'substitutive' : 'complementary', secuencia: Number(((o.nueva ?? {}) as Fila).sequence ?? 0) }
  })
}
