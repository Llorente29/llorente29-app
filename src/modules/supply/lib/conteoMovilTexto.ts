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

/**
 * ¿ESE DECIMAL SON KILOS?
 *
 * Natacha pesó una bolsa empezada de Patatas Bastón y escribió «1,01» en la
 * casilla de GRAMOS. Se guardó 1,011 g de patatas — un grano— cuando quería
 * decir un kilo justo. La casilla dice «gramos» y ella tenía la báscula
 * delante marcando kilos, que es lo que marcan las básculas de cocina.
 *
 * Nadie pesa un gramo y pico. Un decimal en una casilla de gramos o mililitros
 * es, casi siempre, la lectura de la báscula sin convertir. Así que se
 * PREGUNTA — no se convierte a la fuerza, porque 0,5 g de azafrán existe y
 * quien lo pesa tiene derecho a escribirlo.
 *
 * Devuelve `null` cuando no hay nada que preguntar:
 *   · unidad base que no es g ni ml (en «ud» un decimal significa otra cosa);
 *   · un entero — 250 g es 250 g y no se molesta a nadie;
 *   · 1.000 o más, donde el decimal ya es plausible como gramos (1.250,5 g) y
 *     leerlo como kilos daría una tonelada y cuarto.
 */
export function dudaDeKilos(
  texto: string,
  baseUnit: string | null,
): { comoEsta: number; enGrande: number; unidadGrande: string; frase: string } | null {
  const u = (baseUnit ?? '').trim().toLowerCase()
  if (u !== 'g' && u !== 'ml') return null

  const n = Number(texto.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  if (Number.isInteger(n)) return null
  if (n >= 1000) return null

  const grande = u === 'g' ? 'kg' : 'l'
  const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })
  return {
    comoEsta: n,
    enGrande: n * 1000,
    unidadGrande: grande,
    // Espacio de NO SEPARACIÓN: «1,01 kg» no se parte al final de una línea.
    frase: `${nf.format(n)}\u00A0${grande}`,
  }
}

/**
 * CÓMO SE MIDE ESTO, Y CÓMO SE DICE.
 *
 * La pantalla decía «Pésalo y escribe los unidades» en cuanto entró el
 * packaging: dos errores en cuatro palabras. «Unidades» es femenino —de
 * «unidad», que lleva el sufijo -dad— así que pide «las»; y una bolsa no se
 * pesa, se cuenta.
 *
 * No es cosmético: el móvil lo lee alguien de pie delante de una estantería, y
 * «pésalo» le está mandando a buscar una báscula que no necesita.
 *
 * Se decide por la UNIDAD BASE, que es lo único que la pantalla sabe: gramos,
 * kilos, mililitros y litros se pesan (o se miden) y son masculinos; todo lo
 * demás son «unidades», que se cuentan.
 */
export function medida(baseUnit: string | null | undefined): {
  pesable: boolean
  largo: string
  articulo: 'los' | 'las'
  /** El imperativo con su pronombre ya concordado: «Pésalo», «Cuéntalas». */
  verbo: string
} {
  const u = (baseUnit ?? '').trim().toLowerCase()
  const pesable = u === 'g' || u === 'kg' || u === 'ml' || u === 'l'
  return pesable
    ? { pesable: true,  largo: unidadLarga(u), articulo: 'los', verbo: 'Pésalo' }
    : { pesable: false, largo: 'unidades',     articulo: 'las', verbo: 'Cuéntalas' }
}

/** La frase de debajo del título de la fila de lo abierto. */
export function pieDeLaCasilla(baseUnit: string | null | undefined, soloBase: boolean): string {
  const m = medida(baseUnit)
  return soloBase
    ? `Escribe ${m.articulo} ${m.largo}`
    : `${m.verbo} y escribe ${m.articulo} ${m.largo}`
}
