// src/modules/conta/lib/impuestoIndirecto.ts
//
// S01e · Las palabras del impuesto de las facturas según dónde está la empresa
// (company_tax_profile.tax_territory): IVA en la Península y Baleares, IGIC en
// Canarias, IPSI en Ceuta y Melilla. Una empresa canaria no ve «IVA» donde es
// IGIC. Sin pantalla: se prueba sola.
//
// El formato de los libros de la AEAT es el del IVA: para el IGIC (Agencia
// Tributaria Canaria) y el IPSI (Ceuta y Melilla) no es el suyo. No se esconde
// (regla 7): se dice en pantalla.

export type Impuesto = 'iva' | 'igic' | 'ipsi'

/** El impuesto por el territorio fiscal; sin territorio (o uno raro), IVA. */
export function impuestoDelTerritorio(territorio: string | null | undefined): Impuesto {
  if (territorio === 'canarias') return 'igic'
  if (territorio === 'ceuta_melilla') return 'ipsi'
  return 'iva'
}

export interface PalabrasImpuesto {
  impuesto: Impuesto
  /** «IVA», «IGIC» o «IPSI». */
  nombre: string
  /** El área de Libros: «Libros registro de IVA». */
  libros: string
  /** «IVA repercutido» (el de las ventas). */
  repercutido: string
  /** «IVA soportado» (el de las compras). */
  soportado: string
  /** Cabecera de la columna del tipo: «% IVA». */
  columnaTipo: string
  /** La cita legal de lo que es del IVA (LIVA); null fuera del IVA. */
  ley: string | null
  /** Si el formato de libros de la AEAT es el de este impuesto. */
  formatoAeatAplica: boolean
  /** Lo que se dice junto al formato AEAT cuando no es el de este impuesto. */
  avisoFormatoAeat: string | null
  /** Lo que se dice junto a una cita de la ley del IVA cuando no es la de este impuesto. */
  avisoLey: string | null
}

const NOMBRE: Record<Impuesto, string> = { iva: 'IVA', igic: 'IGIC', ipsi: 'IPSI' }

const QUIEN: Record<Exclude<Impuesto, 'iva'>, string> = {
  igic: 'la Agencia Tributaria Canaria',
  ipsi: 'tu ciudad (Ceuta o Melilla)',
}

export function palabrasImpuesto(impuesto: Impuesto): PalabrasImpuesto {
  const n = NOMBRE[impuesto]
  const base = {
    impuesto, nombre: n, libros: `Libros registro de ${n}`, repercutido: `${n} repercutido`,
    soportado: `${n} soportado`, columnaTipo: `% ${n}`,
  }
  if (impuesto === 'iva') return { ...base, ley: 'LIVA', formatoAeatAplica: true, avisoFormatoAeat: null, avisoLey: null }
  return {
    ...base, ley: null, formatoAeatAplica: false,
    avisoFormatoAeat: `Este formato es el de la AEAT para los libros del IVA. Tu empresa lleva ${n}, que lo gestiona ${QUIEN[impuesto]}, y su formato no es este. El fichero sale igual, con las columnas de la AEAT, por si te sirve de base; lo que te pidan exactamente lo confirma tu asesor.`,
    avisoLey: `Las citas son de la ley del IVA (LIVA). Tu empresa lleva ${n}, con su propia norma: los artículos que te tocan los confirma tu asesor.`,
  }
}

/** Las palabras del impuesto de una empresa por su territorio fiscal. */
export const palabrasDelTerritorio = (territorio: string | null | undefined): PalabrasImpuesto =>
  palabrasImpuesto(impuestoDelTerritorio(territorio))

/**
 * Un texto escrito para el IVA, con el nombre del impuesto de la empresa:
 * «el IVA repercutido (477)» → «el IGIC repercutido (477)». Solo la palabra
 * suelta «IVA» (no «LIVA» ni «RIVA», que son leyes del IVA y se dicen aparte).
 */
export function conImpuesto(texto: string, p: Pick<PalabrasImpuesto, 'nombre'>): string {
  return texto.replace(/(^|[^\p{L}])IVA(?![\p{L}])/gu, (_t, antes: string) => `${antes}${p.nombre}`)
}
