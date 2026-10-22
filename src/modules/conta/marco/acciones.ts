// src/modules/conta/marco/acciones.ts
//
// S02 · Las acciones de una página, repartidas con la regla del patrón
// (encargo S02, «Encabezado de cada página»):
//   · UN solo botón principal, azul;
//   · como mucho dos botones blancos más;
//   · lo demás, en «Más acciones ▾», con el título de su grupo DENTRO del menú
//     (se acabaron las etiquetas sueltas debajo de los botones);
//   · lo que no son acciones sino a dónde ir dentro de la página (un grupo
//     `ver`: los libros, las tablas) sale como un selector «Ver: … ▾», y un
//     grupo de la pantalla que marca cuál es el actual (los bancos), como
//     «<grupo>: … ▾».
// Núcleo puro: se prueba sin React (tests/unit/modules/conta/s02/marco.test.ts).

/** Una acción ya resuelta: a dónde lleva (absoluta) o qué hace. */
export interface Accion {
  id: string
  etiqueta: string
  a?: string
  alPulsar?: () => void
  /** Su número (las dudas de un banco, las reglas). */
  numero?: number
  /** El punto ámbar: pide algo. */
  aviso?: boolean
  /** Lo que dice al pasar el ratón y al lector. */
  dato?: string
  /** Es la que se está viendo (en un selector). */
  actual?: boolean
  principal?: boolean
  /** El grupo del que viene (su título va dentro de «Más acciones»). */
  grupo: string
}

export interface GrupoDeAcciones {
  titulo: string
  acciones: Accion[]
  /** A dónde ir dentro de la página, no acciones. */
  ver?: boolean
}

export interface Selector {
  /** «Ver» o el título del grupo («Tus bancos»). */
  titulo: string
  actual: Accion | null
  opciones: GrupoDeAcciones[]
}

export interface AccionesRepartidas {
  principal: Accion | null
  blancos: Accion[]
  mas: GrupoDeAcciones[]
  selectores: Selector[]
}

/** Cuántos botones blancos caben al lado del principal. */
export const BLANCOS = 2

/**
 * Reparte los grupos de una página. `conPropias`: la página ya pinta sus
 * botones (su encabezado o su barra): entonces todo lo del catálogo va a
 * «Más acciones», para no salir dos veces ni competir con su principal.
 */
export function repartirAcciones(grupos: readonly GrupoDeAcciones[], conPropias = false): AccionesRepartidas {
  const selectores: Selector[] = []
  const ver = grupos.filter((g) => g.ver && g.acciones.length > 0)
  if (ver.length > 0) {
    const todas = ver.flatMap((g) => g.acciones)
    selectores.push({ titulo: 'Ver', actual: todas.find((a) => a.actual) ?? null, opciones: ver })
  }
  const resto = grupos.filter((g) => !g.ver)
  // Un grupo de la pantalla en el que una entrada es la actual (los bancos) es un selector.
  for (const g of resto) {
    if (g.acciones.length > 0 && g.acciones.some((a) => a.actual === true)) {
      selectores.push({ titulo: g.titulo, actual: g.acciones.find((a) => a.actual) ?? null, opciones: [g] })
    }
  }
  const deAccion = resto.filter((g) => !selectores.some((s) => s.opciones.includes(g)))
  const todas = deAccion.flatMap((g) => g.acciones)
  if (conPropias) {
    return { principal: null, blancos: [], mas: deAccion.filter((g) => g.acciones.length > 0), selectores }
  }
  const principal = todas.find((a) => a.principal) ?? null
  const blancos = todas.filter((a) => a !== principal).slice(0, BLANCOS)
  const fuera = new Set<Accion>([...(principal ? [principal] : []), ...blancos])
  const mas = deAccion
    .map((g) => ({ ...g, acciones: g.acciones.filter((a) => !fuera.has(a)) }))
    .filter((g) => g.acciones.length > 0)
  return { principal, blancos, mas, selectores }
}

/** ¿Hay algo que pintar? */
export const hayAcciones = (r: AccionesRepartidas): boolean =>
  !!r.principal || r.blancos.length > 0 || r.mas.length > 0 || r.selectores.length > 0
