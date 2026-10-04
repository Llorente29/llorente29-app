// src/modules/conta/lib/ibanFactura.ts
//
// C01b, respuesta 2, punto 1 · IBAN DISTINTO EN UNA FACTURA = aviso y freno.
//
// Es la defensa contra el fraude del «cambio de cuenta»: llega una factura,
// igual a las de siempre, pero con otra cuenta para el pago. Si la lectura de
// la factura trae un IBAN que no es el de la ficha:
//   · la factura sale en ámbar, «IBAN distinto al de la ficha»;
//   · la ficha enseña el aviso;
//   · «Marcar como pagada» queda desactivado (y la base lo rechaza: disparador
//     de 20261006T0135) hasta que una persona decide:
//       «Es el nuevo IBAN» → pasa a la ficha, con quién y cuándo, y pide el
//                            certificado de titularidad del banco;
//       «No es suyo»       → se queda el de la ficha; la factura se paga a ése.
// NADA se cambia solo: ni la ficha ni la factura.
//
// FUNCIONES PURAS. La misma regla está escrita en SQL en el disparador; las dos
// normalizan igual (mayúsculas, sin espacios) y comparan igual.

import { normalizarIban, validarIban } from '@/modules/conta/lib/iban'

export type DecisionIban = 'es_el_nuevo' | 'no_es_suyo'

export type EstadoIbanFactura =
  /** La factura no trae IBAN leído: nada que comparar. */
  | 'sin_dato'
  /** La ficha aún no tiene IBAN: no hay con qué comparar (no frena). */
  | 'ficha_sin_iban'
  | 'coincide'
  /** Distinto y sin decidir: FRENA el pago. */
  | 'distinto'
  | 'decidido_nuevo'
  | 'decidido_no_suyo'

export interface EntradaIbanFactura {
  ibanFicha: string | null
  ibanLeido: string | null
  decision: DecisionIban | null
}

const limpio = (x: string | null): string | null => {
  const s = x === null ? '' : normalizarIban(x)
  return s === '' ? null : s
}

export function estadoIbanFactura({ ibanFicha, ibanLeido, decision }: EntradaIbanFactura): EstadoIbanFactura {
  const leido = limpio(ibanLeido)
  if (leido === null) return 'sin_dato'
  if (decision === 'es_el_nuevo') return 'decidido_nuevo'
  if (decision === 'no_es_suyo') return 'decidido_no_suyo'
  const ficha = limpio(ibanFicha)
  if (ficha === null) return 'ficha_sin_iban'
  return ficha === leido ? 'coincide' : 'distinto'
}

/** ¿Hay que frenar el pago? Solo con un IBAN distinto y sin decidir. */
export const frenaElPago = (e: EntradaIbanFactura): boolean => estadoIbanFactura(e) === 'distinto'

/** Lo mismo para una factura entera: una ya pagada no se frena (ya está hecha). */
export const facturaFrenada = (
  f: { status: string; readIban: string | null; ibanDecision: DecisionIban | null }, ibanFicha: string | null,
): boolean => f.status !== 'pagada' && frenaElPago({ ibanFicha, ibanLeido: f.readIban, decision: f.ibanDecision })

export const AVISO_IBAN_DISTINTO = 'IBAN distinto al de la ficha'

/**
 * Lo que se puede decidir. «Es el nuevo IBAN» solo si el leído es un IBAN
 * válido (módulo 97): un IBAN mal leído no puede acabar en la ficha.
 */
export function puedeSerElNuevo(ibanLeido: string | null): { ok: true } | { ok: false; motivo: string } {
  if (ibanLeido === null || limpio(ibanLeido) === null) return { ok: false, motivo: 'La factura no trae IBAN.' }
  const v = validarIban(ibanLeido)
  return v.ok ? { ok: true } : { ok: false, motivo: `El IBAN leído no es válido (${v.motivo.replace(/\.$/, '')}): puede estar mal leído. Compruébalo en el papel.` }
}

/**
 * El certificado del banco vale si es posterior al último cambio de IBAN: el
 * de la cuenta vieja no dice nada de la nueva. Sin cambio, vale cualquiera.
 */
export function certificadoVale(subidoAt: string, ibanCambiadoAt: string | null): boolean {
  return ibanCambiadoAt === null || subidoAt >= ibanCambiadoAt
}
