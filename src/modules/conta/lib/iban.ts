// src/modules/conta/lib/iban.ts
//
// IBAN: validación ISO 13616 (módulo 97, ISO 7064 MOD 97-10).
//
// FUNCIONES PURAS. El IBAN se guarda sin espacios y en mayúsculas; se enseña
// en grupos de cuatro y, en la ficha, enmascarado.
//
// Algoritmo (ISO 13616-1:2020, §6 y anexo B):
//   1. Se pasan los 4 primeros caracteres al final.
//   2. Cada letra se sustituye por dos dígitos (A=10 … Z=35).
//   3. El número resultante mod 97 tiene que dar 1.
// Longitud por país (registro SWIFT de IBAN). Aquí sólo se fija la de España
// (24), que es la que pide el encargo; para el resto se exige el rango general
// de la norma (15 a 34) y el módulo 97.

export type ResultadoIban =
  | { ok: true; normalizado: string; pais: string }
  | { ok: false; motivo: string }

/** Longitudes conocidas. España, obligatoria por el encargo; el resto, las más habituales en la UE. */
const LONGITUD_POR_PAIS: Record<string, number> = {
  ES: 24, PT: 25, FR: 27, IT: 27, DE: 22, NL: 18, BE: 16, IE: 22, AT: 20, LU: 20,
}

export function normalizarIban(entrada: string): string {
  return entrada.toUpperCase().replace(/[\s\-.]/g, '')
}

/** Resto mod 97 de un número muy largo escrito como texto, por trozos (sin BigInt). */
function mod97(numerico: string): number {
  let resto = 0
  for (let i = 0; i < numerico.length; i += 7) {
    resto = Number(String(resto) + numerico.slice(i, i + 7)) % 97
  }
  return resto
}

export function validarIban(entrada: string): ResultadoIban {
  const s = normalizarIban(entrada)
  if (s === '') return { ok: false, motivo: 'Escribe el IBAN.' }
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) {
    return { ok: false, motivo: 'Un IBAN empieza por las dos letras del país y dos números (ES12…).' }
  }
  const pais = s.slice(0, 2)
  const esperada = LONGITUD_POR_PAIS[pais]
  if (esperada !== undefined && s.length !== esperada) {
    return {
      ok: false,
      motivo: pais === 'ES'
        ? `Un IBAN español tiene 24 caracteres y este tiene ${s.length}: revisa que no falte ni sobre ningún dígito.`
        : `Un IBAN de ${pais} tiene ${esperada} caracteres y este tiene ${s.length}.`,
    }
  }
  if (s.length < 15 || s.length > 34) return { ok: false, motivo: 'Este IBAN no tiene una longitud válida.' }
  const reordenado = s.slice(4) + s.slice(0, 4)
  const numerico = reordenado.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  return mod97(numerico) === 1
    ? { ok: true, normalizado: s, pais }
    : { ok: false, motivo: 'Este IBAN no es correcto: revisa los dígitos.' }
}

/** «ES12 3456 …» en grupos de cuatro. */
export function formatearIban(normalizado: string): string {
  return normalizado.replace(/(.{4})/g, '$1 ').trim()
}

/** «ES12 •••• •••• 4567»: país y control, y los cuatro últimos. Como en la maqueta. */
export function enmascararIban(normalizado: string): string {
  if (normalizado.length < 8) return normalizado
  return `${normalizado.slice(0, 4)} •••• •••• ${normalizado.slice(-4)}`
}
