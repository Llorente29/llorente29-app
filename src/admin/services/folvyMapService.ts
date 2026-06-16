// src/admin/services/folvyMapService.ts
//
// Mapa de Folvy — lectura del diagrama de flujo (folvy_map_node, GLOBAL sin
// account_id) + medición de estado EN VIVO (RPC folvy_map_measure) + edición del
// estado declarado. La tabla la mantiene Julio/SQL (la semilla de 39 nodos NO se
// regenera desde aquí); la página solo LEE + EDITA status_declared/status_note.
//
// RLS: lectura para cualquier authenticated; escritura solo platform_admins (la
// política ya protege el UPDATE — no añadimos guard de cliente).
//
// folvy_map_node aún NO está en database.ts → acceso UNTYPED, mismo patrón que el
// resto del módulo admin (lastappIntegrationService) y kdsService.

import { supabase } from '@/lib/supabase'

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

type Row = Record<string, unknown>

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

// JUICIO declarado de cada caja (manda sobre el color). El medido es secundario.
export type MapNodeStatus = 'vivo' | 'a_medias' | 'deuda' | 'bloqueado' | 'vacio' | 'idea'

export interface MapNode {
  id: string
  code: string
  name: string
  description: string | null
  parentId: string | null
  layer: string
  flowOrder: number
  statusDeclared: MapNodeStatus
  statusNote: string | null
  measureTable: string | null
  isActive: boolean
}

function rowToNode(r: Row): MapNode {
  return {
    id: r.id as string,
    code: (r.code as string) ?? '',
    name: (r.name as string) ?? '',
    description: (r.description as string | null) ?? null,
    parentId: (r.parent_id as string | null) ?? null,
    layer: (r.layer as string) ?? '',
    flowOrder: Number(r.flow_order ?? 0),
    statusDeclared: ((r.status_declared as string) ?? 'idea') as MapNodeStatus,
    statusNote: (r.status_note as string | null) ?? null,
    measureTable: (r.measure_table as string | null) ?? null,
    isActive: Boolean(r.is_active),
  }
}

/** Nodos activos del mapa, ya ordenados por capa y orden de flujo. */
export async function listMapNodes(): Promise<MapNode[]> {
  requireSupabase()
  const { data, error } = await from('folvy_map_node')
    .select('id, code, name, description, parent_id, layer, flow_order, status_declared, status_note, measure_table, is_active')
    .eq('is_active', true)
    .order('layer', { ascending: true })
    .order('flow_order', { ascending: true })
  if (error) throw new Error(`Error cargando el mapa: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(rowToNode)
}

/**
 * Conteo ESTIMADO de filas por measure_table (n_live_tup) vía la RPC
 * folvy_map_measure. UNA sola llamada: la RPC saca el conjunto de tablas de los
 * propios nodos (no N selects con select('*')). Devuelve un mapa
 * measure_table → filas. Sin estadística → 0 (basta para "vacío vs poblado").
 */
export async function getMeasuredCounts(): Promise<Record<string, number>> {
  requireSupabase()
  const { data, error } = await (supabase! as unknown as {
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('folvy_map_measure')
  if (error) throw new Error(`Error midiendo el mapa: ${error.message}`)
  const map: Record<string, number> = {}
  for (const r of (data as { measure_table: string; filas: number }[] | null) ?? []) {
    if (r.measure_table) map[r.measure_table] = Number(r.filas ?? 0)
  }
  return map
}

/** Reclasifica una caja: estado declarado + nota (RLS limita a platform_admins). */
export async function updateNodeStatus(
  id: string,
  statusDeclared: MapNodeStatus,
  statusNote: string | null,
): Promise<void> {
  requireSupabase()
  const { error } = await from('folvy_map_node')
    .update({
      status_declared: statusDeclared,
      status_note: statusNote,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(`No se pudo guardar el estado: ${error.message}`)
}
