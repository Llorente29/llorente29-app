// src/modules/conta/documentos/abono.ts
//
// S01h · El abono de un proveedor (factura rectificativa recibida), en la
// ficha de «Por revisar». En la base va con todo en negativo (base, cuota y
// total restan); en pantalla se enseña SIN signo, porque en un abono todo va a
// tu favor (maqueta aprobada por Julio el 31/10), y al guardar se le devuelve
// el signo. El asiento lo da la vuelta comoAbono (lib/asientosPropuestos).

import type { FacturaRevisar } from '@/modules/conta/services/documentosService'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { fechaEs } from '@/modules/conta/documentos/fichaRecibida'

/** ¿Es un abono? Por su clase o porque su total va en negativo. */
export const esAbono = (f: Pick<FacturaRevisar, 'clase' | 'total'> | null | undefined): boolean =>
  !!f && (f.clase === 'credit_note' || (f.total ?? 0) < 0)

const abs = (x: number | null): number | null => (x === null ? null : Math.abs(x))

/** La factura, con los importes sin signo: así cuadra y se lee como una de siempre. */
export function sinSigno(f: FacturaRevisar): FacturaRevisar {
  if (!esAbono(f)) return f
  return {
    ...f,
    base: abs(f.base), cuota: abs(f.cuota), recargo: abs(f.recargo), retencion: abs(f.retencion), total: abs(f.total),
    tipos: f.tipos.map((t) => ({ ...t, base: Math.abs(t.base), cuota: Math.abs(t.cuota), recargo: abs(t.recargo) })),
    lineas: f.lineas.map((l) => ({ ...l, importe: abs(l.importe), cantidad: abs(l.cantidad) })),
  }
}

const neg = (x: unknown) => (typeof x === 'number' ? -Math.abs(x) : x)

/** Lo que la ficha manda a la base, con el signo del abono: base, cuota, recargo, retención y gasto restan. */
export function conSigno(p: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = { ...p }
  if (Array.isArray(p.iva)) r.iva = (p.iva as Record<string, unknown>[]).map((l) => ({ ...l, base: neg(l.base), cuota: neg(l.cuota), ...('recargo' in l ? { recargo: neg(l.recargo) } : {}) }))
  if (p.retencion && typeof p.retencion === 'object') {
    const x = p.retencion as Record<string, unknown>
    r.retencion = { ...x, base: neg(x.base), importe: neg(x.importe) }
  }
  if (Array.isArray(p.gasto)) r.gasto = (p.gasto as Record<string, unknown>[]).map((g) => ({ ...g, importe: neg(g.importe) }))
  return r
}

export const CHIP_ABONO = 'Abono · a tu favor'

/** Lo que anula el abono y lo que lo sustituye, si están en Sumied. */
export interface LoQueAnula {
  anulada: { id: string; codigo: string; numero: string | null; fecha: string | null; total: number | null; pagada: boolean; conAlbaran: boolean } | null
  sustituta: { id: string; codigo: string; numero: string | null; fecha: string | null } | null
  /** El número que el abono dice que anula (reading → factura → rectificaA). */
  dice: string | null
  /** Ya compensado: pagado «por compensación». */
  compensado: boolean
}

const nombreDe = (x: { numero: string | null; codigo: string }) => (x.numero ? `${x.numero} (${x.codigo})` : x.codigo)

/** «ANULA»: qué anula, entero o en parte, y qué lo sustituye. */
export function textoAnula(a: LoQueAnula, total: number): { titulo: string; detalle: string } | null {
  if (!a.anulada) {
    if (!a.dice) return null
    return { titulo: `La factura ${a.dice}, que no está en Sumied`, detalle: 'El abono se apunta igual. Si la factura llega después, se liga sola.' }
  }
  const que = a.anulada.conAlbaran ? 'El albarán-factura' : 'La factura'
  const entera = a.anulada.total !== null && Math.round(Math.abs(a.anulada.total) * 100) === Math.round(Math.abs(total) * 100)
  const cifras = [fechaEs(a.anulada.fecha), a.anulada.total !== null ? eurosExactos(a.anulada.total) : null].filter(Boolean).join(' · ')
  const sus = a.sustituta ? ` Lo sustituye la factura ${nombreDe(a.sustituta)}.` : ''
  return {
    titulo: `${que} ${a.anulada.numero ?? ''} · ${a.anulada.codigo}`.replace('  ', ' '),
    detalle: `${cifras}${cifras ? ' · ' : ''}${entera ? 'lo anula entero.' : `anula ${eurosExactos(Math.abs(total))}.`}${sus}`,
  }
}

/** «Pago»: compensa la que anula, o queda a tu favor. */
export function textoPago(a: LoQueAnula, total: number): { titulo: string; detalle: string } {
  const t = eurosExactos(Math.abs(total))
  if (a.compensado && a.anulada) return { titulo: `Pago: compensada con la ${a.anulada.codigo}`, detalle: 'Las dos quedan saldadas, sin movimiento de banco.' }
  if (a.anulada && !a.anulada.pagada) {
    return {
      titulo: `Pago: compensa la ${a.anulada.codigo}`,
      detalle: `La ${a.anulada.codigo} está sin pagar: al validar el asiento, las dos quedan saldadas, sin movimiento de banco.${a.sustituta ? ` Se paga solo la ${a.sustituta.codigo}.` : ''}`,
    }
  }
  if (a.anulada) return { titulo: 'Pago: queda a tu favor', detalle: `La ${a.anulada.codigo} ya está pagada: los ${t} quedan como saldo a tu favor con el proveedor.` }
  return { titulo: 'Pago: queda a tu favor', detalle: `Sin la factura que anula, los ${t} quedan como saldo a tu favor con el proveedor.` }
}

/** «IVA»: resta en el 303 del trimestre del asiento. */
export function textoIva(fechaAsiento: string | null, base: number, cuota: number): { titulo: string; detalle: string } {
  const mes = fechaAsiento ? Number(fechaAsiento.slice(5, 7)) : null
  const tri = mes ? `del ${Math.ceil(mes / 3)}.º trimestre` : 'del trimestre del asiento'
  return {
    titulo: `IVA: resta en el 303 ${tri}`,
    detalle: `Va al libro de recibidas como rectificativa: base −${eurosExactos(Math.abs(base))} y cuota −${eurosExactos(Math.abs(cuota))}.`,
  }
}
