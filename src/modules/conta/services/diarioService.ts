// src/modules/conta/services/diarioService.ts
//
// C04 · Tarea 4. Lo que leen y escriben las pantallas del libro (N11 Libro
// diario, N12 Asiento). Todo filtrado por cuenta y empresa (regla 9). Escribe
// solo por las funciones de la base (validar, anular, descartar, cerrar y
// reabrir mes) y, para el asiento a mano y «Cambiar» una cuenta, por la RLS,
// que solo deja tocar lo que no está validado. Lo validado no se toca: se anula.
//
// Nombres dentro de cadenas (regla 40), comprobados contra el esquema de
// staging-conta el 07/10: journal_entry, journal_line (company_account,
// locations, brand, tax_rate por sus claves ajenas), fiscal_year,
// fiscal_period_lock, company_account, locations, sales_day_summary,
// supplier_invoice, channel_settlement, licensed_settlement, payroll_summary,
// conta_resultado_por_local, conta_dias_por_asentar, journal_entry_validar,
// journal_entry_anular, journal_entry_descartar, journal_cadena_comprobar,
// conta_cerrar_mes, conta_reabrir_mes; pgc_account (code, name, plan) y
// company_account.kind / plain_name / template_code / plan (12/10).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { AsientoDiario, ApunteDiario, CierreMes, EstadoAsiento, FuenteCierre, LineaMano } from '@/modules/conta/lib/diario'
import { finDeMes, importeMano, nombreDeUso } from '@/modules/conta/lib/diario'
import type { Confianza, OrigenAsiento, Razon, Serie } from '@/modules/conta/lib/libro'
import { apuntarCorreccion } from '@/modules/conta/services/propuestasLibroService'
import { normalizarHora } from '@/modules/conta/lib/cierreDelDia'
import { autorVisible, esFirmaAutomatica } from '@/modules/conta/lib/autor'
import type { DeclaracionSinPagar } from '@/modules/conta/lib/pagoDeModelo'
import type { LineaPredefinida, Predefinido } from '@/modules/conta/lib/tipoAsiento'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const sinPrefijo = (e: unknown): Error => new Error((e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, ''))

const CAMPOS_ASIENTO = [
  'id, series, number, entry_date, concept, source_type, source_id, status, confidence, reason, reasons, party_id, document_ref, document_date',
  'external_program, external_series, external_number, validated_at, validated_by_name, chain_seq, prev_hash, hash',
  'reverses_entry_id, voided_by_entry_id, voided_at, voided_by_name, void_reason, created_at, created_by_name',
  'journal_line(position, company_account_id, debit, credit, concept, location_id, is_common, brand_id, document_ref, tax_rate_id, tax_base, vat_book, withholding_base, withholding_model, withholding_period, external_negative_side, company_account(code, name, kind, plain_name, template_code, plan), locations(name), brand(name, ownership_type), tax_rate(rate))',
].join(', ')

function aApunte(l: Fila): ApunteDiario {
  const ca = (l.company_account ?? {}) as Fila
  const lo = (l.locations ?? null) as Fila | null
  const br = (l.brand ?? null) as Fila | null
  const tr = (l.tax_rate ?? null) as Fila | null
  return {
    posicion: n(l.position), cuentaId: String(l.company_account_id), cuenta: String(ca.code ?? ''),
    nombreCuenta: nombreDeUso({ kind: s(ca.kind), name: String(ca.name ?? ''), plainName: s(ca.plain_name) }),
    tituloOficial: ca.kind === 'own' ? null : s(ca.name),
    debe: n(l.debit), haber: n(l.credit), concepto: s(l.concept), localId: s(l.location_id), local: lo ? s(lo.name) : null,
    comun: l.is_common === true, marcaId: s(l.brand_id), marca: br ? s(br.name) : null, cedida: br?.ownership_type === 'licensed',
    documento: s(l.document_ref),
    iva: l.tax_rate_id ? { tipoId: String(l.tax_rate_id), base: n(l.tax_base), libro: String(l.vat_book ?? ''), tipo: tr ? n(tr.rate) : null } : null,
    retencion: l.withholding_model ? { base: n(l.withholding_base), modelo: String(l.withholding_model), periodo: s(l.withholding_period) } : null,
    negativoEnDiez: l.external_negative_side === 'debe' || l.external_negative_side === 'haber' ? l.external_negative_side : null,
  }
}

function aAsiento(f: Fila): AsientoDiario {
  const razones = Array.isArray(f.reasons) ? (f.reasons as Fila[]).map((r): Razon => ({ decision: String(r.decision ?? ''), porque: String(r.porque ?? ''), cita: s(r.cita) ?? undefined })) : []
  return {
    id: String(f.id), serie: n(f.series) as Serie, numero: f.number === null ? null : n(f.number), fecha: String(f.entry_date), concepto: String(f.concept),
    origen: String(f.source_type) as OrigenAsiento, origenId: s(f.source_id), estado: String(f.status) as EstadoAsiento,
    confianza: s(f.confidence) as Confianza | null, porque: s(f.reason), razones, documento: s(f.document_ref), fechaDocumento: s(f.document_date), terceroId: s(f.party_id),
    creadoPor: autorVisible(s(f.created_by_name)), creadoEn: String(f.created_at), validadoPor: autorVisible(s(f.validated_by_name)), validadoEn: s(f.validated_at),
    validadoAutomatico: esFirmaAutomatica(s(f.validated_by_name)),
    anuladoPor: autorVisible(s(f.voided_by_name)), anuladoEn: s(f.voided_at), motivoAnulacion: s(f.void_reason), anuladoCon: s(f.voided_by_entry_id), anulaA: s(f.reverses_entry_id),
    traido: f.external_program ? { programa: String(f.external_program), serie: s(f.external_series), numero: s(f.external_number) } : null,
    huella: s(f.hash), huellaAnterior: s(f.prev_hash), cadena: f.chain_seq === null ? null : n(f.chain_seq),
    apuntes: ((f.journal_line ?? []) as Fila[]).map(aApunte).sort((a, b) => a.posicion - b.posicion),
  }
}

/** Los asientos de la empresa entre dos fechas (todos los estados: un filtro no esconde). */
export async function leerAsientos(accountId: string, companyId: string, desde: string, hasta: string): Promise<AsientoDiario[]> {
  const { data, error } = await tabla('journal_entry').select(CAMPOS_ASIENTO)
    .eq('account_id', accountId).eq('company_id', companyId).gte('entry_date', desde).lte('entry_date', hasta)
    .order('entry_date', { ascending: false }).limit(5000)
  if (error) throw new Error(mensaje('No se ha podido leer el libro', error))
  const asientos = ((data ?? []) as Fila[]).map(aAsiento)
  // V01 · Entrega 2: las propuestas de ventas del día entero (sin canal) se quedan en Asientos.
  const sinCanal = await ventasSinCanal(accountId, companyId, asientos.filter((a) => a.origen === 'sales_day' && a.estado === 'propuesto').map((a) => a.origenId))
  return sinCanal.size ? asientos.map((a) => (a.origenId && sinCanal.has(a.origenId) ? { ...a, sinCanal: true } : a)) : asientos
}

/**
 * V01 · Entrega 2 · De estos resúmenes del día (origen de un asiento de ventas),
 * los que no son de un canal: los días asentados enteros «a la antigua», que
 * no salen en Ventas › Cierres del día y se deciden en Asientos.
 * Nombres dentro de cadenas (regla 40): sales_day_summary (id, channel_id).
 */
export async function ventasSinCanal(accountId: string, companyId: string, resumenes: readonly (string | null)[]): Promise<Set<string>> {
  const ids = [...new Set(resumenes.filter((x): x is string => !!x))]
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await tabla('sales_day_summary').select('id').eq('account_id', accountId).eq('company_id', companyId)
      .in('id', ids.slice(i, i + 200)).is('channel_id', null)
    if (error) throw new Error(mensaje('No se han podido leer los resúmenes de ventas', error))
    for (const f of (data ?? []) as Fila[]) out.add(String(f.id))
  }
  return out
}

/**
 * S01 · PR 3 · Lo propuesto de unos orígenes, de cualquier fecha: lo que se
 * decide en su apartado (lib/diario.ts, SE_DECIDE_EN) y ese apartado enseña
 * entero (regla 7: un asiento propuesto de hace meses también espera).
 */
export async function leerPropuestosDe(accountId: string, companyId: string, origenes: readonly OrigenAsiento[]): Promise<AsientoDiario[]> {
  const { data, error } = await tabla('journal_entry').select(CAMPOS_ASIENTO)
    .eq('account_id', accountId).eq('company_id', companyId).eq('status', 'propuesto').in('source_type', [...origenes])
    .order('entry_date', { ascending: true }).limit(5000)
  if (error) throw new Error(mensaje('No se han podido leer los asientos por validar', error))
  return ((data ?? []) as Fila[]).map(aAsiento)
}

export async function leerAsiento(accountId: string, entryId: string): Promise<AsientoDiario | null> {
  const { data, error } = await tabla('journal_entry').select(`${CAMPOS_ASIENTO}, company_id`).eq('account_id', accountId).eq('id', entryId).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer el asiento', error))
  if (!data) return null
  const a = aAsiento(data as Fila)
  // El título oficial de una subcuenta es el de su cuenta del PGC (catálogo global, sin account_id).
  const lineas = ((data as Fila).journal_line ?? []) as Fila[]
  const propias = lineas.map((l) => (l.company_account ?? {}) as Fila).filter((c) => c.kind === 'own')
  const plan = s(propias[0]?.plan)
  if (plan && propias.length) {
    const { data: serie } = await tabla('pgc_account').select('code, name').eq('plan', plan).is('valid_to', null)
      .in('code', [...new Set(propias.map((c) => String(c.template_code)))])
    const titulo = new Map(((serie ?? []) as Fila[]).map((f) => [String(f.code), String(f.name)]))
    const plantillaDe = new Map(lineas.map((l) => [String(l.company_account_id), String(((l.company_account ?? {}) as Fila).template_code ?? '')]))
    for (const ap of a.apuntes) if (ap.tituloOficial === null) ap.tituloOficial = titulo.get(plantillaDe.get(ap.cuentaId) ?? '') ?? null
  }
  return a
}

export interface EjercicioLibro { id: string; code: string; inicio: string; fin: string; abierto: boolean; traidoHasta: string | null }

export async function leerEjercicios(accountId: string, companyId: string): Promise<EjercicioLibro[]> {
  const { data, error } = await tabla('fiscal_year').select('id, code, starts_on, ends_on, status, imported_until')
    .eq('account_id', accountId).eq('company_id', companyId).order('starts_on', { ascending: false })
  if (error) throw new Error(mensaje('No se han podido leer los ejercicios', error))
  return ((data ?? []) as Fila[]).map((f) => ({
    id: String(f.id), code: String(f.code), inicio: String(f.starts_on), fin: String(f.ends_on), abierto: f.status === 'open', traidoHasta: s(f.imported_until),
  }))
}

export async function leerCierres(accountId: string, companyId: string): Promise<CierreMes[]> {
  const { data, error } = await tabla('fiscal_period_lock').select('month, kind, locked_by_name')
    .eq('account_id', accountId).eq('company_id', companyId).is('reopened_at', null)
  if (error) throw new Error(mensaje('No se han podido leer los meses cerrados', error))
  return ((data ?? []) as Fila[]).map((f) => ({ mes: String(f.month), tipo: (s(f.kind) ?? 'manual') as CierreMes['tipo'], quien: s(f.locked_by_name) }))
}

export interface CuentaPlan { id: string; code: string; nombre: string; oficial: string }

/** Las cuentas de apunte del plan (las que no tienen hijas), sin las cerradas: lo que se puede elegir. */
export async function cuentasDeApunte(accountId: string, companyId: string): Promise<CuentaPlan[]> {
  const { data, error } = await tabla('company_account').select('id, code, name, kind, plain_name, status')
    .eq('account_id', accountId).eq('company_id', companyId)
  if (error) throw new Error(mensaje('No se ha podido leer el plan', error))
  const todas = (data ?? []) as Fila[]
  const codigos = todas.map((f) => String(f.code))
  return todas
    .filter((f) => f.status !== 'cerrada' && !codigos.some((c) => c.length > String(f.code).length && c.startsWith(String(f.code))))
    .map((f) => ({ id: String(f.id), code: String(f.code), nombre: nombreDeUso({ kind: s(f.kind), name: String(f.name), plainName: s(f.plain_name) }), oficial: String(f.name) }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

/** La hora de cierre del día de la empresa («06:00»); sin fila o vacía, la de serie. */
export async function horaDeCierre(accountId: string, companyId: string): Promise<string> {
  const { data, error } = await tabla('company_tax_profile').select('sales_day_close_time').eq('account_id', accountId).eq('company_id', companyId).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer la hora de cierre del día', error))
  return normalizarHora(s((data as Fila | null)?.sales_day_close_time))
}

/** Cambia la hora de cierre del día. Falla si no ha cambiado ninguna fila (regla 8: nada callado). */
export async function guardarHoraDeCierre(accountId: string, companyId: string, hora: string): Promise<string> {
  const h = normalizarHora(hora)
  if (h !== hora.slice(0, 5)) throw new Error('Escribe una hora entre 0:00 y 23:59.')
  const { data, error } = await tabla('company_tax_profile').update({ sales_day_close_time: `${h}:00` })
    .eq('account_id', accountId).eq('company_id', companyId).select('sales_day_close_time')
  if (error) throw new Error(mensaje('No se ha podido guardar la hora de cierre del día', error))
  if (!data || (data as Fila[]).length !== 1) throw new Error('No se ha guardado: la empresa no tiene su perfil fiscal (Tu empresa › Impuestos), o no tienes permiso para cambiarlo.')
  return normalizarHora(s((data as Fila[])[0].sales_day_close_time))
}

/** Un pedido cerrado como no confirmado, para la lista del asiento de ventas del día. */
export interface NoConfirmado {
  id: string; soldAt: string; marca: string | null; canal: string | null; codigo: string | null; total: number
  orderStatus: string | null; deliveryState: string | null
  /** Si la plataforma lo pagó después y ya tiene su propio asiento (propuesto, borrador o validado). */
  asientoAparte: string | null
}

/** Los no confirmados del día y local de un asiento de ventas del día (origen = su resumen). */
export async function noConfirmadosDelResumen(accountId: string, companyId: string, resumenId: string): Promise<NoConfirmado[]> {
  const { data: r, error } = await tabla('sales_day_summary').select('location_id, sales_day').eq('account_id', accountId).eq('company_id', companyId).eq('id', resumenId).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer el resumen del día', error))
  if (!r) return []
  const dia = String((r as Fila).sales_day)
  const filas = ((await rpc('conta_no_confirmados', { p_company: companyId, p_desde: dia, p_hasta: dia, p_location: String((r as Fila).location_id) })) ?? []) as Fila[]
  if (!filas.length) return []
  const { data: aparte, error: e2 } = await tabla('journal_entry').select('id, source_id').eq('account_id', accountId).eq('company_id', companyId)
    .eq('source_type', 'sales_adjustment').in('status', ['propuesto', 'borrador', 'validado']).in('source_id', filas.map((f) => String(f.id)))
  if (e2) throw new Error(mensaje('No se han podido leer los asientos aparte', e2))
  const deVenta = new Map(((aparte ?? []) as Fila[]).map((x) => [String(x.source_id), String(x.id)]))
  return filas.map((f) => ({
    id: String(f.id), soldAt: String(f.sold_at), marca: s(f.marca), canal: s(f.canal), codigo: s(f.codigo), total: n(f.total),
    orderStatus: s(f.order_status), deliveryState: s(f.delivery_state), asientoAparte: deVenta.get(String(f.id)) ?? null,
  }))
}

export interface LocalEmpresa { id: string; nombre: string }
export async function localesDeLaCuenta(accountId: string): Promise<LocalEmpresa[]> {
  const { data, error } = await tabla('locations').select('id, name').eq('account_id', accountId).order('name')
  if (error) throw new Error(mensaje('No se han podido leer los locales', error))
  return ((data ?? []) as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.name) }))
}

/** El resultado del mes por local (lo común repartido si hay regla). */
export async function resultadoDelMes(companyId: string, mes: string, locales: readonly LocalEmpresa[]): Promise<{ total: number; porLocal: { nombre: string; resultado: number }[] }> {
  const filas = ((await rpc('conta_resultado_por_local', { p_company: companyId, p_desde: mes, p_hasta: finDeMes(mes), p_repartir: true })) ?? []) as Fila[]
  const por = new Map<string, number>()
  let total = 0
  for (const f of filas) {
    const r = n(f.resultado); total += r
    const nombre = f.location_id ? locales.find((l) => l.id === f.location_id)?.nombre ?? 'Local' : 'Común'
    por.set(nombre, (por.get(nombre) ?? 0) + r)
  }
  return { total, porLocal: [...por].map(([nombre, resultado]) => ({ nombre, resultado })) }
}

/** Lo que dice el «Cierre del mes»: cuánto hay de cada origen y cuánto está validado. */
export async function fuenteCierre(accountId: string, companyId: string, mes: string, asientos: readonly AsientoDiario[], cerrado: boolean): Promise<FuenteCierre> {
  const fin = finDeMes(mes)
  const validadoDe = new Map<string, Set<string>>()
  for (const a of asientos) {
    if (a.estado !== 'validado' || !a.origenId) continue
    if (!validadoDe.has(a.origen)) validadoDe.set(a.origen, new Set())
    validadoDe.get(a.origen)!.add(a.origenId)
  }
  const cuenta = (tipo: OrigenAsiento, ids: string[]) => ({ total: ids.length, asentadas: ids.filter((id) => validadoDe.get(tipo)?.has(id)).length })
  const leerIds = async (t: string, campo: string, estados?: string[], deLaEmpresa = false): Promise<string[]> => {
    let q = tabla(t).select('id').eq('account_id', accountId).gte(campo, mes).lte(campo, fin)
    if (estados) q = q.in('status', estados)
    if (deLaEmpresa) q = q.eq('company_id', companyId)
    const { data, error } = await q
    if (error) throw new Error(mensaje(`No se ha podido leer ${t}`, error))
    return ((data ?? []) as Fila[]).map((f) => String(f.id))
  }
  const [resumenes, pendientes, facturas, liqs, socios, nominas] = await Promise.all([
    leerIds('sales_day_summary', 'sales_day', undefined, true),
    rpc('conta_dias_por_asentar', { p_company: companyId, p_desde: mes, p_hasta: fin }) as Promise<Fila[] | null>,
    leerIds('supplier_invoice', 'invoice_date', ['aprobada', 'pagada']),
    leerIds('channel_settlement', 'settlement_date'),
    leerIds('licensed_settlement', 'period_to'),
    leerIds('payroll_summary', 'period_month', undefined, true),
  ])
  const dias = cuenta('sales_day', resumenes)
  return {
    diasVenta: { total: dias.total + (pendientes ?? []).length, asentadas: dias.asentadas },
    facturas: cuenta('supplier_invoice', facturas),
    liquidaciones: cuenta('channel_settlement', liqs),
    socios: cuenta('licensed_settlement', socios),
    nominas: cuenta('payroll', nominas),
    pendientes: asientos.filter((a) => (a.estado === 'propuesto' || a.estado === 'borrador') && a.fecha >= mes && a.fecha <= fin).length,
    cerrado,
  }
}

// ── Escribir ────────────────────────────────────────────────────────────────

export async function validar(entryId: string, quien: string | null): Promise<{ serie: number; numero: number }> {
  try {
    const r = (await rpc('journal_entry_validar', { p_entry: entryId, p_quien_nombre: quien })) as Fila
    return { serie: n(r.serie), numero: n(r.numero) }
  } catch (e) { throw sinPrefijo(e) }
}

export async function anular(entryId: string, motivo: string, fecha: string | null, quien: string | null): Promise<{ serie: number; numero: number; fecha: string; contraasiento: string }> {
  try {
    const r = (await rpc('journal_entry_anular', { p_entry: entryId, p_motivo: motivo, p_fecha: fecha, p_quien_nombre: quien })) as Fila
    return { serie: n(r.serie), numero: n(r.numero), fecha: String(r.fecha), contraasiento: String(r.contraasiento) }
  } catch (e) { throw sinPrefijo(e) }
}

export async function descartar(entryId: string, motivo: string, quien: string | null): Promise<void> {
  try { await rpc('journal_entry_descartar', { p_entry: entryId, p_motivo: motivo, p_quien_nombre: quien }) } catch (e) { throw sinPrefijo(e) }
}

/**
 * El primer día desde `fecha` en que se puede asentar, con la misma regla que
 * la validación (`conta_primer_dia_abierto`: ejercicio abierto, después de lo
 * traído y mes sin cerrar). null: ninguno en los 400 días siguientes.
 */
export async function primerDiaAbierto(companyId: string, fecha: string): Promise<string | null> {
  const d = await rpc<string | null>('conta_primer_dia_abierto', { p_company: companyId, p_fecha: fecha })
  return typeof d === 'string' && d ? d.slice(0, 10) : null
}

export async function cerrarMes(companyId: string, mes: string): Promise<void> {
  try { await rpc('conta_cerrar_mes', { p_company: companyId, p_mes: mes }) } catch (e) { throw sinPrefijo(e) }
}

export async function reabrirMes(companyId: string, mes: string, motivo: string): Promise<void> {
  try { await rpc('conta_reabrir_mes', { p_company: companyId, p_mes: mes, p_motivo: motivo }) } catch (e) { throw sinPrefijo(e) }
}

/** ¿Encadena bien? Cuántos asientos se han comprobado y los que no. */
export async function comprobarCadena(companyId: string): Promise<{ total: number; mal: { serie: number; numero: number; motivo: string }[] }> {
  const filas = ((await rpc('journal_cadena_comprobar', { p_company: companyId })) ?? []) as Fila[]
  return { total: filas.length, mal: filas.filter((f) => f.ok !== true).map((f) => ({ serie: n(f.series), numero: n(f.number), motivo: String(f.motivo ?? '') })) }
}

/**
 * «Cambiar» la cuenta de un apunte de una propuesta (no validada: la RLS y el
 * disparador no dejan otra cosa). Queda apuntado para la siguiente del mismo
 * origen (regla 11) cuando el origen lo permite.
 */
export async function cambiarCuenta(accountId: string, companyId: string, a: AsientoDiario, posicion: number, nueva: CuentaPlan, quien: string | null): Promise<string> {
  const apunte = a.apuntes.find((l) => l.posicion === posicion)
  if (!apunte) throw new Error('Ese apunte ya no está.')
  const { data, error } = await tabla('journal_line').update({ company_account_id: nueva.id })
    .eq('account_id', accountId).eq('entry_id', a.id).eq('position', posicion).select('position')
  if (error) throw new Error(mensaje('No se ha cambiado', error))
  if (!data || (data as unknown[]).length === 0) throw new Error('No se ha cambiado: el asiento ya está validado o no es de tu cuenta.')
  const clave = await claveDeOrigen(accountId, a)
  if (clave) await apuntarCorreccion(accountId, companyId, clave, apunte.cuenta, nueva.code, a.id, quien)
  return clave
    ? `Cambiada la ${apunte.cuenta} por la ${nueva.code} (${nueva.nombre}). La próxima del mismo origen la propondré así.`
    : `Cambiada la ${apunte.cuenta} por la ${nueva.code} (${nueva.nombre}).`
}

async function claveDeOrigen(accountId: string, a: AsientoDiario): Promise<string | null> {
  if (!a.origenId) return null
  if (a.origen === 'supplier_invoice') {
    const { data } = await tabla('supplier_invoice').select('supplier_id').eq('account_id', accountId).eq('id', a.origenId).maybeSingle()
    return data ? `supplier_invoice:${String((data as Fila).supplier_id)}` : null
  }
  if (a.origen === 'channel_settlement') {
    const { data } = await tabla('channel_settlement').select('channel_id').eq('account_id', accountId).eq('id', a.origenId).maybeSingle()
    return data ? `channel_settlement:${String((data as Fila).channel_id)}` : null
  }
  return null
}

/**
 * Un asiento a mano: se guarda como borrador (la RLS solo deja eso) con sus
 * apuntes; si algún apunte no entra, se deshace el asiento entero: nunca queda
 * medio asiento.
 */
export async function guardarAMano(accountId: string, companyId: string, ejercicioId: string, serie: Serie, fecha: string, concepto: string,
  lineas: readonly LineaMano[], cuentas: readonly CuentaPlan[], quien: string | null): Promise<string> {
  const { data, error } = await tabla('journal_entry').insert({
    account_id: accountId, company_id: companyId, fiscal_year_id: ejercicioId, series: serie, entry_date: fecha, concept: concepto.trim(),
    source_type: 'manual', status: 'borrador', created_by_name: quien,
  }).select('id').single()
  if (error) throw new Error(mensaje('No se ha guardado el asiento', error))
  const id = String((data as Fila).id)
  const usadas = lineas.filter((l) => l.cuenta.trim())
  const filas = usadas.map((l, i) => ({
    account_id: accountId, company_id: companyId, entry_id: id, position: i + 1,
    company_account_id: cuentas.find((c) => c.code === l.cuenta.trim())?.id,
    debit: importeMano(l.debe), credit: importeMano(l.haber), concept: l.concepto.trim() || null,
    location_id: l.comun ? null : l.localId, is_common: l.comun,
  }))
  const r = await tabla('journal_line').insert(filas)
  if (r.error) {
    await tabla('journal_entry').delete().eq('id', id)
    throw new Error(mensaje('No se ha guardado el asiento', r.error))
  }
  return id
}

// ── S01 · Asientos predefinidos (entry_template, del C04) ─────────────────
// La cinta de Asientos abre «Predefinidos» con ?tipo=predefinido. Se leen los
// de la empresa que no están archivados; al usarlos, el asiento a mano se rellena.

/** Los predefinidos de la empresa, por nombre, con sus apuntes en orden. */
export async function leerPredefinidos(accountId: string, companyId: string): Promise<Predefinido[]> {
  const { data, error } = await tabla('entry_template')
    .select('id, name, series, concept, entry_template_line(position, company_account_id, side, fixed_amount, concept, location_id, is_common)')
    .eq('account_id', accountId).eq('company_id', companyId).is('archived_at', null).order('name')
  if (error) throw new Error(mensaje('No se han podido leer los asientos predefinidos', error))
  return ((data ?? []) as Fila[]).map((t) => ({
    id: String(t.id), nombre: String(t.name), serie: Number(t.series) as Serie, concepto: String(t.concept),
    lineas: ((t.entry_template_line ?? []) as Fila[]).sort((a, b) => Number(a.position) - Number(b.position)).map((l) => ({
      cuentaId: String(l.company_account_id), lado: l.side === 'credit' ? 'credit' as const : 'debit' as const,
      importe: l.fixed_amount === null || l.fixed_amount === undefined ? null : Number(l.fixed_amount),
      concepto: l.concept ? String(l.concept) : null, localId: l.location_id ? String(l.location_id) : null, comun: l.is_common === true,
    })),
  }))
}

/** Guarda un predefinido nuevo con sus apuntes. Si los apuntes no entran, no deja la cabecera sola. */
export async function guardarPredefinido(accountId: string, companyId: string, nombre: string, serie: Serie, concepto: string,
  lineas: readonly LineaPredefinida[]): Promise<string> {
  if (lineas.length < 2) throw new Error('Un predefinido necesita al menos dos apuntes con cuenta.')
  const { data, error } = await tabla('entry_template').insert({
    account_id: accountId, company_id: companyId, name: nombre.trim(), series: serie, concept: concepto.trim(),
  }).select('id').single()
  if (error) {
    if (error.code === '23505') throw new Error(`Ya tienes un predefinido que se llama «${nombre.trim()}».`)
    throw new Error(mensaje('No se ha guardado el predefinido', error))
  }
  const id = String((data as Fila).id)
  const r = await tabla('entry_template_line').insert(lineas.map((l, i) => ({
    account_id: accountId, company_id: companyId, template_id: id, position: i + 1, company_account_id: l.cuentaId,
    side: l.lado, fixed_amount: l.importe, concept: l.concepto, location_id: l.comun ? null : l.localId, is_common: l.comun,
  })))
  if (r.error) {
    await tabla('entry_template').delete().eq('id', id)
    throw new Error(mensaje('No se ha guardado el predefinido', r.error))
  }
  return id
}

// ── S01d · El pago, la compensación o la devolución de un modelo ─────────────

export interface ModeloPagado { modelo: string; periodo: string; texto: string; declaracion: string | null; importe: number | null; pagado: number; pendiente: number | null; asientoPago: string | null }

/** Un apunte de la 4751 de un asiento sin validar es el pago de un modelo y periodo («2026-3T»). Devuelve la frase y lo pagado hasta hoy. */
export async function marcarPagoDeModelo(entryId: string, posicion: number, modelo: string, periodo: string): Promise<{ mensaje: string; pagado: ModeloPagado }> {
  try {
    const r = (await rpc('conta_apunte_pago_modelo', { p_entry: entryId, p_posicion: posicion, p_modelo: modelo, p_periodo: periodo })) as Fila
    const p = r.pagado as Fila
    return { mensaje: String(r.mensaje), pagado: {
      modelo: String(p.modelo), periodo: String(p.periodo), texto: String(p.texto), declaracion: s(p.declaracion),
      importe: p.importe == null ? null : n(p.importe), pagado: n(p.pagado), pendiente: p.pendiente == null ? null : n(p.pendiente), asientoPago: s(p.asiento_pago),
    } }
  } catch (e) { throw sinPrefijo(e) }
}

/**
 * S01d-b · Lo que hace falta para proponer el modelo y el periodo de un apunte
 * de la 4751: el modelo de su cuenta y las declaraciones presentadas sin pagar
 * de la empresa (111, 115 y 123).
 */
export async function datosDelPagoDeModelo(companyId: string, cuenta: string): Promise<{ modeloDeLaCuenta: string | null; declaraciones: DeclaracionSinPagar[] }> {
  const [c, d] = await Promise.all([
    tabla('company_account').select('withholding_model').eq('company_id', companyId).eq('code', cuenta).maybeSingle(),
    tabla('tax_return').select('form_code, fiscal_year, period, amount, payment_entry_id, status').eq('company_id', companyId)
      .in('form_code', ['111', '115', '123']).in('status', ['filed', 'booked']),
  ])
  if (c.error) throw new Error(`No se ha podido leer la cuenta ${cuenta}: ${c.error.message}`)
  if (d.error) throw new Error(`No se han podido leer las declaraciones: ${d.error.message}`)
  return {
    modeloDeLaCuenta: s((c.data as Fila | null)?.withholding_model),
    declaraciones: ((d.data ?? []) as Fila[]).filter((x) => x.payment_entry_id == null && x.amount != null)
      .map((x) => ({ modelo: String(x.form_code), ejercicio: Number(x.fiscal_year), periodo: String(x.period), importeCent: Math.round(Number(x.amount) * 100) })),
  }
}
