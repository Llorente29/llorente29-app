// src/modules/kitchen/services/costAverageService.ts
//
// Coste medio ponderado de lo comprado (27/09). Dos llamadas:
//   · de dónde sale el coste de un artículo: las líneas de albarán de la
//     ventana, las que entran y las que el guardia deja fuera, con su motivo;
//   · aprobar que un artículo pase a media ponderada, uno a uno.
// El cálculo vive en la base (_article_weighted_cost). Aquí no se recalcula
// nada: se pinta lo que la base dice, para que la ficha y el motor no puedan
// discrepar.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}
// Las RPC no están aún en database.ts (se regenera después de aplicar la migración).
type RpcResult = { data: unknown; error: { message: string } | null }
function rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult> {
  return (supabase! as unknown as {
    rpc: (fn: string, a: Record<string, unknown>) => PromiseLike<RpcResult>
  }).rpc(fn, args)
}

export type CostAverageMethod = 'media' | 'poco_dato' | 'ultima_conocida' | 'sin_compras'
export type CostDiscardReason =
  | 'importe_no_positivo'
  | 'mas_de_3x_la_mediana'
  | 'menos_de_un_tercio_de_la_mediana'

export interface CostBasisLine {
  lineaId: string
  albaran: string | null
  fecha: string
  proveedor: string | null
  producto: string
  cantidad: number
  importe: number
  eurUnidad: number
  entra: boolean
  motivo: CostDiscardReason | null
}

export interface CostRollout {
  grupo: 'quieto' | 'se_mueve' | 'imposible' | 'sin_compras' | 'plantilla' | 'archivado' | 'ventana_retirada'
  estado: 'pendiente' | 'encendido' | 'no_aplica'
  costeAntes: number | null
  costeMedia: number | null
  pctCambio: number | null
  decididoAt: string | null
  decididoByName: string | null
}

export interface CostBreakdown {
  estrategia: string
  costeActual: number | null
  ventanaDias: number
  desde: string
  metodo: CostAverageMethod
  coste: number | null
  lineasVentana: number
  descartadas: number
  pctDescartadas: number
  cantidad: number | null
  importe: number | null
  ultimaCompra: { albaran: string | null; fecha: string; eurUnidad: number } | null
  lineas: CostBasisLine[]
  rollout: CostRollout | null
}

export interface ApproveAverageResult {
  encendido: boolean
  nombre: string
  motivo: string | null
  antes: number | null
  despues: number | null
  metodo: CostAverageMethod | null
  lineas: number | null
  descartadas: number | null
  pctDescartadas: number | null
  avisoDescartes: boolean
}

type Row = Record<string, unknown>
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function mapLine(l: Row): CostBasisLine {
  return {
    lineaId: String(l.linea_id),
    albaran: (l.albaran as string | null) ?? null,
    fecha: String(l.fecha),
    proveedor: (l.proveedor as string | null) ?? null,
    producto: String(l.producto ?? ''),
    cantidad: Number(l.cantidad),
    importe: Number(l.importe),
    eurUnidad: Number(l.eur_unidad),
    entra: Boolean(l.entra),
    motivo: (l.motivo as CostDiscardReason | null) ?? null,
  }
}

export async function getCostBreakdown(itemId: string): Promise<CostBreakdown> {
  requireSupabase()
  const { data, error } = await rpc('article_cost_breakdown', { p_item_id: itemId })
  if (error) throw new Error(`No se pudo leer de dónde sale el coste: ${error.message}`)
  const d = data as Row
  const r = d.rollout as Row | null
  const u = d.ultima_compra as Row | null
  return {
    estrategia: String(d.estrategia),
    costeActual: num(d.coste_actual),
    ventanaDias: Number(d.ventana_dias),
    desde: String(d.desde),
    metodo: d.metodo as CostAverageMethod,
    coste: num(d.coste),
    lineasVentana: Number(d.lineas_ventana ?? 0),
    descartadas: Number(d.descartadas ?? 0),
    pctDescartadas: Number(d.pct_descartadas ?? 0),
    cantidad: num(d.cantidad),
    importe: num(d.importe),
    ultimaCompra: u
      ? { albaran: (u.albaran as string | null) ?? null, fecha: String(u.fecha), eurUnidad: Number(u.eur_unidad) }
      : null,
    lineas: ((d.lineas as Row[] | null) ?? []).map(mapLine),
    rollout: r
      ? {
          grupo: r.grupo as CostRollout['grupo'],
          estado: r.estado as CostRollout['estado'],
          costeAntes: num(r.coste_antes),
          costeMedia: num(r.coste_media),
          pctCambio: num(r.pct_cambio),
          decididoAt: (r.decidido_at as string | null) ?? null,
          decididoByName: (r.decidido_by_name as string | null) ?? null,
        }
      : null,
  }
}

export async function approveAverageCost(itemId: string): Promise<ApproveAverageResult> {
  requireSupabase()
  const { data, error } = await rpc('approve_average_cost', { p_item_id: itemId, p_solo_si_no_cambia: false })
  if (error) throw new Error(`No se pudo pasar a media ponderada: ${error.message}`)
  const d = data as Row
  return {
    encendido: Boolean(d.encendido),
    nombre: String(d.nombre ?? ''),
    motivo: (d.motivo as string | null) ?? null,
    antes: num(d.antes),
    despues: num(d.despues),
    metodo: (d.metodo as CostAverageMethod | null) ?? null,
    lineas: num(d.lineas),
    descartadas: num(d.descartadas),
    pctDescartadas: num(d.pct_descartadas),
    avisoDescartes: Boolean(d.aviso_descartes),
  }
}
