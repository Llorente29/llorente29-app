// src/modules/kitchen/services/salesByBrandService.ts
//
// Casado de ventas POR MARCA × LOCAL (Trabajo B). Lectura + acción de ignorar.
//
// Ejes:
//   - MARCA: sale.brand_id (marca canónica de Folvy, estable por UUID vía
//     external_brand_map). El casado se acota a la marca → imposible atribuir a
//     otra marca por error.
//   - LOCAL: sale.location_id (directo). null = consolidado = todos los locales.
//     Lo aporta la pantalla desde useLocationScope().resolvedLocationId.
//
// La marca NO vive en sale_line; se llega vía el join sale_line → sale. Se usa
// el filtrado embebido de PostgREST (sale!inner + .eq('sale.brand_id', …)) para
// empujar el join y los filtros a la BBDD.
//
// Anti-invención: solo lee/agrega lo que el adaptador dejó escrito (menu_item_id,
// unmapped_reason, computed_cost, ignore_reason). No deduce ni casa solo.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

// ─────────────────────────────────────────────────────────────────────
// Tipos de dominio
// ─────────────────────────────────────────────────────────────────────

/** Estado de una línea de producto frente al casado de su marca. */
export type BrandLineStatus = 'pending' | 'matched' | 'ignored'

export interface BrandWithSales {
  brandId: string
  brandName: string
  ownershipType: string        // 'own' | 'ceded' | … (brand.ownership_type)
  isActive: boolean
  lineas: number               // nº de líneas de producto de la marca (en rango/local)
  pendientes: number           // líneas pendientes de casar
  casadas: number              // líneas casadas (menu_item_id no null)
  ignoradas: number            // líneas ignoradas
}

export interface BrandReliability {
  brandId: string
  lineasTotal: number
  lineasCasadas: number
  lineasPendientes: number
  lineasIgnoradas: number
  lineasDescatalogadas: number
  /** % casado por líneas sobre el universo "vivo" (casadas+pendientes). */
  casadoPct: number | null
  /** Líneas casadas que SÍ tienen coste conocido. */
  lineasConCoste: number
  /** % del casado con coste conocido (food cost no ciego). */
  costeCoberturaPct: number | null
  importeTotal: number
  importeCasado: number
  importePendiente: number
  importeIgnorado: number
}

/** Un producto agregado dentro de una marca (todas sus líneas del mismo nombre). */
export interface BrandProduct {
  productName: string
  status: BrandLineStatus
  salesCount: number           // nº de líneas/ventas del producto
  totalEur: number             // importe acumulado
  // pendiente:
  reason: string | null        // unmapped_reason (no_recipe/no_menu_item/no_brand/…)
  // casado:
  hasCost: boolean             // todas las líneas tienen computed_cost → coste conocido
  // ignorado:
  ignoreReason: string | null  // motivo del ignore
  ignoredAt: string | null     // fecha del ignore (la más reciente)
  // contexto (atado al ticket):
  locationIds: string[]        // locales donde se vendió (para etiquetar marca×local)
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

function defaultRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

interface EmbeddedSale {
  brand_id: string | null
  location_id: string | null
  sold_at: string | null
  source: string | null
  is_active: boolean | null
}

interface RawBrandLine {
  saleId: string
  brandId: string | null
  locationId: string | null
  soldAt: string | null
  productName: string
  quantity: number
  amount: number
  menuItemId: string | null
  unmappedReason: string | null
  computedCost: number | null
  ignoreReason: string | null
  ignoredAt: string | null
}

function lineStatus(l: RawBrandLine): BrandLineStatus | 'delisted' {
  if (l.menuItemId) return 'matched'
  if (l.unmappedReason === 'ignored') return 'ignored'
  if (l.unmappedReason === 'delisted') return 'delisted'
  return 'pending'
}

/**
 * Trae las líneas de PRODUCTO (line_type='product') de ventas lastapp activas en
 * el rango, opcionalmente acotadas a una marca y/o un local. Empuja el join y los
 * filtros a la BBDD vía embebido PostgREST. Pagina (N puede ser miles).
 */
async function fetchBrandLines(
  accountId: string,
  brandId: string | null,
  locationId: string | null,
  from: string,
  to: string,
): Promise<RawBrandLine[]> {
  const out: RawBrandLine[] = []
  const pageSize = 1000
  let offset = 0
  for (;;) {
    let q = supabase!
      .from('sale_line')
      .select(
        'sale_id, product_name, quantity, line_total, unit_price, menu_item_id, unmapped_reason, computed_cost, ignore_reason, ignored_at, line_type, sale!inner(brand_id, location_id, sold_at, source, is_active)'
      )
      .eq('account_id', accountId)
      .eq('line_type', 'product')
      .eq('sale.source', 'lastapp')
      .eq('sale.is_active', true)
      .gte('sale.sold_at', from)
      .lt('sale.sold_at', to)
    if (brandId) q = q.eq('sale.brand_id', brandId)
    if (locationId) q = q.eq('sale.location_id', locationId)
    q = q.range(offset, offset + pageSize - 1)

    const { data, error } = await q
    if (error) throw new Error(`Error listando líneas por marca: ${error.message}`)
    const rows = (data as Record<string, unknown>[] | null) ?? []
    if (rows.length === 0) break
    for (const r of rows) {
      const s = (r.sale as EmbeddedSale | null) ?? null
      const qty = Number(r.quantity ?? 1)
      const amount = Number(
        (r.line_total as number | null) ??
          (Number(r.unit_price ?? 0) * qty)
      )
      out.push({
        saleId: r.sale_id as string,
        brandId: s?.brand_id ?? null,
        locationId: s?.location_id ?? null,
        soldAt: s?.sold_at ?? null,
        productName: ((r.product_name as string) ?? '(sin nombre)').trim(),
        quantity: qty,
        amount,
        menuItemId: (r.menu_item_id as string | null) ?? null,
        unmappedReason: (r.unmapped_reason as string | null) ?? null,
        computedCost: (r.computed_cost as number | null) ?? null,
        ignoreReason: (r.ignore_reason as string | null) ?? null,
        ignoredAt: (r.ignored_at as string | null) ?? null,
      })
    }
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────
// API pública — lectura
// ─────────────────────────────────────────────────────────────────────

/**
 * Marcas con ventas (en rango/local), con contadores por estado. Para el selector
 * de marca de la pantalla. Excluye ventas sin marca reconocida (brand_id null):
 * esas viven en la vista general "Todas" (no_brand).
 */
export async function listBrandsWithSales(
  accountId: string,
  locationId?: string | null,
  from?: string,
  to?: string,
): Promise<BrandWithSales[]> {
  requireSupabase()
  const range = from && to ? { from, to } : defaultRange()

  const [lines, brandsRes] = await Promise.all([
    fetchBrandLines(accountId, null, locationId ?? null, range.from, range.to),
    supabase!
      .from('brand')
      .select('id, name, ownership_type, is_active')
      .eq('account_id', accountId),
  ])
  if (brandsRes.error) throw new Error(`Error cargando marcas: ${brandsRes.error.message}`)
  const brandMeta = new Map<string, { name: string; ownership: string; active: boolean }>()
  for (const b of (brandsRes.data as Record<string, unknown>[] | null) ?? []) {
    brandMeta.set(b.id as string, {
      name: (b.name as string) ?? '(sin nombre)',
      ownership: (b.ownership_type as string) ?? 'own',
      active: b.is_active !== false,
    })
  }

  interface Acc { lineas: number; pendientes: number; casadas: number; ignoradas: number }
  const byBrand = new Map<string, Acc>()
  for (const l of lines) {
    if (!l.brandId) continue
    const st = lineStatus(l)
    let a = byBrand.get(l.brandId)
    if (!a) { a = { lineas: 0, pendientes: 0, casadas: 0, ignoradas: 0 }; byBrand.set(l.brandId, a) }
    a.lineas++
    if (st === 'matched') a.casadas++
    else if (st === 'ignored') a.ignoradas++
    else if (st === 'pending') a.pendientes++
    // 'delisted' no suma a ninguno de los tres visibles.
  }

  const result: BrandWithSales[] = []
  for (const [brandId, a] of byBrand.entries()) {
    const meta = brandMeta.get(brandId)
    result.push({
      brandId,
      brandName: meta?.name ?? '(marca desconocida)',
      ownershipType: meta?.ownership ?? 'own',
      isActive: meta?.active ?? true,
      lineas: a.lineas,
      pendientes: a.pendientes,
      casadas: a.casadas,
      ignoradas: a.ignoradas,
    })
  }
  // Orden: más pendientes primero (lo que pide atención), luego por nombre.
  result.sort((x, y) => (y.pendientes - x.pendientes) || x.brandName.localeCompare(y.brandName, 'es'))
  return result
}

/** Resumen de fiabilidad del casado de UNA marca (acotado al local activo). */
export async function getBrandReliability(
  accountId: string,
  brandId: string,
  locationId?: string | null,
  from?: string,
  to?: string,
): Promise<BrandReliability> {
  requireSupabase()
  const range = from && to ? { from, to } : defaultRange()
  const lines = await fetchBrandLines(accountId, brandId, locationId ?? null, range.from, range.to)

  let casadas = 0, pendientes = 0, ignoradas = 0, delisted = 0, conCoste = 0
  let impTotal = 0, impCasado = 0, impPend = 0, impIgn = 0
  for (const l of lines) {
    const st = lineStatus(l)
    impTotal += l.amount
    if (st === 'matched') {
      casadas++; impCasado += l.amount
      if (l.computedCost !== null && l.computedCost !== undefined) conCoste++
    } else if (st === 'pending') {
      pendientes++; impPend += l.amount
    } else if (st === 'ignored') {
      ignoradas++; impIgn += l.amount
    } else {
      delisted++
    }
  }
  const vivo = casadas + pendientes
  return {
    brandId,
    lineasTotal: lines.length,
    lineasCasadas: casadas,
    lineasPendientes: pendientes,
    lineasIgnoradas: ignoradas,
    lineasDescatalogadas: delisted,
    casadoPct: vivo > 0 ? Math.round((casadas / vivo) * 1000) / 10 : null,
    lineasConCoste: conCoste,
    costeCoberturaPct: casadas > 0 ? Math.round((conCoste / casadas) * 1000) / 10 : null,
    importeTotal: Math.round(impTotal * 100) / 100,
    importeCasado: Math.round(impCasado * 100) / 100,
    importePendiente: Math.round(impPend * 100) / 100,
    importeIgnorado: Math.round(impIgn * 100) / 100,
  }
}

/**
 * Productos de una marca por estado (pending/matched/ignored), AGRUPADOS por
 * nombre de producto con nº de ventas e importe. Para el casado: solo platos de
 * esa marca (acotado).
 */
export async function listBrandLines(
  accountId: string,
  brandId: string,
  status: BrandLineStatus,
  locationId?: string | null,
  from?: string,
  to?: string,
): Promise<BrandProduct[]> {
  requireSupabase()
  const range = from && to ? { from, to } : defaultRange()
  const lines = await fetchBrandLines(accountId, brandId, locationId ?? null, range.from, range.to)

  const byName = new Map<string, BrandProduct & { _allCost: boolean; _locSet: Set<string> }>()
  for (const l of lines) {
    if (lineStatus(l) !== status) continue
    const name = l.productName || '(sin nombre)'
    let p = byName.get(name)
    if (!p) {
      p = {
        productName: name,
        status,
        salesCount: 0,
        totalEur: 0,
        reason: l.unmappedReason,
        hasCost: true,
        ignoreReason: l.ignoreReason,
        ignoredAt: l.ignoredAt,
        locationIds: [],
        _allCost: true,
        _locSet: new Set<string>(),
      }
      byName.set(name, p)
    }
    p.salesCount++
    p.totalEur += l.amount
    if (status === 'matched' && (l.computedCost === null || l.computedCost === undefined)) {
      p._allCost = false
    }
    if (status === 'ignored') {
      // Conserva el motivo y la fecha MÁS RECIENTE.
      if (l.ignoredAt && (!p.ignoredAt || l.ignoredAt > p.ignoredAt)) {
        p.ignoredAt = l.ignoredAt
        p.ignoreReason = l.ignoreReason
      }
    }
    if (l.locationId) p._locSet.add(l.locationId)
  }

  const out: BrandProduct[] = []
  for (const p of byName.values()) {
    p.hasCost = p._allCost
    p.totalEur = Math.round(p.totalEur * 100) / 100
    p.locationIds = Array.from(p._locSet)
    const { _allCost, _locSet, ...clean } = p
    void _allCost; void _locSet
    out.push(clean)
  }
  out.sort((a, b) => b.totalEur - a.totalEur)
  return out
}

// ─────────────────────────────────────────────────────────────────────
// API pública — acciones (ignorar con motivo / deshacer)
// ─────────────────────────────────────────────────────────────────────

/**
 * Ignora un producto ciego de una marca con un MOTIVO obligatorio. Acotado a la
 * marca (p_brand_id) para no ignorarlo en otras marcas por error. Reusa
 * resolve_unmapped_sales (action='ignore'). Devuelve nº de líneas afectadas.
 */
export async function ignoreBrandProduct(
  accountId: string,
  brandId: string,
  productName: string,
  reason: string,
): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('resolve_unmapped_sales', {
    p_account_id: accountId,
    p_product_name: productName,
    p_action: 'ignore',
    p_reason: reason,
    p_brand_id: brandId,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as { lineas_afectadas?: number } | undefined
  return Number(row?.lineas_afectadas ?? 0)
}

/**
 * Deshace el ignore de un producto de una marca: lo devuelve a pendiente y recasa
 * (recomputa la razón real). Acotado a la marca. Devuelve nº de líneas reabiertas.
 */
export async function unignoreBrandProduct(
  accountId: string,
  brandId: string,
  productName: string,
): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('unignore_unmapped_sales', {
    p_account_id: accountId,
    p_product_name: productName,
    p_brand_id: brandId,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as { lineas_afectadas?: number } | undefined
  return Number(row?.lineas_afectadas ?? 0)
}
