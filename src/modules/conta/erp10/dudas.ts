// src/modules/conta/erp10/dudas.ts
//
// X31 · 2 · Lo que ya está en ERP10 y espera a una persona (antes de enviar, mirar; respuesta de Julio, 24/11). Puro: lo
// prueba tests/conta/x31-erp10/dudas.test.ts.
//   · Una factura: «Ya está en ERP10 (asiento N)», con un solo botón, «Es la misma, no la mandes». ERP10 no admite otra con
//     el mismo número del mismo tercero, así que no hay «Es otra». Si el total no es el mismo, los dos totales uno al lado
//     del otro y la diferencia en rojo, y no se puede decir «Es la misma» sin mirarla.
//   · Un asiento (de tesorería o manual): los dos botones, «Es el mismo, no lo mandes» y «Es otro, mándalo».

import { formatoImporte } from '../nucleo/piezas/logica'

export interface DudaVista {
  envioId: string; entryId: string
  que: 'factura' | 'asiento'
  /** En ERP10: su número de asiento y cuántos encajan. */
  documento: number; serie: string; cuantos: number
  /** Lo de Sumied: el número de la factura o el asiento, y su concepto. */
  numero: string | null; concepto: string | null; fecha: string | null
  totalErp10Cent: number | null; totalSumiedCent: number | null
}

const eur = (cent: number) => `${formatoImporte(cent / 100)} €`

/** La diferencia (Sumied menos ERP10), o null si no se sabe o es la misma. */
export function diferenciaCent(d: Pick<DudaVista, 'totalErp10Cent' | 'totalSumiedCent'>): number | null {
  if (d.totalErp10Cent == null || d.totalSumiedCent == null) return null
  const x = d.totalSumiedCent - d.totalErp10Cent
  return x === 0 ? null : x
}

/** «Ya está en ERP10 (asiento 51)», y si encajan varios, cuántos más. */
export const textoYaEsta = (d: Pick<DudaVista, 'documento' | 'cuantos'>) =>
  `Ya está en ERP10 (asiento ${d.documento})${d.cuantos > 1 ? ` y ${d.cuantos - 1} más que encajan` : ''}`

/** Qué es, en una línea: «La factura F-0007 · Proveedor…» o «El asiento del 05/11 · Pago…». */
export function queEs(d: Pick<DudaVista, 'que' | 'numero' | 'concepto' | 'fecha'>): string {
  const f = d.fecha ? `${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}` : null
  if (d.que === 'factura') return `La factura ${d.numero ?? 'sin número'}${d.concepto ? ` · ${d.concepto}` : ''}`
  return `El asiento ${d.numero ?? ''}${f ? ` del ${f}` : ''}${d.concepto ? ` · ${d.concepto}` : ''}`.replace(/\s+/g, ' ').trim()
}

/** Los dos totales, uno al lado del otro, y la diferencia (null si no hay totales que comparar). */
export function totales(d: Pick<DudaVista, 'totalErp10Cent' | 'totalSumiedCent'>): { sumied: string; erp10: string; diferencia: string | null } | null {
  if (d.totalErp10Cent == null || d.totalSumiedCent == null) return null
  const x = diferenciaCent(d)
  return { sumied: eur(d.totalSumiedCent), erp10: eur(d.totalErp10Cent), diferencia: x === null ? null : `${x > 0 ? '+' : '−'}${eur(Math.abs(x))}` }
}

/** «Es la misma» se puede pulsar si los totales son iguales, o si la diferencia está mirada. */
export const sePuedeLaMisma = (d: Pick<DudaVista, 'totalErp10Cent' | 'totalSumiedCent'>, mirada: boolean) => diferenciaCent(d) === null || mirada

/** Los botones de cada una: de una factura, solo «Es la misma»; de un asiento, los dos. */
export const botones = (d: Pick<DudaVista, 'que'>): ('la_misma' | 'otro')[] => (d.que === 'factura' ? ['la_misma'] : ['la_misma', 'otro'])

export const textoBoton = (d: Pick<DudaVista, 'que'>, b: 'la_misma' | 'otro') =>
  b === 'otro' ? 'Es otro, mándalo' : d.que === 'factura' ? 'Es la misma, no la mandes' : 'Es el mismo, no lo mandes'

/** De la fila de la base (conta_erp10_envio en duda, con su asiento) a la vista. */
export function deLaFila(f: Record<string, unknown>): DudaVista | null {
  const d = (f.duda ?? null) as Record<string, unknown> | null
  if (!d || d.documento == null) return null
  const e = (f.journal_entry ?? null) as Record<string, unknown> | null
  const n = (x: unknown) => (x == null || x === '' ? null : Number(x))
  return {
    envioId: String(f.id), entryId: String(f.entry_id), que: d.que === 'asiento' ? 'asiento' : 'factura',
    documento: Number(d.documento), serie: String(d.serie ?? ''), cuantos: Number(d.cuantos ?? 1),
    numero: d.numero != null ? String(d.numero) : e?.number != null ? `${e.series ?? ''}/${e.number}` : null,
    concepto: e?.concept != null ? String(e.concept) : null,
    fecha: d.fecha != null ? String(d.fecha) : e?.entry_date != null ? String(e.entry_date) : null,
    totalErp10Cent: n(d.totalErp10Cent), totalSumiedCent: n(d.totalSumiedCent),
  }
}
