// src/modules/kitchen/lib/formatosDeCompra.ts
//
// Reglas PURAS de los formatos de compra. Viven en lib/ y no en el componente
// a propósito: exportar funciones desde un fichero de componente añade avisos
// `react-refresh` al lint (medido el 05/09: cinco errores nuevos por hacerlo).
//
// Aquí hay tres cosas, y ninguna toca la base:
//   1. La FRASE del formato — «Caja · lleva · 6 · piezas de · Bote · de · 965 g»
//      y su cuenta hecha — «1 Caja = 6 Botes × 965 g = 5.790 g».
//   2. El sello «No cuadra»: el texto del proveedor dice un tamaño que el
//      formato guardado no explica de ninguna manera.
//   3. El sello «Repetido»: dos enlaces vivos del MISMO proveedor para el
//      MISMO artículo.
//
// Sobre el árbol: en `recipe_item_purchase_format` el PADRE es la PIEZA y el
// HIJO es la CAJA (`parent_format_id` de la Caja apunta al Bote, y
// `qty_per_parent` es cuántos botes trae). Se lee al revés de lo que sugiere
// el nombre; está así desde ensurePackTree y los 50 formatos anidados vivos
// dependen de ello, así que aquí se respeta y se documenta, no se cambia.

export type DimensionBase = 'weight' | 'volume' | 'unit' | string

/** Un formato tal y como lo necesitan las reglas (sin depender de la fila). */
export interface FormatoParaRegla {
  nombre: string
  qtyInBase: number
  /** cuántas piezas trae (solo en el nodo CAJA). */
  qtyPerParent: number | null
  /** contenido de UNA pieza, en unidad base (el nodo padre). */
  innerQtyInBase: number | null
  /** nombre de la pieza (el nodo padre). */
  innerNombre: string | null
}

// ─────────────────────────────────────────────────────────────────────
// 1 · La frase y la cuenta
// ─────────────────────────────────────────────────────────────────────

/**
 * Número en castellano, sin decimales de más.
 *
 * `useGrouping: true` no sobra: en es-ES el separador de millar se omite por
 * defecto en los números de CUATRO cifras (CLDR `minimumGroupingDigits: 2`),
 * así que sin esto 5790 saldría «5790» y la maqueta aprobada escribe «5.790».
 * Lo cazó la prueba, no la lectura del código.
 */
export function num(n: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3, useGrouping: true }).format(n)
}

/** Plural de andar por casa para el nombre de una pieza («Bote» → «Botes»). */
export function plural(nombre: string, n: number): string {
  const limpio = nombre.trim()
  if (n === 1 || limpio === '') return limpio
  if (/[aeiouáéíóú]$/i.test(limpio)) return `${limpio}s`
  if (/[zZ]$/.test(limpio)) return `${limpio.slice(0, -1)}ces`
  return `${limpio}es`
}

/**
 * Las piezas de la frase, para pintarla con cada trozo en su sitio:
 * «Caja · lleva · 6 · piezas de · Bote · de · 965 g».
 * Devuelve null cuando el formato NO es una caja con piezas dentro.
 */
export function frasePack(f: FormatoParaRegla, baseAbbr: string): {
  caja: string
  cuantas: number
  pieza: string
  contenido: string
} | null {
  if (f.qtyPerParent === null || f.innerQtyInBase === null) return null
  if (!(f.qtyPerParent > 0) || !(f.innerQtyInBase > 0)) return null
  return {
    caja: f.nombre,
    cuantas: f.qtyPerParent,
    pieza: f.innerNombre ?? 'pieza',
    contenido: `${num(f.innerQtyInBase)} ${baseAbbr}`,
  }
}

/**
 * La cuenta hecha, en una línea. Con árbol:
 *   «1 Caja = 6 Botes × 965 g = 5.790 g»
 * Sin árbol (un total):
 *   «1 Saco = 25.000 g»
 */
export function cuentaDelFormato(f: FormatoParaRegla, baseAbbr: string): string {
  const p = frasePack(f, baseAbbr)
  if (p) {
    return `1 ${p.caja} = ${num(p.cuantas)} ${plural(p.pieza, p.cuantas)} × ${p.contenido} = ${num(f.qtyInBase)} ${baseAbbr}`
  }
  return `1 ${f.nombre} = ${num(f.qtyInBase)} ${baseAbbr}`
}

// ─────────────────────────────────────────────────────────────────────
// 2 · El sello «No cuadra»
// ─────────────────────────────────────────────────────────────────────
//
// Cómo se mide, y por qué así (medido el 19/09 sobre los 165 enlaces vivos
// con denominación de proveedor de Foodint):
//
//   a) Del texto del proveedor se sacan las MAGNITUDES: un número pegado a
//      una unidad de una LISTA BLANCA. Lista blanca y no «letras sueltas»
//      porque «2 Latas» se leería como 2 litros. `gne` entra a propósito: es
//      como escribe Makro los gramos netos («lata 1600gne»).
//   b) Solo cuentan las magnitudes de la MISMA dimensión que la unidad base
//      del artículo. «AGUA MINERAL FUENTEVERA 50CL» sobre un artículo que se
//      cuenta en unidades no dice nada del formato: no se sella.
//   c) Una magnitud queda EXPLICADA si coincide (±1 %) con el total del
//      formato, con su nº de piezas, con el contenido de una pieza, o si
//      algún entero suelto del propio texto multiplicado por ella da el
//      total. Ese último caso es la CAJA APLANADA: «CAJA 8 BOLSAS DE 500 GR»
//      guardada como un único nodo de 4.000 g. El número es correcto —lo que
//      se perdió es la forma—, así que sellarla de «No cuadra» sería mentir.
//   d) Se sella solo si había al menos una magnitud comparable y NINGUNA
//      quedó explicada.
//
// Medido así: 115 enlaces con magnitud comparable, 2 sellados —
// «Aceite de Oliva Suave 0,4º» (Makro dice 250 ml, el formato 1.000 ml, y es
// el caso que puso Julio) y «DELICIAS DE POLLO SOUTHERN» (Coheldi dice
// piezas de 35 g y la caja son 2.200 g, que no es múltiplo de 35).
// Con la regla sin el punto (c) salían 8, y seis de ellas eran cajas
// aplanadas correctas: el sello habría gritado por nada.

const UNIDADES: Record<string, { dim: DimensionBase; aBase: number }> = {
  kg: { dim: 'weight', aBase: 1000 },
  kgs: { dim: 'weight', aBase: 1000 },
  kilo: { dim: 'weight', aBase: 1000 },
  kilos: { dim: 'weight', aBase: 1000 },
  g: { dim: 'weight', aBase: 1 },
  gr: { dim: 'weight', aBase: 1 },
  grs: { dim: 'weight', aBase: 1 },
  gne: { dim: 'weight', aBase: 1 },
  gramo: { dim: 'weight', aBase: 1 },
  gramos: { dim: 'weight', aBase: 1 },
  l: { dim: 'volume', aBase: 1000 },
  lt: { dim: 'volume', aBase: 1000 },
  lts: { dim: 'volume', aBase: 1000 },
  litro: { dim: 'volume', aBase: 1000 },
  litros: { dim: 'volume', aBase: 1000 },
  ml: { dim: 'volume', aBase: 1 },
  mls: { dim: 'volume', aBase: 1 },
  cl: { dim: 'volume', aBase: 10 },
  cls: { dim: 'volume', aBase: 10 },
  ud: { dim: 'unit', aBase: 1 },
  uds: { dim: 'unit', aBase: 1 },
  u: { dim: 'unit', aBase: 1 },
  unidad: { dim: 'unit', aBase: 1 },
  unidades: { dim: 'unit', aBase: 1 },
}

// número + (espacios opcionales) + la tira de letras pegada.
const TOKEN = /([0-9]+(?:[.,][0-9]+)?)\s*([a-záéíóúüñ]*)/gi

interface TokenTexto {
  numero: number
  letras: string
}

function tokens(texto: string): TokenTexto[] {
  const out: TokenTexto[] = []
  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(texto)) !== null) {
    const numero = Number(m[1].replace(',', '.'))
    if (!Number.isFinite(numero)) continue
    out.push({ numero, letras: (m[2] ?? '').toLowerCase() })
  }
  return out
}

/** Magnitudes del texto ya pasadas a la unidad base del artículo. */
export function magnitudesDelTexto(texto: string, baseDim: DimensionBase): number[] {
  return tokens(texto.toLowerCase())
    .map((t) => {
      const u = UNIDADES[t.letras]
      if (!u || u.dim !== baseDim) return null
      return t.numero * u.aBase
    })
    .filter((v): v is number => v !== null && v > 0)
}

/** Enteros sueltos del texto: los candidatos a «cuántas piezas trae la caja». */
export function enterosDelTexto(texto: string): number[] {
  const vistos = new Set<number>()
  for (const t of tokens(texto.toLowerCase())) {
    if (Number.isInteger(t.numero) && t.numero >= 2 && t.numero <= 999) vistos.add(t.numero)
  }
  return [...vistos]
}

function casiIgual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.01)
}

export interface EntradaNoCuadra {
  /** denominación del proveedor (article_supplier.supplier_item_name). */
  texto: string | null
  baseDim: DimensionBase
  formato: FormatoParaRegla | null
}

/** true = el texto del proveedor dice un tamaño que el formato no explica. */
export function elTextoNoCuadra(e: EntradaNoCuadra): boolean {
  const texto = (e.texto ?? '').trim()
  if (texto === '' || !e.formato) return false
  const f = e.formato
  if (!(f.qtyInBase > 0)) return false

  const magnitudes = magnitudesDelTexto(texto, e.baseDim)
  if (magnitudes.length === 0) return false

  const enteros = enterosDelTexto(texto)
  const explicada = (m: number): boolean => {
    if (casiIgual(m, f.qtyInBase)) return true
    if (f.qtyPerParent !== null && casiIgual(m, f.qtyPerParent)) return true
    if (f.innerQtyInBase !== null && casiIgual(m, f.innerQtyInBase)) return true
    // la caja aplanada: un entero del propio texto × esta magnitud = el total
    return enteros.some((n) => casiIgual(n * m, f.qtyInBase))
  }
  return !magnitudes.some(explicada)
}

// ─────────────────────────────────────────────────────────────────────
// 3 · El sello «Repetido»
// ─────────────────────────────────────────────────────────────────────
//
// Dos o más enlaces VIVOS del mismo artículo con el mismo proveedor.
// No es descuido del usuario: `learn_from_receipt` guarda una fila por
// referencia distinta MÁS una fila con referencia nula (sus dos ON CONFLICT
// tienen claves distintas), así que el mismo proveedor acaba duplicado solo.
// Medido el 19/09 en Foodint: 33 pares, 22 artículos.

export interface EnlaceMinimo {
  recipeItemId: string
  supplierId: string
}

/** Ids de artículo que tienen al menos un proveedor repetido. */
export function articulosConProveedorRepetido(enlaces: EnlaceMinimo[]): Set<string> {
  const cuenta = new Map<string, number>()
  for (const e of enlaces) {
    const k = `${e.recipeItemId}|${e.supplierId}`
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1)
  }
  const out = new Set<string>()
  for (const [k, n] of cuenta) {
    if (n >= 2) out.add(k.split('|')[0])
  }
  return out
}
