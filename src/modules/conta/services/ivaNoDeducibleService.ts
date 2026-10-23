// src/modules/conta/services/ivaNoDeducibleService.ts
//
// D07 · Leer y marcar el IVA no deducible de una recibida (tanda 0850:
// supplier_invoice.vat_non_deductible_reason y _note, y la función
// conta_recibida_iva_no_deducible). Nombres de la base entre comillas (regla
// 40): supplier_invoice (id, account_id, vat_non_deductible,
// vat_non_deductible_reason, vat_non_deductible_note) y
// conta_recibida_iva_no_deducible(p_invoice, p_no_deducible, p_motivo,
// p_texto, p_quien_nombre).
//
// Mientras la base no tenga la 0850 (staging antes de aplicarla), se lee solo
// vat_non_deductible (de la 0190) y el motivo queda sin decir.

import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import type { MotivoNoDeducible } from '@/modules/conta/lib/ivaNoDeducible'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const sinColumna = (m: string) => /does not exist|could not find|schema cache/i.test(m)

export interface IvaNoDeducible { noDeducible: boolean; motivo: MotivoNoDeducible | null; texto: string | null; conMotivo: boolean }

/** El IVA no deducible de unas recibidas de la cuenta, por id (solo las marcadas). */
export async function leerNoDeducibles(accountId: string, ids: readonly string[]): Promise<Map<string, IvaNoDeducible>> {
  const fuera = new Map<string, IvaNoDeducible>()
  if (!ids.length) return fuera
  const consulta = (sel: string) => tabla('supplier_invoice').select(sel).eq('account_id', accountId).in('id', [...ids]).eq('vat_non_deductible', true)
  let r = await consulta('id, vat_non_deductible, vat_non_deductible_reason, vat_non_deductible_note')
  let conMotivo = true
  if (r.error && sinColumna(r.error.message)) { r = await consulta('id, vat_non_deductible'); conMotivo = false }
  if (r.error) throw new Error(mensaje('No se ha podido leer el IVA no deducible', r.error))
  for (const x of (r.data ?? []) as unknown as Fila[]) {
    fuera.set(String(x.id), { noDeducible: true, motivo: (s(x.vat_non_deductible_reason) as MotivoNoDeducible | null) ?? null, texto: s(x.vat_non_deductible_note), conMotivo })
  }
  return fuera
}

/** El de una recibida (marcada o no). */
export async function leerNoDeducible(accountId: string, invoiceId: string): Promise<IvaNoDeducible> {
  const m = await leerNoDeducibles(accountId, [invoiceId])
  return m.get(invoiceId) ?? { noDeducible: false, motivo: null, texto: null, conMotivo: true }
}

/** Marcarlo (o quitarlo) desde la ficha. Devuelve la frase de lo hecho. */
export async function marcarNoDeducible(invoiceId: string, noDeducible: boolean, motivo: MotivoNoDeducible | null, texto: string | null, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_recibida_iva_no_deducible', {
    p_invoice: invoiceId, p_no_deducible: noDeducible, p_motivo: noDeducible ? motivo : null, p_texto: noDeducible ? texto : null, p_quien_nombre: quien,
  })
  return r.texto
}
