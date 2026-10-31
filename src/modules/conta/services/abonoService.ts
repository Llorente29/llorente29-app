// src/modules/conta/services/abonoService.ts
//
// S01h · Lo que anula un abono de proveedor y lo que lo sustituye, para la
// ficha. Todo por la cuenta (regla 9). Nombres comprobados contra el esquema
// (regla 40): supplier_invoice.corrects_invoice_id, code, number_key,
// paid_method, status, doc_kind, reading; supplier_invoice_receipt.
import { tabla, mensaje } from '@/modules/conta/services/bd'
import type { LoQueAnula } from '@/modules/conta/documentos/abono'

type Fila = Record<string, unknown>
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function leerLoQueAnula(accountId: string, abonoId: string): Promise<LoQueAnula> {
  const { data: a, error } = await tabla('supplier_invoice')
    .select('id, supplier_id, corrects_invoice_id, grand_total, invoice_date, paid_method, status, reading')
    .eq('account_id', accountId).eq('id', abonoId).maybeSingle()
  if (error) throw new Error(mensaje('No he podido leer lo que anula el abono', error))
  const ab = (a ?? {}) as Fila
  const dice = s(((ab.reading as Fila | null)?.factura as Fila | undefined)?.rectificaA)
  const compensado = s(ab.paid_method) === 'compensation'
  const anuladaId = s(ab.corrects_invoice_id)
  if (!anuladaId) return { anulada: null, sustituta: null, dice, compensado }
  const { data: f, error: e2 } = await tabla('supplier_invoice')
    .select('id, code, invoice_number, number_key, invoice_date, grand_total, status, supplier_id, supplier_invoice_receipt(goods_receipt_id)')
    .eq('account_id', accountId).eq('id', anuladaId).maybeSingle()
  if (e2) throw new Error(mensaje('No he podido leer la factura que anula', e2))
  if (!f) return { anulada: null, sustituta: null, dice, compensado }
  const fa = f as Fila
  const total = n(fa.grand_total)
  // Lo sustituye: otra factura del mismo proveedor, del mismo importe, de ese día o después.
  let sustituta: LoQueAnula['sustituta'] = null
  if (total !== null && s(fa.supplier_id)) {
    const { data: o } = await tabla('supplier_invoice')
      .select('id, code, invoice_number, invoice_date')
      .eq('account_id', accountId).eq('supplier_id', s(fa.supplier_id)!).eq('doc_kind', 'invoice').eq('grand_total', total)
      .neq('id', anuladaId).neq('status', 'descartada').gte('invoice_date', s(fa.invoice_date) ?? '1900-01-01')
      .order('invoice_date').limit(1)
    const x = ((o ?? []) as Fila[])[0]
    if (x) sustituta = { id: String(x.id), codigo: String(x.code), numero: s(x.invoice_number), fecha: s(x.invoice_date) }
  }
  return {
    anulada: {
      id: String(fa.id), codigo: String(fa.code), numero: s(fa.invoice_number), fecha: s(fa.invoice_date), total,
      pagada: s(fa.status) === 'pagada', conAlbaran: Array.isArray(fa.supplier_invoice_receipt) && fa.supplier_invoice_receipt.length > 0,
    },
    sustituta, dice, compensado,
  }
}
