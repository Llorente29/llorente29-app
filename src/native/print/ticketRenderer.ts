// src/native/print/ticketRenderer.ts
// Port TS del ticketRenderer.js del agente (lógica pura, sin dependencias Node).
// Construye el modelo de bloques (TicketDoc) por tipo de documento.
// bag = factura/bolsa (texto) · kitchen = cocina ENORME · labels = pegatinas.

import type { TicketDoc } from './escpos';
import { passCode } from '@/modules/orders/lib/passCode';
import { direccionParaMostrar } from '@/lib/direccionEntrega';

function ticketNumber(order: any) { return order.external_tab_ref ?? order.external_ref ?? '—'; }
// CÓDIGO DE PASE (lo que canta el repartidor): Glovo → pos_short_code; Uber →
// platform_order_code completo; propio/otros → pos_short_code. Lógica única en passCode.ts.
function pickupCode(order: any) {
  return passCode(order).full;
}
// Referencia fina = el OTRO código (para incidencias). Con canal si es de la plataforma
// (el largo de Glovo o el corto del canal). Qué código es lo decide passCode.ts.
function platformRef(order: any) {
  const pc = passCode(order);
  if (!pc.secondary) return null;
  const ch = (order.channel ?? '').trim();
  return (pc.secondarySource !== 'short' && ch) ? `${ch} · ${pc.secondary}` : pc.secondary;
}
function money(n: any) {
  if (n === null || n === undefined) return '';
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function fmtDate(iso: any) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function isOwnDelivery(serviceType: any) { return (serviceType ?? '').toLowerCase().includes('own'); }
function deliveryLabel(serviceType: any) {
  const t = (serviceType ?? '').toLowerCase();
  if (t.includes('pickup') || t.includes('collection') || t.includes('takeaway')) return 'RECOGIDA';
  if (t.includes('platform')) return 'REPARTO PLATAFORMA';
  if (t.includes('own')) return 'REPARTO PROPIO';
  return serviceType ? serviceType.toUpperCase() : 'REPARTO';
}
function isDrinkOrDessert(family: any, name: any) {
  const fam = (family ?? '').toLowerCase();
  if (fam) return /bebida|drink|refresco|postre|dessert|dulce/.test(fam);
  return /mahou|coca|cola|agua|cerveza|fanta|sprite|refresco|nestea|aquarius|zumo/.test((name || '').toLowerCase());
}
const LOOKS_REMOVE = /^\s*(sin|no|quitar|without|sans)\b/i;
function childTone(c: any) {
  if (c.line_type === 'combo_item') return 'neutral';
  const looksRemove = LOOKS_REMOVE.test(c.name || '');
  switch (c.group_type) {
    case 'removal': return 'remove';
    case 'extras': return 'add';
    case 'choice': case 'side': return looksRemove ? 'remove' : 'neutral';
    case 'cross_sell': case 'info': return 'neutral';
    default: return looksRemove ? 'remove' : 'add';
  }
}
function modifierLines(children: any) {
  return (children || []).map((c: any) => {
    const tone = childTone(c);
    const prefix = tone === 'remove' ? 'SIN ' : tone === 'add' ? '+ ' : '';
    const cleanName = (c.name || '').replace(/^\s*(sin|no|quitar|without|sans)\s+/i, '');
    return { text: prefix + (tone === 'remove' ? cleanName : c.name), tone };
  });
}
function allergenList(line: any) {
  const a = line.allergens || [];
  return a.length ? a.join(' · ') : '';
}
// C9 · Lote 1 (04/09/2026). ANTES esta funcion construia objetos nuevos y TIRABA
// el `line_id` que order_for_print si devuelve, asi que dos unidades de la misma
// linea eran indistinguibles — y una etiqueta impresa no se podia identificar.
//
// Ahora conserva `lineId` y numera la unidad DENTRO de su linea (`unitNo`, 1..qty).
// La pareja (lineId, unitNo) ES la identidad de una etiqueta. Ojo: en un combo el
// lineId es el del COMPONENTE, no el del padre, porque es el componente lo que se
// embolsa y lo que lleva pegatina.
//
// NO se toca el «N de M»: cuenta piezas fisicas y ya lo hacia bien (ver :198).
// Son dos numeraciones distintas a proposito — «2 de 3» es la pieza en la bolsa,
// `unitNo` es la unidad dentro de su linea.
//
// Las BEBIDAS siguen colapsando en una sola etiqueta de bolsa: no se expanden y
// por eso llevan `unitNo: null`. Limitacion aceptada y anotada en el diseño (la
// cantidad de bebidas no sera verificable), no un defecto a arreglar aqui.
function flattenItems(order: any) {
  const out: any[] = [];
  const pushExpanded = (it: any) => {
    if (it.isDrink) { out.push({ ...it, unitNo: null }); return; }
    const n = Math.max(1, Math.round(it.qty));
    for (let i = 0; i < n; i++) out.push({ ...it, qty: 1, unitNo: i + 1 });
  };
  for (const line of order.lineas || []) {
    const comboComponents = (line.children || []).filter((c: any) => c.line_type === 'combo_item');
    if (comboComponents.length > 0) {
      for (const comp of comboComponents) {
        pushExpanded({ lineId: comp.line_id ?? null, unitTokens: comp.unit_tokens ?? null, name: comp.name, qty: comp.qty, family: comp.family, allergens: line.allergens || [], modifiers: [], isDrink: isDrinkOrDessert(comp.family, comp.name) });
      }
    } else {
      pushExpanded({ lineId: line.line_id ?? null, unitTokens: line.unit_tokens ?? null, name: line.name, qty: line.qty, family: line.family, allergens: line.allergens || [], modifiers: (line.children || []).filter((c: any) => c.line_type !== 'combo_item'), isDrink: isDrinkOrDessert(line.family, line.name) });
    }
  }
  return out;
}

export function renderBagTicket(order: any, fiscal?: any): TicketDoc {
  const b: any[] = [];
  if (order._logo && order._logo.data) {
    b.push({ kind: 'logo', width: order._logo.width, height: order._logo.height, data: order._logo.data });
  } else {
    b.push({ kind: 'text', text: order.brand ?? 'Folvy', align: 'center', bold: true, size: 3 });
  }
  if (fiscal?.legalName) b.push({ kind: 'text', text: fiscal.legalName, align: 'center', bold: true });
  if (fiscal?.taxId)     b.push({ kind: 'text', text: fiscal.taxId, align: 'center' });
  if (fiscal?.address)   b.push({ kind: 'text', text: fiscal.address, align: 'center' });
  b.push({ kind: 'space' });
  b.push({ kind: 'text', text: fmtDate(order.entro_at), align: 'center' });
  b.push({ kind: 'row', left: 'Factura Simplificada', right: fiscal?.ticketNumber ?? ticketNumber(order) });
  b.push({ kind: 'space' });
  b.push({ kind: 'invertBanner', text: pickupCode(order), size: 4 });
  b.push({ kind: 'space' });
  const ch = (order.channel ?? '').trim();
  // El OTRO código, pequeño debajo (para incidencias/reclamaciones). Para Uber es el
  // corto; para Glovo/propio es el nº de plataforma con el canal delante.
  const ref = platformRef(order);
  if (ref) b.push({ kind: 'text', text: 'Código: ' + ref, bold: true });
  b.push({ kind: 'text', text: 'Método: ' + deliveryLabel(order.service_type) });
  if (order.expected_time) b.push({ kind: 'text', text: 'Hora programada: ' + fmtDate(order.expected_time) });
  if (order.customer_name) b.push({ kind: 'text', text: 'Nombre del cliente: ' + order.customer_name });
  if (isOwnDelivery(order.service_type)) {
    // Traducción de presentación: el dato guardado no cambia.
    if (order.delivery_address) b.push({ kind: 'text', text: 'Dirección: ' + direccionParaMostrar(order.delivery_address) });
    if (order.customer_phone)   b.push({ kind: 'text', text: 'Número de teléfono: ' + order.customer_phone });
  }
  b.push({ kind: 'space' });
  b.push({ kind: 'banner', text: 'Productos' });
  for (const line of order.lineas || []) {
    const label = `${line.qty}x ${line.name}`;
    if (line.original_unit_price != null) {
      b.push({ kind: 'priceRow', label, original: money(line.original_unit_price * line.qty), final: money(line.line_total), discountLabel: line.discount_label });
    } else {
      b.push({ kind: 'priceRow', label, final: money(line.line_total) });
    }
    for (const m of modifierLines(line.children)) b.push({ kind: 'text', text: '   ' + m.text });
  }
  b.push({ kind: 'space' });
  b.push({ kind: 'rule' });
  if (order.delivery_cost)   b.push({ kind: 'row', left: 'Gastos de envío:', right: money(order.delivery_cost) });
  if (order.discount_amount) b.push({ kind: 'row', left: 'Descuento:', right: '-' + money(order.discount_amount) });
  b.push({ kind: 'rule', dashed: true });
  const total = Number(order.total ?? 0);
  const base = total / 1.10;
  const iva = total - base;
  b.push({ kind: 'cols', parts: ['', 'Subtotal', 'IVA', 'Total'] });
  b.push({ kind: 'cols', parts: ['IVA (10%)', money(base), money(iva), money(total)] });
  b.push({ kind: 'space' });
  b.push({ kind: 'text', text: 'Total: ' + money(total), align: 'right', bold: true, size: 3 });
  b.push({ kind: 'space' });
  b.push({ kind: 'text', text: 'Pagos', bold: true });
  if (order.payment_method) b.push({ kind: 'row', left: order.payment_method + ':', right: money(total) });
  else if (ch) b.push({ kind: 'row', left: ch + ':', right: money(total) });
  if (order.brand_shop_url) {
    b.push({ kind: 'rule', dashed: true });
    b.push({ kind: 'qr', data: order.brand_shop_url, caption: order.brand_qr_caption ?? 'Pide directo la próxima vez y ahorra', size: 'lg' });
  }
  b.push({ kind: 'space', lines: 2 });
  b.push({ kind: 'cut' });
  return { title: 'Bolsa', widthMm: 80, blocks: b };
}

export function renderKitchenTicket(order: any): TicketDoc {
  const b: any[] = [];
  b.push({ kind: 'invertBanner', text: pickupCode(order), size: 4 });
  b.push({ kind: 'text', text: (order.brand ?? '').toUpperCase(), align: 'center', bold: true, size: 2 });
  const kref = platformRef(order);
  if (kref) b.push({ kind: 'text', text: kref, align: 'center', muted: true });
  b.push({ kind: 'text', text: fmtDate(order.entro_at), align: 'center', muted: true });
  b.push({ kind: 'space' });
  b.push({ kind: 'text', text: deliveryLabel(order.service_type), align: 'center', bold: true, size: 2 });
  if (order.customer_name) b.push({ kind: 'text', text: (order.customer_name || '').split(' ')[0], align: 'center', bold: true, size: 2 });
  if (order.expected_time) b.push({ kind: 'row', left: 'Recogida', right: fmtDate(order.expected_time) });
  b.push({ kind: 'rule' });
  const groups = new Map<string, any[]>(); const NOCAT = 'Otros';
  for (const line of order.lineas || []) {
    const key = line.family ?? NOCAT;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(line);
  }
  const keys = [...groups.keys()].sort((a, z) => a === NOCAT ? 1 : z === NOCAT ? -1 : a.localeCompare(z, 'es'));
  for (const key of keys) {
    b.push({ kind: 'banner', text: key });
    for (const line of groups.get(key)!) {
      b.push({ kind: 'text', text: `${line.qty}x ${line.name}`, bold: true, size: 3 });
      for (const m of modifierLines(line.children)) {
        b.push({ kind: 'text', text: '  ' + m.text, bold: m.tone === 'remove', size: m.tone === 'remove' ? 2 : 1 });
      }
      const al = allergenList(line);
      if (al) b.push({ kind: 'text', text: '! ' + al, muted: true });
      if (line.customer_note) b.push({ kind: 'text', text: '> ' + line.customer_note, bold: true, size: 2 });
      b.push({ kind: 'space' });
    }
  }
  b.push({ kind: 'cut' });
  return { title: 'Cocina', widthMm: 80, blocks: b };
}

// C9 · Lote 1 §2 (04/09/2026). El QR deja de ser un cartel y pasa a ser un
// identificador. ANTES las 18 marcas de la cuenta emitian LA MISMA URL
// (`brand_shop_url`): verificado sobre una foto real, los seis QR decodificaban
// a `https://foodint.folvy.app/`. Como identificador no servia para nada.
//
// Ahora: `https://<tienda-de-la-marca>/e/<token>`, que redirige (302) a la
// tienda. Para el cliente es exactamente lo mismo que hoy; para nosotros, la
// etiqueta pasa a ser identificable.
//
// SIN TOKEN SE IMPRIME IGUAL, con la URL de siempre. Una venta antigua, un
// acuñado que fallo, o una tablet contra un order_for_print sin parchear, no
// pueden dejar a la cocina sin pegatinas: se imprime peor, no se deja de
// imprimir (misma regla que B53).
// LA URL VA ENTERA EN MAYUSCULAS, y no es un capricho: el modo alfanumerico del
// QR admite 0-9 A-Z y poco mas, pero NO minusculas. Medido con un codificador
// real, 40 caracteres y ECC Q:
//   `https://…/e/aZ3kP9qR7mXt`  -> version 4, 33 modulos, modo byte  (24,8 mm)
//   `HTTPS://…/E/AZ3KP9QR7MXT`  -> version 3, 29 modulos, alfanum.   (21,8 mm)
// Subir a mayusculas SOLO el token no sirve: sigue saliendo byte. Tiene que ir
// todo. El esquema y el dominio son insensibles a mayusculas por norma y por
// DNS; de la ruta /E/ se encarga label-scan.
function qrEtiqueta(order: { brand_shop_url?: string | null }, token: string | null | undefined): string | null {
  const tienda = String(order.brand_shop_url ?? '').trim();
  if (!tienda) return null;
  if (!token) return tienda.toUpperCase();
  return (tienda.replace(/\/+$/, '') + '/e/' + token).toUpperCase();
}

export function renderLabels(order: any): TicketDoc[] {
  const items = flattenItems(order);
  const food = items.filter(it => !it.isDrink);
  const drinks = items.filter(it => it.isDrink);
  const labels: TicketDoc[] = [];
  const code = pickupCode(order);
  const who = (order.customer_name || '').split(' ')[0] ?? '';
  const totalPieces = food.length + (drinks.length > 0 ? 1 : 0);
  let idx = 0;
  for (const it of food) {
    idx++;
    const b: any[] = [];
    b.push({ kind: 'row', left: code, right: (order.brand ?? '').slice(0, 16), bold: true });
    b.push({ kind: 'rule', dashed: true });
    b.push({ kind: 'text', text: it.name, bold: true, size: 2 });
    for (const m of modifierLines(it.modifiers)) b.push({ kind: 'text', text: '  ' + m.text, muted: true });
    if (it.allergens.length) b.push({ kind: 'text', text: '! ' + it.allergens.join(' · '), bold: true });
    b.push({ kind: 'row', left: `${idx} de ${totalPieces} · ${who}`, right: '', muted: true });
    const qrUnidad = qrEtiqueta(order, it.unitTokens?.[(it.unitNo ?? 1) - 1]);
    if (qrUnidad) b.push({ kind: 'qr', data: qrUnidad, size: 'sm' });
    b.push({ kind: 'cut' });
    labels.push({ title: `Pegatina ${idx}/${totalPieces}`, widthMm: 80, blocks: b });
  }
  if (drinks.length > 0) {
    idx++;
    const b: any[] = [];
    b.push({ kind: 'row', left: code, right: 'BOLSA BEBIDAS', bold: true });
    b.push({ kind: 'rule', dashed: true });
    b.push({ kind: 'text', text: 'Bebidas y postres', bold: true, size: 2 });
    for (const it of drinks) b.push({ kind: 'text', text: `  ${it.qty}x ${it.name}` });
    b.push({ kind: 'row', left: `${idx} de ${totalPieces} · bolsa aparte · ${who}`, right: '', muted: true });
    const qrBolsa = qrEtiqueta(order, order.bag_token);
    if (qrBolsa) b.push({ kind: 'qr', data: qrBolsa, size: 'sm' });
    b.push({ kind: 'cut' });
    labels.push({ title: 'Pegatina bebidas', widthMm: 80, blocks: b });
  }
  return labels;
}

export function renderForType(order: any, docType: string, fiscal?: any): TicketDoc[] {
  if (docType === 'bag') return [renderBagTicket(order, fiscal)];
  if (docType === 'kitchen') return [renderKitchenTicket(order)];
  if (docType === 'labels') return renderLabels(order);
  return [];
}
