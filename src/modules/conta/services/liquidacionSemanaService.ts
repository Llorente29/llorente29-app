// src/modules/conta/services/liquidacionSemanaService.ts
//
// D07 (Julio, 23/10, camino B) · La factura de comisión de una plataforma
// (Uber) llega cada semana como su propia factura recibida, con su PDF, y se
// enlaza con las liquidaciones de su semana. Aquí: las liquidaciones que puede
// llevar una factura (las de la plataforma de su proveedor, sin otra factura,
// de los días antes de su fecha) y enlazarlas (tanda 0860,
// conta_liquidacion_enlazar_factura).
//
// Nombres de la base entre comillas (regla 40): party_role (account_id,
// party_id, role, supplier_id, channel_id), channel_settlement (id,
// account_id, channel_id, period_from, period_to, commission_invoice_id,
// is_reference, raw, external_location_text, store_id) y
// platform_store (external_text) por channel_settlement_store_id_fkey.

import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'

type Fila = Record<string, unknown>
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export interface LiquidacionDeLaSemana {
  id: string
  tienda: string | null
  desde: string
  hasta: string
  /** Lo que factura la plataforma por ella (su parte de la factura de la semana). */
  aFacturar: number
  /** Ya enlazada con ESTA factura. */
  enlazada: boolean
}

/** La fecha `dias` antes (o después, si es negativo). */
const antes = (iso: string, dias: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - dias); return d.toISOString().slice(0, 10) }

/**
 * Las liquidaciones que puede llevar esta factura: las del canal cuya
 * plataforma es su proveedor, sin otra factura y no de referencia, que acaban
 * en los 13 días antes de su fecha (la factura de la semana llega el martes
 * siguiente). Null si su proveedor no es el de ninguna plataforma.
 */
export async function liquidacionesDeLaSemana(accountId: string, supplierId: string, invoiceId: string, fecha: string): Promise<LiquidacionDeLaSemana[] | null> {
  const roles = await tabla('party_role').select('party_id, role, supplier_id, channel_id').eq('account_id', accountId).in('role', ['supplier', 'platform'])
  if (roles.error) throw new Error(mensaje('No se ha podido saber si es una plataforma', roles.error))
  const rs = (roles.data ?? []) as Fila[]
  const partes = new Set(rs.filter((r) => r.role === 'supplier' && r.supplier_id === supplierId).map((r) => String(r.party_id)))
  const canales = rs.filter((r) => r.role === 'platform' && partes.has(String(r.party_id)) && r.channel_id).map((r) => String(r.channel_id))
  if (!canales.length) return null
  const r = await tabla('channel_settlement')
    .select('id, period_from, period_to, commission_invoice_id, is_reference, raw, external_location_text, platform_store(external_text)')
    .eq('account_id', accountId).in('channel_id', canales)
    .gte('period_to', antes(fecha, 13)).lte('period_to', fecha)
    .or(`commission_invoice_id.is.null,commission_invoice_id.eq.${invoiceId}`)
    .order('period_to', { ascending: false })
  if (r.error) throw new Error(mensaje('No se han podido leer las liquidaciones de su semana', r.error))
  return ((r.data ?? []) as unknown as Fila[])
    .filter((x) => x.is_reference !== true)
    .map((x) => {
      const tienda = (x.platform_store as { external_text?: string } | null)?.external_text ?? txt(x.external_location_text)
      const total = Number(((x.raw ?? null) as { factura?: { total?: unknown } } | null)?.factura?.total ?? 0)
      return {
        id: String(x.id), tienda: tienda ? tienda.replace(/\s*\(.*\)\s*$/, '') : null,
        desde: String(x.period_from), hasta: String(x.period_to), aFacturar: total > 0 ? total : 0, enlazada: x.commission_invoice_id === invoiceId,
      }
    })
    .filter((x) => x.aFacturar > 0 || x.enlazada)
}

/** Enlazarla con esas liquidaciones. Devuelve la frase de lo hecho (cuántas, cuánto suman contra su total). */
export async function enlazarConLiquidaciones(invoiceId: string, ids: readonly string[], quien: string | null): Promise<{ texto: string; cuadra: boolean }> {
  const r = await rpc<{ texto: string; cuadra: boolean }>('conta_liquidacion_enlazar_factura', { p_invoice: invoiceId, p_liquidaciones: [...ids], p_quien_nombre: quien })
  return { texto: r.texto, cuadra: r.cuadra === true }
}
