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

/**
 * Plural de andar por casa para el nombre de una pieza («Bote» → «Botes»).
 *
 * Y lo primero: **si ya acaba en «s», no se toca**. Julio escribe «Latas» y el
 * código le añadía «-es» — «latases», «boteses»—, y eso salía en la línea que
 * dice en qué se cuenta el artículo, que es de las más leídas de la ficha.
 *
 * No es una lista de excepciones, es lo que dicen los datos: de los **281
 * formatos vivos** de Foodint, **4** tienen el nombre ya en plural
 * («bolsas», «botes», «Latas») y **ninguno** es una palabra singular acabada en
 * «s». Medido el 19/09 contra `recipe_item_purchase_format`.
 */
export function plural(nombre: string, n: number): string {
  const limpio = nombre.trim()
  if (n === 1 || limpio === '') return limpio
  if (/s$/i.test(limpio)) return limpio
  // «Bidón» → «Bidones»: al pluralizar, la tilde del singular se cae.
  if (/ón$/i.test(limpio)) return `${limpio.slice(0, -2)}ones`
  if (/[aeiouáéíóú]$/i.test(limpio)) return `${limpio}s`
  if (/[zZ]$/.test(limpio)) return `${limpio.slice(0, -1)}ces`
  return `${limpio}es`
}

/**
 * Singular, para un PRECIO UNITARIO: «4,81 € / lata», no «/ latas».
 *
 * Es el mismo animal que el plural, con la otra piel: los nombres que Julio
 * escribe ya en plural («Latas», «botes», «bolsas») hay que devolverlos al
 * singular cuando lo que se dice es cuánto cuesta UNA. Los 4 nombres vivos
 * acabados en «s» de Foodint salen bien quitando la «s»; «-ones» vuelve a
 * «-ón», que es el inverso exacto de lo que hace `plural`.
 */
export function singular(nombre: string): string {
  const limpio = nombre.trim()
  if (!/s$/i.test(limpio)) return limpio
  // Los dos inversos exactos de `plural`, y nada más.
  if (/ones$/i.test(limpio)) return `${limpio.slice(0, -4)}ón`
  if (/ces$/i.test(limpio)) return `${limpio.slice(0, -3)}z`
  // Y si no, se quita solo la «s». «botes» es ambiguo en castellano —puede
  // venir de «bote» o de «bot»— y quitar «es» daba «bot»: lo cazó la prueba.
  // En esta población todos los nombres en plural son del tipo «+s»
  // (bolsas, botes, Latas), así que se quita una letra y se acierta.
  return limpio.slice(0, -1)
}

/**
 * «Se cuenta en cajas · latas de 1.600 g · latas de 3.000 g».
 *
 * Dos cosas que se ven en los datos reales y que hay que respetar:
 *  · Alubias rojas tiene TRES formatos marcados para contar, y dos se llaman
 *    «Lata» (1.600 g) y «Latas» (3.000 g). NO son un duplicado: son dos
 *    envases distintos con el mismo nombre. Fundirlos escondería una fila que
 *    existe, que es lo que prohíbe la regla 7.
 *  · Por eso, cuando dos nombres coinciden al ponerlos en plural, cada uno
 *    lleva detrás cuánto trae. Cuando no coinciden, el nombre va solo.
 *
 * Y se unen con «·», no con «y … y …».
 */
export function comoSeCuenta(
  formatos: { nombre: string; qtyInBase: number }[],
  baseAbbr: string,
): string {
  if (formatos.length === 0) return baseAbbr || 'la unidad base'
  const enPlural = formatos.map((f) => ({ ...f, etiqueta: plural(f.nombre, 2).toLowerCase() }))
  const veces = new Map<string, number>()
  enPlural.forEach((f) => veces.set(f.etiqueta, (veces.get(f.etiqueta) ?? 0) + 1))
  // Las del mismo nombre, JUNTAS, y de mayor a menor. Antes salía «latas de
  // 3.000 g · cajas · latas de 1.600 g»: las dos latas partidas por las cajas,
  // y había que releer la línea. Ordenar por nombre agrupaba pero dejaba
  // «botes · cajas», que es el envase pequeño primero; por eso cada grupo va
  // donde lo pone su miembro MÁS GRANDE, y dentro también de mayor a menor.
  const mayorDelGrupo = new Map<string, number>()
  enPlural.forEach((f) =>
    mayorDelGrupo.set(f.etiqueta, Math.max(mayorDelGrupo.get(f.etiqueta) ?? 0, f.qtyInBase)),
  )
  return [...enPlural]
    .sort(
      (a, b) =>
        (mayorDelGrupo.get(b.etiqueta) ?? 0) - (mayorDelGrupo.get(a.etiqueta) ?? 0) ||
        a.etiqueta.localeCompare(b.etiqueta, 'es') ||
        b.qtyInBase - a.qtyInBase,
    )
    .map((f) =>
      (veces.get(f.etiqueta) ?? 0) > 1
        ? `${f.etiqueta} de ${num(f.qtyInBase)} ${baseAbbr}`
        : f.etiqueta,
    )
    .join(' · ')
}

/**
 * C3 · «Lo que va a cambiar». El precio del formato NO cambia —sigue costando
 * lo mismo la caja—; lo que cambia es cuánto trae, y por eso cambia el coste
 * por unidad base. Puro y probado aparte porque es la cifra que el operario
 * va a usar para decidir si toca o no toca.
 */
export function loQueVaACambiar(params: {
  /** €/base de hoy (article_supplier.last_price). */
  costeHastaHoy: number | null
  /** cuánto trae el formato de hoy. */
  totalHastaHoy: number
  /** cuánto va a traer. */
  totalDesdeHoy: number | null
}): { precioDelFormato: number | null; costeDesdeHoy: number | null } {
  const { costeHastaHoy, totalHastaHoy, totalDesdeHoy } = params
  if (costeHastaHoy === null || !(totalHastaHoy > 0)) {
    return { precioDelFormato: null, costeDesdeHoy: null }
  }
  const precioDelFormato = costeHastaHoy * totalHastaHoy
  const costeDesdeHoy =
    totalDesdeHoy !== null && totalDesdeHoy > 0 ? precioDelFormato / totalDesdeHoy : null
  return { precioDelFormato, costeDesdeHoy }
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
//   c-bis) Y una magnitud solo HABLA del envase si lleva delante una palabra
//      de envase o de tamaño («caja», «bolsa», «botella», «de», «contiene»…).
//      Un número pegado al NOMBRE DEL PRODUCTO dice lo que pesa una PIEZA, no
//      lo que trae la caja. Corrección de Julio del 19/09 sobre «POLLO
//      DELICIAS SUREÑAS METEORITOS 35G»: 35 g es un meteorito de pollo, y que
//      2.200 no sea múltiplo de 35 no dice nada malo del formato.
//   d) Se sella solo si había al menos una magnitud comparable y NINGUNA
//      quedó explicada.
//
// Medido sobre los 165 enlaces reales, y cada paso con su cifra:
//   · sin el punto (c): 8 sellos, y SEIS eran cajas aplanadas correctas.
//   · con (c), sin (c-bis): 115 comparables, 2 sellos — y el segundo era falso.
//   · con (c) y (c-bis): 93 comparables, 1 sello.
// El coste de (c-bis) está medido y se dice: 22 enlaces dejan de poder
// comprobarse, porque su tamaño va pegado al nombre del producto y desde
// fuera no hay manera de saber si habla de la caja o de la pieza. Es el
// precio de no mentir: un sello que grita en falso enseña a no leer sellos.

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

// Palabras tras las que un número SÍ habla del envase: o nombran el envase, o
// son la juntura de una frase de tamaño («caja DE 3 kg», «CONTIENE 24 latas»,
// «CJ 5X1 kg»). Si delante no hay ninguna de estas, el número está pegado al
// nombre del producto y dice el tamaño de una PIEZA.
const ANTES_DE_TAMANO = [
  'caja', 'cj', 'cja', 'bolsa', 'bote', 'lata', 'paquete', 'paq', 'pq', 'saco',
  'garrafa', 'bidon', 'bidón', 'estuche', 'tarrina', 'pack', 'botella', 'frasco',
  'cubo', 'malla', 'bandeja', 'manojo', 'doypack', 'sobre', 'rollo', 'bobina',
  'carton', 'cartón', 'huevera', 'tazon', 'tazón', 'tarrico', 'envase', 'pieza',
  'embalaje', 'cubeta', 'barqueta', 'ud', 'uds', 'unidad', 'unidades',
  'de', 'en', 'x', 'contiene', 'total',
]

// Cuántos caracteres se miran por delante del número. 16 es lo medido: con 10
// se pierden enlaces buenos («… CAJA 6 UD DE 3 KG»), y con 24 vuelve a colarse
// el falso de las Delicias.
const VENTANA_ANTES = 16

// número + (espacios opcionales) + la tira de letras pegada.
const TOKEN = /([0-9]+(?:[.,][0-9]+)?)\s*([a-záéíóúüñ]*)/gi

interface TokenTexto {
  numero: number
  letras: string
  /** dónde empieza el NÚMERO en el texto. Hace falta para mirar qué va delante. */
  inicio: number
}

function tokens(texto: string): TokenTexto[] {
  const out: TokenTexto[] = []
  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(texto)) !== null) {
    const numero = Number(m[1].replace(',', '.'))
    if (!Number.isFinite(numero)) continue
    out.push({ numero, letras: (m[2] ?? '').toLowerCase(), inicio: m.index })
  }
  return out
}

export interface MagnitudDelTexto {
  /** ya pasada a la unidad base del artículo. */
  valor: number
  /** dónde empieza su número en el texto, para poder mirar qué lleva delante. */
  inicio: number
}

/** Magnitudes del texto, con su sitio, ya en la unidad base del artículo. */
export function magnitudesConSitio(texto: string, baseDim: DimensionBase): MagnitudDelTexto[] {
  return tokens(texto.toLowerCase())
    .map((t) => {
      const u = UNIDADES[t.letras]
      if (!u || u.dim !== baseDim) return null
      const valor = t.numero * u.aBase
      return valor > 0 ? { valor, inicio: t.inicio } : null
    })
    .filter((v): v is MagnitudDelTexto => v !== null)
}

/** Magnitudes del texto ya pasadas a la unidad base del artículo. */
export function magnitudesDelTexto(texto: string, baseDim: DimensionBase): number[] {
  return magnitudesConSitio(texto, baseDim).map((m) => m.valor)
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

  // Solo las magnitudes que HABLAN del envase (c-bis).
  const minusculas = texto.toLowerCase()
  const magnitudes = magnitudesConSitio(texto, e.baseDim)
    .filter((m) => {
      const antes = minusculas.slice(Math.max(0, m.inicio - VENTANA_ANTES), m.inicio)
      return ANTES_DE_TAMANO.some((w) => antes.includes(w))
    })
    .map((m) => m.valor)
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
