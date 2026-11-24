// src/modules/conta/nucleo/recibida/pagosServicio.ts
//
// K11b · Los pagos de una recibida, uno por fila como ERP10 («Pago factura»), con las funciones del K10c (0920):
//   · leerPagos: los de supplier_invoice_payment de la factura (regla 9: su cuenta), con su asiento (serie / número,
//     fecha, concepto) y la cuenta con la que se pagó (la del haber del asiento, la que no es la del proveedor);
//   · apuntarUnPago: conta_recibida_pago_apuntar (un pago por un importe, su asiento en la serie 4);
//   · sePuedeCambiarPago: conta_recibida_pago_se_puede_cambiar (los candados: conciliado en Bancos, una remesa o una
//     liquidación, ya en ERP10, el IVA presentado, el ejercicio o el mes cerrados, Diez, la cadena);
//   · cambiarPago y borrarPago: conta_recibida_pago_cambiar (el mismo número) y conta_recibida_pago_borrar (renumera).
// Cada uno devuelve la frase de la base: la ficha la pone en la barra (regla 8).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'

type Fila = Record<string, unknown>
const s = (x: unknown): string | null => (x === null || x === undefined || x === '' ? null : String(x))
const n = (x: unknown): number => Number(x ?? 0)

export interface PagoDeLaFactura {
  id: string
  fecha: string
  importe: number
  /** La subcuenta con la que se pagó (la del haber del asiento) y su nombre. */
  cuenta: string | null
  nombreCuenta: string | null
  concepto: string
  asientoId: string | null
  serie: number | null
  numero: number | null
  /** Conciliado con un movimiento del banco: se deshace en Bancos. */
  conciliado: boolean
  apuntes: { cuenta: string; nombre: string; debe: number; haber: number }[]
}

/** Los pagos de una recibida, por fecha, con su asiento. La cuenta del proveedor (su 400/410) no es la del pago. */
export async function leerPagos(accountId: string, invoiceId: string, cuentaProveedor: string | null): Promise<PagoDeLaFactura[]> {
  const { data, error } = await tabla('supplier_invoice_payment')
    .select('id, paid_on, amount, note, entry_id, bank_match_id, journal_entry:entry_id(id, series, number, entry_date, concept, journal_line(position, debit, credit, company_account(code, name)))')
    .eq('account_id', accountId).eq('invoice_id', invoiceId).order('paid_on').order('created_at')
  if (error) throw new Error(mensaje('No se han podido leer los pagos de la factura', error))
  return ((data ?? []) as Fila[]).map((p) => {
    const e = (p.journal_entry ?? null) as Fila | null
    const apuntes = ((e?.journal_line ?? []) as Fila[])
      .sort((a, b) => n(a.position) - n(b.position))
      .map((l) => { const c = (l.company_account ?? {}) as Fila; return { cuenta: String(c.code ?? ''), nombre: String(c.name ?? ''), debe: n(l.debit), haber: n(l.credit) } })
    const contra = apuntes.find((a) => a.haber > 0 && a.cuenta !== cuentaProveedor) ?? apuntes.find((a) => a.cuenta !== cuentaProveedor) ?? null
    return {
      id: String(p.id), fecha: String(p.paid_on), importe: n(p.amount), cuenta: contra?.cuenta ?? null, nombreCuenta: contra?.nombre ?? null,
      concepto: s(e?.concept) ?? s(p.note) ?? '', asientoId: s(e?.id), serie: e?.series === null || e?.series === undefined ? null : n(e.series),
      numero: e?.number === null || e?.number === undefined ? null : n(e.number), conciliado: !!p.bank_match_id, apuntes,
    }
  })
}

type Frase = { frase?: string }
const frase = (r: Frase | null, otra: string) => String(r?.frase ?? otra)

/** Un pago por un importe con una subcuenta (no del banco: ese espera el cargo en Bancos). */
export async function apuntarUnPago(o: { companyId: string; invoiceId: string; cuenta: string; fecha: string; importe: number; concepto: string | null; quien: string | null }): Promise<string> {
  const r = await rpc<Frase>('conta_recibida_pago_apuntar', { p_company: o.companyId, p_invoice: o.invoiceId, p_cuenta: o.cuenta, p_fecha: o.fecha, p_importe: o.importe, p_concepto: o.concepto, p_quien_nombre: o.quien })
  return frase(r, `Pago apuntado con la ${o.cuenta}.`)
}

export interface SePuede { puede: boolean; porque: string | null }

/** Si un pago se puede cambiar o borrar, y si no, por qué (la frase de la base, para el `title`). */
export async function sePuedeCambiarPago(pagoId: string): Promise<SePuede> {
  const r = await rpc<{ puede?: boolean; porque?: string | null }>('conta_recibida_pago_se_puede_cambiar', { p_pago: pagoId })
  return { puede: r?.puede === true, porque: s(r?.porque) }
}

export async function cambiarPago(o: { pagoId: string; cuenta: string; fecha: string; importe: number; concepto: string | null; quien: string | null }): Promise<string> {
  const r = await rpc<Frase>('conta_recibida_pago_cambiar', { p_pago: o.pagoId, p_cuenta: o.cuenta, p_fecha: o.fecha, p_importe: o.importe, p_concepto: o.concepto, p_quien_nombre: o.quien })
  return frase(r, 'Pago cambiado.')
}

export async function borrarPago(o: { pagoId: string; motivo: string; quien: string | null }): Promise<string> {
  const r = await rpc<Frase>('conta_recibida_pago_borrar', { p_pago: o.pagoId, p_motivo: o.motivo, p_quien_nombre: o.quien })
  return frase(r, 'Pago borrado.')
}
