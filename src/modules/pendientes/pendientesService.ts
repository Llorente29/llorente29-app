// src/modules/pendientes/pendientesService.ts
//
// ENCARGO CODE (14/08) Pantalla de PENDIENTES, Fase 1. Envuelve las RPC
// pending_board / dismiss_pending. El alcance por rol/local vive DENTRO de
// la RPC (ver migración) — este service no filtra nada, solo traduce.

import { supabase, isSupabaseEnabled } from '../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

export type PendingLayer = 'ahora' | 'semana' | 'salud'
export type PendingPreset = 'manana' | 'semana' | 'mes'
export type DismissReason =
  | 'ya está resuelto fuera de Folvy'
  | 'no aplica a este local'
  | 'es un error del sistema'

export interface PendingItem {
  pendingKind: string
  layer: PendingLayer
  area: string
  locationId: string
  locationName: string
  items: number
  detail: Record<string, unknown>
  sortWeight: number
}

interface PendingBoardRow {
  pending_kind: string
  layer: string
  area: string
  location_id: string
  location_name: string
  items: number
  detail: Record<string, unknown>
  sort_weight: number
}

export async function getPendingBoard(accountId: string): Promise<PendingItem[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('pending_board', { p_account_id: accountId })
  if (error) throw new Error(`No se pudo cargar el tablero de pendientes: ${error.message}`)
  return ((data as PendingBoardRow[]) ?? []).map(r => ({
    pendingKind: r.pending_kind,
    layer: r.layer as PendingLayer,
    area: r.area,
    locationId: r.location_id,
    locationName: r.location_name,
    items: r.items,
    detail: r.detail ?? {},
    sortWeight: r.sort_weight,
  }))
}

export async function postponePending(
  accountId: string,
  pendingKind: string,
  locationId: string,
  preset: PendingPreset
): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('dismiss_pending', {
    p_account_id: accountId,
    p_pending_kind: pendingKind,
    p_location_id: locationId,
    p_action: 'posponer',
    p_preset: preset,
  })
  if (error) throw new Error(`No se pudo posponer: ${error.message}`)
}

export async function dismissPending(
  accountId: string,
  pendingKind: string,
  locationId: string,
  reason: DismissReason
): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('dismiss_pending', {
    p_account_id: accountId,
    p_pending_kind: pendingKind,
    p_location_id: locationId,
    p_action: 'descartar',
    p_reason: reason,
  })
  if (error) throw new Error(`No se pudo descartar: ${error.message}`)
}

// ─────────────────────────────────────────────────────────────────────
// Textos y destino de botón — A.2, literales del encargo. Un solo sitio:
// si se añade un pending_kind, se añade una línea aquí, no se busca por
// el código de la pantalla.
//
// 🔴 DEUDA DECLARADA: el destino navega a la pantalla correcta, pero
// NINGUNA de las pantallas de Supply lee hoy un query param de filtro
// (verificado: GoodsReceiptsPage no usa useSearchParams). El botón dice
// "revisar los 2 albaranes" pero aterriza en la lista SIN filtrar a ese
// subconjunto — el "filtrada a X" de la columna A.2 no está cumplido
// todavía. Cablear el filtro real en cada pantalla de destino es trabajo
// aparte, no de esta rama; los query params de abajo quedan como el
// contrato que esas pantallas deberían empezar a leer.
// ─────────────────────────────────────────────────────────────────────
export interface PendingKindMeta {
  text: (n: number) => string
  buttonText: (n: number) => string
  destination: (locationId: string) => string
}

const PENDING_KIND_META: Record<string, PendingKindMeta> = {
  recepcion_esperando_oficina: {
    text: n => `${n} recepción${n === 1 ? '' : 'es'} esperan tu verificación`,
    buttonText: n => `Revisar ${n === 1 ? 'la' : 'las'} ${n} recepci${n === 1 ? 'ón' : 'ones'}`,
    destination: () => '/supply/recepciones?estado=recibido',
  },
  albaran_genero_sin_casar: {
    text: n => `${n} albarán${n === 1 ? '' : 'es'} con género que no ha entrado al almacén`,
    buttonText: () => 'Meter al stock',
    destination: () => '/supply/recepciones?estado=confirmado_revision',
  },
  pedido_vencido: {
    text: n => `${n} pedido${n === 1 ? '' : 's'} que el proveedor no ha traído`,
    buttonText: n => `Revisar ${n === 1 ? 'el' : 'los'} ${n} pedido${n === 1 ? '' : 's'}`,
    destination: () => '/supply?estado=vencido',
  },
  albaran_borrador_atascado: {
    text: n => `${n} albarán${n === 1 ? '' : 'es'} a medio registrar`,
    buttonText: n => `Revisar ${n === 1 ? 'el' : 'los'} ${n} albarán${n === 1 ? '' : 'es'}`,
    destination: () => '/supply/recepciones?estado=borrador',
  },
  pedido_borrador_atascado: {
    text: n => `${n} pedido${n === 1 ? '' : 's'} sin enviar al proveedor`,
    buttonText: n => `Revisar ${n === 1 ? 'el' : 'los'} ${n} pedido${n === 1 ? '' : 's'}`,
    destination: () => '/supply?estado=borrador',
  },
  recuento_abierto: {
    // Sin filtro cableado en InventoryPage todavía (14/08, §0.2) — texto
    // honesto en vez de un botón que promete filtrar y no filtra.
    text: n => `${n} recuento${n === 1 ? '' : 's'} de inventario sin cerrar`,
    buttonText: () => 'Ir a Inventarios',
    destination: () => '/supply/inventario',
  },
  recuento_sin_aprobar: {
    text: n => `${n} recuento${n === 1 ? '' : 's'} contado${n === 1 ? '' : 's'} y sin aprobar`,
    buttonText: () => 'Ir a Inventarios',
    destination: () => '/supply/inventario',
  },
  linea_sin_coste: {
    // No cableado (14/08): es un filtro por LÍNEA de albarán, no por
    // recepción — GoodsReceiptsPage filtra por status de la recepción, no
    // tiene forma barata de saber qué recepción contiene una línea sin
    // coste sin una consulta aparte. Hasta que exista esa consulta, texto
    // honesto: dice adónde va, no promete filtrar.
    text: n => `${n} entrada${n === 1 ? '' : 's'} de género sin precio: no cuentan en tu coste`,
    buttonText: () => 'Ir a Recepciones',
    destination: () => '/supply/recepciones',
  },
  stock_negativo: {
    text: n => `${n} artículo${n === 1 ? '' : 's'} en negativo`,
    buttonText: () => 'Ir a Inventarios',
    destination: () => '/supply/inventario',
  },
}

export function pendingKindMeta(kind: string): PendingKindMeta {
  return (
    PENDING_KIND_META[kind] ?? {
      text: n => `${n} pendiente${n === 1 ? '' : 's'}`,
      buttonText: n => `Ver ${n === 1 ? 'el' : 'los'} ${n}`,
      destination: () => '/',
    }
  )
}

export const DISMISS_REASONS: DismissReason[] = [
  'ya está resuelto fuera de Folvy',
  'no aplica a este local',
  'es un error del sistema',
]
