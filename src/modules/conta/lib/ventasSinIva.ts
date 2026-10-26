// src/modules/conta/lib/ventasSinIva.ts
//
// V03 · Entrega 2 · LAS VENTAS SIN IVA (respuesta 2 de Julio, a). Una línea
// con el tipo «Exento o 0 %» necesita su porqué: la ley lo pide en la factura
// (RD 1619/2012, art. 6.1.j: la referencia a la norma), el libro y el 303 lo
// necesitan, y Verifactu también. Aquí, en palabras de la calle (tablero 27):
// qué le has vendido, según dónde está el cliente.
//
// La base guarda el porqué en verifactu_operacion (calificación N1/N2 o
// exención E1…E6) y lo comprueba al emitir (_verifactu_desglose); esto solo
// elige qué se ofrece y qué frase lleva el PDF. Sin React.

import { ESTADOS_UE } from './vatEu'

/** El porqué de una venta sin IVA, como lo guarda la base. */
export type PorqueSinIva = 'N2' | 'E2' | 'E5' | 'E1'

export type Zona = 'espana' | 'ue' | 'fuera'

/** Dónde está el cliente, por el país de su ficha (sin país, España). */
export function zonaDelCliente(pais: string | null | undefined): Zona {
  const p = (pais ?? '').trim().toUpperCase() || 'ES'
  if (p === 'ES') return 'espana'
  return ESTADOS_UE.includes(p) ? 'ue' : 'fuera'
}

export interface OpcionSinIva {
  codigo: PorqueSinIva
  /** «Un servicio a una empresa». */
  titulo: string
  /** «No sujeta a IVA en España: se tributa donde está el cliente». */
  texto: string
}

const OPCIONES: Record<PorqueSinIva, OpcionSinIva> = {
  N2: { codigo: 'N2', titulo: 'Un servicio a una empresa', texto: 'No sujeta a IVA en España: se tributa donde está el cliente' },
  E2: { codigo: 'E2', titulo: 'Mercancía que sale de España', texto: 'Exportación, exenta de IVA' },
  E5: { codigo: 'E5', titulo: 'Mercancía que va a otro país de la UE', texto: 'Entrega intracomunitaria, exenta de IVA (el cliente tiene NIF-IVA europeo)' },
  E1: { codigo: 'E1', titulo: 'Una actividad exenta', texto: 'Sanidad, enseñanza, seguros, alquiler de vivienda… (art. 20 de la Ley del IVA)' },
}

/**
 * Lo que se ofrece según dónde está el cliente. Fuera de la UE: servicio o
 * exportación (tablero 27), y «otra cosa» (art. 20). En la UE: servicio o
 * entrega intracomunitaria. En España solo cabe la exención del art. 20: lo no
 * sujeto por localización y la exportación son para clientes de fuera.
 */
export function opcionesSinIva(zona: Zona): OpcionSinIva[] {
  if (zona === 'fuera') return [OPCIONES.N2, OPCIONES.E2, OPCIONES.E1]
  if (zona === 'ue') return [OPCIONES.N2, OPCIONES.E5, OPCIONES.E1]
  return [OPCIONES.E1]
}

/** La frase que lleva el PDF, con su artículo (la «referencia» que pide el reglamento). */
export const MENCION_SIN_IVA: Record<PorqueSinIva, string> = {
  N2: 'Operación no sujeta a IVA en España por reglas de localización (arts. 69 y 70 de la Ley 37/1992).',
  E2: 'Exportación exenta de IVA (art. 21 de la Ley 37/1992).',
  E5: 'Entrega intracomunitaria exenta de IVA (art. 25 de la Ley 37/1992).',
  E1: 'Operación exenta de IVA (art. 20 de la Ley 37/1992).',
}

/** Lo que manda la base (tipo_venta de conta_venta_guardar). */
export function aTipoVenta(p: PorqueSinIva | null): { calificacion: 'N2' } | { exenta: 'E1' | 'E2' | 'E5' } | null {
  if (!p) return null
  return p === 'N2' ? { calificacion: 'N2' } : { exenta: p }
}

/** Lo que guarda la base (verifactu_operacion), como porqué; otra cosa → null. */
export function dePorque(calificacion: string | null | undefined, exenta: string | null | undefined): PorqueSinIva | null {
  if (calificacion === 'N2') return 'N2'
  if (exenta === 'E1' || exenta === 'E2' || exenta === 'E5') return exenta
  return null
}

/** Si el porqué elegido no vale para este cliente, cuál (la base lo diría al emitir). */
export function porqueNoVale(p: PorqueSinIva | null, zona: Zona): string | null {
  if (!p) return null
  if (opcionesSinIva(zona).some((o) => o.codigo === p)) return null
  if (p === 'E2') return 'Una exportación es una venta a fuera de la UE: este cliente no lo es.'
  if (p === 'E5') return 'Una entrega intracomunitaria es a otro país de la UE: este cliente no lo es.'
  return '«No sujeta por reglas de localización» es para un cliente de fuera de España: este es de España.'
}
