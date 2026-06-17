// src/modules/supply/services/avtService.ts
//
// AvT por periodo (capa 3+4). Llama a la RPC avt_period (motor consolidado) y
// agrupa el resultado en el cliente por la dimensión elegida (local/almacén/
// familia/artículo). Solo los artículos 'medible' suman al total de merma; el
// resto se cuenta aparte para la salud del dato (números honestos o ninguno).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

type Row = Record<string, unknown>

export type AvtStatus = 'medible' | 'sin_apertura' | 'dato_incompleto' | 'escandallo_no_fiable'

export interface AvtItem {
  recipeItemId: string
  itemName: string
  locationId: string
  locationName: string
  areaName: string | null
  familyId: string | null
  familyName: string | null
  unitAbbr: string | null
  initQty: number | null
  initSource: 'conteo' | 'apertura' | null
  buysQty: number
  consumoQty: number
  theoFinal: number | null
  realFinal: number
  mermaQty: number | null
  mermaEur: number | null
  status: AvtStatus
  initEstimated: boolean
}

export async function getAvtPeriod(input: {
  accountId: string
  from: string
  to: string
  locationId?: string | null
}): Promise<AvtItem[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('avt_period', {
    p_account: input.accountId,
    p_from: input.from,
    p_to: input.to,
    p_location: input.locationId ?? undefined,
  })
  if (error) throw new Error(`No se pudo calcular el AvT del periodo: ${error.message}`)
  const obj = (data ?? {}) as { items?: unknown }
  return ((obj.items ?? []) as Row[]).map(r => ({
    recipeItemId: String(r.recipe_item_id),
    itemName: (r.item_name as string) ?? '(sin nombre)',
    locationId: String(r.location_id),
    locationName: (r.location_name as string) ?? '(local)',
    areaName: (r.area_name as string | null) ?? null,
    familyId: (r.family_id as string | null) ?? null,
    familyName: (r.family_name as string | null) ?? null,
    unitAbbr: (r.unit_abbr as string | null) ?? null,
    initQty: r.init_qty == null ? null : Number(r.init_qty),
    initSource: (r.init_source as 'conteo' | 'apertura' | null) ?? null,
    buysQty: Number(r.buys_qty ?? 0),
    consumoQty: Number(r.consumo_qty ?? 0),
    theoFinal: r.theo_final == null ? null : Number(r.theo_final),
    realFinal: Number(r.real_final ?? 0),
    mermaQty: r.merma_qty == null ? null : Number(r.merma_qty),
    mermaEur: r.merma_eur == null ? null : Number(r.merma_eur),
    status: (r.status as AvtStatus) ?? 'sin_apertura',
    initEstimated: Boolean(r.init_estimated),
  }))
}

export type AvtGroupBy = 'local' | 'almacen' | 'familia' | 'articulo'

export interface AvtGroup {
  key: string
  label: string
  sublabel: string | null
  mermaEur: number       // suma de mermas medibles del grupo
  measurable: number     // nº de artículos medibles
  total: number          // nº de artículos del grupo
}

// Agrupa los items por la dimensión elegida. Solo 'medible' suma a mermaEur.
export function groupAvt(items: AvtItem[], by: AvtGroupBy): AvtGroup[] {
  const map = new Map<string, AvtGroup>()
  for (const it of items) {
    let key: string, label: string, sublabel: string | null = null
    switch (by) {
      case 'local': key = it.locationId; label = it.locationName; break
      case 'almacen': key = `${it.locationId}|${it.areaName ?? '—'}`; label = it.areaName ?? 'Sin almacén'; sublabel = it.locationName; break
      case 'familia': key = it.familyId ?? '—'; label = it.familyName ?? 'Sin familia'; break
      case 'articulo': key = `${it.recipeItemId}|${it.locationId}`; label = it.itemName; sublabel = it.locationName; break
    }
    let g = map.get(key)
    if (!g) { g = { key, label, sublabel, mermaEur: 0, measurable: 0, total: 0 }; map.set(key, g) }
    g.total += 1
    if (it.status === 'medible' && it.mermaEur != null) { g.mermaEur += it.mermaEur; g.measurable += 1 }
  }
  return Array.from(map.values()).sort((a, b) => Math.abs(b.mermaEur) - Math.abs(a.mermaEur))
}

export interface AvtHealth {
  measurable: number
  sinApertura: number
  datoIncompleto: number
  escandalloNoFiable: number
  initEstimated: number
  totalMermaEur: number
  level: 'none' | 'partial' | 'good'
}

export function avtHealth(items: AvtItem[]): AvtHealth {
  const measurable = items.filter(i => i.status === 'medible')
  const sinApertura = items.filter(i => i.status === 'sin_apertura').length
  const datoIncompleto = items.filter(i => i.status === 'dato_incompleto').length
  const escandalloNoFiable = items.filter(i => i.status === 'escandallo_no_fiable').length
  const initEstimated = measurable.filter(i => i.initEstimated).length
  const totalMermaEur = measurable.reduce((s, i) => s + (i.mermaEur ?? 0), 0)
  let level: 'none' | 'partial' | 'good' = 'none'
  if (items.length > 0) {
    level = (datoIncompleto === 0 && escandalloNoFiable === 0 && sinApertura === 0 && initEstimated === 0)
      ? 'good' : (measurable.length > 0 ? 'partial' : 'none')
  }
  return { measurable: measurable.length, sinApertura, datoIncompleto, escandalloNoFiable, initEstimated, totalMermaEur, level }
}
