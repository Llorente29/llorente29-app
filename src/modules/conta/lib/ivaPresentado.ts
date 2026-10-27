// src/modules/conta/lib/ivaPresentado.ts
//
// V04 · Respuesta 5 · EL CANDADO DEL IVA, en las pantallas. Quien manda es la
// base (conta_iva_presentado y sus disparadores, 1233): esto solo sirve para
// que ninguna pantalla ofrezca un botón que lleve a algo prohibido, y para
// poner el candado en el mes y el trimestre. Los textos son los mismos que los
// de la base.
//
// «Presentado» = el 303 del periodo (trimestre o mes) en filed, booked, paid,
// offset o refunded. Lo da conta_iva_presentados (services/ivaPresentadoService).

import type { ApunteDiario } from './diario'

export interface PeriodoPresentado {
  /** «3T» o «09». */
  periodo: string
  ejercicio: number
  /** AAAA-MM-DD, los dos incluidos. */
  desde: string
  hasta: string
  /** Cuándo se presentó (ISO). */
  presentado: string
  /** «3T de 2026», «septiembre de 2026». */
  nombre: string
  /** A qué periodo va lo que llegue tarde: «4T», «octubre», «1T de 2027». */
  siguiente: string
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const esTrimestre = (p: string) => /^[1-4]T/.test(p)

/** El periodo presentado que cubre ese día, o null. */
export function presentadoDe(fecha: string | null | undefined, lista: readonly PeriodoPresentado[]): PeriodoPresentado | null {
  if (!fecha) return null
  const d = fecha.slice(0, 10)
  return lista.find((p) => p.desde <= d && d <= p.hasta) ?? null
}

/** ¿Algún día de este mes (AAAA-MM) está en un periodo presentado? */
export function mesPresentado(mes: string, lista: readonly PeriodoPresentado[]): PeriodoPresentado | null {
  return lista.find((p) => p.desde.slice(0, 7) <= mes && mes <= p.hasta.slice(0, 7)) ?? null
}

/** ¿Está presentado este trimestre (1–4) de este año, o los tres meses de él? */
export function trimestrePresentado(ejercicio: number, trimestre: number, lista: readonly PeriodoPresentado[]): PeriodoPresentado | null {
  const meses = [0, 1, 2].map((i) => `${ejercicio}-${String((trimestre - 1) * 3 + 1 + i).padStart(2, '0')}`)
  const deCada = meses.map((m) => mesPresentado(m, lista))
  return deCada.every(Boolean) ? deCada[2] : null
}

/** La fecha de presentación, como la escribe la base: «20/10». */
export function diaPresentado(p: PeriodoPresentado): string {
  const d = new Date(p.presentado)
  const f = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Madrid' }).formatToParts(d)
  const v = (t: string) => (f.find((x) => x.type === t)?.value ?? '').padStart(2, '0')
  return `${v('day')}/${v('month')}`
}

const del = (p: PeriodoPresentado) => (esTrimestre(p.periodo) ? `del ${p.nombre}` : `de ${p.nombre}`)
const al = (siguiente: string) => (esTrimestre(siguiente) ? `al ${siguiente}` : `a ${siguiente}`)
const enEl = (siguiente: string) => (esTrimestre(siguiente) ? `en el ${siguiente}` : `en ${siguiente}`)

/**
 * El mensaje de la base: «El IVA del 3T de 2026 ya está presentado (20/10). No
 * se puede cambiar. Esta factura va al 4T.» Con «corregir», para lo que ya
 * estaba dentro: «… Lo que haya que corregir va al 4T.»
 */
export function mensajePresentado(p: PeriodoPresentado, que: 'factura' | 'corregir' = 'factura'): string {
  return `El IVA ${del(p)} ya está presentado (${diaPresentado(p)}). No se puede cambiar. `
    + `${que === 'corregir' ? 'Lo que haya que corregir va' : 'Esta factura va'} ${al(p.siguiente)}.`
}

/** El periodo corto, sin año: «3T», «Septiembre». */
function corto(p: PeriodoPresentado): string {
  return esTrimestre(p.periodo) ? p.periodo : MESES[Number(p.periodo) - 1].replace(/^./, (c) => c.toUpperCase())
}

/**
 * La recibida que llegó tarde: su fecha de factura cae en un periodo
 * presentado y su asiento no. «El 3T ya está presentado. Esta factura se deduce
 * en el 4T.» (El de la base, 1233, lo pone también en sus razones.)
 */
export function avisoTardia(fechaFactura: string | null | undefined, fechaAsiento: string, lista: readonly PeriodoPresentado[]): string | null {
  const p = presentadoDe(fechaFactura, lista)
  if (!p || presentadoDe(fechaAsiento, lista)) return null
  const t = esTrimestre(p.periodo)
  const [y, m] = fechaAsiento.slice(0, 7).split('-').map(Number)
  const destino = t ? `${Math.floor((m - 1) / 3) + 1}T` : MESES[m - 1]
  const conAnio = y !== p.ejercicio ? ` de ${y}` : ''
  return `${t ? 'El ' : ''}${corto(p)} ya está presentado. Esta factura se deduce ${enEl(destino)}${conAnio}.`
}

/** ¿Lleva IVA? Un apunte con libro registro, o en una 472 o una 477 (lo mismo que la base). */
export function llevaIva(apuntes: readonly Pick<ApunteDiario, 'cuenta' | 'iva'>[]): boolean {
  return apuntes.some((a) => (a.iva?.libro ?? '') !== '' || a.cuenta.startsWith('472') || a.cuenta.startsWith('477'))
}

/** Lo que no entra en el candado (lo mismo que la base): lo traído, la liquidación del 303, la apertura y el cierre. */
export const ORIGENES_SIN_CANDADO: readonly string[] = ['migrated', 'vat_settlement', 'opening', 'closing']

/** El candado de un asiento: el periodo presentado que lo cierra, o null. */
export function candadoDelAsiento(a: { fecha: string; origen: string; apuntes: readonly Pick<ApunteDiario, 'cuenta' | 'iva'>[] },
  lista: readonly PeriodoPresentado[]): PeriodoPresentado | null {
  if (ORIGENES_SIN_CANDADO.includes(a.origen) || !llevaIva(a.apuntes)) return null
  return presentadoDe(a.fecha, lista)
}
