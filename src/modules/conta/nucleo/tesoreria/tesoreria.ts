// src/modules/conta/nucleo/tesoreria/tesoreria.ts
//
// X28 · Tesorería como ERP10 («Introducción de asientos por tesorería», maqueta nucleo_21): lo que decide la pantalla,
// sin tocar la base. Núcleo puro: lo prueba tests/conta/x28-tesoreria.
//   · la subcuenta de cada fila: la de su asiento si está contabilizado; si no, la que propone Sumied (regla,
//     conciliación, la factura que casa), EN ÁMBAR; si Sumied no sabe, en blanco;
//   · los totales: ingresos, pagos, cuántos movimientos y cuántos sin contabilizar (lo apartado se ve y no suma);
//   · Intro: qué hace con la línea que se edita (contabilizar lo que propone, contabilizar a otra subcuenta, o
//     modificar lo contabilizado con el mismo número) y a cuál baja después (la siguiente sin contabilizar).
// Por dentro usa lo de hoy (aQueVa, asientoQueSeCrea, confirmable): no cambia ninguna regla de la conciliación.

import type { Destino } from '@/modules/conta/lib/conciliacion'
import { MOTOR_BANCOS } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { confirmable } from '@/modules/conta/lib/conciliarVista'
import { aQueVa } from '../bancos/rejilla'

/** La subcuenta de la fila: el código (o nada) y si es una propuesta de Sumied (ámbar). */
export interface SubcuentaDeFila { codigo: string | null; propuesta: boolean }

export function subcuentaDeFila(m: MovimientoBanco, cuenta572: string | null, delAsiento: string | null): SubcuentaDeFila {
  if (m.estado === 'casado') return { codigo: delAsiento, propuesta: false }
  if (m.estado === 'ignorado') return { codigo: null, propuesta: false }
  const c = aQueVa(m, cuenta572, null)
  return c ? { codigo: c, propuesta: true } : { codigo: null, propuesta: false }
}

/** Contabilizado: con su asiento en el diario (lo casado). */
export const contabilizado = (m: Pick<MovimientoBanco, 'estado'>): boolean => m.estado === 'casado'
/** Sin contabilizar: lo que espera a una persona (no lo contabilizado ni lo apartado). */
export const sinContabilizar = (m: Pick<MovimientoBanco, 'estado' | 'importeCent'>): boolean => m.estado !== 'casado' && m.estado !== 'ignorado' && m.importeCent !== 0

export interface Totales { ingresosCent: number; pagosCent: number; movimientos: number; sinContabilizar: number }

/** Los totales de abajo (maqueta 21): lo apartado (el banco no lo cobró) se ve en la lista y no suma. */
export function totalesDe(movs: readonly Pick<MovimientoBanco, 'estado' | 'importeCent'>[]): Totales {
  let ingresosCent = 0, pagosCent = 0
  for (const m of movs) {
    if (m.estado === 'ignorado') continue
    if (m.importeCent > 0) ingresosCent += m.importeCent; else pagosCent -= m.importeCent
  }
  return { ingresosCent, pagosCent, movimientos: movs.length, sinContabilizar: movs.filter(sinContabilizar).length }
}

/** «⊕ otro movimiento · 7 movimientos · 3 sin contabilizar». */
export const textoDelPie = (t: Totales): string =>
  `${t.movimientos === 1 ? '1 movimiento' : `${t.movimientos} movimientos`} · ${t.sinContabilizar} sin contabilizar`

/** Después de Intro: el siguiente sin contabilizar por debajo; si no hay, el primero sin contabilizar de arriba; si no, -1. */
export function siguienteSinContabilizar(movs: readonly Pick<MovimientoBanco, 'estado' | 'importeCent'>[], desde: number): number {
  for (let i = desde + 1; i < movs.length; i++) if (sinContabilizar(movs[i])) return i
  for (let i = 0; i <= Math.min(desde, movs.length - 1); i++) if (sinContabilizar(movs[i])) return i
  return -1
}

/** Ingreso y pago, como ERP10 (sin signo). */
export function ingresoYPago(importeCent: number): { ingresoCent: number | null; pagoCent: number | null } {
  if (importeCent > 0) return { ingresoCent: importeCent, pagoCent: null }
  if (importeCent < 0) return { ingresoCent: null, pagoCent: -importeCent }
  return { ingresoCent: null, pagoCent: null }
}

/** La analítica de la línea: el local (un id, «comun» o nada), la marca y la plataforma. */
export interface Analitica { local: string | null; marca: string | null; plataforma: string | null }

/** La línea que se edita. */
export interface LineaEd extends Analitica { cuenta: string | null; concepto: string }

const esId = (x: string | null) => !!x && /^[0-9a-f-]{36}$/i.test(x)

/** Lo que viaja en el destino de bank_casar (0801): local_id, marca_id y canal_id, solo si los hay. */
export function analiticaDelDestino(a: Analitica): Record<string, string> {
  const out: Record<string, string> = {}
  if (esId(a.local)) out.local_id = a.local!
  if (esId(a.marca)) out.marca_id = a.marca!
  if (esId(a.plataforma)) out.canal_id = a.plataforma!
  return out
}

/** Lo que hace Intro con la línea. */
export type Intro =
  | { que: 'propuesta'; destino: Destino }
  | { que: 'cuenta'; destino: Destino }
  | { que: 'modificar'; cambios: Record<string, string> }
  | { que: 'nada'; porque: string | null }
  | { que: 'recalcular' }

/**
 * Qué hace Intro (como ERP10, contabiliza la línea):
 *   · contabilizado: si algo cambió, modificar (el mismo número); si no, nada (baja a la siguiente);
 *   · apartado: nada, y por qué;
 *   · sin subcuenta: nada, y qué falta;
 *   · la subcuenta que propone Sumied, con su propuesta lista: contabilizar lo propuesto (si paga una factura, la deja
 *     pagada), con el concepto y la analítica de la línea;
 *   · otra subcuenta: contabilizar a esa subcuenta, por el importe del movimiento.
 * `original`: cómo estaba la línea al elegir la fila (para saber qué cambió).
 */
export function queHaceIntro(m: MovimientoBanco, ed: LineaEd, original: LineaEd, cuenta572: string | null): Intro {
  if (m.estado === 'ignorado') return { que: 'nada', porque: 'Está apartado: ábrelo otra vez en Bancos para contabilizarlo.' }
  if (m.estado === 'casado') {
    const cambios: Record<string, string> = {}
    if (ed.cuenta && ed.cuenta !== original.cuenta) cambios.cuenta = ed.cuenta
    if (ed.concepto.trim() && ed.concepto.trim() !== original.concepto.trim()) cambios.concepto = ed.concepto.trim()
    if (ed.local !== original.local) cambios.local = ed.local ?? 'comun'
    if (ed.marca !== original.marca) cambios.marca = ed.marca ?? ''
    if (ed.plataforma !== original.plataforma) cambios.plataforma = ed.plataforma ?? ''
    return Object.keys(cambios).length ? { que: 'modificar', cambios } : { que: 'nada', porque: null }
  }
  if (!ed.cuenta) return { que: 'nada', porque: 'Falta la subcuenta: escríbela o búscala con F4.' }
  const ana = analiticaDelDestino(ed)
  const propuesta = aQueVa(m, cuenta572, null)
  const d = m.propuesta?.destino as unknown as Destino | null | undefined
  if (d && propuesta === ed.cuenta && confirmable(m)) {
    if (m.propuesta?.motor !== MOTOR_BANCOS) return { que: 'recalcular' }
    const concepto = ed.concepto.trim() && ed.concepto.trim() !== original.concepto.trim() ? { concepto: ed.concepto.trim() } : {}
    return { que: 'propuesta', destino: { ...d, ...concepto, ...ana } as unknown as Destino }
  }
  const concepto = ed.concepto.trim() || m.conceptoLimpio.trim() || m.conceptoBanco.trim()
  return { que: 'cuenta', destino: { tipo: 'cuenta', concepto, lineas: [{ cuenta: ed.cuenta, importe: Math.abs(m.importeCent) / 100 }], ...ana } as unknown as Destino }
}

/** La factura que se paga o se cobra según la propuesta (la primera), para el documento de la derecha. */
export function facturaDeLaPropuesta(m: MovimientoBanco): { tipo: 'recibida' | 'emitida'; id: string } | null {
  const d = m.propuesta?.destino as { tipo?: string; facturas?: { id: string }[] } | null | undefined
  const id = d?.facturas?.[0]?.id
  if (!id) return null
  if (d?.tipo === 'factura_recibida') return { tipo: 'recibida', id }
  if (d?.tipo === 'factura_emitida') return { tipo: 'emitida', id }
  return null
}

/** Lo pendiente de una factura ANTES de este movimiento: el total menos lo pagado por otros movimientos hasta su fecha. */
export function pendienteAntes(totalCent: number, pagos: readonly { movimiento: string; fecha: string; cent: number }[], este: { id: string; fecha: string }): number {
  return totalCent - pagos.filter((p) => p.movimiento !== este.id && p.fecha <= este.fecha).reduce((t, p) => t + p.cent, 0)
}
