// src/modules/conta/lib/asientoNucleo.ts
//
// N08 · El asiento del núcleo: lo que decide la ficha, sin pantalla (encargo N08, punto 3).
// Lo que guarda y valida es lo de hoy (guardarAMano y validar en diarioService, con
// LineaMano, problemasMano y cuadreMano de lib/diario): aquí solo lo que el teclado y la
// rejilla deciden antes de guardar.
//
//   · cuál queda con el atajo de la subcuenta (el atajo es el de la pieza común, cuentasQueEncajan);
//   · el concepto de la cabecera pasa solo a las líneas, y el local de una línea a la siguiente;
//   · la última línea rellena sola el debe o el haber que falta para cuadrar;
//   · los totales (debe, haber y descuadre), como ERP10;
//   · Intro de casilla en casilla, y al final de la línea, la siguiente.
// F4, F5 y F8 son del teclado común del marco (nucleo/teclado.ts): se usan, no se copian.

import { cuadreMano, importeMano, type LineaMano } from '@/modules/conta/lib/diario'
import { cuentasQueEncajan } from '@/modules/conta/nucleo/ficha/teclas'
import { cifra } from '@/modules/conta/nucleo/ficha/textos'

/** Una subcuenta del plan de la empresa, lo que el atajo necesita. */
export interface SubcuentaAtajo { code: string; nombre: string }

/** Lo que da un atajo: la subcuenta, o las que encajan si hay más de una (para la lista de F4). */
export interface Atajo { codigo: string | null; candidatas: SubcuentaAtajo[] }

/**
 * El atajo de la subcuenta, como en ERP10 («5511» y «551.1» dan la 55100001; letras, parte del nombre):
 * es el de la pieza común del núcleo (cuentasQueEncajan, K04), que se usa y no se copia. Aquí solo se
 * dice cuál queda: la que encaja, si es una sola; si no, las que encajan, para elegir con F4.
 */
export function atajoDeSubcuenta(texto: string, digitos: number, plan: readonly SubcuentaAtajo[]): Atajo {
  const r = cuentasQueEncajan(texto, plan.map((c) => ({ codigo: c.code, nombre: c.nombre })), digitos)
  return { codigo: r.length === 1 ? r[0].codigo : null, candidatas: r.map((c) => ({ code: c.codigo, nombre: c.nombre })) }
}

/**
 * La línea nueva: el concepto de la cabecera (si la de arriba no lo cambió, el suyo) y el local
 * de la de arriba (Julio, 12/11 y 23/10).
 */
export function lineaNueva(conceptoCabecera: string, anterior: LineaMano | null, localPorDefecto: string | null): LineaMano {
  return {
    cuenta: '', debe: '', haber: '',
    concepto: anterior?.concepto.trim() ? anterior.concepto : conceptoCabecera,
    localId: anterior ? anterior.localId : localPorDefecto,
    comun: anterior ? anterior.comun : false,
  }
}

/**
 * El concepto de la cabecera pasa solo a las líneas: a las que lo tenían igual que el de antes
 * (o vacío). Las que se cambiaron a mano se quedan como están.
 */
export function conConceptoDeCabecera(lineas: readonly LineaMano[], antes: string, ahora: string): LineaMano[] {
  return lineas.map((l) => (l.concepto === antes || !l.concepto.trim() ? { ...l, concepto: ahora } : l))
}

/** «1.210,00»: el importe como se escribe; la cifra de la pieza común (textos.ts, K04). */
const dos = (n: number) => cifra(n)

/**
 * La última línea rellena sola lo que falta para cuadrar: si tiene subcuenta y ni debe ni haber,
 * y lo de arriba descuadra, pone la diferencia en su lado (debe si sobra haber; haber si sobra debe).
 * Devuelve las líneas como estaban si no toca (la última con importe, o cuadra, o no tiene subcuenta).
 */
export function cuadrarLaUltima(lineas: readonly LineaMano[]): { lineas: LineaMano[]; rellena: 'debe' | 'haber' | null } {
  const i = lineas.length - 1
  const u = lineas[i]
  if (!u || !u.cuenta.trim() || u.debe.trim() || u.haber.trim()) return { lineas: [...lineas], rellena: null }
  const t = totales(lineas.slice(0, i))
  if (t.descuadre === 0) return { lineas: [...lineas], rellena: null }
  const lado = t.descuadre > 0 ? 'haber' as const : 'debe' as const
  return { lineas: lineas.map((l, j) => (j === i ? { ...l, [lado]: dos(Math.abs(t.descuadre)) } : l)), rellena: lado }
}

/** Total debe, total haber y descuadre (debe − haber), en euros con dos decimales, como ERP10. */
export function totales(lineas: readonly LineaMano[]): { debe: number; haber: number; descuadre: number; cuadra: boolean } {
  const c = (n: number) => Math.round(n * 100)
  const debe = lineas.reduce((s, l) => s + c(importeMano(l.debe) || 0), 0)
  const haber = lineas.reduce((s, l) => s + c(importeMano(l.haber) || 0), 0)
  const conImporte = lineas.some((l) => l.debe.trim() || l.haber.trim())
  return { debe: debe / 100, haber: haber / 100, descuadre: (debe - haber) / 100, cuadra: conImporte && debe === haber && cuadreMano(lineas).cuadra }
}

/** Las casillas de una línea de la rejilla, en el orden de Intro (como ERP10: subcuenta, concepto, debe, haber). */
export const CASILLAS = ['subcuenta', 'concepto', 'debe', 'haber'] as const
export type Casilla = (typeof CASILLAS)[number]

/**
 * Intro: a la casilla siguiente; desde el haber, a la subcuenta de la línea de abajo, que se abre si
 * no existe. Con importe en el debe, Intro salta el haber (una línea va a un lado), como ERP10.
 */
export function siguienteCasilla(fila: number, casilla: Casilla, filas: number, linea: LineaMano): { fila: number; casilla: Casilla; nuevaLinea: boolean } {
  const i = CASILLAS.indexOf(casilla)
  const saltaHaber = casilla === 'debe' && linea.debe.trim() !== ''
  if (casilla === 'haber' || saltaHaber) return { fila: fila + 1, casilla: 'subcuenta', nuevaLinea: fila + 1 >= filas }
  return { fila, casilla: CASILLAS[i + 1], nuevaLinea: false }
}
