// src/modules/conta/lib/cifras.ts
//
// Las cuatro cifras de la ficha y el vencimiento. Encargo C01 §5.6 y §4.4.
//
// CUENTAN SÓLO LAS FACTURAS APROBADAS: estado 'aprobada' o 'pagada' (una
// pagada fue aprobada antes; marcarla como pagada no puede sacarla de lo que
// le has comprado). Borradores, en revisión, con discrepancias y anuladas, no.
//
// Sin facturas, una cifra es null y la pantalla dice «Aún no hay facturas
// suyas», nunca un 0 € que parezca que no se le debe nada.

import type { FacturaParaCifras } from '@/modules/conta/types'

export const ESTADOS_QUE_CUENTAN = ['aprobada', 'pagada'] as const

export function cuenta(f: FacturaParaCifras): boolean {
  return (ESTADOS_QUE_CUENTAN as readonly string[]).includes(f.status)
}

export function estaPagada(f: FacturaParaCifras): boolean {
  return f.paidAt !== null || f.status === 'pagada'
}

export interface CifrasFicha {
  /** Suma de grand_total del año natural. null = ninguna factura aprobada este año. */
  compradoEsteAnio: number | null
  facturasEsteAnio: number
  /** Suma de las aprobadas sin pagar. null = no hay ninguna factura aprobada (nunca). */
  leDebes: number | null
  /** El vencimiento más cercano de las no pagadas. null = no hay nada pendiente. */
  proximoPago: { fecha: string; importe: number; facturas: number } | null
  /** ¿Hay alguna factura aprobada de este proveedor, de cualquier año? */
  hayFacturas: boolean
}

const redondea = (x: number): number => Math.round(x * 100) / 100

/** `hoy` en 'YYYY-MM-DD' (hora de Madrid, la decide quien llama). */
export function calcularCifras(facturas: FacturaParaCifras[], hoy: string): CifrasFicha {
  const validas = facturas.filter(cuenta)
  const anio = hoy.slice(0, 4)
  const delAnio = validas.filter((f) => (f.invoiceDate ?? '').startsWith(anio))
  const pendientes = validas.filter((f) => !estaPagada(f))

  const conVencimiento = pendientes.filter((f) => f.dueDate !== null)
  let proximoPago: CifrasFicha['proximoPago'] = null
  if (conVencimiento.length > 0) {
    const fecha = conVencimiento.map((f) => f.dueDate as string).sort()[0]
    const mismas = conVencimiento.filter((f) => f.dueDate === fecha)
    proximoPago = {
      fecha,
      importe: redondea(mismas.reduce((s, f) => s + (f.grandTotal ?? 0), 0)),
      facturas: mismas.length,
    }
  }

  return {
    compradoEsteAnio: delAnio.length === 0 ? null : redondea(delAnio.reduce((s, f) => s + (f.grandTotal ?? 0), 0)),
    facturasEsteAnio: delAnio.length,
    leDebes: validas.length === 0 ? null : redondea(pendientes.reduce((s, f) => s + (f.grandTotal ?? 0), 0)),
    proximoPago,
    hayFacturas: validas.length > 0,
  }
}

// ── Vencimiento ──────────────────────────────────────────────────────────────

function aFecha(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function aIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function diasDelMes(anio: number, mes0: number): number {
  return new Date(Date.UTC(anio, mes0 + 1, 0)).getUTCDate()
}

/**
 * Vencimiento de una factura: fecha de factura + plazo en días. Si el
 * proveedor cobra en días fijos del mes (p. ej. 5 y 20), el vencimiento pasa
 * al primer día fijo que sea igual o posterior. Un día fijo que no existe en
 * ese mes (el 31 en abril) se toma como el último día del mes.
 *
 * Sin plazo (null) no se inventa nada: devuelve null y la factura queda sin
 * vencimiento hasta que alguien lo ponga.
 */
export function calcularVencimiento(
  fechaFactura: string, plazoDias: number | null, diasFijos: number[] = [],
): string | null {
  if (plazoDias === null || plazoDias < 0) return null
  const base = aFecha(fechaFactura)
  base.setUTCDate(base.getUTCDate() + plazoDias)
  const fijos = Array.from(new Set(diasFijos.filter((d) => d >= 1 && d <= 31))).sort((a, b) => a - b)
  if (fijos.length === 0) return aIso(base)

  let anio = base.getUTCFullYear()
  let mes = base.getUTCMonth()
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    const ultimo = diasDelMes(anio, mes)
    for (const d of fijos) {
      const dia = Math.min(d, ultimo)
      const candidato = new Date(Date.UTC(anio, mes, dia))
      if (candidato >= base) return aIso(candidato)
    }
    mes += 1
    if (mes > 11) { mes = 0; anio += 1 }
  }
  return aIso(base) // inalcanzable: el mes siguiente siempre tiene un día fijo
}
