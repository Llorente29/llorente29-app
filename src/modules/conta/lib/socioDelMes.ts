// src/modules/conta/lib/socioDelMes.ts
//
// V01 · Entrega 3 · La liquidación mensual del socio de marca (CTB), como la
// dejó Julio el 24/10 (opción A):
//
//   1. Los albaranes de los proveedores que facturan al socio NO se
//      contabilizan: se guardan como soporte, por mes y por local.
//   2. Su factura de compra del mes (FV) se apunta a la 600 tal cual.
//   3. Los albaranes del mes se comparan con la columna «Compras» de su
//      «Relación Compras y Ventas», producto a producto, en CANTIDAD y en
//      PRECIO: tienen que coincidir. Si no, se dice qué productos no casan, con
//      su diferencia de cantidad o de precio.
//   4. La AF (705), la compensación y el cobro, como hoy.
//
// Aquí, lo del punto 3, sin React y con sus pruebas (contra las líneas reales
// de los albaranes de CTB de Foodint, regla 31).
//
// Cómo se casa un producto de la Relación con lo que traen los albaranes: por
// el artículo. El de la Relación lo da lo casado a mano (settlement_product_match,
// «¿Cuál es cuál?»); si no lo hay, el artículo de los albaranes que se llama
// igual (sin tildes, mayúsculas ni signos), por su nombre o por el del producto
// en el albarán. Se busca solo entre los artículos de los albaranes del mes: es
// la lista contra la que se compara (regla 30).
//
// Las cantidades, en la unidad de la Relación (Kg, Lt o Uni): los albaranes
// traen la cantidad en la unidad base del artículo (g, ml o ud). El precio de
// los albaranes es su importe entre su cantidad. Coinciden si la cantidad
// difiere en menos de 0,005 (la Relación da dos decimales) y el precio en un
// céntimo o menos.
//
// Nada se esconde (regla 7): todo producto de la Relación con compras y todo
// artículo de los albaranes sale en el cruce; lo que no casa, primero.

import { eurosExactos } from './formato'

/** Una fila de la Relación (lector de la liquidación: nombre, precio, compras, unidad). */
export interface ProductoRelacion { nombre: string; precio: number; compras: number; unidad: string }

/** Lo casado a mano de un producto de la Relación (compras_liquidacion_productos). */
export interface CasadoAMano { nombre: string; articulo: string | null; noEsNuestro: boolean }

export type Dimension = 'weight' | 'volume' | 'unit'

/** Una línea de un albarán del mes (en la unidad base del artículo: g, ml o ud). */
export interface LineaAlbaran {
  albaran: string | null
  articulo: string | null
  articuloNombre: string | null
  producto: string | null
  dimension: Dimension | null
  /** g, ml o ud; null si la línea no dice cuánto. */
  cantidadBase: number | null
  importe: number | null
}

export type EstadoProducto = 'coincide' | 'cantidad' | 'precio' | 'cantidad-y-precio' | 'sin-albaran' | 'sin-casar' | 'no-es-nuestro' | 'unidad-distinta' | 'incompleto' | 'sobra'

export interface FilaCruce {
  nombre: string
  /** Kg, Lt o Uni: la unidad de la Relación (para lo que sobra, la del artículo). */
  unidad: string
  estado: EstadoProducto
  relacion: { cantidad: number; precio: number } | null
  albaranes: { cantidad: number | null; precio: number | null; importe: number; lineas: number; albaranes: string[] } | null
  /** Albaranes − Relación. */
  difCantidad: number | null
  difPrecio: number | null
  texto: string
}

export interface CruceRelacion {
  estado: 'coincide' | 'no-coincide' | 'sin-relacion' | 'sin-albaranes'
  filas: FilaCruce[]
  coinciden: number
  noCasan: number
  texto: string
}

const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000
const cent = (x: number) => Math.round(x * 100)

/** «Calle», «CALLE», «cálle!» → «calle». */
export const nombreNorm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** La unidad de la Relación: su dimensión y cuántas unidades base (g, ml, ud) es una. */
export function unidadRelacion(u: string): { dimension: Dimension; factor: number } {
  switch (nombreNorm(u)) {
    case 'kg': case 'kgs': case 'kilo': case 'kilos': return { dimension: 'weight', factor: 1000 }
    case 'g': case 'gr': case 'grs': return { dimension: 'weight', factor: 1 }
    case 'lt': case 'l': case 'litro': case 'litros': return { dimension: 'volume', factor: 1000 }
    case 'ml': return { dimension: 'volume', factor: 1 }
    default: return { dimension: 'unit', factor: 1 }
  }
}

const UNIDAD_DE: Record<Dimension, string> = { weight: 'Kg', volume: 'Lt', unit: 'Uni' }
const FACTOR_DE: Record<Dimension, number> = { weight: 1000, volume: 1000, unit: 1 }

const num = (x: number, d = 2) => x.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: d })
const conSigno = (x: number, d = 2) => `${x > 0 ? '+' : ''}${num(x, d)}`
const precioTxt = (x: number, u: string) => `${eurosExactos(x)}/${u}`

interface Grupo { articulo: string; nombre: string; productos: Set<string>; dimension: Dimension | null; cantidad: number; importe: number; lineas: number; sinCantidad: number; albaranes: Set<string> }

export function cruzarConRelacion(relacion: readonly ProductoRelacion[] | null, casados: readonly CasadoAMano[], lineas: readonly LineaAlbaran[]): CruceRelacion {
  // Los albaranes, por artículo.
  const grupos = new Map<string, Grupo>()
  for (const l of lineas) {
    const clave = l.articulo ?? `producto:${nombreNorm(l.producto)}`
    const g = grupos.get(clave) ?? { articulo: clave, nombre: l.articuloNombre ?? l.producto ?? 'Sin artículo', productos: new Set<string>(), dimension: l.dimension, cantidad: 0, importe: 0, lineas: 0, sinCantidad: 0, albaranes: new Set<string>() }
    if (l.producto) g.productos.add(l.producto)
    if (l.albaran) g.albaranes.add(l.albaran)
    g.lineas += 1
    g.importe += l.importe ?? 0
    if (l.cantidadBase == null || l.dimension == null) g.sinCantidad += 1
    else g.cantidad += l.cantidadBase
    grupos.set(clave, g)
  }
  if (!relacion) {
    return { estado: 'sin-relacion', filas: [], coinciden: 0, noCasan: 0,
      texto: `Aún no está su «Relación Compras y Ventas»: sin ella no se pueden comparar los albaranes (${lineas.length} ${lineas.length === 1 ? 'línea' : 'líneas'} en ${new Set(lineas.map((l) => l.albaran)).size} albaranes).` }
  }

  const porNombre = new Map(casados.map((c) => [nombreNorm(c.nombre), c]))
  const porNombreArticulo = new Map<string, string>()
  for (const g of grupos.values()) {
    porNombreArticulo.set(nombreNorm(g.nombre), g.articulo)
    for (const p of g.productos) if (!porNombreArticulo.has(nombreNorm(p))) porNombreArticulo.set(nombreNorm(p), g.articulo)
  }

  const filas: FilaCruce[] = []
  const usados = new Set<string>()
  for (const p of relacion) {
    const u = unidadRelacion(p.unidad)
    const mano = porNombre.get(nombreNorm(p.nombre))
    const rel = { cantidad: p.compras, precio: p.precio }
    if (mano?.noEsNuestro) {
      filas.push({ nombre: p.nombre, unidad: p.unidad, estado: 'no-es-nuestro', relacion: rel, albaranes: null, difCantidad: null, difPrecio: null, texto: 'Marcado como que no es nuestro: no se compara.' })
      continue
    }
    const art = mano?.articulo ?? porNombreArticulo.get(nombreNorm(p.nombre)) ?? null
    const g = art ? grupos.get(art) : undefined
    if (art && g) usados.add(art)
    if (!g) {
      if (p.compras === 0) continue // Sin compras en la Relación ni en los albaranes: no es una compra del mes.
      filas.push({ nombre: p.nombre, unidad: p.unidad, estado: art ? 'sin-albaran' : 'sin-casar', relacion: rel, albaranes: null, difCantidad: -p.compras, difPrecio: null,
        texto: art
          ? `La Relación dice ${num(p.compras)} ${p.unidad} comprados y ningún albarán del mes lo trae.`
          : `La Relación dice ${num(p.compras)} ${p.unidad} comprados y no sé qué artículo es: cásalo en «¿Cuál es cuál?».` })
      continue
    }
    const alb = { cantidad: null as number | null, precio: null as number | null, importe: r2(g.importe), lineas: g.lineas, albaranes: [...g.albaranes].sort() }
    if (g.dimension && g.dimension !== u.dimension) {
      filas.push({ nombre: p.nombre, unidad: p.unidad, estado: 'unidad-distinta', relacion: rel, albaranes: alb, difCantidad: null, difPrecio: null,
        texto: `La Relación lo cuenta en ${p.unidad} y el artículo «${g.nombre}» en ${UNIDAD_DE[g.dimension]}: no se puede comparar la cantidad. Revisa la unidad del artículo.` })
      continue
    }
    alb.cantidad = r3(g.cantidad / u.factor)
    alb.precio = alb.cantidad > 0 ? r2(g.importe / alb.cantidad) : null
    if (g.sinCantidad > 0) {
      filas.push({ nombre: p.nombre, unidad: p.unidad, estado: 'incompleto', relacion: rel, albaranes: alb, difCantidad: null, difPrecio: null,
        texto: `${g.sinCantidad === 1 ? 'Una línea' : `${g.sinCantidad} líneas`} de sus albaranes no ${g.sinCantidad === 1 ? 'dice' : 'dicen'} la cantidad: no se puede comparar. Complétala en el albarán.` })
      continue
    }
    const difCantidad = r3(alb.cantidad - p.compras)
    const difPrecio = alb.precio == null ? null : r2(alb.precio - p.precio)
    const malCantidad = Math.abs(difCantidad) >= 0.005
    const malPrecio = difPrecio != null && Math.abs(cent(difPrecio)) > 1
    const estado: EstadoProducto = malCantidad && malPrecio ? 'cantidad-y-precio' : malCantidad ? 'cantidad' : malPrecio ? 'precio' : 'coincide'
    const partes: string[] = []
    if (malCantidad) partes.push(`cantidad: los albaranes traen ${num(alb.cantidad, 3)} ${p.unidad} y la Relación ${num(p.compras)} (${conSigno(difCantidad, 3)})`)
    if (malPrecio) partes.push(`precio: ${precioTxt(alb.precio!, p.unidad)} en los albaranes y ${precioTxt(p.precio, p.unidad)} en la Relación (${conSigno(difPrecio!)} €)`)
    filas.push({ nombre: p.nombre, unidad: p.unidad, estado, relacion: rel, albaranes: alb, difCantidad, difPrecio,
      texto: partes.length ? `No casa en ${partes.join('; y en ')}.` : 'Coincide en cantidad y en precio.' })
  }

  // Lo que traen los albaranes y la Relación no compra: sobra.
  for (const g of grupos.values()) {
    if (usados.has(g.articulo)) continue
    const unidad = g.dimension ? UNIDAD_DE[g.dimension] : 'Uni'
    const cantidad = g.dimension ? r3(g.cantidad / FACTOR_DE[g.dimension]) : null
    filas.push({ nombre: g.nombre, unidad, estado: 'sobra', relacion: null,
      albaranes: { cantidad, precio: cantidad && cantidad > 0 ? r2(g.importe / cantidad) : null, importe: r2(g.importe), lineas: g.lineas, albaranes: [...g.albaranes].sort() },
      difCantidad: cantidad, difPrecio: null,
      texto: `Los albaranes traen ${cantidad == null ? `${g.lineas} ${g.lineas === 1 ? 'línea' : 'líneas'}` : `${num(cantidad, 3)} ${unidad}`} (${eurosExactos(r2(g.importe))}) y la Relación no lo compra${g.productos.size ? ` (${[...g.productos].slice(0, 2).join(', ')})` : ''}.` })
  }

  const ORDEN: Record<EstadoProducto, number> = { 'cantidad-y-precio': 0, cantidad: 1, precio: 2, sobra: 3, 'sin-albaran': 4, 'sin-casar': 5, 'unidad-distinta': 6, incompleto: 7, coincide: 8, 'no-es-nuestro': 9 }
  filas.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.nombre.localeCompare(b.nombre, 'es'))
  const coinciden = filas.filter((f) => f.estado === 'coincide').length
  const noCasan = filas.filter((f) => f.estado !== 'coincide' && f.estado !== 'no-es-nuestro').length
  if (lineas.length === 0) {
    return { estado: 'sin-albaranes', filas, coinciden, noCasan,
      texto: `Ningún albarán del mes trae líneas de producto, y la Relación dice que compraste ${noCasan} ${noCasan === 1 ? 'producto' : 'productos'}: no casan.` }
  }
  return {
    estado: noCasan === 0 ? 'coincide' : 'no-coincide', filas, coinciden, noCasan,
    texto: noCasan === 0
      ? `Los albaranes del mes coinciden con la Relación Compras y Ventas: ${coinciden} ${coinciden === 1 ? 'producto' : 'productos'}, en cantidad y en precio.`
      : `Algo está mal: ${noCasan} ${noCasan === 1 ? 'producto no casa' : 'productos no casan'} entre los albaranes del mes y la Relación Compras y Ventas${coinciden ? ` (${coinciden} sí)` : ''}.`,
  }
}

export const NOMBRE_ESTADO_PRODUCTO: Record<EstadoProducto, string> = {
  coincide: 'Coincide', cantidad: 'Cantidad', precio: 'Precio', 'cantidad-y-precio': 'Cantidad y precio', 'sin-albaran': 'Sin albarán',
  'sin-casar': 'Sin casar', 'no-es-nuestro': 'No es nuestro', 'unidad-distinta': 'Otra unidad', incompleto: 'Sin cantidad', sobra: 'Sobra',
}
