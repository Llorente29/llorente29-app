// src/lib/texto.ts
//
// Trozos de redacción que la pantalla usa en más de un módulo. Están aquí y no
// copiados en cada sitio por la razón de siempre: un criterio escrito dos veces
// acaba discrepando (Regla 10).

/**
 * «A», «A y B», «A, B y C». TODOS los nombres, siempre.
 *
 * Nunca «A, B y 3 más»: un umbral ordena, no esconde (regla 7). Si la lista es
 * larga, el sitio equivocado para recortarla es aquí.
 */
export function enumeraNombres(nombres: string[]): string {
  if (nombres.length === 0) return ''
  if (nombres.length === 1) return nombres[0]
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}
