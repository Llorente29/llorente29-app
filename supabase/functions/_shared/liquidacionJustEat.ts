// supabase/functions/_shared/liquidacionJustEat.ts
//
// V02 · Entrega 2 · EL LECTOR DE LA LIQUIDACIÓN DE JUST EAT POR CORREO. Puro: ni
// red ni base. Lo llama recibirCorreo (facturasEntrada.ts) cuando llega un
// correo de Just Eat al buzón de liquidaciones o a la puerta, y lo puede llamar
// la pantalla con un .eml subido. Lo que devuelve va a conta_liquidacion_registrar.
//
// La forma, medida en el correo de Julio (25/10: «Just-eat invoice: 4126424», de
// noreplyes@justeat-int.com, del 16/10):
//   · uno por restaurante (marca y local) y quincena;
//   · arriba, el periodo («1 octubre 2026 - 15 octubre 2026»), el restaurante
//     y «Recibirás de Just Eat» (el neto), «Será abonado antes del <fecha>»,
//     «Número de pedidos» y «Total de ventas»;
//   · «Tu factura de Just Eat»: su FACTURA DE COMISIÓN (Nº Factura, el
//     restaurante con su dirección, el NIF del cliente y el de Just Eat, las
//     líneas, Base, IVA y «Total incluido IVA»);
//   · «Estado de tu cuenta»: el balance (el pago del periodo anterior, las
//     ventas con tarjeta, las campañas y la factura) y «Tu balance en cuenta»
//     (el neto, otra vez);
//   · «Tus pedidos»: uno a uno.
// No trae ningún ID de la tienda: Just Eat se reconoce por el nombre del
// restaurante y su calle, hasta que llegue un documento suyo con ID.
// Cuadrado al céntimo: ventas 144,02 − factura 32,79 − campaña 20,93 = 90,30.
//
// S01j·3 · Con saldo negativo (lo que se le debe a Just Eat), el correo no dice
// «Recibirás de Just Eat»: dice «El importe que debes abonar a Just Eat es
// -4,33€» (el importe en el mismo trozo o en el siguiente) y no trae «Será
// abonado». Se lee igual: el neto es negativo. Y su factura puede no traer la
// tabla «Base · IVA · Cuota»: entonces trae «Subtotal», «IVA 21%» y «Total
// incluido IVA» (medido en los correos de Just Eat de saldo negativo, sin
// copiar ninguno: la prueba usa uno inventado con la misma forma).

import { centimos, trozos } from './liquidacionUber.ts'

export class NoEsLiquidacionJustEat extends Error {}

export interface LiquidacionJustEat {
  restaurante: string
  calle: string | null
  desde: string
  hasta: string
  pagoEl: string | null
  pedidos: number
  ventas: number
  neto: number
  factura: { numero: string; base: number; iva: number; total: number }
  /** S01j · La fecha de la factura («Fecha de factura»), si la trae. */
  fechaFactura: string | null
  /** S01j · El número del asunto («Just-eat invoice: 4126424»), si lo trae. */
  numeroAsunto: string | null
  nifJustEat: string | null
  /** Lo demás que mueve el pago (campañas…): neto − ventas + factura. */
  otros: number
  avisos: string[]
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const fechaLarga = (s: string): string | null => {
  const m = /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de\s+)?(\d{4})|(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})/i.exec(s)
  if (!m) return null
  const d = m[1] ?? m[4]; const mes = (m[2] ?? m[5]).toLowerCase(); const a = m[3] ?? m[6]
  const i = MESES.indexOf(mes)
  return i < 0 ? null : `${a}-${String(i + 1).padStart(2, '0')}-${d.padStart(2, '0')}`
}
const euros = (s: string | undefined): number | null => {
  const c = centimos(s ?? null)
  return c === null ? null : c / 100
}
const r2 = (x: number): number => Math.round(x * 100) / 100

/** S01j·3 · «El importe que debes abonar a Just Eat es -4,33€»: el saldo es negativo. */
const DEBES = /^El importe que debes abonar a Just Eat es\b/i

/** Lo que se le debe a Just Eat, como neto (negativo): el importe va en el mismo trozo o en el siguiente. */
function debes(ts: readonly string[]): number | null {
  const i = ts.findIndex((t) => DEBES.test(t))
  if (i < 0) return null
  const v = euros(ts[i].replace(DEBES, '').trim()) ?? euros(ts[i + 1])
  return v === null ? null : -Math.abs(v)
}

/** ¿Es una liquidación de Just Eat? Por el remitente o el asunto, y su cuerpo. */
export function esLiquidacionJustEat(c: { from?: string | null; subject?: string | null }, ts: readonly string[]): boolean {
  const de = /just-?eat|justeat/i.test(`${c.from ?? ''} ${c.subject ?? ''}`)
  const cuerpo = ts.some((t) => /^Recibirás de Just Eat$/i.test(t) || DEBES.test(t)) && ts.some((t) => /^Nº Factura\s+\S+/i.test(t))
  return de && cuerpo
}

/** El valor que sigue a una etiqueta (en el trozo siguiente). */
const tras = (ts: readonly string[], re: RegExp, desde = 0): string | undefined => {
  const i = ts.findIndex((t, k) => k >= desde && re.test(t))
  return i < 0 ? undefined : ts[i + 1]
}

export function leerLiquidacionJustEat(c: { from?: string | null; subject?: string | null; html?: string | null; text?: string | null }): LiquidacionJustEat {
  const ts = trozos(c)
  if (!esLiquidacionJustEat(c, ts)) throw new NoEsLiquidacionJustEat('No es una liquidación de Just Eat.')
  const periodo = ts.find((t) => /^\d{1,2}\s+[a-záéíóú]+\s+\d{4}\s*-\s*\d{1,2}\s+[a-záéíóú]+\s+\d{4}$/i.test(t))
  const [d1, d2] = (periodo ?? '').split('-').map((x) => fechaLarga(x.trim()))
  if (!d1 || !d2) throw new NoEsLiquidacionJustEat('La liquidación de Just Eat no dice su periodo.')
  const neto = euros(tras(ts, /^Recibirás de Just Eat$/i)) ?? debes(ts) ?? euros(tras(ts, /^Tu balance en cuenta$/i))
  const ventas = euros(tras(ts, /^Total de ventas$/i))
  const pedidos = Number(tras(ts, /^Número de pedidos$/i))
  const iFac = ts.findIndex((t) => /^Nº Factura\s+\S+/i.test(t))
  const numero = ts[iFac]?.replace(/^Nº Factura\s+/i, '').trim()
  // Base, IVA y Cuota van como cabecera y luego sus valores: «27,10€», «21%», «5,69€».
  const iBase = ts.findIndex((t, k) => k > iFac && /^Base$/i.test(t))
  const valores = iBase < 0 ? [] : ts.slice(iBase + 1, iBase + 8).filter((t) => !/^(IVA|Cuota)$/i.test(t))
  // S01j·3 · Sin la tabla, «Subtotal» e «IVA 21%» (los correos de saldo negativo).
  const base = euros(valores[0]) ?? euros(tras(ts, /^Subtotal$/i, iFac))
  const iva = euros(valores[2]) ?? euros(tras(ts, /^IVA \d+(?:[.,]\d+)?\s*%$/i, iFac))
  const total = euros(tras(ts, /^Total incluido IVA$/i, iFac))
  if (neto === null || ventas === null || !Number.isFinite(pedidos) || !numero || base === null || iva === null || total === null) {
    throw new NoEsLiquidacionJustEat('A la liquidación de Just Eat le faltan importes (neto, ventas, pedidos o su factura).')
  }
  const avisos: string[] = []
  if (Math.round(base * 100) + Math.round(iva * 100) !== Math.round(total * 100)) avisos.push('Su factura no cuadra: base + IVA no es el total.')
  // El restaurante y su calle: los de la factura (después del nombre de Just Eat).
  const iJe = ts.findIndex((t, k) => k > iFac && /^Just Eat Spain/i.test(t))
  const restaurante = (iJe >= 0 ? ts[iJe + 1] : ts[2])?.trim() ?? ''
  const calle = iJe >= 0 ? ts.slice(iJe + 2, iJe + 6).find((t) => /\d/.test(t) && /calle|c\/|avenida|avda|plaza|paseo|camino|carretera/i.test(t)) ?? null : null
  const iFecha = ts.findIndex((t, k) => k > iFac && /^Fecha de factura/i.test(t))
  const nifs = ts.slice(iFac, iFecha < 0 ? iFac + 15 : iFecha).filter((t) => /^[A-Z]\d{8}$|^\d{8}[A-Z]$/.test(t))
  const pago = ts.find((t) => /^Será abonado antes del/i.test(t))
  // S01j · La fecha de la factura: en el mismo trozo («Fecha de factura 16 octubre 2026») o en el siguiente.
  const fechaFactura = iFecha < 0 ? null : fechaLarga(ts[iFecha].replace(/^Fecha de factura:?/i, '').trim()) ?? fechaLarga(ts[iFecha + 1] ?? '')
  const numeroAsunto = /invoice:?\s*(\d{5,})/i.exec(c.subject ?? '')?.[1] ?? null
  return {
    restaurante, calle: calle ? calle.replace(/,/g, '').replace(/\s+/g, ' ').trim() : null, desde: d1, hasta: d2,
    pagoEl: pago ? fechaLarga(pago) : null, pedidos, ventas, neto, factura: { numero, base, iva, total }, fechaFactura, numeroAsunto,
    nifJustEat: nifs.length ? nifs[nifs.length - 1] : null, otros: r2(neto - ventas + total), avisos,
  }
}

/** Lo que va a conta_liquidacion_registrar. */
export function paraRegistrarJustEat(l: LiquidacionJustEat, x: { emailId?: string | null; origen?: string } = {}) {
  return {
    proveedor: 'justeat', origen: x.origen ?? 'correo', email_id: x.emailId ?? null,
    tienda: l.calle ? `${l.restaurante} (${l.calle})` : l.restaurante, tienda_id: null, marca: l.restaurante,
    desde: l.desde, hasta: l.hasta, pago_el: l.pagoEl, pedidos: l.pedidos, referencia: l.factura.numero,
    ventas: { total: l.ventas }, comision: l.factura.total, otros: l.otros, neto: l.neto,
    factura: { numero: l.factura.numero, base: l.factura.base, iva: l.factura.iva, total: l.factura.total },
    intermediario: { nombre: 'Just Eat Spain S.L.', nif: l.nifJustEat }, avisos: l.avisos,
    // S01j · Para casar las antiguas sin periodo (import_csv_je, «je:<número>»).
    referencia_asunto: l.numeroAsunto, fecha_factura: l.fechaFactura,
  }
}
