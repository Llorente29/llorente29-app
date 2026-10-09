// src/modules/conta/services/librosService.ts
//
// C05 · Lo que leen y escriben las pantallas de Libros. Nombres del esquema
// (regla 40, comprobados contra staging el 08/10): annual_accounts_line,
// annual_accounts_mapping, annual_accounts_mapping_change, annual_accounts_choice,
// vat_book_entry, investment_good, investment_good_regularization,
// fiscal_year_closing, fiscal_year, company, company_account, journal_ledger;
// funciones conta_saldos_cuentas, conta_mapeo_cambiar,
// conta_mapeo_volver_al_estandar, conta_cierre_enlazar, conta_cierre_cerrar,
// conta_cierre_reabrir, journal_entry_proponer, conta_resultado_por_local.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { Estado, FilaMapeo, LineaModelo, Modelo, SaldoCuenta } from '@/modules/conta/lib/cuentasAnuales'
import type { SaldoPartido } from '@/modules/conta/lib/sumasSaldos'
import type { AnotacionLibro, Libro } from '@/modules/conta/lib/libroRegistro'
import type { AsientoCierre } from '@/modules/conta/lib/cierre'

type Fila = Record<string, unknown>
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numO = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

// ── Modelos y mapeo ─────────────────────────────────────────────────────────

export async function leerLineas(modelo: Modelo, estado: Estado): Promise<LineaModelo[]> {
  const { data, error } = await tabla('annual_accounts_line')
    .select('code, parent_code, text, level, sort_order, side, is_total, to_create, legal_ref')
    .eq('model', modelo).eq('statement', estado).order('sort_order')
  if (error) throw new Error(mensaje('No se han podido leer las líneas del modelo', error))
  return ((data ?? []) as Fila[]).map((f) => ({
    code: String(f.code), parentCode: txt(f.parent_code), text: String(f.text), level: num(f.level), sortOrder: num(f.sort_order),
    side: (txt(f.side) as LineaModelo['side']), isTotal: Boolean(f.is_total), toCreate: Boolean(f.to_create), legalRef: String(f.legal_ref),
  }))
}

export interface MapeoLeido { serie: FilaMapeo[]; propio: FilaMapeo[] }

export async function leerMapeo(companyId: string, modelo: Modelo, estado: Estado): Promise<MapeoLeido> {
  const { data, error } = await tabla('annual_accounts_mapping')
    .select('company_id, line_code, account_prefix, sign, by_balance, origin, excluded, note')
    .eq('model', modelo).eq('statement', estado)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
  if (error) throw new Error(mensaje('No se ha podido leer qué cuentas alimentan cada línea', error))
  const filas = ((data ?? []) as Fila[]).map((f) => ({
    empresa: f.company_id !== null,
    m: { lineCode: String(f.line_code), prefix: String(f.account_prefix), sign: (f.sign === 'resta' ? 'resta' : 'suma') as FilaMapeo['sign'],
      byBalance: (txt(f.by_balance) as FilaMapeo['byBalance']), origin: String(f.origin) as FilaMapeo['origin'], excluded: Boolean(f.excluded), note: txt(f.note) },
  }))
  return { serie: filas.filter((x) => !x.empresa).map((x) => x.m), propio: filas.filter((x) => x.empresa).map((x) => x.m) }
}

export async function cambiarMapeo(companyId: string, modelo: Modelo, estado: Estado, prefijo: string, linea: string | null, porSigno: 'deudor' | 'acreedor' | null, motivo: string | null): Promise<{ de: string | null; a: string | null; quien: string }> {
  const r = await rpc<{ de: string | null; a: string | null; quien: string }>('conta_mapeo_cambiar', {
    p_company: companyId, p_model: modelo, p_statement: estado, p_prefix: prefijo, p_line: linea, p_by_balance: porSigno, p_motivo: motivo,
  })
  return r
}

export async function volverAlEstandar(companyId: string, modelo: Modelo, estado: Estado, prefijo: string | null): Promise<{ vueltas: number; quien: string }> {
  return rpc<{ vueltas: number; quien: string }>('conta_mapeo_volver_al_estandar', { p_company: companyId, p_model: modelo, p_statement: estado, p_prefix: prefijo })
}

export interface CambioMapeo { cuando: string; quien: string | null; prefijo: string | null; accion: 'cambia' | 'deja_fuera' | 'estandar'; de: string | null; a: string | null; motivo: string | null; estado: string; modelo: string }
export async function historialMapeo(accountId: string, companyId: string): Promise<CambioMapeo[]> {
  const { data, error } = await tabla('annual_accounts_mapping_change')
    .select('changed_at, changed_by_name, account_prefix, action, from_line, to_line, reason, statement, model')
    .eq('account_id', accountId).eq('company_id', companyId).order('changed_at', { ascending: false }).limit(50)
  if (error) throw new Error(mensaje('No se ha podido leer el historial del mapeo', error))
  return ((data ?? []) as Fila[]).map((f) => ({
    cuando: String(f.changed_at), quien: txt(f.changed_by_name), prefijo: txt(f.account_prefix), accion: String(f.action) as CambioMapeo['accion'],
    de: txt(f.from_line), a: txt(f.to_line), motivo: txt(f.reason), estado: String(f.statement), modelo: String(f.model),
  }))
}

// ── Saldos ──────────────────────────────────────────────────────────────────

export interface SaldoConLocal extends SaldoPartido { companyAccountId: string; locationId: string | null; brandId: string | null }

export async function saldosCuentas(companyId: string, desde: string, hasta: string, porLocal = false): Promise<SaldoConLocal[]> {
  const filas = (await rpc<Fila[] | null>('conta_saldos_cuentas', { p_company: companyId, p_desde: desde, p_hasta: hasta, p_por_local: porLocal })) ?? []
  return filas.map((f) => ({
    companyAccountId: String(f.company_account_id), code: String(f.code), name: String(f.name), templateCode: txt(f.template_code),
    locationId: txt(f.location_id), brandId: txt(f.brand_id),
    inicialDebe: num(f.inicial_debe), inicialHaber: num(f.inicial_haber), aperturaDebe: num(f.apertura_debe), aperturaHaber: num(f.apertura_haber),
    periodoDebe: num(f.periodo_debe), periodoHaber: num(f.periodo_haber), regularizacionDebe: num(f.regularizacion_debe),
    regularizacionHaber: num(f.regularizacion_haber), cierreDebe: num(f.cierre_debe), cierreHaber: num(f.cierre_haber),
  }))
}

/**
 * Saldo a una fecha para el balance (con apertura, sin regularización ni
 * cierre: el resultado aún vive en 6 y 7 o ya en la 129, nunca en las dos).
 * Para la PyG del periodo, sin apertura ni regularización.
 */
export function aSaldoCuenta(s: SaldoPartido & { companyAccountId?: string }, para: 'balance' | 'pyg'): SaldoCuenta {
  if (para === 'balance') {
    return { code: s.code, name: s.name, templateCode: s.templateCode, companyAccountId: s.companyAccountId,
      debe: s.inicialDebe + s.aperturaDebe + s.periodoDebe + s.regularizacionDebe,
      haber: s.inicialHaber + s.aperturaHaber + s.periodoHaber + s.regularizacionHaber }
  }
  return { code: s.code, name: s.name, templateCode: s.templateCode, companyAccountId: s.companyAccountId,
    debe: s.inicialDebe + s.periodoDebe, haber: s.inicialHaber + s.periodoHaber }
}

// ── Ejercicios, modelo y cierre ─────────────────────────────────────────────

export interface EjercicioLibros {
  id: string; code: string; inicio: string; fin: string; estado: 'open' | 'closed'; origen: 'folvy' | 'migrated' | 'mixed'; traidoHasta: string | null
  anteriorId: string | null; plantillaMedia: number; cierre: { estado: 'abierto' | 'preparado' | 'cerrado'; regularizacion: string | null; cierre: string | null; apertura: string | null; reaperturas: number } | null
  modelo: { elegido: Modelo; propuesto: Modelo; quien: string | null } | null
}

export async function leerEjerciciosLibros(accountId: string, companyId: string): Promise<EjercicioLibros[]> {
  const [ej, ci, mo] = await Promise.all([
    tabla('fiscal_year').select('id, code, starts_on, ends_on, status, origin, imported_until, previous_year_id, average_staff_fixed, average_staff_temporary')
      .eq('account_id', accountId).eq('company_id', companyId).order('starts_on', { ascending: false }),
    tabla('fiscal_year_closing').select('fiscal_year_id, status, regularization_entry_id, closing_entry_id, opening_entry_id, reopenings').eq('account_id', accountId).eq('company_id', companyId),
    tabla('annual_accounts_choice').select('fiscal_year_id, model, proposed_model, chosen_by_name').eq('account_id', accountId).eq('company_id', companyId),
  ])
  for (const r of [ej, ci, mo]) if (r.error) throw new Error(mensaje('No se han podido leer los ejercicios', r.error))
  const cierres = new Map(((ci.data ?? []) as Fila[]).map((f) => [String(f.fiscal_year_id), f]))
  const modelos = new Map(((mo.data ?? []) as Fila[]).map((f) => [String(f.fiscal_year_id), f]))
  const lista = ((ej.data ?? []) as Fila[])
  return lista.map((f, i) => {
    const c = cierres.get(String(f.id)); const m = modelos.get(String(f.id))
    return {
      id: String(f.id), code: String(f.code), inicio: String(f.starts_on), fin: String(f.ends_on), estado: f.status === 'closed' ? 'closed' : 'open',
      origen: String(f.origin) as EjercicioLibros['origen'], traidoHasta: txt(f.imported_until),
      anteriorId: txt(f.previous_year_id) ?? (lista[i + 1] ? String(lista[i + 1].id) : null),
      plantillaMedia: num(f.average_staff_fixed) + num(f.average_staff_temporary),
      cierre: c ? { estado: String(c.status) as 'abierto', regularizacion: txt(c.regularization_entry_id), cierre: txt(c.closing_entry_id), apertura: txt(c.opening_entry_id), reaperturas: Array.isArray(c.reopenings) ? c.reopenings.length : 0 } : null,
      modelo: m ? { elegido: String(m.model) as Modelo, propuesto: String(m.proposed_model) as Modelo, quien: txt(m.chosen_by_name) } : null,
    }
  })
}

export async function elegirModelo(accountId: string, companyId: string, fiscalYearId: string, modelo: Modelo, propuesto: Modelo, cifras: Record<string, unknown>, quien: string | null): Promise<void> {
  const { error } = await tabla('annual_accounts_choice').upsert({
    fiscal_year_id: fiscalYearId, account_id: accountId, company_id: companyId, model: modelo, proposed_model: propuesto, figures: cifras,
    chosen_at: new Date().toISOString(), chosen_by_name: quien,
  } as never)
  if (error) throw new Error(mensaje('No se ha podido guardar el modelo', error))
}

/** Propone los tres asientos del cierre (como cualquier propuesta) y los enlaza al ejercicio. */
export async function prepararCierreEnBase(companyId: string, fiscalYearId: string, asientos: (AsientoCierre | null)[], quien: string | null, regularizacionEnlazada: string | null = null): Promise<{ ids: (string | null)[] }> {
  const ids: (string | null)[] = []
  for (const [i, a] of asientos.entries()) {
    // Sin regularización nueva, se mantiene la ya enlazada (al reabrir se queda): enlazar con null la soltaría.
    if (!a) { ids.push(i === 0 ? regularizacionEnlazada : null); continue }
    const r = await rpc<{ id: string }>('journal_entry_proponer', {
      p_company: companyId,
      p_entry: { fecha: a.fecha, source_type: a.sourceType, series: a.serie, concepto: a.concepto, confianza: 'seguro', porque: `Preparado por Folvy: ${a.tipo} del ejercicio (PGC, quinta parte, cuenta 129 y normas de cierre).`,
        // La marca del generador: con ella y el enlace del ejercicio, el validador no le pide IVA a las 472/477/4751 que deja a cero (0140).
        razones: [{ decision: 'cierre-del-ejercicio', porque: `Asiento de ${a.tipo} calculado por Folvy con los saldos del ejercicio.` }] },
      p_lines: a.apuntes.map((p) => ({ cuenta: p.cuenta, debe: p.debe || undefined, haber: p.haber || undefined, concepto: p.concepto, local_id: p.localId ?? '', marca_id: p.marcaId ?? '', comun: p.comun })),
      p_summary: null, p_quien_nombre: quien,
    })
    ids.push(r.id)
  }
  await rpc('conta_cierre_enlazar', { p_fiscal_year: fiscalYearId, p_regularizacion: ids[0], p_cierre: ids[1], p_apertura: ids[2] })
  return { ids }
}

export const cerrarEjercicio = (fiscalYearId: string) => rpc<{ ejercicio: string; quien: string }>('conta_cierre_cerrar', { p_fiscal_year: fiscalYearId })
export const reabrirEjercicio = (fiscalYearId: string, motivo: string) => rpc<{ ejercicio: string; anulados: unknown[]; quien: string }>('conta_cierre_reabrir', { p_fiscal_year: fiscalYearId, p_motivo: motivo })

// ── Libro registro ──────────────────────────────────────────────────────────

const COLS_LIBRO = 'id, entry_id, book, invoice_type, series, number, number_to, documents_count, issue_date, operation_date, received_date, received_number, party_id, counterpart_tax_id, counterpart_id_type, counterpart_country, counterpart_name, operation_key, qualification, exempt_cause, tax_base, tax_rate, tax_amount, surcharge_rate, surcharge_amount, total, deductible_amount, deductible_later, reverse_charge, investment_good, withholding_rate, withholding_amount, activity_code, activity_type, activity_iae, corrects_ref, source_type, source_id, voided_at'

export async function leerLibroRegistro(accountId: string, companyId: string, libros: Libro[], desde: string, hasta: string): Promise<AnotacionLibro[]> {
  const { data, error } = await tabla('vat_book_entry').select(COLS_LIBRO)
    .eq('account_id', accountId).eq('company_id', companyId).in('book', libros)
    .gte('issue_date', desde).lte('issue_date', hasta).order('issue_date', { ascending: false }).order('number', { ascending: false })
  if (error) throw new Error(mensaje('No se ha podido leer el libro registro', error))
  return ((data ?? []) as Fila[]).map((f) => ({
    id: String(f.id), entryId: String(f.entry_id), book: String(f.book) as Libro, invoiceType: String(f.invoice_type) as AnotacionLibro['invoiceType'],
    series: txt(f.series), number: txt(f.number), numberTo: txt(f.number_to), documentsCount: num(f.documents_count),
    issueDate: String(f.issue_date), operationDate: txt(f.operation_date), receivedDate: txt(f.received_date), receivedNumber: txt(f.received_number),
    partyId: txt(f.party_id), counterpartTaxId: txt(f.counterpart_tax_id), counterpartIdType: txt(f.counterpart_id_type),
    counterpartCountry: txt(f.counterpart_country), counterpartName: txt(f.counterpart_name), operationKey: String(f.operation_key ?? '01'),
    qualification: txt(f.qualification), exemptCause: txt(f.exempt_cause), taxBase: num(f.tax_base), taxRate: numO(f.tax_rate), taxAmount: num(f.tax_amount),
    surchargeRate: numO(f.surcharge_rate), surchargeAmount: numO(f.surcharge_amount), total: numO(f.total), deductibleAmount: numO(f.deductible_amount),
    deductibleLater: Boolean(f.deductible_later), reverseCharge: Boolean(f.reverse_charge), investmentGood: Boolean(f.investment_good),
    withholdingRate: numO(f.withholding_rate), withholdingAmount: numO(f.withholding_amount), activityCode: txt(f.activity_code),
    activityType: txt(f.activity_type), activityIae: txt(f.activity_iae), correctsRef: txt(f.corrects_ref), sourceType: String(f.source_type), sourceId: txt(f.source_id), voidedAt: txt(f.voided_at),
  }))
}

/** «Completar» una anotación: lo que el documento no decía. */
export async function completarAnotacion(id: string, campos: { counterpartTaxId?: string | null; counterpartName?: string | null; number?: string | null; numberTo?: string | null; operationDate?: string | null; invoiceType?: string }, quien: string | null): Promise<void> {
  const cambios: Fila = { updated_at: new Date().toISOString(), updated_by_name: quien }
  if (campos.counterpartTaxId !== undefined) cambios.counterpart_tax_id = campos.counterpartTaxId
  if (campos.counterpartName !== undefined) cambios.counterpart_name = campos.counterpartName
  if (campos.number !== undefined) cambios.number = campos.number
  if (campos.numberTo !== undefined) cambios.number_to = campos.numberTo
  if (campos.operationDate !== undefined) cambios.operation_date = campos.operationDate
  if (campos.invoiceType !== undefined) cambios.invoice_type = campos.invoiceType
  const { data, error } = await tabla('vat_book_entry').update(cambios as never).eq('id', id).select('id')
  if (error) throw new Error(mensaje('No se ha podido completar la anotación', error))
  if (!((data ?? []) as Fila[]).length) throw new Error('No se ha guardado: la anotación ya no está o no tienes permiso para cambiarla.')
}

/**
 * Movimiento de la 477 o la 472 en el periodo para la regla 6, sin la
 * liquidación del IVA (que salda las cuentas y no es una factura).
 */
export async function movimientoIva(accountId: string, companyId: string, libro: 'issued' | 'received', desde: string, hasta: string): Promise<number> {
  const { data, error } = await tabla('journal_ledger').select('debit, credit, template_code, source_type')
    .eq('account_id', accountId).eq('company_id', companyId).gte('entry_date', desde).lte('entry_date', hasta)
    .like('template_code', libro === 'issued' ? '477%' : '472%').neq('source_type', 'vat_settlement')
  if (error) throw new Error(mensaje('No se ha podido leer el IVA del diario', error))
  const filas = (data ?? []) as Fila[]
  const s = filas.reduce((a, f) => a + Math.round(num(f.debit) * 100) - Math.round(num(f.credit) * 100), 0) / 100
  return libro === 'issued' ? -s : s
}

/** Cuentas de cada asiento (para el filtro «subcuenta» del listado de facturación). */
export async function cuentasPorAsiento(accountId: string, entryIds: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>()
  if (!entryIds.length) return m
  const { data, error } = await tabla('journal_ledger').select('entry_id, account_code').eq('account_id', accountId).in('entry_id', entryIds.slice(0, 500))
  if (error) throw new Error(mensaje('No se han podido leer las cuentas de los asientos', error))
  for (const f of (data ?? []) as Fila[]) m.set(String(f.entry_id), [...(m.get(String(f.entry_id)) ?? []), String(f.account_code)])
  return m
}

// ── Bienes de inversión ─────────────────────────────────────────────────────

export interface BienInversion { id: string; descripcion: string; tipo: 'mueble' | 'inmueble'; alta: string; inicioUso: string | null; valor: number; base: number; tipoIva: number | null; cuota: number; deducible: number; baja: string | null }

export async function leerBienes(accountId: string, companyId: string): Promise<BienInversion[]> {
  const { data, error } = await tabla('investment_good').select('id, description, kind, acquired_on, start_use_on, acquisition_value, tax_base, vat_rate, vat_amount, deductible_pct, disposed_on')
    .eq('account_id', accountId).eq('company_id', companyId).order('acquired_on', { ascending: false })
  if (error) throw new Error(mensaje('No se han podido leer los bienes de inversión', error))
  return ((data ?? []) as Fila[]).map((f) => ({
    id: String(f.id), descripcion: String(f.description), tipo: f.kind === 'inmueble' ? 'inmueble' : 'mueble', alta: String(f.acquired_on), inicioUso: txt(f.start_use_on),
    valor: num(f.acquisition_value), base: num(f.tax_base), tipoIva: numO(f.vat_rate), cuota: num(f.vat_amount), deducible: num(f.deductible_pct), baja: txt(f.disposed_on),
  }))
}

export async function altaBien(accountId: string, companyId: string, b: Omit<BienInversion, 'id' | 'baja'>, quien: string | null): Promise<string> {
  const { data, error } = await tabla('investment_good').insert({
    account_id: accountId, company_id: companyId, description: b.descripcion, kind: b.tipo, acquired_on: b.alta, start_use_on: b.inicioUso,
    acquisition_value: b.valor, tax_base: b.base, vat_rate: b.tipoIva, vat_amount: b.cuota, deductible_pct: b.deducible, created_by_name: quien,
  } as never).select('id').single()
  if (error) throw new Error(mensaje('No se ha podido dar de alta el bien', error))
  return String((data as Fila).id)
}

// ── Locales y marcas (regla 10) ─────────────────────────────────────────────

export async function localesYMarcas(accountId: string): Promise<{ locales: { id: string; nombre: string }[]; marcas: { id: string; nombre: string }[] }> {
  const [l, m] = await Promise.all([
    tabla('locations').select('id, name').eq('account_id', accountId).order('name'),
    tabla('brand').select('id, name').eq('account_id', accountId).order('name'),
  ])
  if (l.error) throw new Error(mensaje('No se han podido leer los locales', l.error))
  if (m.error) throw new Error(mensaje('No se han podido leer las marcas', m.error))
  return {
    locales: ((l.data ?? []) as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.name) })),
    marcas: ((m.data ?? []) as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.name) })),
  }
}

/** La empresa (para el nombre del fichero de la AEAT). */
export async function datosFiscales(companyId: string): Promise<{ nif: string | null; razon: string }> {
  const { data, error } = await tabla('company').select('tax_id, legal_name').eq('id', companyId).single()
  if (error) throw new Error(mensaje('No se ha podido leer la empresa', error))
  const f = data as Fila
  return { nif: txt(f.tax_id), razon: String(f.legal_name ?? '') }
}

// ── Lo que dice cada acción de la barra (su dato o estado) ──────────────────

export interface ResumenLibros {
  expedidas: number; recibidas: number; sinNif: number; intracomunitarias: number; bienes: number; retenciones: string[]; suplidos: number
}

export async function resumenLibros(accountId: string, companyId: string, desde: string, hasta: string): Promise<ResumenLibros> {
  const [v, b, r, s] = await Promise.all([
    tabla('vat_book_entry').select('book, operation_key, exempt_cause, counterpart_tax_id, invoice_type')
      .eq('account_id', accountId).eq('company_id', companyId).is('voided_at', null).gte('issue_date', desde).lte('issue_date', hasta),
    tabla('investment_good').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('company_id', companyId),
    tabla('journal_ledger').select('withholding_model').eq('account_id', accountId).eq('company_id', companyId)
      .not('withholding_model', 'is', null).gte('entry_date', desde).lte('entry_date', hasta),
    tabla('company_account_link').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('company_id', companyId).eq('role', 'suplidos'),
  ])
  for (const x of [v, b, r, s]) if (x.error) throw new Error(mensaje('No se ha podido leer el resumen de los libros', x.error))
  const filas = (v.data ?? []) as Fila[]
  const simplificada = (t: unknown) => t === 'F2' || t === 'F4' || t === 'R5'
  return {
    expedidas: filas.filter((f) => f.book === 'issued').length,
    recibidas: filas.filter((f) => f.book === 'received' || f.book === 'investment').length,
    sinNif: filas.filter((f) => !f.counterpart_tax_id && !simplificada(f.invoice_type)).length,
    intracomunitarias: filas.filter((f) => f.operation_key === '09' || f.exempt_cause === 'E5').length,
    bienes: b.count ?? 0,
    retenciones: [...new Set(((r.data ?? []) as Fila[]).map((f) => String(f.withholding_model)))].sort(),
    suplidos: s.count ?? 0,
  }
}

/** El plan de la empresa (pymes o general): decide el modelo que se propone antes de elegir. */
export async function planDeEmpresa(accountId: string, companyId: string): Promise<'pymes' | 'general'> {
  const { data, error } = await tabla('company_account').select('plan').eq('account_id', accountId).eq('company_id', companyId).limit(1)
  if (error) throw new Error(mensaje('No se ha podido leer el plan de la empresa', error))
  return ((data ?? []) as Fila[])[0]?.plan === 'general' ? 'general' : 'pymes'
}

/** Resultado del periodo por local con lo común repartido (C04, ya sin la regularización). */
export async function resultadoRepartido(companyId: string, desde: string, hasta: string): Promise<{ locationId: string | null; resultado: number }[]> {
  const filas = (await rpc<Fila[] | null>('conta_resultado_por_local', { p_company: companyId, p_desde: desde, p_hasta: hasta, p_repartir: true })) ?? []
  const m = new Map<string | null, number>()
  for (const f of filas) { const k = txt(f.location_id); m.set(k, Math.round(((m.get(k) ?? 0) + num(f.resultado)) * 100) / 100) }
  return [...m.entries()].map(([locationId, resultado]) => ({ locationId, resultado }))
}

// ── Diario resumido y Mayor (journal_ledger, C04) ───────────────────────────

export interface Movimiento {
  entryId: string; serie: number; numero: number | null; fecha: string; concepto: string; cuenta: string; nombreCuenta: string; plantilla: string | null
  debe: number; haber: number; localId: string | null; marcaId: string | null; comun: boolean; origen: string; documento: string | null
}

/** Los apuntes del Mayor entre dos fechas; `cuenta` filtra por prefijo (una cuenta o un nivel). */
export async function movimientos(accountId: string, companyId: string, desde: string, hasta: string, cuenta?: string): Promise<Movimiento[]> {
  const fuera: Movimiento[] = []
  const lote = 1000
  for (let desdeFila = 0; ; desdeFila += lote) {
    let q = tabla('journal_ledger')
      .select('entry_id, series, number, entry_date, concept, account_code, account_name, template_code, debit, credit, location_id, brand_id, is_common, source_type, document_ref, position')
      .eq('account_id', accountId).eq('company_id', companyId).gte('entry_date', desde).lte('entry_date', hasta)
    if (cuenta) q = q.like('account_code', `${cuenta}%`)
    const { data, error } = await q.order('entry_date').order('series').order('number').order('position').range(desdeFila, desdeFila + lote - 1)
    if (error) throw new Error(mensaje('No se han podido leer los apuntes', error))
    const filas = (data ?? []) as Fila[]
    for (const f of filas) fuera.push({
      entryId: String(f.entry_id), serie: num(f.series), numero: numO(f.number), fecha: String(f.entry_date), concepto: String(f.concept ?? ''),
      cuenta: String(f.account_code), nombreCuenta: String(f.account_name), plantilla: txt(f.template_code), debe: num(f.debit), haber: num(f.credit),
      localId: txt(f.location_id), marcaId: txt(f.brand_id), comun: f.is_common === true, origen: String(f.source_type), documento: txt(f.document_ref),
    })
    if (filas.length < lote) break
  }
  return fuera
}

/** Las cuentas de apunte con movimiento o saldo en el ejercicio (para elegir en el Mayor). */
export async function cuentasConSaldo(companyId: string, desde: string, hasta: string): Promise<{ code: string; name: string }[]> {
  const s = await saldosCuentas(companyId, desde, hasta)
  return s.filter((x) => x.inicialDebe + x.inicialHaber + x.aperturaDebe + x.aperturaHaber + x.periodoDebe + x.periodoHaber + x.regularizacionDebe + x.regularizacionHaber + x.cierreDebe + x.cierreHaber !== 0)
    .map((x) => ({ code: x.code, name: x.name })).sort((a, b) => a.code.localeCompare(b.code))
}

/** Los documentos de las facturas recibidas de un periodo (para el zip de un requerimiento). */
export async function documentosDeFacturas(accountId: string, sourceIds: string[]): Promise<{ id: string; numero: string | null; url: string }[]> {
  if (!sourceIds.length) return []
  const { data, error } = await tabla('supplier_invoice').select('id, invoice_number, raw_document_url')
    .eq('account_id', accountId).in('id', sourceIds.slice(0, 500)).not('raw_document_url', 'is', null)
  if (error) throw new Error(mensaje('No se han podido leer los documentos de las facturas', error))
  return ((data ?? []) as Fila[]).map((f) => ({ id: String(f.id), numero: txt(f.invoice_number), url: String(f.raw_document_url) }))
}

// ── Retenciones y suplidos ──────────────────────────────────────────────────

export interface ApunteRetencion { entryId: string; fecha: string; modelo: string; base: number; importe: number; cuenta: string; concepto: string; terceroId: string | null }

/** Los apuntes con retención (base y modelo) del periodo; el importe es lo de la 4751/4730 del apunte. */
export async function retenciones(accountId: string, companyId: string, desde: string, hasta: string): Promise<ApunteRetencion[]> {
  const { data, error } = await tabla('journal_ledger').select('entry_id, entry_date, withholding_model, withholding_base, debit, credit, account_code, concept, party_id')
    .eq('account_id', accountId).eq('company_id', companyId).not('withholding_model', 'is', null).gte('entry_date', desde).lte('entry_date', hasta).order('entry_date')
  if (error) throw new Error(mensaje('No se han podido leer las retenciones', error))
  return ((data ?? []) as Fila[]).map((f) => ({
    entryId: String(f.entry_id), fecha: String(f.entry_date), modelo: String(f.withholding_model), base: num(f.withholding_base),
    importe: Math.abs(num(f.credit) - num(f.debit)), cuenta: String(f.account_code), concepto: String(f.concept ?? ''), terceroId: txt(f.party_id),
  }))
}

/** Las cuentas que la empresa usa para suplidos (enlace con papel «suplidos», C03). */
export async function cuentasDeSuplidos(accountId: string, companyId: string): Promise<{ code: string; name: string }[]> {
  const { data, error } = await tabla('company_account_link').select('company_account(code, name)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('role', 'suplidos')
  if (error) throw new Error(mensaje('No se han podido leer las cuentas de suplidos', error))
  const m = new Map<string, string>()
  for (const f of (data ?? []) as Fila[]) { const ca = f.company_account as Fila | null; if (ca) m.set(String(ca.code), String(ca.name)) }
  return [...m.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code))
}

/** La cuenta de apunte de la 129 (Resultado del ejercicio) de la empresa, si la tiene. */
export async function cuenta129(accountId: string, companyId: string): Promise<string | null> {
  const { data, error } = await tabla('company_account').select('code, template_code')
    .eq('account_id', accountId).eq('company_id', companyId).like('code', '129%').order('code')
  if (error) throw new Error(mensaje('No se ha podido leer la cuenta 129', error))
  const filas = (data ?? []) as Fila[]
  const codigos = filas.map((f) => String(f.code))
  // La de apunte: la que no tiene hijas.
  return codigos.find((c) => !codigos.some((o) => o.length > c.length && o.startsWith(c))) ?? null
}
