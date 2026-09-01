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
import {
  getOrderShortfall, buildOrderClaimMessage, type OrderShortfallLine,
} from '@/modules/supply/services/purchaseOrderService'

export type CtbNotifyStatus = 'pendiente' | 'enviado'

export interface CtbNotifyItem {
  id: string
  /** null en una RECLAMACIÓN de pedido (ver purchaseOrderId). */
  goodsReceiptId: string | null
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
  // ENCARGO CODE (21/08) — una entrada de la cola es de una RECEPCIÓN o de un
  // PEDIDO (reclamar lo que falta), nunca de las dos: lo garantiza el CHECK
  // ctb_queue_recepcion_o_pedido, no la buena voluntad de este fichero.
  purchaseOrderId: string | null
  orderCode: string | null
  orderExpectedDate: string | null
  /** Lo que falta del pedido, para redactar. Se rellena aparte (una consulta por fila). */
  faltan: OrderShortfallLine[] | null
}

/** ¿Esta entrada es una reclamación de pedido? */
export function esReclamacionDePedido(i: CtbNotifyItem): boolean {
  return i.purchaseOrderId !== null
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
  const po = (r.purchase_order ?? null) as Row | null
  return {
    id: r.id as string,
    goodsReceiptId: (r.goods_receipt_id as string | null) ?? null,
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
    purchaseOrderId: (r.purchase_order_id as string | null) ?? null,
    orderCode: (po?.code as string | null) ?? null,
    orderExpectedDate: (po?.expected_date as string | null) ?? null,
    faltan: null,
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
      id, goods_receipt_id, purchase_order_id, status, has_differences, sent_by_name, sent_at, created_at,
      goods_receipt:goods_receipt_id ( code, receipt_date, supplier_doc_number, raw_document_url ),
      purchase_order:purchase_order_id ( code, expected_date ),
      supplier:supplier_id ( name ),
      location:location_id ( name )
    `)
    .eq('account_id', accountId)
    .order('has_differences', { ascending: false })
    .order('created_at', { ascending: false })
  if (status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(`Error cargando la cola de CTB: ${error.message}`)
  const items = ((data as Row[]) ?? []).map(rowToItem)

  // Las reclamaciones necesitan saber QUÉ falta para poder redactarse. Se pide
  // sólo para ellas —hoy son pocas— y un fallo aquí NO tumba la cola: la fila
  // se queda sin el detalle y se dice al redactar, en vez de desaparecer.
  await Promise.all(items.filter(i => i.purchaseOrderId).map(async i => {
    try { i.faltan = (await getOrderShortfall(i.purchaseOrderId!)).filter(l => l.qtyMissing > 0) }
    catch (e) { console.warn('[ctbNotifyService] no se pudo leer lo que falta del pedido', i.purchaseOrderId, e) }
  }))
  return items
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

/**
 * LAS DIFERENCIAS DE UN ALBARÁN, CALCULADAS EN LA BBDD.
 *
 * El cálculo vive en `ctb_receipt_differences` y NO se repite aquí: de esa
 * función salen las dos cosas, el `has_differences` que decide si hay aviso y
 * el texto que se redacta abajo. Si el cálculo viviera en dos sitios acabarían
 * diciendo cosas distintas, que es lo que ya advierte buildOrderClaimMessage.
 */
export interface CtbDifference {
  linea: number
  productName: string
  docQty: number | null
  qtyReceived: number | null
  diferencia: number | null
  dimension: string
  valorEur: number | null
  motivo: string | null
  clase: 'diferencia' | 'ruido' | 'no_comparable' | 'solo_nota'
}

export async function listCtbDifferences(receiptId: string): Promise<CtbDifference[]> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as (
    fn: string, args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'ctb_receipt_differences', { p_receipt_id: receiptId },
  )
  if (error) throw new Error(`No se han podido leer las diferencias: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any[]) ?? []).map(r => ({
    linea: Number(r.linea),
    productName: String(r.product_name ?? ''),
    docQty: r.doc_qty != null ? Number(r.doc_qty) : null,
    qtyReceived: r.qty_received != null ? Number(r.qty_received) : null,
    diferencia: r.diferencia != null ? Number(r.diferencia) : null,
    dimension: String(r.dimension ?? 'unit'),
    valorEur: r.valor_eur != null ? Number(r.valor_eur) : null,
    motivo: r.motivo ?? null,
    clase: r.clase as CtbDifference['clase'],
  }))
}

const fmtEur = (n: number) =>
  n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

/** 3 → "3", 3.2 → "3,2". Sin ceros de relleno que nadie dice en voz alta. */
const fmtQty = (n: number) =>
  n.toLocaleString('es-ES', { maximumFractionDigits: 3 })

/**
 * "SOBRE AMERICANO KDB CAJA 250 UD" → "Sobre americano KDB caja 250 ud".
 *
 * El albarán viene TODO EN MAYÚSCULAS y así grita. Pero minusculizar a lo
 * bruto se come las siglas — KDB pasa a "kdb" y el proveedor ya no reconoce su
 * producto.
 *
 * La regla para distinguirlas: UNA SIGLA NO SE PUEDE PRONUNCIAR, no tiene
 * vocales. KDB se queda; BIG (que por longitud también parecía sigla) baja a
 * minúsculas como la palabra que es. Las unidades sin vocales — KG, LT, ML, CL
 * — caerían del lado equivocado, así que van en una lista corta y explícita.
 */
const PALABRAS_DE_ALMACEN = new Set([
  'CAJA', 'CAJAS', 'BOLSA', 'SACO', 'UD', 'UDS', 'KG', 'GR', 'GRS', 'LT', 'ML',
  'CL', 'PACK', 'LATA', 'BOTE', 'DE', 'Y', 'EL', 'LA', 'CON', 'SIN',
])
function nombreLegible(s: string): string {
  const palabras = s.trim().split(/\s+/).map(w => {
    const soloLetras = w.replace(/[^A-ZÁÉÍÓÚÑ]/gi, '')
    const sinVocales = soloLetras.length > 0 && !/[AEIOUÁÉÍÓÚ]/i.test(soloLetras)
    const esSigla = sinVocales && soloLetras.length <= 4
      && w === w.toUpperCase()
      && !PALABRAS_DE_ALMACEN.has(soloLetras.toUpperCase())
    return esSigla ? w : w.toLowerCase()
  })
  const t = palabras.join(' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Una línea de reclamación, con las palabras del almacén y no del programador.
 * Se usa el nombre DEL ALBARÁN, no el del catálogo: el proveedor conoce "SOBRE
 * AMERICANO KDB CAJA 250 UD", no "Bolsas Personalizadas Korean".
 *
 * El motivo escrito a mano NO sustituye al número: va detrás, como contexto.
 * Los números son la verdad; la nota es lo que alguien vio.
 */
export function lineaDeDiferencia(d: CtbDifference): string {
  const nombre = nombreLegible(d.productName)
  const nota = d.motivo ? ` Nota: ${d.motivo}` : ''

  if (d.clase === 'solo_nota') {
    return `${nombre} — cantidad correcta.${nota}`
  }
  if (d.docQty == null || d.qtyReceived == null || d.diferencia == null) {
    return `${nombre} — el albarán no dice cantidad, no se ha podido comparar.${nota}`
  }

  const papel = fmtQty(d.docQty)
  const dif = Math.abs(d.diferencia)
  const importe = d.valorEur != null ? ` · ${fmtEur(d.valorEur)}` : ''

  if (d.diferencia > 0) {
    return `${nombre} — el albarán factura ${papel} y han llegado ${fmtQty(d.qtyReceived)}`
         + ` (${fmtQty(dif)} de más).${nota}`
  }
  const llegado = d.qtyReceived === 0
    ? 'no ha llegado ninguna'
    : `han llegado ${fmtQty(d.qtyReceived)}`
  return `${nombre} — el albarán factura ${papel} y ${llegado}`
       + ` (falta ${fmtQty(dif)}${importe}).${nota}`
}

// Texto del mensaje para el grupo de CTB. Incluye la cuña sutil "folvy.app"
// (publicidad pasiva ante el cedente; WhatsApp la auto-enlaza). Si hay diferencias,
// lo dice explícito (CTB: "si hay diferencias las comunicas").
export function buildCtbMessage(item: CtbNotifyItem, difs: CtbDifference[] = []): string {
  // RECLAMACIÓN DE PEDIDO: el texto lo compone purchaseOrderService, que es
  // donde vive el dato. Aquí no se redacta una segunda versión del mismo
  // mensaje — si hubiera dos, acabarían diciendo cosas distintas.
  if (item.purchaseOrderId) {
    if (!item.faltan || item.faltan.length === 0) {
      return `Reclamación del pedido ${item.orderCode ?? ''}: no se ha podido leer qué falta. Ábrelo en Pedidos antes de mandarlo.`
    }
    return buildOrderClaimMessage({
      orderCode: item.orderCode,
      supplierName: item.supplierName,
      locationName: item.locationName,
      expectedDate: item.orderExpectedDate,
      faltan: item.faltan,
    })
  }
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
  ]

  // LAS DIFERENCIAS, UNA POR LÍNEA Y CON SUS NÚMEROS. Hasta el 01/09 aquí solo
  // iba «⚠️ Recepción CON diferencias respecto al pedido.»: el proveedor recibía
  // que había diferencias y ni qué artículo, ni cuánto, ni cuánto dinero.
  //
  // Solo viajan las de clase 'diferencia'. Las de 'ruido' (décimas de báscula)
  // se ven en el panel de revisión y se pueden añadir a mano desde ahí, pero no
  // entran solas: meterlas resta seriedad a lo que sí importa. Las
  // 'no_comparable' tampoco viajan — se cuentan en el panel, no se inventan.
  const reclamables = difs.filter(d => d.clase === 'diferencia')
  if (reclamables.length > 0) {
    lines.push('', `⚠️ Diferencias (${reclamables.length}):`)
    for (const d of reclamables) lines.push(`· ${lineaDeDiferencia(d)}`)
  } else {
    lines.push('Sin diferencias.')
  }

  // El motivo escrito a mano en una línea SIN diferencia de cantidad no es una
  // reclamación, pero es lo que vio quien recibió: viaja como contexto.
  const notas = difs.filter(d => d.clase === 'solo_nota')
  if (notas.length > 0) {
    lines.push('', 'Notas de la recepción:')
    for (const d of notas) lines.push(`· ${lineaDeDiferencia(d)}`)
  }

  lines.push('', 'Enviado con Folvy · folvy.app')
  return lines.filter(l => l !== null && l !== undefined).join('\n')
}
