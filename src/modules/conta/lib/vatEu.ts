// src/modules/conta/lib/vatEu.ts
//
// NIF-IVA europeo (número de operador intracomunitario): FORMA, en puro.
//
// La comprobación de verdad es la de VIES y se hace SIEMPRE en el servidor
// (edge `conta-vies-check`), nunca desde el navegador. Esto sólo dice si lo
// escrito tiene la forma que publica la Comisión para cada país, para avisar
// al momento antes de preguntar a VIES.
//
// Fuente de las formas: Comisión Europea, «VIES — VAT number validation»,
// estructura de los números de IVA por Estado miembro (FAQ de VIES, pregunta
// «What is the format of a VAT number?»). Grecia usa el prefijo EL, no GR.
// Irlanda del Norte (XI) sigue en VIES para mercancías.

export type ResultadoVatEu =
  | { ok: true; pais: string; numero: string; normalizado: string }
  | { ok: false; motivo: string }

const FORMATO: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
}

export const PAISES_VIES = Object.keys(FORMATO)

export function validarFormatoVatEu(entrada: string): ResultadoVatEu {
  let s = entrada.toUpperCase().replace(/[\s.\-_/]/g, '')
  if (s === '') return { ok: false, motivo: 'Escribe el NIF-IVA europeo, con las dos letras del país delante.' }
  if (s.startsWith('GR')) s = 'EL' + s.slice(2)
  const pais = s.slice(0, 2)
  const numero = s.slice(2)
  const forma = FORMATO[pais]
  if (!forma) {
    return { ok: false, motivo: 'Tiene que empezar por las dos letras de un país de la UE (por ejemplo, FR, PT o IT).' }
  }
  return forma.test(numero)
    ? { ok: true, pais, numero, normalizado: pais + numero }
    : { ok: false, motivo: `No tiene la forma de un NIF-IVA de ${pais}: revisa los números.` }
}

/**
 * Los Estados miembros por su código de país ISO (la misma fuente de VIES):
 * Grecia es GR fuera del IVA, y XI (Irlanda del Norte, solo mercancías) no es
 * un país. Para decir «Compra en la UE» de un proveedor (C02, tarea 6).
 */
export const ESTADOS_UE: readonly string[] = PAISES_VIES.filter((p) => p !== 'XI').map((p) => (p === 'EL' ? 'GR' : p))
