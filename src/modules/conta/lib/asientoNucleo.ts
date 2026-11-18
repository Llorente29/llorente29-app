// src/modules/conta/lib/asientoNucleo.ts
//
// N08 · El asiento del núcleo: lo que decide la ficha, sin pantalla (encargo N08, punto 3).
// Lo que guarda y valida es lo de hoy (guardarAMano y validar en diarioService, con
// LineaMano, problemasMano y cuadreMano de lib/diario): aquí solo lo que el teclado y la
// rejilla deciden antes de guardar.
//
//   · el atajo de la subcuenta: «5511» da la 55100001, «551.1» también, y vale parte del nombre;
//   · el concepto de la cabecera pasa solo a las líneas, y el local de una línea a la siguiente;
//   · la última línea rellena sola el debe o el haber que falta para cuadrar;
//   · los totales (debe, haber y descuadre), como ERP10;
//   · Intro de casilla en casilla, y al final de la línea, la siguiente.
// F4, F5 y F8 son del teclado común del marco (nucleo/teclado.ts): se usan, no se copian.

import { cuadreMano, importeMano, type LineaMano } from '@/modules/conta/lib/diario'

/** Una subcuenta del plan de la empresa, lo que el atajo necesita. */
export interface SubcuentaAtajo { code: string; nombre: string }

/** Lo que da un atajo: la subcuenta, o las que encajan si hay más de una (para la lista de F4). */
export interface Atajo { codigo: string | null; candidatas: SubcuentaAtajo[] }

/** Dónde se parte un atajo sin punto: después de la cuenta de mayor (tres cifras), como ERP10. */
const MAYOR = 3

/**
 * El atajo de la subcuenta, como en ERP10:
 *   · «551.1»: lo de antes del punto, ceros hasta el largo de la empresa y lo de después → 55100001;
 *   · «5511» (cifras, menos que el largo): igual, partiendo después de las tres de la cuenta de mayor;
 *   · las cifras justas: esa subcuenta;
 *   · letras: las subcuentas cuyo nombre lo lleva; si es una sola, esa.
 * Solo devuelve un código que existe en el plan.
 */
export function atajoDeSubcuenta(texto: string, digitos: number, plan: readonly SubcuentaAtajo[]): Atajo {
  const t = texto.trim()
  if (!t) return { codigo: null, candidatas: [] }
  const existe = (c: string) => plan.find((x) => x.code === c) ?? null
  const relleno = (antes: string, despues: string): string | null => {
    const ceros = digitos - antes.length - despues.length
    return ceros >= 0 ? `${antes}${'0'.repeat(ceros)}${despues}` : null
  }
  const conPunto = /^(\d+)\.(\d+)$/.exec(t)
  if (conPunto) {
    const c = relleno(conPunto[1], conPunto[2])
    const x = c ? existe(c) : null
    return { codigo: x?.code ?? null, candidatas: x ? [x] : [] }
  }
  if (/^\d+$/.test(t)) {
    if (t.length === digitos) { const x = existe(t); return { codigo: x?.code ?? null, candidatas: x ? [x] : [] } }
    if (t.length > MAYOR && t.length < digitos) {
      const c = relleno(t.slice(0, MAYOR), t.slice(MAYOR))
      const x = c ? existe(c) : null
      if (x) return { codigo: x.code, candidatas: [x] }
    }
    // Pocas cifras: las que empiezan así, para elegir con F4.
    const empiezan = plan.filter((x) => x.code.startsWith(t))
    return { codigo: empiezan.length === 1 ? empiezan[0].code : null, candidatas: empiezan }
  }
  const q = t.toLowerCase()
  const porNombre = plan.filter((x) => x.nombre.toLowerCase().includes(q))
  return { codigo: porNombre.length === 1 ? porNombre[0].code : null, candidatas: porNombre }
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

/** «1.210,00»: como se escribe un importe (con el punto de los miles también en cuatro cifras). */
export function importeEscrito(n: number): string {
  const c = Math.round(Math.abs(n) * 100)
  const enteros = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}${enteros},${String(c % 100).padStart(2, '0')}`
}
const dos = importeEscrito

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
