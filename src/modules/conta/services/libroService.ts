// src/modules/conta/services/libroService.ts
//
// C04 · Lo que se lee del libro diario. El Mayor del C02, la ficha del
// proveedor y la del tercero dejan de estar vacíos: leen los apuntes
// validados de `journal_ledger` (vista con la RLS de quien lee, filtrada por
// cuenta y empresa, regla 9) y las sumas y saldos de `conta_sumas_saldos`.
// Un asiento anulado y su contraasiento salen los dos: se compensan y nada
// validado desaparece.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { Apunte } from '@/modules/conta/lib/cuentasProveedor'

type Fila = Record<string, unknown>
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/**
 * Los apuntes validados de unas cuentas de la empresa, en orden de fecha y
 * número. Con `partyId`, solo los de ese tercero: es lo que separa a un
 * proveedor de los demás cuando todos comparten la cuenta común (40000000).
 */
export async function apuntesDeCuentas(accountId: string, companyId: string, cuentas: readonly string[], partyId?: string | null): Promise<Apunte[]> {
  if (cuentas.length === 0) return []
  let q = tabla('journal_ledger')
    .select('entry_id, series, number, entry_date, concept, document_ref, debit, credit, status, source_type, voided_by_entry_id')
    .eq('account_id', accountId).eq('company_id', companyId).in('company_account_id', [...cuentas])
  if (partyId) q = q.eq('party_id', partyId)
  const { data, error } = await q.order('entry_date').order('series').order('number')
  if (error) throw new Error(mensaje('No se han podido leer los apuntes', error))
  return ((data ?? []) as Fila[]).map((f) => ({
    fecha: String(f.entry_date),
    documento: f.document_ref ? String(f.document_ref) : `${f.series}/${f.number}`,
    concepto: String(f.concept ?? ''),
    debe: num(f.debit),
    haber: num(f.credit),
    enlace: { tipo: 'asiento' as const, id: String(f.entry_id) },
    asiento: { serie: Number(f.series), numero: Number(f.number), anulado: f.status === 'anulado' },
  }))
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
