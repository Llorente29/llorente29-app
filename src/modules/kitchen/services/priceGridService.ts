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

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled() || !supabase) throw new Error('Supabase no está configurado')
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
  orders30d: number
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
  orders_30d: number
  policy_allowed: boolean; policy_reason: string | null
}

const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

/**
 * La marca entera en UNA llamada. `overrides` ({menuItemId: {channelId: precio}})
 * hace que el SERVIDOR recalcule los márgenes con los precios tecleados, sin
 * escribir nada — es como se previsualiza sin reimplementar la fórmula aquí.
 */
export async function getBrandPriceGrid(
  brandId: string,
  locationId?: string | null,
  overrides?: Record<string, Record<string, number>> | null,
): Promise<PriceGrid> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('brand_price_grid', {
    p_brand_id: brandId,
    p_location_id: locationId ?? undefined,
    p_overrides: overrides && Object.keys(overrides).length > 0 ? overrides : undefined,
  })
  if (error) throw new Error(`Error cargando la rejilla: ${error.message}`)
  return shapeGrid((data ?? []) as RawRow[])
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
      orders30d: r.orders_30d ?? 0,
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
 * Guarda la operación entera: una transacción, un operation_id, reversible.
 * NUNCA se llama a set_menu_item_override en bucle desde el cliente.
 */
export async function applyPriceOperation(args: {
  accountId: string
  scope: Record<string, unknown>
  entries: OperationEntry[]
  note?: string | null
}): Promise<string> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('apply_price_operation', {
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
  const { data, error } = await supabase!.rpc('revert_price_operation', {
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
  const { data, error } = await supabase!
    .from('price_operation')
    .select('id, kind, created_at, entries_count, writes_count, reverted_operation_id, note, scope')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((o) => ({
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
