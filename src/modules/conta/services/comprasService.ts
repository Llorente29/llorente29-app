// src/modules/conta/services/comprasService.ts
//
// Compras (encargo «Contabilidad: las compras», §6): lo que leen y escriben
// las pantallas. Todo pasa por las funciones de la base (0120–0170), que
// deciden y comprueban permisos; aquí solo se llaman y se traducen.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { ivaDelPapel } from '@/modules/conta/lib/compras'
import type {
  EsperandoFactura, FilaLiquidacion, FormaFacturar, Mirar, PapelLeido,
} from '@/modules/conta/lib/compras'

export async function cargarMirar(accountId: string): Promise<Mirar> {
  const m = await rpc<Mirar | null>('compras_mirar', { p_cuenta: accountId })
  return m ?? { recepciones: [], sin_camino: [], fichas: [] }
}

export async function cargarEsperando(accountId: string): Promise<EsperandoFactura[]> {
  const filas = await rpc<EsperandoFactura[] | null>('compras_esperando_factura', { p_cuenta: accountId })
  return (filas ?? []).map((f) => ({ ...f, base: Number(f.base ?? 0), receipts: Number(f.receipts), without_base: Number(f.without_base ?? 0) }))
}

export async function cargarLiquidaciones(accountId: string, mes: string): Promise<FilaLiquidacion[]> {
  const r = await rpc<{ mes: string; filas: FilaLiquidacion[] } | null>('compras_liquidaciones', { p_cuenta: accountId, p_mes: mes })
  return (r?.filas ?? []).map((f) => ({ ...f, base: Number(f.base ?? 0), saldo: f.saldo == null ? null : Number(f.saldo) }))
}

/**
 * Cuántas facturas de proveedor de ese mes están ya en el libro (asiento
 * validado), en la empresa activa.
 */
export async function contarContabilizadas(companyId: string, mes: string, hasta: string): Promise<number> {
  const { count, error } = await tabla('journal_entry')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('source_type', 'supplier_invoice').eq('status', 'validado')
    .gte('entry_date', mes).lt('entry_date', hasta)
  if (error) throw new Error(mensaje('No se pudieron contar las facturas contabilizadas', error))
  return count ?? 0
}

export function cerrarPregunta(recepcion: string, nota: string | null): Promise<{ recepcion: string; pregunta: string }> {
  return rpc('compras_cerrar_pregunta', { p_recepcion: recepcion, p_nota: nota })
}

export function rehacerCamino(recepcion: string): Promise<{ camino: string; frase: string } | null> {
  return rpc('compras_camino_rehacer', { p_recepcion: recepcion })
}

export function caminoDe(recepcion: string): Promise<{ camino: string; frase: string } | null> {
  return rpc('compras_camino_de', { p_recepcion: recepcion })
}

/** «Es de…»: a quién corresponde un nombre. Una de las tres. */
export function decidirDestinatario(accountId: string, nombre: string, a: { empresa?: string; proveedor?: string; otro?: boolean }):
  Promise<{ nombre: string; recepciones: number }> {
  return rpc('compras_destinatario_decide', {
    p_cuenta: accountId, p_nombre: nombre, p_empresa: a.empresa ?? null, p_proveedor: a.proveedor ?? null, p_otro: a.otro ?? false,
  })
}

export function cambiarFormaFacturar(proveedor: string, modo: FormaFacturar, porLocal: boolean | null, frecuencia: string | null):
  Promise<{ proveedor: string; modo: string; recepciones: number }> {
  return rpc('compras_forma_facturar', { p_proveedor: proveedor, p_modo: modo, p_por_local: porLocal, p_frecuencia: frecuencia })
}

/**
 * Sus últimos papeles leídos (N20): de qué tipo eran y si traían IVA, de lo
 * leído en cada uno (`ivaDelPapel`). La misma selección que
 * compras_ultimos_papeles (0170): sus recepciones no anuladas con papel leído
 * y tipo, de la más reciente hacia atrás. Se lee aquí, y no por esa función,
 * para sacar tipo e IVA del mismo documento.
 */
export async function ultimosPapeles(proveedor: string, cuantos = 5): Promise<PapelLeido[]> {
  const { data, error } = await tabla('goods_receipt').select('ai_session_id, receipt_date, created_at')
    .eq('supplier_id', proveedor).neq('status', 'anulado').not('ai_session_id', 'is', null)
    .order('receipt_date', { ascending: false }).order('created_at', { ascending: false }).limit(cuantos * 3)
  if (error) throw new Error(`No se pudieron leer sus últimos papeles: ${error.message}`)
  const ids = ((data ?? []) as { ai_session_id: string }[]).map((r) => r.ai_session_id)
  if (!ids.length) return []
  const { data: ses, error: e2 } = await tabla('goods_receipt_ai_session').select('id, parsed_result').in('id', ids)
  if (e2) throw new Error(`No se pudieron leer sus últimos papeles: ${e2.message}`)
  const porId = new Map(((ses ?? []) as { id: string; parsed_result: { document?: Record<string, unknown> } | null }[])
    .map((x) => [x.id, x.parsed_result?.document ?? null]))
  return ids.map((id) => porId.get(id) ?? null)
    .filter((d): d is Record<string, unknown> => !!d && typeof d.doc_type === 'string')
    .slice(0, cuantos)
    .map((d) => ({ tipo: d.doc_type as string, iva: ivaDelPapel(d) }))
}

export interface ResultadoFactura { factura: string | null; creada: boolean; repetida?: boolean; sin_importes?: boolean; motivo: string }

export function facturaDesdePapel(sesion: string, proveedor: string, local: string | null, empresa: string | null): Promise<ResultadoFactura> {
  return rpc('compras_factura_desde_papel', { p_sesion: sesion, p_proveedor: proveedor, p_local: local, p_empresa: empresa })
}

export interface Candidata { goods_receipt_id: string; code: string | null; receipt_date: string; location_id: string | null; base: number | null; proposed: boolean }

export async function candidatasDeFactura(factura: string): Promise<Candidata[]> {
  const f = await rpc<Candidata[] | null>('compras_casar_candidatos', { p_factura: factura })
  return (f ?? []).map((c) => ({ ...c, base: c.base == null ? null : Number(c.base) }))
}

export function casarFactura(factura: string, recepciones: string[]): Promise<{ casadas: number; diferencia: number; frase: string }> {
  return rpc('compras_casar', { p_factura: factura, p_recepciones: recepciones })
}

/** Unir dos fichas de proveedor: queda la primera (0100). */
export function unirFichas(queda: string, seVa: string): Promise<{ fusion: string; resumen: string }> {
  return rpc('supplier_merge_do', { p_queda: queda, p_se_va: seVa })
}

/** Deshacer una unión de fichas (0100): todo vuelve a la ficha de antes. */
export function deshacerUnion(fusion: string): Promise<{ fusion: string; deshecha: boolean }> {
  return rpc('supplier_merge_undo', { p_merge: fusion })
}

/** «Apuntarla sin descontar el IVA» (0190): registra la factura de su papel con el IVA como más gasto. */
export function sinIva(recepcion: string, empresa: string): Promise<{ factura: string; repetida: boolean; frase: string }> {
  return rpc('compras_sin_iva', { p_recepcion: recepcion, p_empresa: empresa })
}

export interface AlbaranLiquidacion { recepcion: string; codigo: string | null; fecha: string; base: number | null }

/** Los albaranes que cuenta el contraste de compras de una liquidación (0190). */
export async function albaranesDeLiquidacion(liq: string): Promise<AlbaranLiquidacion[]> {
  const v = await rpc<AlbaranLiquidacion[] | null>('compras_liquidacion_recepciones', { p_liq: liq })
  return (v ?? []).map((x) => ({ ...x, base: x.base == null ? null : Number(x.base) }))
}
