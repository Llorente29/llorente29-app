// src/modules/kitchen/lib/catalogPick.ts
//
// B72 (05/09/2026). Las reglas del selector de fichas de «Definir» (la pestaña
// Modificadores del editor de escandallos), fuera del componente para poder
// probarlas sin pintar nada — y porque un fichero de componente que exporta
// constantes rompe el fast refresh.
//
// El problema que resuelven: ese selector filtraba el catálogo a `raw`/`recipe` y
// dejaba fuera los 158 `dish` de la cuenta. Buscar «Patatas Clásicas» daba lista
// vacía y una única salida, «Crear como nuevo» — un clic a duplicar una ficha que
// existe. Ver la cabecera de ModifierImpactsTab.tsx para la historia entera.

import type { RecipeItemType } from '@/types/kitchen'

// Una ficha del catálogo tal y como la ve este selector.
//
// `kind` es lo que se le enseña al usuario, en lenguaje de cocina y sin jerga:
// un `dish` es un PLATO (una ración terminada, se pide por unidades) y un
// `raw`/`recipe` es un INGREDIENTE (se pide por peso o volumen). Esa distinción
// es la que evita cargar 1 gramo de `Patatas Bastón` creyendo que es una ración.
//
// `selectable` separa lo que se puede elegir de lo que solo sirve para NO crear
// un duplicado a ciegas: los `packaging` (63 fichas) y `tool` (1), y las fichas
// desactivadas o archivadas, no se ofrecen — pero si alguien escribe su nombre
// exacto, hay que decirle que ya existe en vez de crear otra igual.
export interface CatalogPick {
  id: string
  name: string
  needsReview?: boolean
  type: RecipeItemType
  kind: 'plato' | 'ingrediente'
  selectable: boolean
}

// Tipos que este selector deja elegir como objetivo de un impacto.
export const TIPOS_ELEGIBLES: RecipeItemType[] = ['raw', 'recipe', 'dish']

export function kindOf(type: RecipeItemType): 'plato' | 'ingrediente' {
  return type === 'dish' ? 'plato' : 'ingrediente'
}

/**
 * Normaliza un nombre para comparar: minúsculas, sin acentos y con los espacios
 * colapsados. Es la misma regla con la que se decide «¿esto ya existe?», así que
 * «  Patatas   CLÁSICAS meraki » y «Patatas Clásicas Meraki» son el mismo nombre.
 */
export function normName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * ¿Este grupo de modificadores está pidiendo un PLATO entero?
 *
 * Solo decide el ORDEN de la lista, nunca qué filas existen (regla 7): con o sin
 * acierto salen todas, cambia cuáles van primero. Por eso una palabra de más aquí
 * cuesta un reordenamiento y no un dato escondido.
 *
 * Las palabras salen de los nombres REALES de los 107 grupos de la cuenta, no de
 * la imaginación: «¿Quieres acompañar con unas patatas?», «Escoge tu entrante»,
 * «¿Quieres añadir un postre?.», «Y una bebida?», «Escoge tu primer kebab»,
 * «Busca la Burger de tu Combo», «Elige tu bocadillo», «Incluye tus Hamburguesas».
 * Frente a los de ingrediente: salsa, pepinillos, toppings, extra, tipo de carne.
 */
const PALABRAS_DE_PLATO = [
  'acompan', 'patata', 'entrante', 'postre', 'bebida',
  'combo', 'kebab', 'burger', 'hamburguesa', 'bocadillo', 'bocata',
]

/**
 * Y las palabras que MANDAN sobre las de arriba, porque nombran el plato solo para
 * decir qué PARTE de él se está eligiendo. Sin este veto, «Escoge la base de tu
 * bocata» y «1. Escoge la salsa para tu primer kebab» se leerían como que piden un
 * plato entero — y piden un ingrediente. Lo cazó la prueba, no el ojo.
 */
const PALABRAS_DE_PARTE = [
  'base', 'tipo de', 'salsa', 'proteina', 'topping', 'extra',
  'ingrediente', 'carne', 'pepinillo', 'quitar', 'quita', 'como quieres',
]

export function grupoPidePlato(groupName: string | null | undefined): boolean {
  if (!groupName) return false
  const n = normName(groupName)
  if (PALABRAS_DE_PARTE.some((w) => n.includes(w))) return false
  return PALABRAS_DE_PLATO.some((w) => n.includes(w))
}

/**
 * Por qué una ficha que existe no se ofrece en este selector. Se dice entero: un
 * «no se crea» sin motivo es un botón que calla (regla 8).
 */
export function razonNoElegible(c: CatalogPick): string {
  if (c.type === 'packaging') return ' como envase'
  if (c.type === 'tool') return ' como utensilio'
  return ', pero está retirada del catálogo'
}

/**
 * Qué fichas casan con lo escrito y en qué orden salen.
 *
 * Filtra por nombre (sin acentos ni mayúsculas) y ordena en tres pasos:
 *  1. la clase que el grupo está pidiendo, primero;
 *  2. dentro de su clase, lo que EMPIEZA por lo escrito antes que lo que solo lo
 *     contiene;
 *  3. y a igualdad, alfabético en español.
 *
 * Devuelve TODAS las que casan. El tope de la pantalla se aplica fuera, y lo que
 * queda fuera se dice en voz alta: aquí no desaparece nada (regla 7).
 */
export function ordenaCandidatas(
  fichas: CatalogPick[],
  search: string,
  platosPrimero: boolean,
): CatalogPick[] {
  const q = normName(search)
  const base = q === '' ? fichas : fichas.filter((i) => normName(i.name).includes(q))
  return [...base].sort((a, b) => {
    const pa = (a.kind === 'plato') === platosPrimero ? 0 : 1
    const pb = (b.kind === 'plato') === platosPrimero ? 0 : 1
    if (pa !== pb) return pa - pb
    if (q !== '') {
      const sa = normName(a.name).startsWith(q) ? 0 : 1
      const sb = normName(b.name).startsWith(q) ? 0 : 1
      if (sa !== sb) return sa - sb
    }
    return a.name.localeCompare(b.name, 'es')
  })
}
