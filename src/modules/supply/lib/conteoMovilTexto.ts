// src/modules/supply/lib/conteoMovilTexto.ts
//
// Las palabras del móvil de quien cuenta. Van en `lib/` y no junto a los
// componentes por la lección del 05/09 (regla 31b): exportar funciones desde un
// fichero de componentes añade cinco avisos de `react-refresh`, y se midió el
// lint a los dos lados para verlo.
//
// Y van SUELTAS porque son lo que se prueba: «2 bolsas (5 kg) + 750 g» es la
// frase que lee alguien de pie delante de una cámara, y se prueba contra los
// formatos REALES del catálogo, no contra ejemplos inventados.

import { fmtQty, type CountFormat } from '@/modules/supply/services/countFormatService'

/** Lo abierto: o se pesa, o se calcula a ojo. Nunca las dos a la vez. */
export type Abierto =
  | { modo: 'peso'; gramos: string }
  | { modo: 'ojo'; formatId: string | null; fraccion: number | null; otros: string }

export const FRACCIONES: { v: number; label: string; pie: string }[] = [
  { v: 0.25, label: '¼', pie: 'poco' },
  { v: 0.5,  label: '½', pie: 'la mitad' },
  { v: 0.75, label: '¾', pie: 'casi llena' },
]

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

/**
 * EL NOMBRE DEL ENVASE, A SECAS: la PRIMERA palabra del formato.
 *
 * «Bolsa cerrada» → «bolsa». Es el sustantivo; lo que viene detrás es un
 * adjetivo o el peso escrito a mano («Caja 12,5 kg», «Pack 3x150 g»). Medido
 * sobre los 24 nombres distintos que hay en el catálogo de Foodint: en los 24,
 * la primera palabra es el envase.
 *
 * Esto es lo que permite pluralizar y concordar bien sin tener que resolver la
 * concordancia de un sintagma entero, que es donde se rompió la primera
 * versión: escribía «2 bolsa cerradas».
 */
export function nombreDeEnvase(nombre: string): string {
  return nombre.trim().split(/\s+/)[0].toLowerCase()
}

/** Nombres cortos que son femeninos y no acaban en -a. */
const FEMENINOS_SUELTOS = new Set(['ud', 'uds', 'u', 'uni', 'unidad', 'unidades'])

/**
 * ¿El envase es femenino? «bolsa» sí, «paquete» no.
 *
 * Regla de castellano, no una lista: acaba en -a (quitando un plural), o lleva
 * uno de los sufijos femeninos de siempre (-dad, -ción, -sión, -tad, -umbre).
 *
 * PROBADA CONTRA LOS 24 NOMBRES REALES del catálogo de Foodint, que es donde se
 * ve que hace falta el segundo tramo: `unidad` no acaba en -a y es femenina, y
 * sin él la pantalla escribiría «Unidad abierto». Los abreviados «Ud» y «Uni»
 * van en la lista porque son esa misma palabra recortada y ninguna regla
 * fonética los alcanza.
 */
export function esFemenino(nombre: string): boolean {
  const b = nombreDeEnvase(nombre)
  if (FEMENINOS_SUELTOS.has(b)) return true
  const sin = b.endsWith('s') ? b.slice(0, -1) : b
  if (/(?:dad|ción|cion|sión|sion|tad|umbre)$/.test(sin)) return true
  return /[aá]$/.test(sin)
}

/** «abierta» / «abierto», «cerrada» / «cerrado». */
export function concuerda(nombre: string, adjetivoMasculino: string): string {
  if (!esFemenino(nombre)) return adjetivoMasculino
  return adjetivoMasculino.replace(/o$/, 'a')
}

/**
 * «Bolsa abierta», «Paquete abierto» — el título de la fila de lo abierto.
 *
 * Usa el NOMBRE DEL ENVASE y no el nombre completo del formato, y eso es lo que
 * arregla la primera versión: con «Bolsa cerrada» delante salía «Bolsa cerrada
 * abierta, a ojo», que dice «cerrada» de una bolsa que está abierta. El
 * adjetivo del nombre describe el formato de compra; aquí estamos hablando del
 * envase que está empezado, que es otra cosa.
 */
export function tituloAbierto(nombre: string): string {
  const b = nombreDeEnvase(nombre)
  return `${b.charAt(0).toUpperCase()}${b.slice(1)} ${concuerda(nombre, 'abierto')}`
}

/**
 * «2 bolsas», «1 bolsa», «3 paquetes», «2 bidones».
 *
 * Lo de la tilde no es cosmético: «bidón» hace «bidones», no «bidónes», porque
 * al añadir sílaba la palabra deja de ser aguda. Sale de probar la regla contra
 * los 24 nombres del catálogo — «Bidón» es uno de ellos.
 */
export function plural(n: number, nombre: string): string {
  const b = nombreDeEnvase(nombre)
  if (n === 1) return `1 ${b}`
  const num = nf.format(n)
  if (/[aeiouáéíóú]$/.test(b)) return `${num} ${b}s`
  const sinTilde = b.replace(/á(?=[ns]$)/, 'a').replace(/é(?=[ns]$)/, 'e')
    .replace(/í(?=[ns]$)/, 'i').replace(/ó(?=[ns]$)/, 'o').replace(/ú(?=[ns]$)/, 'u')
  return `${num} ${sinTilde}es`
}

export function unidadLarga(abbr: string | null | undefined): string {
  switch ((abbr ?? '').toLowerCase()) {
    case 'g': return 'gramos'
    case 'kg': return 'kilos'
    case 'ml': return 'mililitros'
    case 'l': return 'litros'
    default: return 'unidades'
  }
}

/** «2 bolsas (5 kg) + 750 g». La frase de debajo del total. */
export function desglose(
  formats: CountFormat[],
  cuenta: Record<string, number>,
  abierto: Abierto,
  formatoRef: CountFormat | null,
  baseUnit: string | null,
): string {
  const trozos: string[] = []
  for (const f of formats) {
    const n = cuenta[f.id] ?? 0
    if (n <= 0) continue
    trozos.push(`${plural(n, f.name)} (${fmtQty(n * f.qtyInBase, baseUnit)})`)
  }
  if (abierto.modo === 'peso') {
    const g = Number(abierto.gramos.replace(',', '.'))
    if (Number.isFinite(g) && g > 0) trozos.push(fmtQty(g, baseUnit))
  } else {
    const ref = formats.find(f => f.id === abierto.formatId) ?? formatoRef
    if (abierto.fraccion != null && ref) {
      const etiqueta = FRACCIONES.find(f => f.v === abierto.fraccion)?.label ?? nf.format(abierto.fraccion)
      trozos.push(`${etiqueta} ${nombreDeEnvase(ref.name)} a ojo`)
    } else {
      // «Otra» son unidades del formato, no gramos: es otra bolsa abierta.
      const n = Number(abierto.otros.replace(',', '.'))
      if (Number.isFinite(n) && n > 0 && ref) trozos.push(`${plural(n, ref.name)} a ojo`)
    }
  }
  return trozos.join(' + ')
}
