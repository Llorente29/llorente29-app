// src/modules/conta/lib/codigoPostal.ts
//
// La población que sale del código postal, y la dirección dicha en una frase
// repartida en sus campos (respuesta 4 del C00, arreglo 3).
//
// La regla de Julio: UN CAMPO QUE LA IA PUEDE DEDUCIR NUNCA SE DEJA EN BLANCO.
// Se propone, marcado «IA» y con su porqué, y la persona lo confirma. Con un
// código postal, la población sale de la tabla de serie `postal_code`
// (GeoNames, CC BY 4.0, descargado por GitHub Actions; nada en vivo). Si la
// persona dice la ciudad en la frase, manda lo que dijo.

/** Una fila de `postal_code`: un código postal puede tener varias poblaciones. */
export interface LugarCp {
  poblacion: string
  municipio: string | null
  provincia: string | null
}

export interface PoblacionPropuesta {
  valor: string
  /** El porqué que va con la marca «IA». */
  porque: string
  /** Las demás poblaciones de ese código, para elegir si no es la propuesta. */
  otras: string[]
}

export const FUENTE_CP = 'el fichero de códigos postales de España de GeoNames (geonames.org, CC BY 4.0)'

const lista = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

const plano = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'i', 'da', 'do', 'dos', 'das', "d'", 'les', 'en'])

/**
 * Cómo se escribe una población. GeoNames trae la población sin tildes y en
 * mayúscula cada palabra («Las Palmas De Gran Canaria», «Almeria») y el
 * municipio bien escrito («Las Palmas de Gran Canaria», «Almería»). Si son el
 * mismo nombre, el del municipio; si no, la población con las partículas en
 * minúscula. (El municipio no vale siempre: el de Sevilla viene «Seville».)
 */
export function nombrePoblacion(l: LugarCp): string {
  const p = l.poblacion.trim()
  if (l.municipio && plano(l.municipio) === plano(p)) return l.municipio.trim()
  return p.split(' ').map((w, i) => (i > 0 && PARTICULAS.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(' ')
}

/**
 * La población para un código postal, con las filas en el orden del fichero.
 * Si el código es de una sola población, esa. Si es de varias de un mismo
 * municipio, la que se llama como el municipio (o la primera). Si es de varias
 * de municipios distintos, la primera. En los dos últimos casos las demás van a
 * mano: se propone igual (un hueco no ayuda a nadie) y se dice que hay más.
 */
export function proponerPoblacion(cp: string, lugares: LugarCp[]): PoblacionPropuesta | null {
  if (!/^\d{5}$/.test(cp)) return null
  const filas = lugares.filter((l) => l.poblacion.trim() !== '')
  const nombres = [...new Set(filas.map(nombrePoblacion))]
  if (nombres.length === 0) return null
  if (nombres.length === 1) {
    return { valor: nombres[0], porque: `Por el código postal ${cp}: en ${FUENTE_CP} es ${nombres[0]}.`, otras: [] }
  }
  const municipios = [...new Set(filas.map((l) => (l.municipio ?? '').trim()))]
  const unSoloMunicipio = municipios.length === 1 && municipios[0] !== ''
  const cabecera = unSoloMunicipio ? filas.find((l) => plano(l.poblacion) === plano(municipios[0])) : undefined
  const valor = cabecera ? nombrePoblacion(cabecera) : nombres[0]
  const otras = nombres.filter((n) => n !== valor)
  const de = unSoloMunicipio ? `del municipio de ${municipios[0]}, con varias poblaciones` : 'de varias poblaciones'
  return { valor, otras, porque: `Por el código postal ${cp}: en ${FUENTE_CP} es ${de} (${lista(nombres)}). Propongo ${valor}; cámbiala si no es.` }
}

export interface DireccionEntendida {
  calle: string
  numero: string
  codigoPostal: string
  /** La ciudad dicha en la frase; null si no la dijo (entonces sale de la tabla). */
  poblacion: string | null
}

const limpiar = (s: string): string => s.replace(/^[\s,;.\-–]+|[\s,;\-–]+$/g, '').replace(/\s+/g, ' ')
const tieneLetras = (s: string): boolean => /\p{L}/u.test(s)

/** «Calle Mayor 5 bajo» → calle «Calle Mayor», número «5 bajo». El ÚLTIMO número es el del portal. */
function calleYNumero(s: string): { calle: string; numero: string } {
  const t = limpiar(s)
  const re = /(?:^|[\s,])(?:n[º°o]\.?\s*|num\.?\s*|número\s*)?(\d{1,4}\s*[A-Za-z]?)(?=$|[\s,])/giu
  let ultimo: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) ultimo = m
  // Un número pegado al principio es parte del nombre («8 de Marzo»), no el portal.
  if (!ultimo || ultimo.index === 0) return { calle: t, numero: '' }
  const calle = limpiar(t.slice(0, ultimo.index))
  const resto = limpiar(t.slice(ultimo.index + ultimo[0].length))
  if (calle === '' || !tieneLetras(calle)) return { calle: t, numero: '' }
  return { calle, numero: limpiar([ultimo[1].replace(/\s+/g, ''), resto].filter((x) => x !== '').join(' ')) }
}

/**
 * Reparte una dirección dicha en una frase: «Avda Ensanche de Vallecas 106,
 * 28051» → calle, número y código postal; «Calle Mayor 5, 08001 Barcelona» →
 * además la población, que manda sobre la tabla porque la dijo la persona.
 */
export function entenderDireccion(texto: string): DireccionEntendida | null {
  const s = limpiar(texto.replace(/[,\s]*\b(Espa[ñn]a|Spain)\.?\s*$/i, ''))
  if (s === '' || !tieneLetras(s)) return null
  const m = s.match(/(?:^|\D)(\d{5})(?!\d)/)
  if (!m || m.index === undefined) {
    const { calle, numero } = calleYNumero(s)
    return { calle, numero, codigoPostal: '', poblacion: null }
  }
  const cp = m[1]
  const ini = m.index + m[0].length - 5
  const antes = s.slice(0, ini)
  // Lo de detrás del código postal es la ciudad; sin lo de entre paréntesis (la provincia) ni lo que va tras otra coma.
  const despues = limpiar(s.slice(ini + 5).replace(/\([^)]*\)/g, '').split(',')[0] ?? '')
  const partes = antes.split(',').map(limpiar).filter((x) => x !== '')
  let poblacion: string | null = despues !== '' && tieneLetras(despues) ? despues : null
  // «Calle Mayor 5, Madrid, 28013»: la ciudad delante del código postal, en su propio trozo.
  if (!poblacion && partes.length >= 2 && !/\d/.test(partes[partes.length - 1])) poblacion = partes.pop() ?? null
  const { calle, numero } = calleYNumero(partes.join(', '))
  return { calle, numero, codigoPostal: cp, poblacion }
}
