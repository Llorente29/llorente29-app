// src/modules/conta/nucleo/recibida/k13.ts
//
// K13 · La recibida calcada de ERP10 (maqueta 17b): la lógica de lo que la ficha nueva decide sola, sin pantalla.
//   · el IVA: dos grupos por fila; empieza con dos filas y, cuando se usa el último hueco libre, sale otra vacía;
//   · el reparto analítico de una línea en tramos: si suman el importe de su fila 1, o qué falta;
//   · el código corto de local, marca y plataforma: con Intro, el código exacto elige; la lupa busca por código y nombre.

/** Cuántas filas de IVA enseña la ficha: dos grupos por fila, al menos dos filas, y siempre un hueco libre al final. */
export function filasDeIva(usados: number): number {
  const n = Math.max(0, Math.floor(usados))
  return Math.max(2, Math.floor(n / 2) + 1)
}

export interface TramoAReparto { importe: number }
export interface CuadreTramos { cuadra: boolean; suma: number; falta: number; texto: string | null }

const c = (x: number) => Math.round(x * 100)
const euros = (x: number) => (Math.round(x * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Si los tramos de una línea suman su importe (al céntimo). Con menos de dos tramos no hay reparto y cuadra siempre. El
 * texto dice qué falta o qué sobra, para la pantalla (regla 8: la ficha no valida y lo dice).
 */
export function cuadreDeTramos(linea: number, importeLinea: number, tramos: readonly TramoAReparto[]): CuadreTramos {
  if (tramos.length < 2) return { cuadra: true, suma: importeLinea, falta: 0, texto: null }
  const suma = tramos.reduce((t, x) => t + c(Number(x.importe) || 0), 0) / 100
  const falta = (c(importeLinea) - c(suma)) / 100
  if (falta === 0) return { cuadra: true, suma, falta: 0, texto: null }
  return {
    cuadra: false, suma, falta,
    texto: `El reparto de la línea ${linea} suma ${euros(suma)} € y la línea es ${euros(importeLinea)} €: ${falta > 0 ? `faltan ${euros(falta)} €` : `sobran ${euros(-falta)} €`}.`,
  }
}

export interface ConCodigo { id: string; nombre: string; codigo: string | null }

/** Lo que elige el código escrito al pulsar Intro: el que tiene ese código exacto (sin mirar mayúsculas), o ninguno. */
export function elegidoPorCodigo<T extends ConCodigo>(lista: readonly T[], escrito: string): T | null {
  const q = escrito.trim().toUpperCase()
  if (!q) return null
  return lista.find((x) => (x.codigo ?? '').toUpperCase() === q) ?? null
}

const sinAcentos = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** La lupa: por código (empieza por) y por nombre (contiene), sin acentos; primero los del código. */
export function buscarPorCodigoYNombre<T extends ConCodigo>(lista: readonly T[], q: string): T[] {
  const t = sinAcentos(q.trim())
  if (!t) return [...lista].sort((a, b) => (a.codigo === null ? 1 : 0) - (b.codigo === null ? 1 : 0) || (a.codigo ?? '').localeCompare(b.codigo ?? ''))
  const porCodigo = lista.filter((x) => sinAcentos(x.codigo ?? '').startsWith(t))
  const porNombre = lista.filter((x) => !porCodigo.includes(x) && sinAcentos(x.nombre).includes(t))
  return [...porCodigo, ...porNombre]
}
