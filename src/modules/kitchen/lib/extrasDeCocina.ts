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
/** Un plato donde el cliente ve este extra, con su id para poder abrirlo. */
export interface PlatoDeLaCopia { id: string; nombre: string }

export interface CopiaDelExtra {
  opcion: string
  marca: string
  marcaId: string | null
  grupo: string
  precio: number
  vendidas: number
  coste: number
  tieneCoste: boolean
  /**
   * Los platos donde aparece (B84.5). Vacío mientras la consulta no los mande:
   * entonces se pinta el grupo, como antes, en vez de mentir con una lista vacía.
   */
  platos: PlatoDeLaCopia[]
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
 * La misma cuenta, con la palabra puesta: «7 copias en 2 marcas».
 *
 * En la tabla la columna se titula COPIAS y el número no necesita repetirlo; en
 * el título del flujo no hay columna que lo diga, y «Salsa Yogur · 7 en 2
 * marcas» deja al que mira preguntándose 7 qué. La maqueta lo escribe así en
 * los dos sitios y por eso son dos frases, no una con un parámetro.
 */
export function cuantasCopiasEnElTitulo(e: ExtraPorNombre): string {
  if (e.copias === 1) return '1 copia'
  return `${e.copias} copias en ${e.marcas} ${e.marcas === 1 ? 'marca' : 'marcas'}`
}

/**
 * «3 copias», sin marcas: es lo que va en el título de la PUERTA, donde cada
 * fila lleva su marca escrita al lado. Repetir «en 3 marcas» arriba sería decir
 * dos veces lo que ya se está viendo.
 */
export function soloCopias(e: ExtraPorNombre): string {
  return e.copias === 1 ? '1 copia' : `${e.copias} copias`
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

/**
 * DÓNDE APARECE UNA COPIA, dicho para una persona (B84.5).
 *
 * El grupo NO dice dónde: «Algun extra en tu pita?» son cuatro copias de The
 * Urban Kebab y cuatro platos distintos —Falafel, Pollo, Ternera y Mixto—, y la
 * pantalla pintaba cuatro líneas idénticas. El botón se llama «Ver dónde».
 *
 *  · un plato   → el plato, y el grupo detrás en pequeño
 *  · varios     → «15 platos» y el grupo; la lista se abre debajo
 *  · ninguno    → el grupo solo, que es todo lo que se sabe (la consulta vieja
 *                 no manda platos, y una lista vacía no se inventa)
 */
export function dondeApareceLaCopia(c: CopiaDelExtra): { principal: string; secundario: string } {
  const n = c.platos?.length ?? 0
  if (n === 0) return { principal: `«${c.grupo}»`, secundario: c.marca }
  if (n === 1) return { principal: c.platos[0].nombre, secundario: `${c.marca} · «${c.grupo}»` }
  return { principal: `${n} platos`, secundario: `${c.marca} · «${c.grupo}»` }
}

/**
 * LAS MARCAS DE LA FILA, en el mismo orden que la frase del panel: alfabético.
 *
 * (B84.6) La fila decía «The Urban Kebab · Meraki Pita» y el panel «Meraki Pita
 * (3) y The Urban Kebab (4)» para el mismo extra. Dos órdenes distintos para lo
 * mismo obligan a releer para comprobar que hablan del mismo sitio.
 */
export function marcasDeLaFila(e: ExtraPorNombre): string {
  return [...new Set(e.donde.map((d) => d.marca))].sort((a, b) => a.localeCompare(b, 'es')).join(' · ')
}

/**
 * LO QUE HAY QUE DECIR CUANDO UNA FICHA NO TIENE PRECIO (B84.3).
 *
 * Sin esto, elegir un ingrediente sin coste daba «0,00 €» y «Guardar» activo: se
 * escribían siete impactos que dejaban el extra en «puesto, pero vale 0 €» —peor
 * que no haberlo tocado, porque ahora parece hecho—. Es la regla 3 de arriba
 * («computed_cost = 0 tapa el fixed_cost real») vista desde la pantalla: un cero
 * que no es una medida, es una ficha sin rellenar.
 *
 * Devuelve `null` cuando no hay nada que avisar. Nombra la ficha —no «un
 * ingrediente»— porque el que mira tiene que saber cuál ir a arreglar.
 */
export function fichasSinPrecio<T extends { id: string; name: string; costeUnitario?: number | null }>(
  cosas: Array<{ ficha: string }>,
  catalogo: T[],
): T[] {
  const porId = new Map(catalogo.map((c) => [c.id, c]))
  const fuera: T[] = []
  for (const c of cosas) {
    const f = porId.get(c.ficha)
    if (f && !f.costeUnitario) fuera.push(f)   // null, undefined o 0: no hay precio
  }
  return fuera
}

/** «Yogurt Griego no tiene precio puesto» · «Yogurt Griego y Pan de pita no tienen precio puesto». */
export function avisoDeSinPrecio(fichas: Array<{ name: string }>): string | null {
  if (fichas.length === 0) return null
  const nombres = fichas.map((f) => f.name)
  const lista = nombres.length === 1
    ? nombres[0]
    : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
  return `${lista} ${nombres.length === 1 ? 'no tiene' : 'no tienen'} precio puesto`
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
  // Alfabético, como la maqueta. Ordenar por número haría que la misma frase
  // cambiara de orden al añadir una copia, y no dice nada que el número no diga.
  const marcas = [...porMarca.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'es'))
    .map(([m, n]) => `${m} (${n})`)
    .join(', ')
  const n = args.copias.length
  return `${args.nombre} lleva ${args.queLleva}: ${eur(args.coste)}.`
       + ` Aplicado a ${n} ${n === 1 ? 'copia' : 'copias'} en ${porMarca.size} ${porMarca.size === 1 ? 'marca' : 'marcas'}: ${marcas}.`
       + ` Sin coste quedan ${args.sinCosteDespues}.`
}

// ── LA PUERTA DE LAS COPIAS ────────────────────────────────────────────────
//
// Cuando las copias no cobran lo mismo puede que no sean la misma cosa, y ahí
// no se costea a ciegas: se eligen (decisión 2 del §5). El caso que lo obliga
// es real — «Tiras de Pollo Kentucky» está a 1,90 € en dos marcas y a 6,50 € en
// una tercera: la de 6,50 € es una ración entera, no un añadido. Ponerles el
// mismo coste sería escribir un error en tres fichas.

/**
 * Las que vienen marcadas: las que cobran lo mismo que la copia que MÁS SE
 * VENDE. No es el precio más bajo ni el más repetido — es el de la copia que
 * de verdad mueve dinero, que es la que define de qué estamos hablando.
 */
export function copiasPreseleccionadas(e: ExtraPorNombre): string[] {
  if (e.donde.length === 0) return []
  const patron = [...e.donde].sort(
    (a, b) => b.vendidas - a.vendidas || a.precio - b.precio,
  )[0]
  return e.donde.filter((c) => c.precio === patron.precio).map((c) => c.opcion)
}

/**
 * La frase que explica por qué una copia se queda fuera. Se dice: dejarla
 * desmarcada sin decir por qué es esconder una decisión (regla 8).
 */
export function porQueSeQuedaFuera(e: ExtraPorNombre, c: CopiaDelExtra): string | null {
  const marcadas = copiasPreseleccionadas(e)
  if (marcadas.includes(c.opcion)) return null
  const eur2 = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `La de ${c.marca} a ${eur2(c.precio)} € parece otra cosa. Se queda fuera y aparece como extra aparte.`
}

/**
 * ¿EXISTE YA UN PLATO QUE SE LLAMA IGUAL QUE ESTE EXTRA?
 *
 * Cuando lo hay, decirlo ahorra teclear un escandallo que ya está hecho y evita
 * el error de costear a mano lo que la cocina ya tiene medido. En Foodint pasa
 * en OCHO extras el 07/09 — «La Triple» (4,00 €), «Truffled Smash» (3,25 €),
 * «Bocadillo César» (2,92 €)…—: son platos enteros que se venden también como
 * añadido, que es justo el `bundle` de la decisión 5 del §5.
 *
 * Se compara por nombre normalizado y SÓLO dentro del catálogo que llega, que ya
 * viene de la cuenta (regla 9). Devuelve `null` cuando no hay ninguno: entonces
 * no se pinta nada, que es lo que pasa con «Salsa Yogur».
 */
export function platoDelMismoNombre<T extends { name: string; kind: 'plato' | 'ingrediente' }>(
  nombreDelExtra: string,
  catalogo: T[],
  normaliza: (s: string) => string,
): T | null {
  const q = normaliza(nombreDelExtra)
  return catalogo.find((c) => c.kind === 'plato' && normaliza(c.name) === q) ?? null
}

/** Cuántas copias van a recibirlo, para el botón: «Guardar en las 7 copias». */
export function textoDeGuardar(cuantas: number): string {
  return cuantas === 1 ? 'Guardar en la copia' : `Guardar en las ${cuantas} copias`
}

/** Lo que lleva un extra, tal y como se teclea antes de guardarlo. */
export interface CosaQueLleva {
  ficha: string
  nombreFicha: string
  tipo: 'plato' | 'ingrediente'
  cantidad: number | null
  unidad: string | null
  nombreUnidad: string
}

/**
 * La frase de lo que lleva, en castellano y sin jerga (línea 5 del patrón):
 * «40 g de yogur griego», «una ración de Salsa Yogur». Ni `add_item` ni
 * `bundle` salen nunca de aquí.
 */
export function frasedeLoQueLleva(cosas: CosaQueLleva[]): string {
  const trozos = cosas.map((c) => {
    if (c.tipo === 'plato') {
      return c.cantidad && c.cantidad !== 1
        ? `${c.cantidad} raciones de ${c.nombreFicha}`
        : `una ración de ${c.nombreFicha}`
    }
    const cant = c.cantidad ?? 0
    return `${cant.toLocaleString('es-ES')} ${c.nombreUnidad} de ${c.nombreFicha}`
  })
  if (trozos.length <= 1) return trozos[0] ?? ''
  return `${trozos.slice(0, -1).join(', ')} y ${trozos[trozos.length - 1]}`
}

/**
 * QUÉ DÍAS SE ESTÁ VIENDO, con las fechas puestas: «vendido del 9 de agosto al
 * 7 de septiembre». «Los últimos 30 días» obliga a hacer la cuenta de cabeza y
 * no dice desde cuándo, que es lo que hace falta para juzgar un número de
 * ventas.
 *
 * UN SOLO RELOJ. Las dos fechas las manda la consulta (`ventana_desde` y
 * `ventana_hasta`): son los días que ha contado de verdad, en el calendario de
 * Madrid. Aquí no se calcula ninguna, sólo se escriben. Sacarlas de «medido a
 * las 15:00, menos 30 días» prometía días enteros mientras la consulta contaba
 * desde ayer a las 15:00: dos relojes, y el que se leía no era el que contaba.
 *
 * Dos detalles al pasarlas a texto, y los dos cambian lo que dice:
 *  · SE LEEN COMO FECHA DE CALENDARIO, a mano. `new Date('2026-08-09')` es
 *    medianoche UTC, que al oeste de Greenwich cae en el día 8.
 *  · EL LÍMITE DE ARRIBA ES EXCLUSIVO en `intervaloDeFechas`, así que para que
 *    el último día entre en la frase hay que pasarle la medianoche siguiente.
 *
 * Devuelve `null` si falta o no se entiende alguna de las dos: una cabecera sin
 * fechas se pinta, no revienta (B82).
 */
function diaDeCalendario(iso: string | null): Date | null {
  if (!iso) return null
  const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!p) return null
  const anio = Number(p[1]); const mes = Number(p[2]); const dia = Number(p[3])
  const d = new Date(anio, mes - 1, dia)
  // `new Date(2026, 12, 40)` no falla: se desborda a otro mes. Un 13 o un 32 es
  // una fecha que no existe, no una fecha que rueda.
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null
  return d
}

export function ventanaEnCastellano(
  ventanaDesde: string | null,
  ventanaHasta: string | null,
  intervaloDeFechas: (d: Date, h: Date, o?: { minuscula?: boolean }) => string | null,
): string | null {
  const desde = diaDeCalendario(ventanaDesde)
  const hasta = diaDeCalendario(ventanaHasta)
  if (!desde || !hasta) return null
  const finExclusivo = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate() + 1)
  const t = intervaloDeFechas(desde, finExclusivo, { minuscula: true })
  return t ? `vendido ${t}` : null
}
