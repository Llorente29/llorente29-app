// src/modules/conta/lib/plural.ts
//
// S01e · El número con su palabra en singular o plural: «1 expedida»,
// «3 expedidas», «0 bienes». Se pasan las dos formas: el español no siempre
// añade una «s» (bien → bienes, vez → veces).

/** «1 expedida» / «2 expedidas»: el número y la forma que le toca. */
export function cuantas(n: number, una: string, varias: string): string {
  return `${n.toLocaleString('es-ES')} ${n === 1 ? una : varias}`
}
