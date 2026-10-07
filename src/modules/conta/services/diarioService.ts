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

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const sinPrefijo = (e: unknown): Error => new Error((e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, ''))

const CAMPOS_ASIENTO = [
  'id, series, number, entry_date, concept, source_type, source_id, status, confidence, reason, reasons, party_id, document_ref',
  'external_program, external_series, external_number, validated_at, validated_by_name, chain_seq, prev_hash, hash',
  'reverses_entry_id, voided_by_entry_id, voided_at, voided_by_name, void_reason, created_at, created_by_name',
  'journal_line(position, company_account_id, debit, credit, concept, location_id, is_common, brand_id, document_ref, tax_rate_id, tax_base, vat_book, withholding_base, withholding_model, company_account(code, name, kind, plain_name, template_code, plan), locations(name), brand(name, ownership_type), tax_rate(rate))',
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
    retencion: l.withholding_model ? { base: n(l.withholding_base), modelo: String(l.withholding_model) } : null,
  }
}

function aAsiento(f: Fila): AsientoDiario {
  const razones = Array.isArray(f.reasons) ? (f.reasons as Fila[]).map((r): Razon => ({ decision: String(r.decision ?? ''), porque: String(r.porque ?? ''), cita: s(r.cita) ?? undefined })) : []
  return {
    id: String(f.id), serie: n(f.series) as Serie, numero: f.number === null ? null : n(f.number), fecha: String(f.entry_date), concepto: String(f.concept),
    origen: String(f.source_type) as OrigenAsiento, origenId: s(f.source_id), estado: String(f.status) as EstadoAsiento,
    confianza: s(f.confidence) as Confianza | null, porque: s(f.reason), razones, documento: s(f.document_ref), terceroId: s(f.party_id),
    creadoPor: s(f.created_by_name), creadoEn: String(f.created_at), validadoPor: s(f.validated_by_name), validadoEn: s(f.validated_at),
    anuladoPor: s(f.voided_by_name), anuladoEn: s(f.voided_at), motivoAnulacion: s(f.void_reason), anuladoCon: s(f.voided_by_entry_id), anulaA: s(f.reverses_entry_id),
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

export async function anular(entryId: string, motivo: string, fecha: string | null, quien: string | null): Promise<{ serie: number; numero: number; fecha: string }> {
  try {
    const r = (await rpc('journal_entry_anular', { p_entry: entryId, p_motivo: motivo, p_fecha: fecha, p_quien_nombre: quien })) as Fila
    return { serie: n(r.serie), numero: n(r.numero), fecha: String(r.fecha) }
  } catch (e) { throw sinPrefijo(e) }
}

export async function descartar(entryId: string, motivo: string, quien: string | null): Promise<void> {
  try { await rpc('journal_entry_descartar', { p_entry: entryId, p_motivo: motivo, p_quien_nombre: quien }) } catch (e) { throw sinPrefijo(e) }
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
