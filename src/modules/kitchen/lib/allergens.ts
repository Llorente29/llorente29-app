// src/modules/kitchen/lib/allergens.ts
//
// Fuente ÚNICA de verdad de los alérgenos en Folvy.
//
// Regla de oro: lo que se GUARDA en BBDD (recipe_item_allergen.allergen_code,
// ingredient_template_allergen.allergen_code) es el CÓDIGO ESTABLE en
// inglés-neutro (gluten, milk, crustaceans...). NUNCA la etiqueta visible.
// La etiqueta ('Gluten', 'Lácteos'...) se DERIVA por idioma en la UI.
//
// Por qué inglés-neutro y no español:
//  · El master cruza con bases internacionales (USDA, Open Food Facts) que
//    vienen en inglés -> casar por código, no por texto traducido.
//  · Si Folvy sale de España, añadir un idioma = ampliar el mapa de etiquetas,
//    CERO migración de datos (las claves no cambian).
//
// Origen normativo: Reglamento (UE) 1169/2011, Anexo II — los 14 alérgenos de
// declaración obligatoria. El orden sigue el del Anexo.

/** Código estable de alérgeno tal y como se persiste en BBDD. */
export type AllergenCode =
  | 'gluten'
  | 'crustaceans'
  | 'eggs'
  | 'fish'
  | 'peanuts'
  | 'soy'
  | 'milk'
  | 'nuts'
  | 'celery'
  | 'mustard'
  | 'sesame'
  | 'sulphites'
  | 'lupin'
  | 'molluscs'

/**
 * Estado de un alérgeno en un ingrediente/plato.
 *  · contains    -> lo contiene (declaración positiva)
 *  · may_contain -> trazas / puede contener (contaminación cruzada)
 *  · free        -> libre de (declaración negativa explícita)
 * La AUSENCIA de fila NO equivale a 'free': es "sin determinar". 'free' es una
 * afirmación deliberada que el cocinero/master asume (con su responsabilidad).
 */
export type AllergenState = 'contains' | 'may_contain' | 'free'

export interface AllergenDef {
  code: AllergenCode
  labelEs: string
  labelEn: string
}

/** Catálogo canónico, en el orden del Anexo II del Reglamento 1169/2011. */
export const EU_ALLERGENS: readonly AllergenDef[] = [
  { code: 'gluten',      labelEs: 'Gluten',            labelEn: 'Gluten' },
  { code: 'crustaceans', labelEs: 'Crustáceos',        labelEn: 'Crustaceans' },
  { code: 'eggs',        labelEs: 'Huevos',            labelEn: 'Eggs' },
  { code: 'fish',        labelEs: 'Pescado',           labelEn: 'Fish' },
  { code: 'peanuts',     labelEs: 'Cacahuetes',        labelEn: 'Peanuts' },
  { code: 'soy',         labelEs: 'Soja',              labelEn: 'Soybeans' },
  { code: 'milk',        labelEs: 'Lácteos',           labelEn: 'Milk' },
  { code: 'nuts',        labelEs: 'Frutos de cáscara', labelEn: 'Tree nuts' },
  { code: 'celery',      labelEs: 'Apio',              labelEn: 'Celery' },
  { code: 'mustard',     labelEs: 'Mostaza',           labelEn: 'Mustard' },
  { code: 'sesame',      labelEs: 'Sésamo',            labelEn: 'Sesame' },
  { code: 'sulphites',   labelEs: 'Sulfitos',          labelEn: 'Sulphites' },
  { code: 'lupin',       labelEs: 'Altramuces',        labelEn: 'Lupin' },
  { code: 'molluscs',    labelEs: 'Moluscos',          labelEn: 'Molluscs' },
] as const

/** Mapa rápido code -> definición. */
export const ALLERGEN_BY_CODE: Readonly<Record<AllergenCode, AllergenDef>> =
  Object.fromEntries(EU_ALLERGENS.map((a) => [a.code, a])) as Record<
    AllergenCode,
    AllergenDef
  >

/** Lista de los 14 códigos, en orden normativo. */
export const ALLERGEN_CODES: readonly AllergenCode[] = EU_ALLERGENS.map(
  (a) => a.code,
)

/** ¿Es un código de alérgeno válido? (para validar entradas de IA/OCR/import). */
export function isAllergenCode(value: string): value is AllergenCode {
  return value in ALLERGEN_BY_CODE
}

/**
 * Etiqueta visible de un alérgeno por idioma. Hoy la app solo usa 'es'; el
 * parámetro existe para no reescribir las llamadas cuando se añada i18n.
 */
export function allergenLabel(
  code: AllergenCode,
  lang: 'es' | 'en' = 'es',
): string {
  const def = ALLERGEN_BY_CODE[code]
  if (!def) return code
  return lang === 'en' ? def.labelEn : def.labelEs
}

export const ALLERGEN_STATES: readonly AllergenState[] = [
  'contains',
  'may_contain',
  'free',
]

const ALLERGEN_STATE_LABEL_ES: Record<AllergenState, string> = {
  contains: 'Contiene',
  may_contain: 'Puede contener (trazas)',
  free: 'Libre de',
}

const ALLERGEN_STATE_LABEL_EN: Record<AllergenState, string> = {
  contains: 'Contains',
  may_contain: 'May contain (traces)',
  free: 'Free from',
}

export function allergenStateLabel(
  state: AllergenState,
  lang: 'es' | 'en' = 'es',
): string {
  return lang === 'en'
    ? ALLERGEN_STATE_LABEL_EN[state]
    : ALLERGEN_STATE_LABEL_ES[state]
}
