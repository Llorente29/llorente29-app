// src/modules/supply/services/ctbNotifyService.ts
//
// Cola "Comunicar a CTB": recepciones a nombre de un proveedor del grupo Cloudtown
// que hay que comunicar al cedente (foto del albarán al grupo de WhatsApp de la
// EMPRESA). El envío es manual (la cola persigue el OLVIDO, que es el dolor real);
// el "Enviar" abre el compartir nativo con el albarán + un texto ya redactado, y
// al confirmar el envío la entrada sale de la cola.
//
// Scope cuenta. RLS calcada de goods_receipt. La cola la alimenta
// confirm_goods_receipt al confirmar una recepción de un proveedor notify_group='ctb'.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { getReceiptFileUrl } from '@/modules/supply/services/goodsReceiptService'

export type CtbNotifyStatus = 'pendiente' | 'enviado'

export interface CtbNotifyItem {
  id: string
  goodsReceiptId: string
  status: CtbNotifyStatus
  hasDifferences: boolean
  sentByName: string | null
  sentAt: string | null
  createdAt: string
  // datos de la recepción (para pintar y redactar el mensaje)
  receiptCode: string | null
  receiptDate: string | null
  supplierDocNumber: string | null
  rawDocumentUrl: string | null
  supplierName: string | null
  locationName: string | null
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

type Row = Record<string, unknown>
function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

function rowToItem(r: Row): CtbNotifyItem {
  const gr = (r.goods_receipt ?? null) as Row | null
  const sup = (r.supplier ?? null) as Row | null
  const loc = (r.location ?? null) as Row | null
  return {
    id: r.id as string,
    goodsReceiptId: r.goods_receipt_id as string,
    status: r.status as CtbNotifyStatus,
    hasDifferences: Boolean(r.has_differences),
    sentByName: (r.sent_by_name as string | null) ?? null,
    sentAt: (r.sent_at as string | null) ?? null,
    createdAt: r.created_at as string,
    receiptCode: (gr?.code as string | null) ?? null,
    receiptDate: (gr?.receipt_date as string | null) ?? null,
    supplierDocNumber: (gr?.supplier_doc_number as string | null) ?? null,
    rawDocumentUrl: (gr?.raw_document_url as string | null) ?? null,
    supplierName: (sup?.name as string | null) ?? null,
    locationName: (loc?.name as string | null) ?? null,
  }
}

// Lista la cola de una cuenta. status: filtra (por defecto 'pendiente').
// Ordena: pendientes con diferencias primero, luego por fecha.
export async function listCtbQueue(
  accountId: string,
  status: CtbNotifyStatus | 'all' = 'pendiente',
): Promise<CtbNotifyItem[]> {
  requireSupabase()
  let q = from('ctb_notification_queue')
    .select(`
      id, goods_receipt_id, status, has_differences, sent_by_name, sent_at, created_at,
      goods_receipt:goods_receipt_id ( code, receipt_date, supplier_doc_number, raw_document_url ),
      supplier:supplier_id ( name ),
      location:location_id ( name )
    `)
    .eq('account_id', accountId)
    .order('has_differences', { ascending: false })
    .order('created_at', { ascending: false })
  if (status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(`Error cargando la cola de CTB: ${error.message}`)
  return ((data as Row[]) ?? []).map(rowToItem)
}

// Conteo de pendientes (para el badge del menú/contador).
export async function countCtbPending(accountId: string): Promise<number> {
  requireSupabase()
  const { count, error } = await from('ctb_notification_queue')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'pendiente')
  if (error) { console.error('[ctbNotifyService] countCtbPending', error); return 0 }
  return count ?? 0
}

// Marca una entrada como enviada (RPC con sesión; deja rastro de quién/cuándo).
export async function markCtbSent(queueId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('mark_ctb_notification_sent', { p_queue_id: queueId })
  if (error) throw new Error(`No se pudo marcar como enviado: ${error.message}`)
}

// URL firmada del albarán (reusa el helper del servicio de recepción).
export async function getCtbReceiptFileUrl(path: string | null | undefined): Promise<string | null> {
  return getReceiptFileUrl(path)
}

// Texto del mensaje para el grupo de CTB. Incluye la cuña sutil "folvy.app"
// (publicidad pasiva ante el cedente; WhatsApp la auto-enlaza). Si hay diferencias,
// lo dice explícito (CTB: "si hay diferencias las comunicas").
export function buildCtbMessage(item: CtbNotifyItem): string {
  const fecha = item.receiptDate
    ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(item.receiptDate))
    : '—'
  const lines = [
    'Recepción de mercancía',
    item.supplierName ? `Proveedor: ${item.supplierName}` : null,
    item.locationName ? `Local: ${item.locationName}` : null,
    `Fecha: ${fecha}`,
    item.supplierDocNumber ? `Albarán nº: ${item.supplierDocNumber}` : null,
    item.receiptCode ? `Ref. Folvy: ${item.receiptCode}` : null,
    item.hasDifferences ? '⚠️ Recepción CON diferencias respecto al pedido.' : 'Sin diferencias.',
    '',
    'Enviado con Folvy · folvy.app',
  ]
  return lines.filter(Boolean).join('\n')
}
