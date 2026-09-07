// src/modules/kitchen/lib/extrasDeCocina.ts
//
// La sección «Extras» (encargo del 07/09/2026). Aquí vive TODO el castellano de
// la pantalla y ninguna consulta.
//
// POR QUÉ SEPARADO. La RPC devuelve claves —`nada_puesto`, `mixto`,
// `puesto_pero_cero`— y ni una palabra de lo que se pinta. Es la lección de B83:
// el Resumen pintaba `price_impact > 0` en cursiva porque la frase venía de la
// base. Una definición técnica no se cuela en pantalla si nunca sale de allí.
//
// Y separado también para poder probarlo: una frase que cuenta mal —«7 copias
// en 3 marcas» cuando son 2— no la caza un build verde.

/** Lo que la RPC devuelve por cada nombre, ya en camelCase. */
export interface CopiaDelExtra {
  opcion: string
  marca: string
  marcaId: string | null
  grupo: string
  precio: number
  vendidas: number
  coste: number
  tieneCoste: boolean
}

export type EstadoDelExtra = 'nada_puesto' | 'puesto_pero_cero' | 'mixto' | 'con_coste'

export interface ExtraPorNombre {
  clave: string
  nombre: string
  copias: number
  marcas: number
  vendidas: number
  cobrado: number
  precioMin: number
  precioMax: number
  preciosDistintos: boolean
  estado: EstadoDelExtra
  costeYaPuesto: number | null
  marcaQueYaLoTiene: string | null
  donde: CopiaDelExtra[]
}

export interface CifrasDeExtras {
  cobran: number
  marcasQueCobran: number
  conCoste: number
  sinCoste: number
  nombres: number
  nombresSinCoste: number
  vendidosSinCoste: number
  vecesVendidos: number
  cobradoEur: number
}

// ── Cómo se ordena ──────────────────────────────────────────────────────────

export type OrdenDeExtras = 'vendido' | 'copias' | 'cobrado'

export const ORDENES: Array<{ clave: OrdenDeExtras; etiqueta: string }> = [
  { clave: 'vendido', etiqueta: 'Por lo vendido' },
  { clave: 'copias',  etiqueta: 'Por copias' },
  { clave: 'cobrado', etiqueta: 'Por lo cobrado' },
]

/**
 * Un extra «hay que arreglarlo» mientras no todas sus copias tengan coste. Los
 * mixtos entran: que una copia esté puesta no arregla las otras seis.
 */
export function hayQueArreglarlo(e: ExtraPorNombre): boolean {
  return e.estado !== 'con_coste'
}

export function ordena(filas: ExtraPorNombre[], orden: OrdenDeExtras): ExtraPorNombre[] {
  const copia = [...filas]
  copia.sort((a, b) => {
    if (orden === 'copias')  return b.copias - a.copias || b.vendidas - a.vendidas || a.clave.localeCompare(b.clave)
    if (orden === 'cobrado') return b.cobrado - a.cobrado || b.vendidas - a.vendidas || a.clave.localeCompare(b.clave)
    return b.vendidas - a.vendidas || b.copias - a.copias || a.clave.localeCompare(b.clave)
  })
  return copia
}

/**
 * La lista se parte en dos: lo que se vende va primero y entero; lo que no se ha
 * vendido en la ventana va debajo, plegado y contado.
 *
 * No es esconder (regla 7): la segunda mitad SE DICE, con su número y su
 * criterio, y se abre. Lo que hace el umbral es ordenar, no decidir quién
 * existe.
 */
export function parteEnDos(filas: ExtraPorNombre[]): { conVentas: ExtraPorNombre[]; sinVentas: ExtraPorNombre[] } {
  return {
    conVentas: filas.filter((f) => f.vendidas > 0),
    sinVentas: filas.filter((f) => f.vendidas === 0),
  }
}

// ── El castellano ───────────────────────────────────────────────────────────

const eur = (n: number) =>
  `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** «1 copia» · «2 en 1 marca» · «6 en 2 marcas». Tal cual la maqueta. */
export function cuantasCopias(e: ExtraPorNombre): string {
  if (e.copias === 1) return '1 copia'
  return `${e.copias} en ${e.marcas} ${e.marcas === 1 ? 'marca' : 'marcas'}`
}

/**
 * Lo que cobra. Si las copias no cobran lo mismo se enseña el rango, y eso
 * ABRE UNA PUERTA en vez de ser una nota al pie: «Tiras de Pollo Kentucky» está
 * a 1,90 € y a 6,50 € en tres marcas, y no son la misma cosa. Costearlas juntas
 * sería escribir un error en siete fichas.
 */
export function loQueCobra(e: ExtraPorNombre): { texto: string; esRango: boolean } {
  if (!e.preciosDistintos) return { texto: eur(e.precioMin), esRango: false }
  return {
    texto: `${e.precioMin.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} – ${eur(e.precioMax)}`,
    esRango: true,
  }
}

/** La pastilla de la columna «Qué lleva». */
export function queLleva(e: ExtraPorNombre): { texto: string; tono: 'rojo' | 'ambar' | 'verde' } {
  if (e.preciosDistintos && e.estado !== 'con_coste') return { texto: 'precios distintos', tono: 'rojo' }
  switch (e.estado) {
    case 'nada_puesto':      return { texto: 'nada puesto', tono: 'rojo' }
    case 'puesto_pero_cero': return { texto: 'puesto, pero vale 0 €', tono: 'rojo' }
    case 'mixto':            return { texto: 'sólo en algunas copias', tono: 'ambar' }
    case 'con_coste':        return { texto: 'ya dice lo que lleva', tono: 'verde' }
  }
}

/**
 * El botón de la fila. Con precios distintos NO se ofrece costear todo de
 * golpe: se eligen las copias (decisión 2 del §5).
 */
export function botonDeLaFila(e: ExtraPorNombre): string {
  return e.preciosDistintos ? 'Elegir copias' : 'Decir qué lleva'
}

/** El pie de la barra: «56 nombres · 100 copias · los 34 que se venden, primero». */
export function pieDeLaBarra(filas: ExtraPorNombre[]): string {
  const nombres = filas.length
  const copias = filas.reduce((s, f) => s + f.copias, 0)
  const conVentas = filas.filter((f) => f.vendidas > 0).length
  return `${nombres} ${nombres === 1 ? 'nombre' : 'nombres'} · ${copias} ${copias === 1 ? 'copia' : 'copias'}`
       + ` · ${conVentas === 1 ? 'el que se vende' : `los ${conVentas} que se venden`}, primero`
}

/** La cabecera del pliegue de abajo. */
export function tituloDelPliegue(sinVentas: ExtraPorNombre[]): string {
  const n = sinVentas.length
  return n === 1 ? 'y 1 extra más sin coste' : `y ${n} extras más sin coste`
}

/**
 * Lo que dice la confirmación después de guardar. Con CONTENIDO, no un visto
 * (regla 8): qué lleva, cuánto cuesta, a cuántas copias ha ido y en qué marcas.
 */
export function confirmacion(args: {
  nombre: string
  queLleva: string
  coste: number
  copias: CopiaDelExtra[]
  sinCosteDespues: number
}): string {
  const porMarca = new Map<string, number>()
  for (const c of args.copias) porMarca.set(c.marca, (porMarca.get(c.marca) ?? 0) + 1)
  const marcas = [...porMarca.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([m, n]) => `${m} (${n})`)
    .join(', ')
  const n = args.copias.length
  return `${args.nombre} lleva ${args.queLleva}: ${eur(args.coste)}.`
       + ` Aplicado a ${n} ${n === 1 ? 'copia' : 'copias'} en ${porMarca.size} ${porMarca.size === 1 ? 'marca' : 'marcas'}: ${marcas}.`
       + ` Sin coste quedan ${args.sinCosteDespues}.`
}
