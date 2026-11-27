// src/modules/conta/gestoria/r21/datos.ts
//
// R21 · «Facturar el mes» · lo que se lee y se guarda de lo NUEVO del R21 (la 1826): lo dejado para después y el visto
// bueno de QBO. Lo demás (el cobro, las decisiones del banco, lo mandado a Cegid, las facturas de Cegid) se lee y se
// escribe con lo que ya está en main (q10/datos.ts, services/cegidService.ts): no se duplica.
// Columnas de conta_factura_pendiente y conta_factura_visto_bueno: las de la 1826 (regla 40).

import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import type { PendienteGuardado, TipoCaso, VistoBueno } from '../../../../../supabase/functions/_shared/factura/facturarMes'

type Fila = Record<string, unknown>
const cent = (v: unknown) => Math.round(Number(v ?? 0) * 100)
const frase = (r: Fila | null, porDefecto: string) => String(r?.frase ?? porDefecto)

/** Lo dejado para después y aún vivo (ni deshecho ni resuelto) de una empresa, de todos los meses. */
export async function leerPendientes(empresa: string): Promise<PendienteGuardado[]> {
  const r = await tabla('conta_factura_pendiente').select('id, clave, tipo, mes, cliente, importe, motivo, dejado_por, dejado_at')
    .eq('company_id', empresa).is('deshecho_at', null).is('resuelto_at', null).order('mes').order('dejado_at')
  if (r.error) throw new Error(mensaje('No se han podido leer los pendientes', r.error))
  return ((r.data ?? []) as Fila[]).map((x) => ({
    id: String(x.id), clave: String(x.clave), tipo: String(x.tipo) as TipoCaso, mes: String(x.mes).slice(0, 7), cliente: x.cliente == null ? null : String(x.cliente),
    importeCent: cent(x.importe), motivo: String(x.motivo), dejadoPor: x.dejado_por == null ? null : String(x.dejado_por), dejadoAt: String(x.dejado_at),
  }))
}

/** Los pendientes de meses de antes resueltos en este mes: se facturan ahora (cuentan como cobrado del mes en el cuadre). */
export async function leerResueltosEnElMes(empresa: string, mes: string): Promise<{ clave: string; mes: string; importeCent: number }[]> {
  const r = await tabla('conta_factura_pendiente').select('clave, mes, importe').eq('company_id', empresa).eq('resuelto_mes', `${mes}-01`).lt('mes', `${mes}-01`)
  if (r.error) throw new Error(mensaje('No se han podido leer los pendientes resueltos', r.error))
  return ((r.data ?? []) as Fila[]).map((x) => ({ clave: String(x.clave), mes: String(x.mes).slice(0, 7), importeCent: cent(x.importe) }))
}

export interface Dejar { empresa: string; clave: string; tipo: TipoCaso; mes: string; cliente: string | null; importeCent: number; motivo: string }
/** «Dejar para después» (conta_factura_dejar). Devuelve la frase y el id. */
export async function dejarParaDespues(d: Dejar): Promise<{ id: string; frase: string }> {
  // eslint-disable-next-line no-restricted-syntax -- importeCent es un entero (céntimos): a euros con dos decimales
  const r = await rpc<Fila>('conta_factura_dejar', { p_company: d.empresa, p_clave: d.clave, p_tipo: d.tipo, p_mes: `${d.mes}-01`, p_cliente: d.cliente, p_importe: (d.importeCent / 100).toFixed(2), p_motivo: d.motivo })
  return { id: String(r?.id ?? ''), frase: frase(r, 'Dejado para después.') }
}
/** «Deshacer» de «Dejar para después»: apunta quién y cuándo; no borra. */
export async function deshacerPendiente(id: string): Promise<string> {
  return frase(await rpc<Fila>('conta_factura_deshacer_pendiente', { p_id: id }), 'Deshecho.')
}
/** Un pendiente resuelto: se factura en el mes en que se resuelve. */
export async function resolverPendiente(id: string, mes: string): Promise<string> {
  return frase(await rpc<Fila>('conta_factura_resolver_pendiente', { p_id: id, p_mes: `${mes}-01` }), 'Resuelto.')
}

/** El visto bueno vivo de QBO de un mes y una serie, o null. */
export async function leerVistoBueno(empresa: string, mes: string, serie = '1'): Promise<VistoBueno | null> {
  const r = await tabla('conta_factura_visto_bueno').select('serie, total, facturas, quien, at').eq('company_id', empresa).eq('mes', `${mes}-01`).eq('serie', serie)
    .is('sustituido_at', null).maybeSingle()
  if (r.error) throw new Error(mensaje('No se ha podido leer el visto bueno', r.error))
  const x = r.data as Fila | null
  return x ? { serie: String(x.serie), totalCent: cent(x.total), facturas: Number(x.facturas), quien: x.quien == null ? null : String(x.quien), at: String(x.at) } : null
}
/** «Coincide: mandar el listado a QBO»: apunta el total y el número de facturas, quién y cuándo. Sin correo (R21). */
export async function darVistoBueno(empresa: string, mes: string, serie: string, totalCent: number, facturas: number): Promise<string> {
  // eslint-disable-next-line no-restricted-syntax -- totalCent es un entero (céntimos): a euros con dos decimales
  return frase(await rpc<Fila>('conta_factura_visto_bueno_dar', { p_company: empresa, p_mes: `${mes}-01`, p_serie: serie, p_total: (totalCent / 100).toFixed(2), p_facturas: facturas }), 'Apuntado.')
}

/**
 * R21e · Lo que GoCardless tiene previsto cobrar en el mes (las suscripciones activas con su próximo cobro en él), para el
 * mes que aún no tiene cobros. Columnas de conta_gc_suscripcion comprobadas el 27/11 (regla 40).
 */
export async function leerPrevistoGc(empresa: string, mes: string): Promise<{ cent: number; cargos: number; primero: string | null }> {
  const [a, m] = mes.split('-').map(Number)
  const fin = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10)
  const r = await tabla('conta_gc_suscripcion').select('proximo_cobro_fecha, proximo_cobro_importe').eq('company_id', empresa).eq('estado', 'active')
    .gte('proximo_cobro_fecha', `${mes}-01`).lt('proximo_cobro_fecha', fin).limit(5000)
  if (r.error) throw new Error(mensaje('No se ha podido leer lo que GoCardless tiene previsto', r.error as never))
  const filas = (r.data ?? []) as Fila[]
  const fechas = filas.map((x) => String(x.proximo_cobro_fecha)).sort()
  return { cent: filas.reduce((t, x) => t + cent(x.proximo_cobro_importe), 0), cargos: filas.length, primero: fechas[0] ?? null }
}
