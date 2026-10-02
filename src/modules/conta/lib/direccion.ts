// src/modules/conta/lib/direccion.ts
//
// Propuesta de reparto de una dirección en una sola línea (la columna antigua
// `supplier.address`, o la que lee la IA de una factura) en calle, código
// postal, población y provincia. Encargo C01 §4.3.
//
// ES UNA PROPUESTA, NO UN DATO. La ficha la enseña con «Confirmar» y nada se
// guarda sin que una persona lo diga. Por eso aquí se prefiere dejar un hueco
// a adivinar: si no hay código postal, la población y la provincia quedan
// vacías antes que inventadas.

export interface DireccionPropuesta {
  street: string | null
  postalCode: string | null
  city: string | null
  province: string | null
}

/** Provincia por los dos primeros dígitos del CP (INE). */
const PROVINCIA_POR_CP: Record<string, string> = {
  '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila',
  '06': 'Badajoz', '07': 'Illes Balears', '08': 'Barcelona', '09': 'Burgos', '10': 'Cáceres',
  '11': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba', '15': 'A Coruña',
  '16': 'Cuenca', '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa',
  '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León', '25': 'Lleida',
  '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '29': 'Málaga', '30': 'Murcia',
  '31': 'Navarra', '32': 'Ourense', '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas',
  '36': 'Pontevedra', '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '39': 'Cantabria', '40': 'Segovia',
  '41': 'Sevilla', '42': 'Soria', '43': 'Tarragona', '44': 'Teruel', '45': 'Toledo',
  '46': 'Valencia', '47': 'Valladolid', '48': 'Bizkaia', '49': 'Zamora', '50': 'Zaragoza',
  '51': 'Ceuta', '52': 'Melilla',
}

export function provinciaPorCp(cp: string): string | null {
  return /^\d{5}$/.test(cp) ? PROVINCIA_POR_CP[cp.slice(0, 2)] ?? null : null
}

const titulo = (s: string): string =>
  s.toLowerCase().replace(/(^|[\s\-/(])([\p{L}])/gu, (_, sep: string, c: string) => sep + c.toUpperCase())

export function proponerDireccion(linea: string | null): DireccionPropuesta | null {
  if (!linea || linea.trim() === '') return null
  // Fuera el país al final: no es parte de la dirección fiscal estructurada.
  const s = linea.trim().replace(/[,\s]*\b(Espa[ñn]a|Spain)\.?\s*$/i, '').trim()

  const m = s.match(/\b(\d{5})\b/)
  if (!m || m.index === undefined) {
    // Sin código postal no se sabe dónde acaba la calle: se propone entera.
    return { street: s.replace(/[,\s]+$/, ''), postalCode: null, city: null, province: null }
  }
  const cp = m[1]
  const antes = s.slice(0, m.index).replace(/[,\s\-–]+$/, '').trim()
  let despues = s.slice(m.index + 5).replace(/^[,\s\-–]+/, '').trim()

  // «Tres Cantos (Madrid)» → población «Tres Cantos»; la provincia, del CP.
  despues = despues.replace(/\s*\([^)]*\)\s*$/, '').trim()
  // «MADRID VALLECAS»: si la primera palabra es la provincia del CP y queda algo
  // detrás, lo de detrás es un barrio. La población es la de la provincia.
  const provincia = provinciaPorCp(cp)
  let ciudad = despues.split(',')[0].trim()
  if (provincia && ciudad.toUpperCase().startsWith(provincia.toUpperCase() + ' ')) ciudad = provincia

  return {
    street: antes === '' ? null : antes,
    postalCode: cp,
    city: ciudad === '' ? null : titulo(ciudad),
    province: provincia,
  }
}
