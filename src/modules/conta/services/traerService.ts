// src/modules/conta/services/traerService.ts
//
// N07 · «Traer de ERP10»: lo que la pantalla lee de la base y las cuatro cosas que hace en ella
// (N06a y N06b). Todo por cuenta y empresa (regla 9).
//
// Nombres de la base entre comillas (regla 40), comprobados en el esquema el 18/11:
// import_run, company_account, supplier, party, party_role, journal_entry; conta_empresa_dia_de_inicio,
// conta_traer_cargar, conta_traer_antes_de_dar_por_bueno, conta_traer_dar_por_bueno, conta_traer_deshacer.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { normalizarNif } from '@/modules/conta/lib/nif'
import type { DatosDeLaCarga, Diferencia, ResumenPagado, TerceroConPagos, YaEnSumied } from '@/modules/conta/lib/traer'

/** Lo traído que está en prueba en la empresa (como mucho, uno). */
export interface EnPrueba {
  id: string
  programa: string
  cuando: string
  quien: string | null
  desde: string | null
  hasta: string | null
  cuentas: Record<string, number>
  soloCuentas: boolean
  texto: string | null
  sumas: { cuenta: string; nombre: string; debe: number; haber: number }[]
  mirar: { que: string; cuenta?: string; frase: string }[]
  /** N09 · Los proveedores y clientes con pagos sin casar o cuyo pendiente no da su saldo (detail.pendientesNoExactos). */
  pagos: TerceroConPagos[]
  /** N09 · Las emitidas traídas, con su total, retención y lo que les queda (detail.emitidas, en euros). */
  emitidas: { total: number; retencion: number; pendiente: number | null }[]
}

export async function leerEnPrueba(accountId: string, companyId: string): Promise<EnPrueba | null> {
  const { data, error } = await tabla('import_run')
    .select('id, program, started_at, created_by_name, period_from, period_to, counts, detail')
    .eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'carga').eq('status', 'en_prueba')
    .order('started_at', { ascending: false }).limit(1)
  if (error) throw new Error(mensaje('No se ha podido leer lo traído en prueba', error))
  const r = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!r) return null
  const d = (r.detail ?? {}) as Record<string, unknown>
  return {
    id: String(r.id), programa: String(r.program), cuando: String(r.started_at), quien: r.created_by_name ? String(r.created_by_name) : null,
    desde: r.period_from ? String(r.period_from) : null, hasta: r.period_to ? String(r.period_to) : null,
    cuentas: (r.counts ?? {}) as Record<string, number>, soloCuentas: d.solo_plan === true, texto: d.texto ? String(d.texto) : null,
    sumas: Array.isArray(d.sumas) ? (d.sumas as EnPrueba['sumas']) : [],
    mirar: Array.isArray(d.mirar) ? (d.mirar as EnPrueba['mirar']) : [],
    pagos: Array.isArray(d.pendientesNoExactos) ? (d.pendientesNoExactos as TerceroConPagos[]) : [],
    emitidas: Array.isArray(d.emitidas) ? (d.emitidas as Record<string, unknown>[]).filter((e) => e.marca !== 'fuera')
      .map((e) => ({ total: Number(e.total ?? 0), retencion: Number(e.retencion ?? 0), pendiente: e.pendiente == null ? null : Number(e.pendiente) })) : [],
  }
}

/**
 * N09 · Cuántas facturas de lo traído están pagadas (o cobradas), con pago parcial y pendientes enteras, con lo que
 * guardó la base al traer (import_pending de las recibidas; el «pendiente» de las emitidas, en la carga).
 */
export async function resumenPagado(accountId: string, carga: string, emitidas: EnPrueba['emitidas']): Promise<ResumenPagado> {
  const { data, error } = await tabla('supplier_invoice').select('grand_total, withholding_amount, import_pending')
    .eq('account_id', accountId).eq('import_run_id', carga).eq('source', 'traida').or('import_mark.is.null,import_mark.neq.fuera')
  if (error) throw new Error(mensaje('No se ha podido leer lo pagado de lo traído', error))
  const r: ResumenPagado = { pagadas: 0, aMedias: 0, pendientes: 0 }
  const contar = (aPagar: number, pend: number | null) => {
    if (pend === null) return
    if (pend < 0.005) r.pagadas += 1
    else if (pend >= aPagar - 0.005) r.pendientes += 1
    else r.aMedias += 1
  }
  for (const f of (data ?? []) as Record<string, unknown>[]) contar(Number(f.grand_total ?? 0) - Number(f.withholding_amount ?? 0), f.import_pending == null ? null : Number(f.import_pending))
  for (const e of emitidas) contar(e.total - e.retencion, e.pendiente)
  return r
}

/** Lo último que se dio por bueno o se deshizo en la empresa: su confirmación, leída de la base (regla 8). */
export interface Ultima {
  estado: 'dada_por_buena' | 'deshecha'
  quien: string | null
  cuando: string
  /** Al darlo por bueno: el texto que guardó la base. */
  texto: string | null
  /** Al deshacer: lo que se quitó. */
  quitado: Record<string, number>
  soloCuentas: boolean
  cuentas: Record<string, number>
  textoAlTraer: string | null
}

export async function leerUltima(accountId: string, companyId: string): Promise<Ultima | null> {
  const { data, error } = await tabla('import_run')
    .select('id, status, created_by_name, started_at, counts, detail')
    .eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'carga').in('status', ['dada_por_buena', 'deshecha'])
    .order('started_at', { ascending: false }).limit(1)
  if (error) throw new Error(mensaje('No se ha podido leer lo último traído', error))
  const r = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!r) return null
  const d = (r.detail ?? {}) as Record<string, Record<string, unknown> | unknown>
  const estado = r.status === 'deshecha' ? 'deshecha' : 'dada_por_buena'
  const hecho = (d[estado === 'deshecha' ? 'deshecha' : 'dada'] ?? {}) as Record<string, unknown>
  return {
    estado, quien: hecho.por ? String(hecho.por) : null, cuando: String(hecho.el ?? r.started_at),
    texto: hecho.texto ? String(hecho.texto) : null, quitado: (hecho.quitado ?? {}) as Record<string, number>,
    soloCuentas: d.solo_plan === true, cuentas: (r.counts ?? {}) as Record<string, number>, textoAlTraer: d.texto ? String(d.texto) : null,
  }
}

/** Lo que ya está en Sumied: los códigos de cuenta de la empresa y los NIF de proveedores y clientes de la cuenta. */
export async function leerYaEnSumied(accountId: string, companyId: string): Promise<YaEnSumied> {
  const [c, s, p] = await Promise.all([
    tabla('company_account').select('code').eq('account_id', accountId).eq('company_id', companyId),
    tabla('supplier').select('tax_id').eq('account_id', accountId).is('archived_at', null).not('tax_id', 'is', null),
    tabla('party').select('tax_id, party_role!inner(role)').eq('account_id', accountId).eq('party_role.role', 'customer').not('tax_id', 'is', null),
  ])
  for (const r of [c, s, p]) if (r.error) throw new Error(mensaje('No se ha podido leer lo que ya está en Sumied', r.error))
  const nifs = (xs: unknown[] | null) => new Set((xs ?? []).map((x) => normalizarNif(String((x as Record<string, unknown>).tax_id ?? ''))).filter(Boolean))
  return {
    cuentas: new Set(((c.data ?? []) as unknown[]).map((x: unknown) => String((x as Record<string, unknown>).code))),
    nifsProveedores: nifs(s.data), nifsClientes: nifs(p.data),
  }
}

/** Los asientos apuntados en Sumied (no traídos) entre dos días: con alguno, la base no trae (N06a). */
export async function asientosApuntados(accountId: string, companyId: string, desde: string, hasta: string): Promise<{ n: number; desde: string; hasta: string }> {
  const { count, error } = await tabla('journal_entry').select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('company_id', companyId).neq('source_type', 'migrated').in('status', ['borrador', 'validado'])
    .gte('entry_date', desde).lte('entry_date', hasta)
  if (error) throw new Error(mensaje('No se han podido contar los asientos apuntados', error))
  return { n: count ?? 0, desde, hasta }
}

export const diaDeInicio = (companyId: string) => rpc<string | null>('conta_empresa_dia_de_inicio', { p_company: companyId })

/** X14 · Cuántos asientos y facturas lleva metidos en prueba una carga, de cuántos. */
export interface AvanceCarga { asientos: { hechos: number; de: number }; facturas: { hechos: number; de: number } }
type RespuestaCarga = { carga: string; acabado?: boolean; texto?: string; cuentas?: Record<string, number>; asientos?: AvanceCarga['asientos']; facturas?: AvanceCarga['facturas'] }
const avanceDe = (r: RespuestaCarga): AvanceCarga => ({ asientos: r.asientos ?? { hechos: 0, de: 0 }, facturas: r.facturas ?? { hechos: 0, de: 0 } })

/**
 * X14 · Llama a conta_traer_seguir hasta que la carga queda en prueba, diciendo cuánto lleva. Cada llamada mete lo que le cabe
 * en unos segundos (muy por debajo del corte de la sesión), sea la carga del tamaño que sea. Sin «acabado» (una base de antes
 * del X14), la carga ya entró entera.
 */
async function hastaAcabar(r: RespuestaCarga, avance?: (a: AvanceCarga) => void): Promise<{ carga: string; texto: string; cuentas: Record<string, number> }> {
  for (let i = 0; r.acabado === false; i++) {
    if (i > 20_000) throw new Error('La carga no avanza: vuelve a intentarlo.')
    avance?.(avanceDe(r))
    r = await rpc<RespuestaCarga>('conta_traer_seguir', { p_carga: r.carga })
  }
  avance?.(avanceDe(r))
  return { carga: r.carga, texto: r.texto ?? '', cuentas: r.cuentas ?? {} }
}

/** «Traerlo»: en prueba (X14: por trozos, hasta el final). Devuelve el texto de la base (regla 8). */
export async function traer(companyId: string, ejercicio: string | null, datos: DatosDeLaCarga, quien: string | null,
  avance?: (a: AvanceCarga) => void): Promise<{ carga: string; texto: string; cuentas: Record<string, number> }> {
  const r = await rpc<RespuestaCarga>('conta_traer_cargar', { p_company: companyId, p_ejercicio: ejercicio, p_datos: datos, p_quien_nombre: quien })
  return hastaAcabar(r, avance)
}

/** X14 · Sigue con una carga a medias (otra pestaña, o una vuelta que se cortó) hasta dejarla en prueba. */
export async function seguirCarga(carga: string, avance?: (a: AvanceCarga) => void): Promise<{ carga: string; texto: string; cuentas: Record<string, number> }> {
  return hastaAcabar(await rpc<RespuestaCarga>('conta_traer_seguir', { p_carga: carga }), avance)
}

/** X14 · La carga a medias de la empresa («cargando»), con lo que lleva; null si no hay. */
export async function leerAMedias(accountId: string, companyId: string): Promise<{ id: string; avance: AvanceCarga } | null> {
  const { data, error } = await tabla('import_run').select('id, detail')
    .eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'carga').eq('status', 'cargando')
    .order('started_at', { ascending: false }).limit(1)
  if (error) throw new Error(mensaje('No se ha podido leer si hay algo a medias', error))
  const r = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!r) return null
  const e = (((r.detail ?? {}) as Record<string, unknown>).estado ?? {}) as Record<string, unknown>
  const n = (x: unknown) => Number(x ?? 0) || 0
  return { id: String(r.id), avance: { asientos: { hechos: n(e.hechos_a), de: n(e.n_asientos) }, facturas: { hechos: n(e.hechos_f), de: n(e.n_facturas) } } }
}

export interface AntesDeDarlo { puede: boolean; texto: string; comparado: boolean; diferencias: Diferencia[]; asientos: number; facturas: number; si_hay_un_error: string }
export const antesDeDarlo = (carga: string) => rpc<AntesDeDarlo>('conta_traer_antes_de_dar_por_bueno', { p_carga: carga })

export async function darPorBueno(carga: string, quien: string | null): Promise<string> {
  return (await rpc<{ texto: string }>('conta_traer_dar_por_bueno', { p_carga: carga, p_quien_nombre: quien })).texto
}

export async function deshacer(carga: string, quien: string | null): Promise<string> {
  return (await rpc<{ texto: string }>('conta_traer_deshacer', { p_carga: carga, p_quien_nombre: quien })).texto
}
