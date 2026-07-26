// src/modules/kitchen/services/warehouseReliabilityService.ts
//
// Fiabilidad del almacén — la COLA DE TRABAJO que persigue cada fallo hasta que
// el dato demuestra que está corregido.
//
// Los tres carriles son los tres puntos exactos donde generate_sale_consumption
// se rinde y una venta no descuenta ingredientes:
//   A · la línea no está casada con ningún plato  (menu_item_id IS NULL)
//   B · casa con un plato que no explota a crudos (_sale_line_raw_consumption vacío)
//   C · el ingrediente sale sin coste             (avg_unit_cost y computed_cost NULL)
// A tapa a B y B tapa a C, así que la pantalla ataca en ese orden.
//
// Todo el cálculo vive en la RPC warehouse_reliability_queue: una llamada trae
// los tres carriles agrupados POR PRODUCTO y ordenados por € de impacto. (El
// servicio antiguo, salesReliabilityService.listBlindLines, se descarga TODAS
// las líneas sin casar de la cuenta y agrupa en el navegador; para una cola de
// trabajo eso no escala.)
//
// Se REUSA lo que ya existía: getReliability (métrica de cabecera), suggestMatch
// (sugerencia de run_mapping), createDishFromUnmapped y resolveUnmapped (ignorar)
// viven en salesReliabilityService y se re-exportan aquí para que la pantalla
// tenga una sola puerta.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

export type Carril = 'A' | 'B' | 'C'
/** pendiente = nunca se tocó · esperando_confirmacion = arreglado, sin ventas nuevas
 *  todavía · recaido = se arregló y ha vuelto a fallar (por eso reaparece). */
export type EstadoItem = 'pendiente' | 'esperando_confirmacion' | 'recaido'

export interface QueueItem {
  carril: Carril
  productName: string
  recipeItemId: string | null
  ventas: number
  eur: number
  ultimaVenta: string | null
  /** Carril C: en cuántas recetas se usa el ingrediente. */
  enRecetas: number | null
  estado: EstadoItem
  fixedAt: string | null
  fixMethod: string | null
  ventasDesdeArreglo: number
  ventasOkDesdeArreglo: number
}

interface RowQueue {
  carril: string
  product_name: string
  recipe_item_id: string | null
  ventas: number
  eur: number
  ultima_venta: string | null
  en_recetas: number | null
  estado: string
  fixed_at: string | null
  fix_method: string | null
  ventas_desde_arreglo: number
  ventas_ok_desde_arreglo: number
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

/** RPC aún sin tipos generados (la migración se aplica a mano y database.ts se
 *  regenera después). Mismo idiom que el resto del proyecto: cast de la función,
 *  no un `any` suelto. */
function rpc(fn: string, args: Record<string, unknown>): Promise<{
  data: unknown
  error: { message?: string; code?: string } | null
}> {
  // ⚠️ El cast va ANTES del .bind (si no, TS2589) y el .bind es OBLIGATORIO:
  // supabase-js pierde el `this` si se extrae `rpc` a una variable suelta y
  // revienta con "Cannot read properties of undefined (reading 'rest')" — la
  // llamada ni siquiera sale a la red. Ya pasó con el banner del KPI de cocina.
  const call = (supabase!.rpc as unknown as (
    f: string, a: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  ).bind(supabase!)
  return call(fn, args)
}

function faltaMigracion(msg: string): boolean {
  return /could not find the function|does not exist|warehouse_reliability_queue/i.test(msg)
}

/**
 * La cola completa: A, B y C por producto, ordenada por € de impacto.
 * Un ítem NO desaparece por pulsar un botón: desaparece cuando sus ventas nuevas
 * ya casan. Si vuelve a fallar, reaparece como 'recaido'.
 */
export async function getReliabilityQueue(
  accountId: string,
  locationId?: string | null,
  days = 7,
): Promise<QueueItem[]> {
  requireSupabase()
  const { data, error } = await rpc('warehouse_reliability_queue', {
    p_account_id: accountId,
    p_location_id: locationId ?? undefined,
    p_days: days,
  })
  if (error) {
    const msg = error.message ?? ''
    if (faltaMigracion(msg)) {
      throw new Error('Falta aplicar la migración 20260726T1400 en la BBDD para que esta pantalla funcione.')
    }
    throw new Error(`No se pudo cargar la cola de fiabilidad: ${msg}`)
  }
  const rows = (Array.isArray(data) ? data : []) as RowQueue[]
  return rows.map(r => ({
    carril: (r.carril === 'B' || r.carril === 'C' ? r.carril : 'A') as Carril,
    productName: r.product_name ?? '(sin nombre)',
    recipeItemId: r.recipe_item_id ?? null,
    ventas: Number(r.ventas ?? 0),
    eur: Number(r.eur ?? 0),
    ultimaVenta: r.ultima_venta ?? null,
    enRecetas: r.en_recetas == null ? null : Number(r.en_recetas),
    estado: (['pendiente', 'esperando_confirmacion', 'recaido'].includes(r.estado)
      ? r.estado : 'pendiente') as EstadoItem,
    fixedAt: r.fixed_at ?? null,
    fixMethod: r.fix_method ?? null,
    ventasDesdeArreglo: Number(r.ventas_desde_arreglo ?? 0),
    ventasOkDesdeArreglo: Number(r.ventas_ok_desde_arreglo ?? 0),
  }))
}

export interface MapResult {
  menuItemId: string | null
  recipeItemId: string | null
  brandId: string | null
  /** Líneas ya vendidas que siguen sin descontar (el arreglo va de hoy en adelante). */
  lineasPendientes: number
}

/**
 * Casa un producto vendido con un plato QUE YA EXISTE. Es la acción principal
 * del carril A ("Sí, es este plato") y la pieza que NO existía en el backend:
 * las RPC previas creaban un plato nuevo (duplicándolo) o convertían el artículo
 * en reventa. Arregla de hoy en adelante; el pasado se rehace, si se quiere, con
 * recostProduct.
 */
export async function mapProductToDish(
  accountId: string,
  productName: string,
  recipeItemId: string,
  actorName?: string | null,
): Promise<MapResult> {
  requireSupabase()
  const { data, error } = await rpc('map_sales_product_to_dish', {
    p_account_id: accountId,
    p_product_name: productName,
    p_recipe_item_id: recipeItemId,
    p_actor_name: actorName ?? undefined,
  })
  if (error) throw new Error(error.message ?? 'No se pudo casar el producto.')
  const row = (Array.isArray(data) ? data[0] : data) as {
    menu_item_id?: string | null; recipe_item_id?: string | null
    brand_id?: string | null; lineas_futuras?: number
  } | undefined
  if (!row) throw new Error('La acción no devolvió resultado.')
  return {
    menuItemId: row.menu_item_id ?? null,
    recipeItemId: row.recipe_item_id ?? null,
    brandId: row.brand_id ?? null,
    lineasPendientes: Number(row.lineas_futuras ?? 0),
  }
}

export interface RecostResult {
  ventasAfectadas: number
  lineasAfectadas: number
  movimientos: number
  aplicado: boolean
}

/**
 * Re-costeo retroactivo de UN producto. Por defecto en seco (dryRun): devuelve
 * cuántas ventas tocaría. Rehacer el pasado descuadra el stock físico contado,
 * así que nunca se dispara solo.
 */
export async function recostProduct(
  accountId: string,
  productName: string,
  days = 30,
  dryRun = true,
): Promise<RecostResult> {
  requireSupabase()
  const { data, error } = await rpc('recost_sales_for_product', {
    p_account_id: accountId,
    p_product_name: productName,
    p_days: days,
    p_dry_run: dryRun,
  })
  if (error) throw new Error(error.message ?? 'No se pudo recostear.')
  const row = (Array.isArray(data) ? data[0] : data) as {
    ventas_afectadas?: number; lineas_afectadas?: number
    movimientos?: number; aplicado?: boolean
  } | undefined
  return {
    ventasAfectadas: Number(row?.ventas_afectadas ?? 0),
    lineasAfectadas: Number(row?.lineas_afectadas ?? 0),
    movimientos: Number(row?.movimientos ?? 0),
    aplicado: Boolean(row?.aplicado),
  }
}

// Puerta única para la pantalla: lo que ya existía se reusa tal cual.
export {
  getReliability,
  suggestMatch,
  createDishFromUnmapped,
  resolveUnmapped,
  type MatchSuggestion,
  type SalesReliability,
} from './salesReliabilityService'
