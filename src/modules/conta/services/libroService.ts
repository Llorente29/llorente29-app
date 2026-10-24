// src/modules/conta/services/libroService.ts
//
// C04 · Lo que se lee del libro diario. El Mayor del C02, la ficha del
// proveedor y la del tercero dejan de estar vacíos: leen los apuntes
// validados de `journal_ledger` (vista con la RLS de quien lee, filtrada por
// cuenta y empresa, regla 9) y las sumas y saldos de `conta_sumas_saldos`.
// Un asiento anulado y su contraasiento salen los dos: se compensan y nada
// validado desaparece.
//
// I01e · Nombres de la base entre comillas (regla 40), comprobados el 20/10
// contra producción y staging (information_schema, 16 + 14 + 6 + 5 columnas
// de 16 + 14 + 6 + 5): journal_ledger (entry_id, series, number, entry_date,
// concept, document_ref, debit, credit, status, source_type, external_program,
// voided_by_entry_id, position, line_id, company_account_id, party_id),
// vat_book_entry (entry_id, series, number, issue_date, tax_base, tax_amount,
// total, reverse_charge, source_type, source_id, book, voided_at, account_id,
// company_id), company_account_link (company_account_id, entity, entity_id,
// role, account_id, company_id) y company_account (id, code, is_common,
// account_id, company_id).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { Apunte } from '@/modules/conta/lib/cuentasProveedor'
import { origenDelAsiento, type FilaLibroProveedor } from '@/modules/conta/lib/libroProveedor'

type Fila = Record<string, unknown>
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/** Lo que PostgREST da como mucho en una lectura (max-rows): se pide por trozos. */
const POR_PAGINA = 1000

/**
 * Los apuntes validados de unas cuentas de la empresa, en orden de fecha y
 * número. Con `partyId`, solo los de ese tercero: es lo que separa a un
 * proveedor de los demás cuando todos comparten la cuenta común (40000000).
 * I01e: por trozos de 1.000 (una cuenta de Foodint tiene más de 2.600
 * asientos; antes el saldo salía de los 1.000 primeros) y con su origen.
 */
export async function apuntesDeCuentas(accountId: string, companyId: string, cuentas: readonly string[], partyId?: string | null): Promise<Apunte[]> {
  if (cuentas.length === 0) return []
  const filas: Fila[] = []
  for (let desde = 0; ; desde += POR_PAGINA) {
    let q = tabla('journal_ledger')
      .select('entry_id, series, number, entry_date, concept, document_ref, debit, credit, status, source_type, external_program, voided_by_entry_id')
      .eq('account_id', accountId).eq('company_id', companyId).in('company_account_id', [...cuentas])
    if (partyId) q = q.eq('party_id', partyId)
    const { data, error } = await q.order('entry_date').order('series').order('number').order('position').order('line_id')
      .range(desde, desde + POR_PAGINA - 1)
    if (error) throw new Error(mensaje('No se han podido leer los apuntes', error))
    const trozo = (data ?? []) as Fila[]
    filas.push(...trozo)
    if (trozo.length < POR_PAGINA) break
  }
  return filas.map((f) => ({
    fecha: String(f.entry_date),
    documento: f.document_ref ? String(f.document_ref) : `${f.series}/${f.number}`,
    concepto: String(f.concept ?? ''),
    debe: num(f.debit),
    haber: num(f.credit),
    enlace: { tipo: 'asiento' as const, id: String(f.entry_id) },
    asiento: { serie: Number(f.series), numero: Number(f.number), anulado: f.status === 'anulado' },
    origen: origenDelAsiento(f.source_type ? String(f.source_type) : null, f.external_program ? String(f.external_program) : null),
  }))
}

/** De cuántos asientos se pregunta al libro de IVA de una vez (la lista va en la dirección). */
const ASIENTOS_POR_LECTURA = 100

/**
 * I01e · Las filas del libro de IVA de recibidas de unos asientos, sin las
 * anuladas. Por trozos: la lista de asientos va en la dirección de la lectura.
 */
export async function libroDeLosAsientos(accountId: string, companyId: string, asientos: readonly string[]): Promise<FilaLibroProveedor[]> {
  const ids = [...new Set(asientos)]
  const trozos: string[][] = []
  for (let i = 0; i < ids.length; i += ASIENTOS_POR_LECTURA) trozos.push(ids.slice(i, i + ASIENTOS_POR_LECTURA))
  const out: FilaLibroProveedor[] = []
  // De cuatro en cuatro: una cuenta con miles de asientos no abre cien lecturas a la vez.
  for (let i = 0; i < trozos.length; i += 4) {
    const leidos = await Promise.all(trozos.slice(i, i + 4).map(async (t) => {
      const { data, error } = await tabla('vat_book_entry')
        .select('entry_id, series, number, issue_date, tax_base, tax_amount, total, reverse_charge, source_type, source_id')
        .eq('account_id', accountId).eq('company_id', companyId).eq('book', 'received').is('voided_at', null).in('entry_id', t)
      if (error) throw new Error(mensaje('No se ha podido leer el libro de IVA', error))
      return (data ?? []) as Fila[]
    }))
    for (const f of leidos.flat()) {
      out.push({
        entryId: String(f.entry_id),
        serie: f.series ? String(f.series) : null,
        numero: f.number ? String(f.number) : null,
        fecha: String(f.issue_date),
        base: num(f.tax_base),
        cuota: num(f.tax_amount),
        total: num(f.total),
        isp: f.reverse_charge === true,
        sourceType: f.source_type ? String(f.source_type) : null,
        sourceId: f.source_id ? String(f.source_id) : null,
      })
    }
  }
  return out
}

/** I01e · Lo que el libro sabe de un proveedor: su cuenta, sus apuntes y las filas del libro de esos asientos. */
export interface LibroDelProveedor {
  /** Su cuenta (la «principal»: 400 o 410). null si no tiene. */
  cuenta: { id: string; code: string } | null
  apuntes: Apunte[]
  filas: FilaLibroProveedor[]
}

/**
 * Su cuenta principal en la empresa, sus apuntes validados y las filas del
 * libro de IVA de esos asientos. Si su cuenta es la común de proveedores, solo
 * los de su tercero; común y sin tercero, ninguno (mejor ninguno que los de otros).
 */
export async function libroDelProveedor(accountId: string, companyId: string, supplierId: string): Promise<LibroDelProveedor> {
  const { data: enlaces, error } = await tabla('company_account_link').select('company_account_id')
    .eq('account_id', accountId).eq('company_id', companyId).eq('entity', 'supplier').eq('entity_id', supplierId).eq('role', 'principal').limit(1)
  if (error) throw new Error(mensaje('No se ha podido leer su cuenta', error))
  const id = ((enlaces ?? []) as Fila[])[0]?.company_account_id
  if (!id) return { cuenta: null, apuntes: [], filas: [] }
  const { data: cuentas, error: e2 } = await tabla('company_account').select('id, code, is_common')
    .eq('account_id', accountId).eq('company_id', companyId).eq('id', String(id)).limit(1)
  if (e2) throw new Error(mensaje('No se ha podido leer su cuenta', e2))
  const ca = ((cuentas ?? []) as Fila[])[0]
  if (!ca) return { cuenta: null, apuntes: [], filas: [] }
  const cuenta = { id: String(ca.id), code: String(ca.code) }
  let partyId: string | null = null
  if (ca.is_common === true) {
    partyId = await terceroDelProveedor(accountId, supplierId)
    if (!partyId) return { cuenta, apuntes: [], filas: [] }
  }
  const apuntes = await apuntesDeCuentas(accountId, companyId, [cuenta.id], partyId)
  const filas = await libroDeLosAsientos(accountId, companyId, apuntes.flatMap((a) => (a.enlace ? [a.enlace.id] : [])))
  return { cuenta, apuntes, filas }
}

export interface SumaCuenta { companyAccountId: string; code: string; name: string; debe: number; haber: number; saldo: number }

/** Sumas y saldos de la empresa en un periodo (fechas 'YYYY-MM-DD'). */
export async function sumasYSaldos(companyId: string, desde: string, hasta: string): Promise<SumaCuenta[]> {
  const filas = (await rpc('conta_sumas_saldos', { p_company: companyId, p_desde: desde, p_hasta: hasta })) as Fila[] | null
  return (filas ?? []).map((f) => ({
    companyAccountId: String(f.company_account_id), code: String(f.code), name: String(f.name),
    debe: num(f.debe), haber: num(f.haber), saldo: num(f.saldo),
  }))
}

/** El tercero (party) de un proveedor de Cocina, si lo tiene: party_role con su supplier_id. */
export async function terceroDelProveedor(accountId: string, supplierId: string): Promise<string | null> {
  const { data, error } = await tabla('party_role').select('party_id').eq('account_id', accountId).eq('supplier_id', supplierId).limit(1)
  if (error) throw new Error(mensaje('No se ha podido leer el tercero del proveedor', error))
  const f = ((data ?? []) as Fila[])[0]
  return f ? String(f.party_id) : null
}
