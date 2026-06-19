// src/modules/orders/lib/ticketRenderer.ts
//
// Renderizador de TICKETS (capa 1: texto + estructura + QR).
//
// Produce un MODELO INTERMEDIO de ticket (lista de bloques con estilo), no bytes
// directos. De ese modelo salen dos cosas:
//   - una vista de PREVISUALIZACIÓN en pantalla (ticketPreview, sin impresora)
//   - en una capa siguiente, los bytes ESC/POS para la impresora real
// Separar el modelo de las salidas evita escribir bytes a ciegas y deja el
// renderizador puro y testeable (sin Supabase, sin DOM).
//
// Tres documentos (diseño aprobado, docs/folvy_impresion_diseno.md):
//   1. renderBagTicket    - bolsa/cliente: marca, fiscal, entrega, productos CON
//      precios, IVA, total, QR a la shop (caption configurable).
//   2. renderKitchenTicket - cocina: SIN precios, agrupado por categoría (family),
//      "Sin categoría" al final; modificadores con su lógica (sin/extra).
//   3. renderLabels        - pegatinas opción (c): una por artículo de comida +
//      una agrupada "bolsa bebidas/postres". Alérgenos en texto (capa 1).
//
// Número de ticket (decisión Julio): marca propia (own) -> correlativo Folvy
// (ticket_code, futuro; hoy cae a external_ref); marca cedida (licensed) ->
// external_ref de Last. La función ticketNumber() centraliza la regla.

import type { OrderFeedItem, OrderFeedLine, OrderFeedChild } from '../services/ordersFeedService'
import { childVisual } from '../services/ordersFeedService'

// ── Modelo intermedio ───────────────────────────────────────────────────────

export type Align = 'left' | 'center' | 'right'

/** Un bloque de ticket. El renderizador produce una lista de estos. */
export type TicketBlock =
  | { kind: 'text'; text: string; align?: Align; bold?: boolean; size?: 1 | 2 | 3; muted?: boolean }
  | { kind: 'row'; left: string; right: string; bold?: boolean; muted?: boolean }
  | { kind: 'banner'; text: string }                 // texto blanco sobre negro (banda)
  | { kind: 'rule'; dashed?: boolean }               // línea separadora
  | { kind: 'space'; lines?: number }                // hueco vertical
  | { kind: 'qr'; data: string; caption?: string; size?: 'sm' | 'lg' }
  | { kind: 'cut' }                                  // corte de papel (una etiqueta por ticket)

export interface TicketDoc {
  /** Identificador del documento, para depurar / cabecera de preview. */
  title: string
  /** 80mm estándar; lo dejamos explícito por si una pegatina usa otro ancho. */
  widthMm: 80 | 58
  blocks: TicketBlock[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function ticketNumber(order: OrderFeedItem): string {
  // Marca propia: correlativo Folvy (cuando exista ticket_code). Hoy no está en
  // el feed, así que cae a external_ref. Marca cedida: external_ref de Last.
  // En ambos casos el identificador VISIBLE protagonista es order_code (abajo).
  return order.external_tab_ref ?? order.external_ref ?? '—'
}

/** Código de pedido grande (el protagonista): el ref corto del canal. */
function orderCode(order: OrderFeedItem): string {
  // external_tab_ref suele ser un uuid largo; el código corto "G406" viene del
  // canal. Usamos external_ref si parece corto; si no, los últimos 5 del tab.
  const ref = order.external_ref ?? ''
  if (ref && ref.length <= 8) return ref.toUpperCase()
  const tab = order.external_tab_ref ?? order.external_ref ?? ''
  return tab ? ('#' + tab.replace(/-/g, '').slice(-5).toUpperCase()) : '—'
}

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Reparto: etiqueta legible del service_type. */
function deliveryLabel(serviceType: string | null): string {
  const t = (serviceType ?? '').toLowerCase()
  if (t.includes('pickup') || t.includes('collection') || t.includes('takeaway')) return 'RECOGIDA'
  if (t.includes('platform')) return 'REPARTO PLATAFORMA'
  if (t.includes('own')) return 'REPARTO PROPIO'
  return serviceType ? serviceType.toUpperCase() : 'REPARTO'
}

/** ¿Es bebida/postre? (va en bolsa aparte en la pegatina opción c).
 *  Prioriza la FAMILIA (dato fiable); cae al nombre solo si no hay familia. */
function isDrinkOrDessert(family: string | null, name: string): boolean {
  const fam = (family ?? '').toLowerCase()
  if (fam) return /bebida|drink|refresco|postre|dessert|dulce/.test(fam)
  // sin familia: heurística por nombre (red de seguridad)
  return /mahou|coca|cola|agua|cerveza|fanta|sprite|refresco|nestea|aquarius|zumo/.test(name.toLowerCase())
}

/** Artículo FÍSICO aplanado: una línea suelta es 1 artículo; un combo se expande
 *  en sus componentes (combo_item). Cada artículo lleva su nombre, qty, familia,
 *  alérgenos (de la línea padre si es combo), modificadores propios. */
interface FlatItem {
  name: string
  qty: number
  family: string | null
  allergens: string[]
  modifiers: OrderFeedChild[]
  isDrink: boolean
}

function flattenItems(order: OrderFeedItem): FlatItem[] {
  const out: FlatItem[] = []
  const pushExpanded = (it: FlatItem) => {
    // Comida: una pegatina por UNIDAD física (cada envase su etiqueta) -> expandir qty.
    // Bebidas/postres: se agrupan en la bolsa de bebidas -> no se expanden aquí.
    if (it.isDrink) { out.push(it); return }
    const n = Math.max(1, Math.round(it.qty))
    for (let i = 0; i < n; i++) out.push({ ...it, qty: 1 })
  }
  for (const line of order.lineas) {
    const comboComponents = line.children.filter(c => c.line_type === 'combo_item')
    if (comboComponents.length > 0) {
      // Es un combo: cada componente es un artículo físico propio (expandido por su qty).
      for (const comp of comboComponents) {
        pushExpanded({
          name: comp.name,
          qty: comp.qty,
          family: comp.family,
          allergens: line.allergens,                 // alérgenos del plato padre (aprox.)
          modifiers: [],                             // los modificadores de combo cuelgan aparte; simplificamos
          isDrink: isDrinkOrDessert(comp.family, comp.name),
        })
      }
    } else {
      // Suelto: un artículo (expandido por su qty), con sus modificadores (no combo_item).
      pushExpanded({
        name: line.name,
        qty: line.qty,
        family: line.family,
        allergens: line.allergens,
        modifiers: line.children.filter(c => c.line_type !== 'combo_item'),
        isDrink: isDrinkOrDessert(line.family, line.name),
      })
    }
  }
  return out
}

/** Modificadores de una línea, en texto legible con su signo (sin/＋). */
function modifierLines(children: OrderFeedChild[]): { text: string; tone: string }[] {
  return children.map((c) => {
    const v = childVisual(c)
    const prefix = v.tone === 'remove' ? 'SIN ' : v.tone === 'add' ? '+ ' : ''
    const cleanName = c.name.replace(/^\s*(sin|no|quitar|without|sans)\s+/i, '')
    return { text: prefix + (v.tone === 'remove' ? cleanName : c.name), tone: v.tone }
  })
}

// ── 1. Ticket de bolsa / cliente ────────────────────────────────────────────

export function renderBagTicket(order: OrderFeedItem, fiscal?: { legalName?: string; taxId?: string; address?: string }): TicketDoc {
  const b: TicketBlock[] = []

  // Cabecera de marca (logo = capa 2; aquí el nombre en texto grande)
  b.push({ kind: 'text', text: order.brand ?? 'Folvy', align: 'center', bold: true, size: 2 })
  if (fiscal?.legalName) b.push({ kind: 'text', text: fiscal.legalName, align: 'center', bold: true })
  if (fiscal?.taxId)     b.push({ kind: 'text', text: fiscal.taxId, align: 'center', muted: true })
  if (fiscal?.address)   b.push({ kind: 'text', text: fiscal.address, align: 'center', muted: true })
  b.push({ kind: 'space' })
  b.push({ kind: 'text', text: fmtDate(order.entro_at), align: 'center', muted: true })

  // Código de pedido (protagonista)
  b.push({ kind: 'space' })
  b.push({ kind: 'banner', text: orderCode(order) })

  // Datos de entrega
  if (order.channel) b.push({ kind: 'row', left: order.channel, right: order.external_ref ?? '', bold: true })
  b.push({ kind: 'text', text: 'Método: ' + deliveryLabel(order.service_type) })
  if (order.customer_name)   b.push({ kind: 'text', text: 'Cliente: ' + order.customer_name })
  if (order.delivery_address) b.push({ kind: 'text', text: 'Dir: ' + order.delivery_address })
  if (order.customer_phone)  b.push({ kind: 'text', text: 'Tel: ' + order.customer_phone })
  if (order.expected_time)   b.push({ kind: 'text', text: 'Hora: ' + fmtDate(order.expected_time) })

  // Productos CON precios
  b.push({ kind: 'space' })
  b.push({ kind: 'banner', text: 'Productos' })
  for (const line of order.lineas) {
    b.push({ kind: 'row', left: `${line.qty}x ${line.name}`, right: money(line.line_total), bold: true })
    for (const m of modifierLines(line.children)) {
      b.push({ kind: 'text', text: '   ' + m.text, muted: true })
    }
  }

  // Económico
  b.push({ kind: 'rule', dashed: true })
  if (order.delivery_cost) b.push({ kind: 'row', left: 'Gastos de envío', right: money(order.delivery_cost) })
  if (order.discount_amount) b.push({ kind: 'row', left: 'Descuento', right: '-' + money(order.discount_amount) })
  b.push({ kind: 'row', left: 'TOTAL', right: money(order.total), bold: true })
  if (order.payment_method) b.push({ kind: 'row', left: 'Pago', right: order.payment_method, muted: true })

  // QR a la shop (caption configurable por marca)
  if (order.brand_shop_url) {
    b.push({ kind: 'rule', dashed: true })
    b.push({
      kind: 'qr',
      data: order.brand_shop_url,
      caption: order.brand_qr_caption ?? 'Pide directo la próxima vez y ahorra',
      size: 'lg',
    })
  }

  b.push({ kind: 'space', lines: 2 })
  b.push({ kind: 'cut' })
  return { title: 'Bolsa · ' + (order.brand ?? ''), widthMm: 80, blocks: b }
}

// ── 2. Ticket de cocina ─────────────────────────────────────────────────────

export function renderKitchenTicket(order: OrderFeedItem): TicketDoc {
  const b: TicketBlock[] = []

  b.push({ kind: 'text', text: 'TICKET ' + (order.channel ?? '').toUpperCase(), align: 'center', bold: true })
  b.push({ kind: 'banner', text: orderCode(order) })
  b.push({ kind: 'text', text: (order.brand ?? '').toUpperCase(), bold: true })
  if (order.external_ref) b.push({ kind: 'row', left: order.channel ?? '', right: order.external_ref, muted: true })
  b.push({ kind: 'text', text: fmtDate(order.entro_at), muted: true })
  if (order.customer_name) b.push({ kind: 'row', left: 'Cliente', right: order.customer_name.split(' ')[0], bold: true })
  if (order.expected_time) b.push({ kind: 'row', left: 'Recogida', right: fmtDate(order.expected_time) })
  b.push({ kind: 'space' })
  b.push({ kind: 'text', text: deliveryLabel(order.service_type), align: 'center', bold: true })

  // Agrupar líneas por categoría (family). Sin family -> "Sin categoría" al final.
  const groups = new Map<string, OrderFeedLine[]>()
  const NOCAT = 'Sin categoría'
  for (const line of order.lineas) {
    const key = line.family ?? NOCAT
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(line)
  }
  // Orden: las con nombre primero (alfabético), "Sin categoría" al final.
  const keys = [...groups.keys()].sort((a, z) => {
    if (a === NOCAT) return 1
    if (z === NOCAT) return -1
    return a.localeCompare(z, 'es')
  })

  for (const key of keys) {
    b.push({ kind: 'banner', text: key })
    for (const line of groups.get(key)!) {
      b.push({ kind: 'row', left: `${line.qty}x  ${line.name}`, right: '', bold: true })
      for (const m of modifierLines(line.children)) {
        b.push({ kind: 'text', text: '    ' + m.text, muted: m.tone !== 'remove' })
      }
      if (line.customer_note) b.push({ kind: 'text', text: '    » ' + line.customer_note, bold: true })
    }
  }

  // Alérgenos: NO en el ticket de cocina (decisión de seguridad). Nota al pie.
  b.push({ kind: 'rule', dashed: true })
  b.push({ kind: 'text', text: 'Alérgenos en el escandallo (pulsar el plato)', align: 'center', muted: true })
  b.push({ kind: 'space', lines: 2 })
  b.push({ kind: 'cut' })
  return { title: 'Cocina · ' + (order.brand ?? ''), widthMm: 80, blocks: b }
}

// ── 3. Pegatinas (opción c: por artículo comida + agrupada bebidas/postres) ──

export function renderLabels(order: OrderFeedItem): TicketDoc[] {
  const items = flattenItems(order)
  const food = items.filter((it) => !it.isDrink)
  const drinks = items.filter((it) => it.isDrink)
  const labels: TicketDoc[] = []
  const code = orderCode(order)
  const who = order.customer_name?.split(' ')[0] ?? ''
  // Total de PIEZAS: una por artículo de comida + una (agrupada) si hay bebidas/postres.
  const totalPieces = food.length + (drinks.length > 0 ? 1 : 0)
  let idx = 0

  // Una pegatina por artículo de comida (sueltos + componentes de combo)
  for (const it of food) {
    idx++
    const b: TicketBlock[] = []
    b.push({ kind: 'row', left: code, right: `${(order.brand ?? '').slice(0, 14)} · ${order.channel ?? ''}`, bold: true })
    b.push({ kind: 'rule', dashed: true })
    b.push({ kind: 'text', text: it.name, bold: true })
    for (const m of modifierLines(it.modifiers)) {
      b.push({ kind: 'text', text: '  ' + m.text, muted: true })
    }
    // Alérgenos en texto (capa 1; iconos en capa 2)
    if (it.allergens.length) {
      b.push({ kind: 'text', text: '⚠ ' + it.allergens.join(' · '), muted: true })
    }
    b.push({ kind: 'row', left: `${idx} de ${totalPieces} · ${who}`, right: '', muted: true })
    if (order.brand_shop_url) b.push({ kind: 'qr', data: order.brand_shop_url, size: 'sm' })
    b.push({ kind: 'cut' })
    labels.push({ title: `Pegatina ${idx}/${totalPieces}`, widthMm: 80, blocks: b })
  }

  // Una pegatina agrupada para bebidas/postres (bolsa aparte)
  if (drinks.length > 0) {
    idx++
    const b: TicketBlock[] = []
    b.push({ kind: 'row', left: code, right: 'BOLSA BEBIDAS', bold: true })
    b.push({ kind: 'rule', dashed: true })
    b.push({ kind: 'text', text: 'Bebidas y postres', bold: true })
    for (const it of drinks) {
      b.push({ kind: 'text', text: `  ${it.qty}x ${it.name}` })
    }
    b.push({ kind: 'row', left: `${idx} de ${totalPieces} · bolsa aparte · ${who}`, right: '', muted: true })
    if (order.brand_shop_url) b.push({ kind: 'qr', data: order.brand_shop_url, size: 'sm' })
    b.push({ kind: 'cut' })
    labels.push({ title: `Pegatina bebidas`, widthMm: 80, blocks: b })
  }

  return labels
}
