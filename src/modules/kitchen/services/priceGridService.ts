// src/modules/kitchen/services/priceGridService.ts
//
// REJILLA DE PRECIOS — servicio. Habla con brand_price_grid (una sola llamada
// por marca) y con apply_price_operation / revert_price_operation.
//
// TRES REGLAS QUE NO SE NEGOCIAN AQUÍ, porque vienen del encargo (18/08):
//
// 1. EL PRECIO ES SIEMPRE CON IVA. `price` de menu_item_channel_economics ya es
//    el precio que paga el cliente desde el arreglo del IVA del 17/08 — `price`
//    y `price_with_vat` devuelven el MISMO número. No se convierte nada aquí.
//
// 2. NO SE PINTAN LAS COMBINACIONES IMPOSIBLES. El servidor marca cada fila con
//    policy_allowed; este servicio agrupa en columnas SOLO las permitidas y
//    devuelve aparte las excluidas con su motivo, para que la pantalla lo diga.
//    El caso que importa: uber/own_delivery da el mejor margen de la pantalla
//    (66,4 % en un producto real) y es imposible — Uber siempre reparte Uber.
//
// 3. SIN ESCANDALLO NO HAY MARGEN. cost_available=false ⇒ margen null, y la UI
//    deja la celda VACÍA. Nunca 0 %: un 0 % ahí es mentira, un hueco es un dato.
//
// La economía NO se recalcula en cliente jamás: para previsualizar se vuelve a
// llamar a brand_price_grid con p_overrides y el servidor rehace los márgenes.
// Vale igual para una operación de 200 celdas y para editar UNA: la fórmula del
// margen vive en un solo sitio, y no es éste.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado')
}

// DEUDA DECLARADA: src/types/database.ts se regenera con el CLI de Supabase
// (npm run gen:types, que necesita el CLI global y el proyecto linkeado) y
// todavia no conoce brand_price_grid, apply_price_operation,
// revert_price_operation ni la tabla price_operation: las cuatro migraron el
// 18/08. Hasta la proxima regeneracion se pasa por el cliente sin tipar, que es
// el patron ya usado en availabilityReportService y comboEditService.
// Lo unico que se afloja es el NOMBRE de la RPC/tabla; los tipos de retorno
// (RawRow, PriceOperationRow) se siguen declarando a mano mas abajo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return supabase
}

// ─── Tipos ───

/** Una celda: un producto en un (canal × modalidad). */
export interface GridCell {
  menuItemId: string
  channelId: string
  serviceType: string | null
  price: number
  priceSource: 'preview' | 'override' | 'base'
  isLocationOverride: boolean
  isAvailable: boolean
  costAvailable: boolean
  netMargin: number | null
  netMarginPct: number | null
  contributionMarginPct: number | null
  /**
   * Pedidos del CANAL en 30 dias. NO son los de este producto: el recuento
   * filtra por cuenta y ventana, por nada mas, asi que sale el mismo numero
   * para los 27 productos de la marca (297 filas, 10 valores distintos en
   * Scandal Burgers / Alcala). El servidor lo renombro el 18/08 para que el
   * nombre dejara de enganar. Pendiente de decision: cambiarlo para que cuente
   * ESE producto seria mas util para decidir precios, pero es un cambio de
   * significado.
   */
  channelOrders30d: number
  policyAllowed: boolean
  policyReason: string | null
}

export interface GridProduct {
  menuItemId: string
  name: string
  categoryId: string | null
  categoryName: string | null
  productType: string | null
  basePrice: number | null
  vatRate: number
}

/** Una columna = un (canal × modalidad) que SÍ puede ocurrir. */
export interface GridColumn {
  key: string            // `${channelId}::${serviceType ?? '-'}`
  channelId: string
  channelName: string
  channelType: string | null
  serviceType: string | null
  label: string          // "Glovo · Reparto propio"
}

/** Un (canal × modalidad) que existe en channel_rate pero NO puede ocurrir. */
export interface ExcludedColumn {
  channelName: string
  serviceType: string | null
  reason: string
}

export interface PriceGrid {
  products: GridProduct[]
  columns: GridColumn[]
  excluded: ExcludedColumn[]
  cells: Map<string, GridCell>   // clave `${menuItemId}::${columnKey}`
}

export const SERVICE_TYPE_LABEL: Record<string, string> = {
  platform_delivery: 'Reparto de plataforma',
  pickup: 'Recogida',
  own_delivery: 'Reparto propio',
}

export function cellKey(menuItemId: string, columnKey: string): string {
  return `${menuItemId}::${columnKey}`
}
function columnKeyOf(channelId: string, serviceType: string | null): string {
  return `${channelId}::${serviceType ?? '-'}`
}

// ─── Carga ───

export interface RawRow {
  menu_item_id: string; menu_item_name: string
  category_id: string | null; category_name: string | null
  product_type: string | null; base_price: string | number | null
  channel_id: string; channel_name: string; channel_type: string | null
  service_type: string | null
  price: string | number; price_source: string
  is_location_override: boolean; is_available: boolean
  vat_rate: string | number; cost_available: boolean
  net_margin: string | number | null; net_margin_pct: string | number | null
  contribution_margin_pct: string | number | null
  channel_orders_30d: number
  policy_allowed: boolean; policy_reason: string | null
}

const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

// ─── Instrumentación (punto 2 del encargo del 18/08) ───
//
// La pantalla anunciaba 5.918 ms con un servidor que, medido con explain
// analyze, tardaba 484 ms. Ese 484 se midio SIN RLS (superusuario), y
// brand_price_grid es SECURITY INVOKER: el usuario real paga las politicas.
// Medido de nuevo como `authenticated`, la MISMA llamada tarda 3.774 ms.
// Por eso el desglose separa lo que se puede separar de verdad desde el
// navegador y no finge precision que no hay:
//
//   rpcMs    ida y vuelta completa (latencia + servidor + descarga)
//   shapeMs  filas crudas -> rejilla, en el hilo principal
//   rows     cuantas filas han venido
//   bytes    tamano real del cuerpo JSON
//
// ttfbMs / downloadMs salen de la Resource Timing API y solo estan disponibles
// si el servidor manda Timing-Allow-Origin (Supabase, siendo otro origen, no
// lo manda hoy). Cuando no estan, se devuelve null y la pantalla lo dice: un
// hueco es un dato, un cero seria mentira. Misma regla que el margen.
export interface GridTimings {
  rpcMs: number
  ttfbMs: number | null
  downloadMs: number | null
  shapeMs: number
  rows: number
  bytes: number | null
}

export interface TimedGrid {
  grid: PriceGrid
  timings: GridTimings
}

/** Tamano del cuerpo en bytes, o null si no se puede serializar. */
function pesoJson(rows: unknown): number | null {
  try { return JSON.stringify(rows).length } catch { return null }
}

/** Lee el desglose de red de la llamada recien hecha, si el navegador lo da. */
function timingDeRed(desde: number): { ttfbMs: number | null; downloadMs: number | null } {
  try {
    const entradas = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const mia = entradas.filter((e) => e.name.includes('/rpc/brand_price_grid') && e.startTime >= desde - 1).pop()
    // responseStart a 0 = sin Timing-Allow-Origin. No se inventa.
    if (!mia || !mia.responseStart) return { ttfbMs: null, downloadMs: null }
    return {
      ttfbMs: Math.round(mia.responseStart - mia.requestStart),
      downloadMs: Math.round(mia.responseEnd - mia.responseStart),
    }
  } catch {
    return { ttfbMs: null, downloadMs: null }
  }
}

/**
 * La marca entera en UNA llamada. `overrides` ({menuItemId: {channelId: precio}})
 * hace que el SERVIDOR recalcule los márgenes con los precios tecleados, sin
 * escribir nada — es como se previsualiza sin reimplementar la fórmula aquí.
 */
export async function getBrandPriceGrid(
  brandId: string,
  locationId?: string | null,
  overrides?: Record<string, Record<string, number>> | null,
): Promise<TimedGrid> {
  requireSupabase()
  const t0 = performance.now()
  const { data, error } = await db().rpc('brand_price_grid', {
    p_brand_id: brandId,
    p_location_id: locationId ?? undefined,
    p_overrides: overrides && Object.keys(overrides).length > 0 ? overrides : undefined,
  })
  const tRpc = performance.now()
  if (error) throw new Error(`Error cargando la rejilla: ${error.message}`)

  const rows = (data ?? []) as RawRow[]
  // Tamano real del cuerpo. Cuesta ~1 ms sobre 300 filas y responde a la
  // pregunta "¿es el transporte?" sin conjeturas.
  const bytes = pesoJson(rows)

  const tShape0 = performance.now()
  const grid = shapeGrid(rows)
  const tShape1 = performance.now()

  const red = timingDeRed(t0)
  return {
    grid,
    timings: {
      rpcMs: Math.round(tRpc - t0),
      ttfbMs: red.ttfbMs,
      downloadMs: red.downloadMs,
      shapeMs: Math.round(tShape1 - tShape0),
      rows: rows.length,
      bytes,
    },
  }
}

/**
 * Filas crudas -> rejilla. PURA a proposito: es la parte con mas reglas del
 * servicio (columnas permitidas, exclusiones con motivo, anulacion del margen
 * sin escandallo) y asi se puede probar con datos reales sin tocar la red.
 */
export function shapeGrid(rows: RawRow[]): PriceGrid {
  const products = new Map<string, GridProduct>()
  const columns = new Map<string, GridColumn>()
  const excluded = new Map<string, ExcludedColumn>()
  const cells = new Map<string, GridCell>()

  for (const r of rows) {
    if (!products.has(r.menu_item_id)) {
      products.set(r.menu_item_id, {
        menuItemId: r.menu_item_id,
        name: r.menu_item_name,
        categoryId: r.category_id,
        categoryName: r.category_name,
        productType: r.product_type,
        basePrice: numOrNull(r.base_price),
        vatRate: num(r.vat_rate),
      })
    }

    const key = columnKeyOf(r.channel_id, r.service_type)

    // Las combinaciones imposibles no se convierten en columna: se apuntan
    // aparte, con motivo, para poder decirlo en pantalla.
    if (!r.policy_allowed) {
      const ek = `${r.channel_name}::${r.service_type ?? '-'}`
      if (!excluded.has(ek)) {
        excluded.set(ek, {
          channelName: r.channel_name,
          serviceType: r.service_type,
          reason: r.policy_reason ?? 'Combinación no permitida.',
        })
      }
      continue
    }

    if (!columns.has(key)) {
      const modal = r.service_type ? SERVICE_TYPE_LABEL[r.service_type] ?? r.service_type : null
      columns.set(key, {
        key,
        channelId: r.channel_id,
        channelName: r.channel_name,
        channelType: r.channel_type,
        serviceType: r.service_type,
        label: modal ? `${r.channel_name} · ${modal}` : r.channel_name,
      })
    }

    cells.set(cellKey(r.menu_item_id, key), {
      menuItemId: r.menu_item_id,
      channelId: r.channel_id,
      serviceType: r.service_type,
      price: num(r.price),
      priceSource: (r.price_source as GridCell['priceSource']) ?? 'base',
      isLocationOverride: r.is_location_override === true,
      isAvailable: r.is_available !== false,
      costAvailable: r.cost_available === true,
      // SIN ESCANDALLO NO HAY MARGEN. El servidor calcula con coste cero, que
      // daría un 100 % en Mostrador; aquí se anula para que la UI deje hueco.
      netMargin: r.cost_available ? numOrNull(r.net_margin) : null,
      netMarginPct: r.cost_available ? numOrNull(r.net_margin_pct) : null,
      contributionMarginPct: r.cost_available ? numOrNull(r.contribution_margin_pct) : null,
      channelOrders30d: r.channel_orders_30d ?? 0,
      policyAllowed: true,
      policyReason: null,
    })
  }

  const orderRank: Record<string, number> = { delivery: 0, takeaway: 1, dine_in: 2 }
  const cols = Array.from(columns.values()).sort((a, b) => {
    const ra = orderRank[a.channelType ?? ''] ?? 9
    const rb = orderRank[b.channelType ?? ''] ?? 9
    if (ra !== rb) return ra - rb
    if (a.channelName !== b.channelName) return a.channelName < b.channelName ? -1 : 1
    return (a.serviceType ?? '') < (b.serviceType ?? '') ? -1 : 1
  })

  return {
    products: Array.from(products.values()).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    columns: cols,
    excluded: Array.from(excluded.values()),
    cells,
  }
}

// ─── Orden de la carta (punto 1-bis del encargo del 18/08) ───
//
// La rejilla se leia por orden alfabetico y empezaba por "Agua Mineral". Nadie
// piensa los precios asi: se piensan por bloques de carta, en el orden en que
// los ve el cliente.
//
// El orden esta en los datos y esta limpio: menu_item.position y
// menu_category.position son NOT NULL en las dos tablas (verificado en
// information_schema el 18/08). No hay nada que inventar.
//
// DEUDA ANOTADA: esto deberia venir en brand_price_grid, que ya hace el join
// con menu_category — serian dos columnas mas y CERO llamadas extra. No se
// toca hoy porque cambiar las columnas de salida de una funcion obliga a
// DROP + CREATE, y el SQL lo ejecuta y verifica Julio, no esta sesion. Mientras
// tanto son dos consultas diminutas (ids + position) que van EN PARALELO con la
// rejilla, asi que no suman a la espera.
export interface MenuOrder {
  categorias: Map<string, { position: number; name: string }>
  productos: Map<string, number>
}

export async function getBrandMenuOrder(brandId: string): Promise<MenuOrder> {
  requireSupabase()
  const [cats, items] = await Promise.all([
    db().from('menu_category').select('id, name, position').eq('brand_id', brandId),
    db().from('menu_item').select('id, position').eq('brand_id', brandId),
  ])
  const categorias = new Map<string, { position: number; name: string }>()
  for (const c of ((cats.data ?? []) as Record<string, unknown>[])) {
    categorias.set(c.id as string, { position: Number(c.position ?? 0), name: (c.name as string) ?? '' })
  }
  const productos = new Map<string, number>()
  for (const i of ((items.data ?? []) as Record<string, unknown>[])) {
    productos.set(i.id as string, Number(i.position ?? 0))
  }
  return { categorias, productos }
}

/** Un bloque de carta: la cabecera de categoria y sus productos. */
export interface GridSection {
  categoryId: string | null      // null = "Sin categoria"
  categoryName: string
  products: GridProduct[]
}

/**
 * Agrupa la marca en bloques de carta y la ordena como la ve el cliente.
 *
 * PURA a proposito, como shapeGrid: es la parte con reglas (desempates,
 * huerfanos) y asi se puede comprobar con datos reales sin tocar la red.
 *
 * Dos casos limite REALES, comprobados en la cuenta:
 *
 *  - Productos SIN categoria (13 en Foodint: 1 de 23 en Lovers Burgers, 1 de 32
 *    en Meraki Pita). Van a un bloque "Sin categoria" AL FINAL y VISIBLE. Hoy
 *    ninguna seleccion por categoria los alcanza y nadie lo sabe; esconderlos
 *    seria repetir el problema.
 *
 *  - Dos categorias con la MISMA position (The Urban Kebab: 8 categorias, 7
 *    posiciones. Scandal Burgers tambien: dos "Combo Scandal." en 0 y en 2).
 *    Sin desempate el orden cambia entre cargas. Se desempata por nombre y,
 *    si tambien empata, por id: asi es estable siempre.
 *
 * Si `orden` es null (la consulta de posiciones fallo), NO se rompe la
 * pantalla: se cae a orden alfabetico, que es lo que habia antes.
 */
export function agruparPorCarta(products: GridProduct[], orden: MenuOrder | null): GridSection[] {
  const porCat = new Map<string, GridProduct[]>()
  const SIN = '\u0000sin'
  for (const p of products) {
    const k = p.categoryId ?? SIN
    const l = porCat.get(k)
    if (l) l.push(p); else porCat.set(k, [p])
  }

  const secciones: Array<GridSection & { pos: number }> = []
  for (const [k, lista] of porCat.entries()) {
    const esSin = k === SIN
    const meta = esSin ? null : orden?.categorias.get(k) ?? null
    lista.sort((a, b) => {
      const pa = orden?.productos.get(a.menuItemId)
      const pb = orden?.productos.get(b.menuItemId)
      if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb
      const n = a.name.localeCompare(b.name, 'es')
      return n !== 0 ? n : (a.menuItemId < b.menuItemId ? -1 : 1)
    })
    secciones.push({
      categoryId: esSin ? null : k,
      categoryName: esSin ? 'Sin categoría' : (meta?.name ?? lista[0].categoryName ?? '(sin nombre)'),
      products: lista,
      // Sin categoria SIEMPRE al final, pase lo que pase con las posiciones.
      pos: esSin ? Number.MAX_SAFE_INTEGER : (meta?.position ?? Number.MAX_SAFE_INTEGER - 1),
    })
  }

  secciones.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos
    const n = a.categoryName.localeCompare(b.categoryName, 'es')
    if (n !== 0) return n
    return (a.categoryId ?? '') < (b.categoryId ?? '') ? -1 : 1
  })
  return secciones.map(({ categoryId, categoryName, products: ps }) => ({ categoryId, categoryName, products: ps }))
}

// ─── Cuenta interna (punto 3 del encargo del 18/08) ───
//
// accounts.is_internal existe y vale true solo para Folvy Interno. No lo usaba
// nadie, y el 18/08 costo un documento de bug entero: la rejilla abierta en la
// cuenta interna no pintaba canales —correctamente, porque alli no hay filas en
// channel_delivery_policy— y se leyo como un fallo de la pantalla.
//
// DEUDA ANOTADA: este aviso deberia ser de TODA la aplicacion (una banda en el
// armazon), no de una pantalla. Se limita aqui para no tocar el Shell dentro de
// la ventana de despliegue del 18/08.
export async function getAccountIsInternal(accountId: string): Promise<boolean> {
  requireSupabase()
  const { data, error } = await db()
    .from('accounts').select('is_internal').eq('id', accountId).maybeSingle()
  // Un fallo aqui NO puede tumbar la rejilla: se degrada a "no es interna", que
  // es el caso de 2 de las 3 cuentas.
  if (error) return false
  return (data as { is_internal?: boolean } | null)?.is_internal === true
}

// ─── Bandas de salud (§5 del encargo: absolutas, no relativas por canal) ───
//
// Absolutas A PROPÓSITO: el objetivo de la pantalla es comparar canales entre
// sí. Si cada canal se midiera contra su propia media, la rejilla escondería
// que el reparto propio en Just Eat va peor que todo lo demás.
//
// El 25 % sale de la distribución real (p25 de Just Eat reparto propio: 1,6 %;
// Glovo: 11,4 %; todo lo demás por encima de 37 %), no de la economía de
// Foodint. Si Julio da otro número, se cambia esta constante y ya.
//
// NO se usa food_cost_status: target_food_cost_pct no está configurado en
// Foodint, así que ese semáforo sale 'no_target' en toda la cuenta.
export const BANDA_APRIETA_HASTA = 25

export type Banda = 'pierde' | 'aprieta' | 'sano' | 'sin_dato'

export function bandaDe(netMarginPct: number | null): Banda {
  if (netMarginPct === null || Number.isNaN(netMarginPct)) return 'sin_dato'
  if (netMarginPct < 0) return 'pierde'
  if (netMarginPct < BANDA_APRIETA_HASTA) return 'aprieta'
  return 'sano'
}

export const BANDA_LABEL: Record<Banda, string> = {
  pierde: 'Pierde',
  aprieta: 'Aprieta',
  sano: 'Sano',
  sin_dato: 'Sin escandallo',
}

// ─── Operaciones en lote ───

export type BulkOp =
  | { kind: 'pct'; value: number }        // +10 / -10
  | { kind: 'eur'; value: number }        // +1 / -1
  | { kind: 'set'; value: number }        // fijar a X
  | { kind: 'base' }                      // volver a precio base

/** Escalera de redondeo. 'decena' = múltiplos de 10 céntimos (por defecto). */
export type Escalera = 'ninguno' | 'decena' | 'noventa' | 'noventaycinco' | 'cincuenta' | 'entero'

export const ESCALERA_LABEL: Record<Escalera, string> = {
  ninguno: 'Sin redondear',
  decena: 'Múltiplos de 10 cts (recomendado)',
  noventa: 'Terminar en ,90',
  noventaycinco: 'Terminar en ,95',
  cincuenta: 'Terminar en ,50',
  entero: 'Euro entero',
}

/**
 * Redondeo EN LA DIRECCIÓN DE LA OPERACIÓN: al alza si el precio sube, a la baja
 * si baja. El redondeo nunca contradice lo que se pidió.
 *
 * `,90` y compañía NO son la opción por defecto a propósito: +10 % sobre 1,90
 * da 2,09, y forzado a ,90 se convierte en 2,90 — un +52 %. En productos
 * baratos una escalera gruesa destroza la operación. Por eso el defecto es
 * múltiplos de 10 céntimos, que es lo que la casa ya usa en 227 de 236
 * productos (96 %).
 */
export function redondear(target: number, anterior: number, escalera: Escalera): number {
  if (escalera === 'ninguno') return Math.round(target * 100) / 100
  const sube = target >= anterior
  const paso =
    escalera === 'decena' ? 0.10 :
    escalera === 'cincuenta' ? 0.50 :
    escalera === 'entero' ? 1 : 1   // noventa / noventaycinco: escalón de 1 € + resto
  const resto =
    escalera === 'noventa' ? 0.90 :
    escalera === 'noventaycinco' ? 0.95 : 0

  const base = target - resto
  const n = sube ? Math.ceil(base / paso - 1e-9) : Math.floor(base / paso + 1e-9)
  const out = n * paso + resto
  return Math.max(0, Math.round(out * 100) / 100)
}

/** Precio objetivo de una operación, ANTES de redondear. null = volver a base. */
export function precioObjetivo(actual: number, op: BulkOp): number | null {
  switch (op.kind) {
    case 'pct': return actual * (1 + op.value / 100)
    case 'eur': return actual + op.value
    case 'set': return op.value
    case 'base': return null
  }
}

/** El porcentaje REAL tras redondear. Si la pantalla sigue diciendo «+10 %», miente. */
export function pctReal(anterior: number, despues: number): number | null {
  if (!anterior) return null
  return ((despues - anterior) / anterior) * 100
}

/**
 * Lee un precio tecleado por una persona. Acepta coma decimal y el simbolo del
 * euro, porque es lo que sale de un teclado espanol. Devuelve:
 *   number  precio valido
 *   null    campo vacio => "volver a heredado" (borrar el override)
 *   NaN     no es un numero: la pantalla lo rechaza sin tocar la BBDD
 *           (NaN es un number, por eso no aparece en la firma; se comprueba
 *           con Number.isNaN en el llamador)
 */
export function leerPrecio(texto: string): number | null {
  const limpio = texto.replace(/[€\s]/g, '').replace(',', '.').trim()
  if (limpio === '') return null
  const n = Number(limpio)
  if (!Number.isFinite(n) || n < 0) return NaN
  return Math.round(n * 100) / 100
}

// ─── Guardado ───

export interface OperationEntry {
  menu_item_id: string
  channel_id: string
  location_id: string | null
  action: 'set' | 'clear'
  price?: number
  expected_price_before: number | null
}

/**
 * `expected_price_before` tal y como lo entiende apply_price_operation:
 *   null      la previsualizacion vio "sin override EN ESTE AMBITO"; el servidor
 *             comprueba que sigue sin haberlo.
 *   numero    se compara contra effective_price con tolerancia de 0,005.
 * Una sola definicion para el lote y para la celda suelta: si divergieran,
 * divergirian tambien los conflictos que cada camino detecta.
 */
export function expectedPriceBefore(cell: { priceSource: string; isLocationOverride: boolean; price: number }): number | null {
  return cell.priceSource === 'base' && !cell.isLocationOverride ? null : cell.price
}

/**
 * Guarda la operación entera: una transacción, un operation_id, reversible.
 * NUNCA se llama a set_menu_item_override en bucle desde el cliente.
 *
 * Vale igual para 200 celdas y para UNA. Que la edicion directa pase por aqui
 * no es ceremonia: si las ediciones sueltas no dejaran fila en price_operation,
 * el historial tendria agujeros y "Deshacer" no las alcanzaria.
 */
export async function applyPriceOperation(args: {
  accountId: string
  scope: Record<string, unknown>
  entries: OperationEntry[]
  note?: string | null
}): Promise<string> {
  requireSupabase()
  const { data, error } = await db().rpc('apply_price_operation', {
    p_account_id: args.accountId,
    p_scope: args.scope,
    p_entries: args.entries,
    p_note: args.note ?? undefined,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function revertPriceOperation(operationId: string): Promise<string> {
  requireSupabase()
  const { data, error } = await db().rpc('revert_price_operation', {
    p_operation_id: operationId,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export interface PriceOperationRow {
  id: string
  kind: 'bulk_price' | 'revert'
  createdAt: string
  entriesCount: number
  writesCount: number
  revertedOperationId: string | null
  note: string | null
  scope: Record<string, unknown> | null
}

export async function listPriceOperations(accountId: string, limit = 10): Promise<PriceOperationRow[]> {
  requireSupabase()
  const { data, error } = await db()
    .from('price_operation')
    .select('id, kind, created_at, entries_count, writes_count, reverted_operation_id, note, scope')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((o) => ({
    id: o.id as string,
    kind: o.kind as PriceOperationRow['kind'],
    createdAt: o.created_at as string,
    entriesCount: o.entries_count as number,
    writesCount: o.writes_count as number,
    revertedOperationId: (o.reverted_operation_id as string | null) ?? null,
    note: (o.note as string | null) ?? null,
    scope: (o.scope as Record<string, unknown> | null) ?? null,
  }))
}
