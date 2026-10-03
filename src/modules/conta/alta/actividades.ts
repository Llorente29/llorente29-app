// src/modules/conta/alta/actividades.ts
//
// Del «a qué os dedicáis», con las palabras de la persona, a QUÉ BUSCAR en
// los catálogos oficiales (IAE y CNAE-2025). Encargo C00 §6.4: la IA nunca
// inventa un epígrafe; solo elige entre lo que hay en las tablas.
//
// Esto no da epígrafes: da términos de búsqueda. Los epígrafes salen de la
// base (iae_heading, cnae_code) y la persona marca o desmarca. Si no sale
// nada, se dice y se deja buscar a mano.
//
// Cómo se eligieron los términos: medidos en staging-conta contra los títulos
// cargados (03/10). «pan» suelto se descarta: encuentra también «paneles».
// Puro: se prueba sin base.

export interface Grupo {
  /** Clave estable (para no proponer dos veces lo mismo). */
  clave: string
  /** Cómo se llamará la actividad: «Restaurante», «Comida a domicilio». */
  descripcion: string
  /** Lo que dijo la persona que lo activó. */
  porLaPalabra: string
  /** Trozos de título a buscar en el IAE (sección 1: empresariales). */
  iae: string[]
  /** Trozos de título a buscar en la CNAE-2025 (clases de cuatro cifras). */
  cnae: string[]
}

const GRUPOS: { clave: string; descripcion: string; palabras: string[]; iae: string[]; cnae: string[] }[] = [
  { clave: 'restaurante', descripcion: 'Restaurante', palabras: ['restaurante', 'restaurantes', 'comidas', 'menu', 'menus', 'casa de comidas'],
    iae: ['restaurantes'], cnae: ['Restaurantes'] },
  { clave: 'bar', descripcion: 'Bar o cafetería', palabras: ['bar', 'bares', 'cafeteria', 'cafeterias', 'cafe', 'cafes', 'copas', 'cerveceria', 'tapas'],
    iae: ['cafés y bares', 'cafeterías'], cnae: ['Servicios de bebidas'] },
  { clave: 'domicilio', descripcion: 'Comida a domicilio', palabras: ['domicilio', 'reparto', 'repartimos', 'repartir', 'delivery', 'envio', 'envios', 'para llevar'],
    iae: ['propios de la restauración', 'fuera de dichos'], cnae: ['Restaurantes'] },
  { clave: 'catering', descripcion: 'Catering', palabras: ['catering', 'eventos', 'banquetes'],
    iae: [], cnae: ['catering'] },
  { clave: 'heladeria', descripcion: 'Heladería', palabras: ['heladeria', 'helados', 'chocolateria', 'horchateria'],
    iae: ['heladerías'], cnae: [] },
  { clave: 'alojamiento', descripcion: 'Alojamiento', palabras: ['hotel', 'hoteles', 'hostal', 'alojamiento', 'hospedaje'],
    iae: ['hoteles'], cnae: ['Hoteles'] },
  { clave: 'panaderia', descripcion: 'Panadería', palabras: ['panaderia', 'pasteleria', 'bolleria', 'obrador'],
    iae: ['Despachos de pan', 'Industria del pan'], cnae: ['productos de panadería'] },
]

const VACIAS = new Set(['tambien', 'nosotros', 'somos', 'tenemos', 'hacemos', 'nuestro', 'nuestra', 'sobre', 'todo', 'para',
  'como', 'pero', 'desde', 'hasta', 'mucho', 'poco', 'tipo', 'cosas', 'local', 'negocio', 'empresa', 'dedicamos'])

/** Minúsculas y sin tildes: «Cafetería» → «cafeteria». */
export const normalizar = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Los grupos que activa lo que escribió la persona, en el orden en que lo dijo.
 * Lo que no encaja en ningún grupo y es una palabra con sentido (cinco letras o
 * más) se busca tal cual: puede que esté en el catálogo.
 */
export function gruposDe(texto: string): Grupo[] {
  const t = ` ${normalizar(texto).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ')} `
  const encontrados: { pos: number; g: Grupo }[] = []
  const usadas = new Set<string>()
  for (const g of GRUPOS) {
    let mejor: { pos: number; palabra: string } | null = null
    for (const p of g.palabras) {
      const pos = t.indexOf(` ${p} `)
      if (pos >= 0 && (mejor === null || pos < mejor.pos)) mejor = { pos, palabra: p }
    }
    if (mejor) {
      encontrados.push({ pos: mejor.pos, g: { clave: g.clave, descripcion: g.descripcion, porLaPalabra: mejor.palabra, iae: g.iae, cnae: g.cnae } })
      for (const p of g.palabras) for (const w of p.split(' ')) usadas.add(w)
    }
  }
  for (const w of t.trim().split(' ')) {
    if (w.length < 5 || VACIAS.has(w) || usadas.has(w)) continue
    usadas.add(w)
    encontrados.push({ pos: t.indexOf(` ${w} `), g: { clave: `palabra:${w}`, descripcion: w.charAt(0).toUpperCase() + w.slice(1), porLaPalabra: w, iae: [w], cnae: [w] } })
  }
  return encontrados.sort((a, b) => a.pos - b.pos).map((e) => e.g)
}

export interface Encontrado { code: string; title: string; level?: string }

export interface PropuestaActividad {
  clave: string
  descripcion: string
  porLaPalabra: string
  iae: Encontrado | null
  cnae: Encontrado | null
}

/**
 * Lo que se le propone a la persona, a partir de lo que devolvió la base para
 * cada término de cada grupo (en el orden de los términos). Manda el primer
 * término que encontró algo; dentro de él, mejor un grupo de tres cifras que
 * un epígrafe suelto. Si un grupo no encontró nada en ninguno de los dos
 * catálogos, no se propone: no hay nada que proponer.
 */
export function proponer(grupos: Grupo[], encontrado: Map<string, { iae: Encontrado[][]; cnae: Encontrado[][] }>): PropuestaActividad[] {
  const primero = (porTermino: Encontrado[][]): Encontrado | null => {
    const lista = porTermino.find((l) => l.length > 0)
    if (!lista) return null
    return lista.find((e) => e.level === 'grupo') ?? lista[0]
  }
  const out: PropuestaActividad[] = []
  for (const g of grupos) {
    const r = encontrado.get(g.clave)
    if (!r) continue
    const iae = primero(r.iae)
    const cnae = primero(r.cnae)
    if (!iae && !cnae) continue
    out.push({ clave: g.clave, descripcion: g.descripcion, porLaPalabra: g.porLaPalabra, iae, cnae })
  }
  return out
}
