// src/modules/conta/nucleo/bancos/rejilla.ts
//
// E05 · Bancos del núcleo: lo que decide la rejilla de movimientos (maqueta
// nucleo_6_bancos; ERP10, «Introducción de asientos por tesorería»): ingreso y
// pago en lugar de debe y haber, la etiqueta de cada fila, cuántos esperan a una
// persona, los seguros ya marcados para confirmar en bloque, moverse con ↑ ↓ y
// la cuenta de «A qué va». Usa por dentro lo de hoy (lib/conciliarVista,
// lib/bancosVista): no cambia ninguna regla de la conciliación. Núcleo puro: lo
// prueba tests/conta/e05-bancos.

import { asientoQueSeCrea, preseleccionado } from '@/modules/conta/lib/conciliarVista'
import type { Destino } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'

/** Ingreso y pago, como ERP10: el dinero que entra y el que sale, sin signo. */
export function ingresoPago(m: Pick<MovimientoBanco, 'importeCent'>): { ingresoCent: number | null; pagoCent: number | null } {
  if (m.importeCent > 0) return { ingresoCent: m.importeCent, pagoCent: null }
  if (m.importeCent < 0) return { ingresoCent: null, pagoCent: -m.importeCent }
  return { ingresoCent: null, pagoCent: null }
}

export type Etiqueta = { texto: string; tono: 'bien' | 'mira' | 'neutro' }

/**
 * La etiqueta de la fila (maqueta): «Mira esto» (ámbar) lo propuesto que espera
 * a una persona; «Hecho solo» (verde) lo que casó Sumied; «Sin saber» (gris) lo
 * que no tiene propuesta. Lo seguro, en verde y ya marcado para confirmar en
 * bloque. Lo demás que existe (casado por una persona, apartado, repetido…) se
 * enseña también, con su nombre (regla 7: no se esconde ninguna fila).
 */
export function etiquetaDe(m: MovimientoBanco): Etiqueta {
  switch (m.estado) {
    case 'casado': return m.casado?.porQuien === 'folvy' ? { texto: 'Hecho solo', tono: 'bien' } : { texto: 'Hecho', tono: 'bien' }
    case 'propuesto': return preseleccionado(m) ? { texto: 'Seguro', tono: 'bien' } : { texto: 'Mira esto', tono: 'mira' }
    case 'posible_repetido': return { texto: '¿Repetido?', tono: 'mira' }
    case 'ignorado': return { texto: 'Apartado', tono: 'neutro' }
    case 'antes_corte_sin_pareja': return { texto: 'Antes del corte', tono: 'neutro' }
    default: return m.propuesta ? { texto: 'Mira esto', tono: 'mira' } : { texto: 'Sin saber', tono: 'neutro' }
  }
}

/** Los que esperan a una persona («14 por revisar»): lo que no está casado, ni apartado, ni es de antes del corte. */
export const porRevisar = (movs: readonly MovimientoBanco[]): number =>
  movs.filter((m) => m.estado === 'propuesto' || m.estado === 'por_aclarar' || m.estado === 'pendiente' || m.estado === 'posible_repetido').length

/**
 * Los seguros, ya marcados para confirmar en bloque: los mismos que preselecciona
 * la pantalla de hoy (cuadreDe: movs.filter(preseleccionado), que ya es confirmable).
 */
export const segurosMarcados = (movs: readonly MovimientoBanco[]): string[] => movs.filter(preseleccionado).map((m) => m.id)

/** ↑ ↓: la fila de al lado, sin salirse de la rejilla. */
export function mover(actual: number, paso: 1 | -1, filas: number): number {
  if (filas <= 0) return -1
  if (actual < 0) return paso > 0 ? 0 : filas - 1
  return Math.min(filas - 1, Math.max(0, actual + paso))
}

/**
 * «A qué va»: la cuenta que no es la del banco. Casado, la de su asiento (la da
 * el servicio, que lee sus líneas); con propuesta, la que escribirá el motor
 * (asientoQueSeCrea, la misma que «El asiento que sale»). Sin nada, null.
 */
export function aQueVa(m: MovimientoBanco, cuenta572: string | null, delAsiento: string | null = null): string | null {
  if (m.estado === 'casado') return delAsiento
  const d = m.propuesta?.destino as unknown as Destino | null | undefined
  if (!d) return null
  const lineas = asientoQueSeCrea(m, d, cuenta572)
  return lineas?.find((l) => l.cuenta !== (cuenta572 ?? '572'))?.cuenta ?? null
}
