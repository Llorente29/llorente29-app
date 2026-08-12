// src/modules/supply/pages/GoodsReceiptForm.tsx
//
// Formulario de RECEPCIÓN de albarán (C2) — diseño ANTI-ERROR (blind receiving).
// Tres modos: CONTRA PEDIDO (order), CORREGIR (prefill), CIEGO (ninguno).
//
// SEGURIDAD (evita el "confirmation bias"):
//   · La celda "Recibido" NACE VACÍA SIEMPRE. Nunca se precarga lo pedido ni lo
//     pendiente: el usuario teclea lo que CUENTA. Lo pedido / ya recibido /
//     pendiente se muestran como REFERENCIA gris al lado, no en la casilla.
//   · Botón "Rellenar con lo pendiente": acelerador OPT-IN para el caso "llegó
//     todo lo que faltaba". No se salta el resumen.
//   · RESUMEN antes de confirmar SIEMPRE (coinciden / de más / de menos / sin
//     recibir). Segundo clic REFORZADO solo si hay anomalía (algo de más, o
//     muchas líneas con pendiente dejadas sin tocar). "De menos" no frena (es
//     normal: te traen menos). Lo no tocado = NO recibido, explícito.
//
// "Ya recibido" sale de listOrderLineReceived (recepciones confirmadas del
// pedido); pendiente = max(0, pedido − ya recibido). En modo corregir se
// excluye la recepción que se va a sustituir.
//
// HUECO FEFO/APPCC: cada línea ya transporta lotCode/expiryDate (se persisten);
// los inputs visibles y el control APPCC de recepción llegan en su frente. Así
// no se rehace la tabla cuando se enchufen.
//
// Tras confirmar, VUELVE SOLO (onSaved con mensaje); aviso como toast en lista.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search, Loader2, Check, Save, ListChecks, AlertTriangle, Box, ArrowRight, Truck } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useOperativeLocation } from '@/modules/supply/hooks/useOperativeLocation'
import OperativeLocationBanner from '@/modules/supply/components/OperativeLocationBanner'
import ReceiptPhotoViewer from '@/modules/supply/components/ReceiptPhotoViewer'
import { listSuppliers, createPurchaseFormat, ensurePackTree } from '@/modules/kitchen/services/purchaseFormatService'
import { rescaleLastPriceToFormat, unitPriceFromBase, pickDisplayUnit } from '@/modules/kitchen/lib/unitConversion'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import type { Supplier, KitchenUnit } from '@/types/kitchen'
import {
  getSupplierCatalog,
  listSupplyLocations,
  type SupplierCatalogEntry,
  type SupplierFormatOption,
  type SupplyLocation,
} from '@/modules/supply/services/supplierCatalogService'
import {
  listPurchaseOrderLines,
  listPurchaseOrders,
  getPurchaseOrderById,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from '@/modules/supply/services/purchaseOrderService'
import {
  createGoodsReceipt,
  updateGoodsReceipt,
  deleteGoodsReceiptLinesByReceipt,
  createGoodsReceiptLine,
  confirmReceipt,
  voidReceipt,
  listOrderLineReceived,
  qtyInBaseFromFormat,
  matchReceiptLine,
  matchTypeLabel,
  learnFromReceipt,
  learnSupplierAlias,
  quickCreateSupplier,
  getItemBaseUnit,
  getItemHomeAreas,
  ensureLastPurchaseStrategy,
  formatQtyInBaseFromPack,
  getSupplySettings,
  getSupplierFormatPrices,
  getSupplierLastPrices,
  getPriceDrift,
  priceAlertFor,
  negotiatedAlertFor,
  driftAlertFor,
  lineActualPerBase,
  expiryAlertFor,
  type LineMatchCandidate,
  type SupplySettings,
  type SupplierPriceRef,
  type PriceDrift,
  type BaseUnitInfo,
} from '@/modules/supply/services/goodsReceiptService'
import LineMatchPicker from '@/modules/supply/pages/LineMatchPicker'

export interface ReceiptPrefill {
  sourceReceiptId: string
  supplierId: string
  locationId: string
  purchaseOrderId: string | null
  supplierDocNumber: string | null
  lines: ReceiptPrefillLine[]
  // REVISAR BORRADOR EN SITIO: si la fuente es un borrador, la oficina lo revisa
  // y confirma la MISMA recepción (no crea otra ni anula). Trae la foto del albarán.
  isDraft?: boolean
  code?: string | null
  rawDocumentUrl?: string | null
}
export interface ReceiptPrefillLine {
  recipeItemId: string | null
  productName: string
  purchaseFormatId: string | null
  qtyReceived: number
  unitCost: number | null
  purchaseOrderLineId: string | null
  // ENCARGO CODE (12/08) fix/recepcion-fromocr-borrador. Sin esto, revisar un
  // borrador que vino de OCR no tiene ni el texto ni el código con los que
  // casar (el dato SÍ está en goods_receipt_line — raw_text/supplier_code —
  // pero handleReviewDraft no lo leía). Sin código/texto, el casado
  // automático y el desglose de formato del albarán quedan sin ancla aunque
  // needsResolution ya no bloquee dónde se muestran.
  rawText: string | null
  supplierCode: string | null
}

// Propuesta OCR (C2.2.a-2): cabecera resuelta + líneas leídas del albarán.
// El proveedor/local pueden venir sin casar ('') → el form los pide. Las líneas
// llegan SIN artículo (recipeItemId null): el casado a artículos es C2.2.b.
export interface OcrPrefill {
  aiSessionId: string | null
  supplierId: string            // '' si no casó
  proposedSupplierName: string | null   // emisor leído (para prerellenar el alta si no casa)
  proposedSupplierNif: string | null
  proposedSupplierPhone: string | null  // Mejora 1: contacto leído del albarán
  proposedSupplierEmail: string | null
  proposedSupplierAddress: string | null
  proposedSupplierHealthRegistry: string | null
  deliveredBy: string | null    // entregado por (Joan/Bidfood) cuando hay intermediario
  locationId: string            // '' si no casó
  supplierDocNumber: string | null
  receiptDate: string | null
  rawDocumentUrl: string | null
  unmatchedSupplier: boolean
  unmatchedLocation: boolean
  lines: OcrPrefillLine[]
}
export interface OcrPrefillLine {
  recipeItemId: string | null   // null en a-2 (casado en b)
  productName: string           // raw_text leído
  supplierCode: string | null   // código del proveedor (ancla de casado por código)
  qty: number | null            // cantidad leída → celda precargada
  unitCost: number | null       // precio neto leído
  lineAmount: number | null     // importe neto de línea (dato duro p/ aviso de precio)
  albaranUnit?: string | null   // unidad de la cantidad del albarán (ud/caja/kg…) p/ conversión a formato
  packages?: number | null      // nº de bultos físicos del albarán (referencia)
  lotCode: string | null
  expiryDate: string | null
  // Mejora 3: pista de FORMATO leída (la IA propone; el front convierte a base).
  formatName: string | null
  packSize: number | null
  packUnit: string | null
}

interface GoodsReceiptFormProps {
  accountId: string
  order?: PurchaseOrder | null
  prefill?: ReceiptPrefill | null
  ocrPrefill?: OcrPrefill | null
  // 'always' (def): quien recibe puede confirmar (oficina). 'by-location': respeta
  // locations.receipt_approval — si el local está en 'oficina', el que recibe solo
  // deja BORRADOR (la oficina confirma). Lo usa el móvil del trabajador.
  confirmPolicy?: 'always' | 'by-location'
  // Arranque rápido desde el vigía de stock negativo (Almacén → Teórico vs Real):
  // recepción CIEGA (sin order/prefill/ocrPrefill) pero con el proveedor ya
  // elegido y el buscador de artículos apuntando al que hay que cargar. La
  // persona sigue tecleando la cantidad real — esto solo quita fricción de
  // navegación, no rellena nada por su cuenta.
  initialSupplierId?: string | null
  focusSearch?: string | null
  onBack: () => void
  onSaved: (message?: string) => void
}

interface DraftLine {
  key: string
  recipeItemId: string | null
  productName: string
  purchaseFormatId: string | null
  formatLabel: string | null
  formatQtyInBase: number | null
  qtyOrdered: number | null    // referencia (modo con pedido)
  alreadyReceived: number | null
  pending: number | null       // max(0, pedido − ya recibido); null = sin referencia
  qty: string                  // RECIBIDO — nace vacío SIEMPRE (en el FORMATO elegido)
  unitCost: string
  lineAmount?: number | null   // importe de línea del albarán (OCR), dato duro p/ aviso de precio
  albaranUnit?: string | null  // unidad de la cantidad leída del albarán (ud/caja/kg…)
  albaranQty?: number | null   // cantidad ORIGINAL del albarán (antes de convertir a formato)
  convertedNote?: string | null // "480 ud → 6 cajas": referencia visible de la conversión
  poLineId: string | null
  lotCode: string | null       // hueco FEFO/APPCC (se persiste; UI en su frente)
  expiryDate: string | null
  // C2.2.b — casado de línea de albarán (solo modo OCR)
  rawText: string | null            // texto leído del albarán (referencia gris)
  supplierCode: string | null       // código del proveedor (ancla de casado)
  matchedName: string | null        // nombre del artículo casado (tu nombre)
  matchSemaphore: 'green' | 'yellow' | null
  matchType: string | null
  // Tramo A — captura de formato (solo OCR; opcionales: los caminos no-OCR no los usan)
  formatName?: string | null        // nombre del formato a crear/heredar ("Caja")
  packSize?: number | null          // pista IA: contenido de un formato
  packUnit?: string | null          // pista IA: unidad del contenido
  baseUnit?: BaseUnitInfo | null    // unidad base del artículo (para convertir)
  formatSuggested?: boolean         // el formato lo propuso la IA (✨)
  formatTouched?: boolean           // el humano editó el formato → no autollenar
  formatOptions?: SupplierFormatOption[]  // todos los formatos del artículo (elegir bote/caja)
  // Desglose del formato leído/confirmado del albarán ("Caja = 3 × 2 kg"): alimenta
  // ensurePackTree al persistir (Caja → unidad interior contable + total derivado).
  packCount?: number | null         // nº de unidades interiores por caja (3)
  packInnerBase?: number | null     // contenido de UNA unidad interior, en base (2000 g)
  packInnerName?: string | null     // nombre de la unidad interior ("Ud")
  // ENCARGO CODE (12/08) — fix/recepcion-selector-formato, §3.5: excepción
  // EXPLÍCITA (nunca por omisión) para dejar confirmar una línea con cantidad
  // pero sin formato. No cambia el motor: esas líneas ya no posteaban a stock;
  // esto solo desbloquea el botón Confirmar cuando la persona lo decide a
  // propósito, en vez de dejarlo bloqueado en silencio.
  skipStock?: boolean
  // ENCARGO CODE (12/08) R1' (feat/recepcion-casado-automatico): el humano
  // eligió o quitó el casado a mano → el efecto de casado automático no
  // vuelve a tocar esta línea (mismo patrón que formatTouched).
  matchTouched?: boolean
  // §2.2 — propuesta por nombre razonable (candidato único). A diferencia de
  // recipeItemId, esto NUNCA se aplica solo: pide un toque explícito ("¿Es
  // esto?" en Fila 1.5) porque no es una señal que un humano ya confirmara
  // antes (a diferencia del código o el texto exacto aprendido).
  suggestedRecipeItemId?: string | null
  suggestedName?: string | null
}

function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(new Date(iso + 'T00:00:00'))
}

// ── P1.b: casado automático del albarán escaneado con un pedido ───────────
// El trabajador del muelle NUNCA elige pedido a mano en el caso normal — el
// sistema propone solo, con proveedor+local ya filtrados como hard filter y
// esto como score de desempate: solape de texto entre lo leído del albarán y
// las líneas del pedido, más cercanía de expected_date. Sencillo a propósito
// (sin NLP): normaliza y compara conjuntos de palabras de 3+ letras.
function normalizeWords(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').trim()
}
function wordSet(s: string): Set<string> {
  return new Set(normalizeWords(s).split(/\s+/).filter(t => t.length >= 3))
}
/** 0..1: fracción de líneas del albarán que casan (≥50% de palabras comunes) con alguna línea del pedido. */
function lineOverlapScore(ocrProductNames: string[], poProductNames: string[]): number {
  if (ocrProductNames.length === 0) return 0
  const poSets = poProductNames.map(wordSet)
  let matched = 0
  for (const name of ocrProductNames) {
    const ot = wordSet(name)
    if (ot.size === 0) continue
    const hit = poSets.some(pt => {
      if (pt.size === 0) return false
      let common = 0
      for (const t of ot) if (pt.has(t)) common++
      return common / Math.min(ot.size, pt.size) >= 0.5
    })
    if (hit) matched++
  }
  return matched / ocrProductNames.length
}
/** 0..1: 1 = entrega esperada hoy, decae linealmente hasta 0 en +-windowDays. */
function dateProximityScore(expectedDate: string | null, nowMs: number, windowDays: number): number {
  if (!expectedDate || windowDays <= 0) return 0
  const diffDays = Math.abs(nowMs - new Date(expectedDate + 'T00:00:00').getTime()) / 86400000
  return Math.max(0, 1 - diffDays / windowDays)
}

// €/UNIDAD BASE (€/g, €/ml, €/ud) → €/UNIDAD HUMANA (€/kg, €/L, €/ud) para que el
// aviso de precio se entienda (0,00954 €/g no se lee; 9,54 €/kg sí). Reutiliza
// pickDisplayUnit + unitPriceFromBase de unitConversion. Necesita el KitchenUnit
// base de la línea (resuelto por id desde la lista de unidades). Sin él, cae a la
// abreviatura conocida sin convertir (no rompe).
function perBaseToHuman(
  perBase: number,
  baseKU: KitchenUnit | null,
  units: KitchenUnit[],
  fallbackAbbr: string,
): { value: number; abbr: string } {
  if (!baseKU) return { value: perBase, abbr: fallbackAbbr }
  const priceUnits = units.filter((u) => u.dimension === baseKU.dimension && (u.isActive || u.isBase))
  const displayUnit = pickDisplayUnit(priceUnits, baseKU)
  if (!displayUnit) return { value: perBase, abbr: baseKU.abbreviation }
  const v = unitPriceFromBase(perBase, displayUnit, baseKU)
  return v != null
    ? { value: v, abbr: displayUnit.abbreviation }
    : { value: perBase, abbr: baseKU.abbreviation }
}

// Formato monetario humano (2 decimales; hasta 4 si es muy pequeño).
function fmtHumanPrice(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2 })
}

// Nombre de formato por defecto cuando la IA no propuso uno (el humano puede editarlo).
function defaultFormatName(_packUnit: string | null, base: BaseUnitInfo | null): string {
  switch (base?.dimension) {
    case 'weight': return 'Kilogramo'
    case 'volume': return 'Litro'
    case 'unit': return 'Unidad'
    default: return 'Formato'
  }
}

// Elige, entre los formatos del artículo, el que mejor casa con la línea del albarán.
// Estrategia (IA propone, humano decide): (1) si el nombre del formato del albarán
// (packUnit/formatName) coincide con el nombre de un formato → ese; (2) si no, el que
// más se acerque a packSize (contenido leído); (3) si nada casa → el preferente (1er
// elemento, ya viene ordenado por tamaño asc) y se marca como "a revisar el formato".
// Devuelve { option, confident }: confident=false ⇒ pintar semáforo ámbar de formato.
function pickFormatForLine(
  formats: SupplierFormatOption[],
  packUnit: string | null,
  packSize: number | null,
  preferredId: string | null,
): { option: SupplierFormatOption | null; confident: boolean } {
  if (!formats || formats.length === 0) return { option: null, confident: false }
  // Un solo formato posible: no hay ENTRE QUÉ elegir, así que no hay incertidumbre
  // que confirmar (ENCARGO CODE 12/08, §3.4: "un solo formato activo →
  // preseleccionado sin preguntar"). Sin este atajo, un packUnit/packSize del
  // albarán que no casara con el único formato lo dejaba marcado "a revisar" sin
  // motivo real.
  if (formats.length === 1) return { option: formats[0], confident: true }
  const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
  // (1) match por nombre de unidad del albarán
  if (packUnit) {
    const byName = formats.find(f => norm(f.name) === norm(packUnit))
    if (byName) return { option: byName, confident: true }
  }
  // (2) match por contenido aproximado (packSize en unidad base)
  if (packSize != null && packSize > 0) {
    let best: SupplierFormatOption | null = null
    let bestDiff = Infinity
    for (const f of formats) {
      if (f.qtyInBase == null) continue
      const diff = Math.abs(f.qtyInBase - packSize)
      if (diff < bestDiff) { bestDiff = diff; best = f }
    }
    // aceptamos si el mejor está a ≤2% del contenido leído
    if (best && best.qtyInBase && Math.abs(best.qtyInBase - packSize) / best.qtyInBase <= 0.02) {
      return { option: best, confident: true }
    }
  }
  // (3) sin certeza → preferente (o el de menor tamaño) y marcar a revisar
  const pref = (preferredId && formats.find(f => f.id === preferredId)) || formats[0]
  return { option: pref, confident: false }
}

// Etiqueta legible de la equivalencia: "80 ud", "5 kg", "10 L" (escala g→kg, ml→L).
function formatBaseQty(qty: number, abbr: string): string {
  let q = qty
  let u = abbr
  if (abbr === 'g' && qty >= 1000) { q = qty / 1000; u = 'kg' }
  else if (abbr === 'ml' && qty >= 1000) { q = qty / 1000; u = 'L' }
  const s = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(q)
  return `${s} ${u}`
}

// Reescala el COSTE por formato cuando cambia el contenido del formato, manteniendo
// constante el €/unidad-base (cálculo MATEMÁTICO, decisión de Julio): el €/base se
// deriva del par anterior (coste ÷ contenido anterior) o de un €/base de referencia
// del proveedor si se pasa; el coste nuevo = €/base × contenido nuevo.
// Ej.: bote 200 g a 2,03 € → 0,01015 €/g → caja 1.200 g = 12,18 €.
// Los descuentos por volumen NO se modelan aquí (se tratan en el aviso de precio /
// precio pactado). Devuelve '' si no hay base de cálculo fiable (no inventa).
// Capa de PRESENTACIÓN sobre la conversión canónica (unitConversion.ts, una sola
// verdad del escalado €/base → €/formato; cap a 0.c). El cálculo es idéntico al
// del editor de la ficha y al motor; aquí solo formateamos para el input editable:
// redondeo a céntimo, y '' cuando no hay ancla (que lo ponga el humano).
function rescaleCostToFormat(
  prevCost: number | null,
  prevQtyInBase: number | null,
  nextQtyInBase: number | null,
  refPerBase: number | null,   // €/base de referencia del proveedor (formatPrices), si se conoce
): string {
  const next = rescaleLastPriceToFormat(prevCost, prevQtyInBase, nextQtyInBase, refPerBase)
  if (next === null) return ''   // sin ancla → vaciar, que el humano lo ponga
  // Redondeo a céntimo para el campo editable (el cálculo fino de stock es server-side).
  return String(Math.round(next * 100) / 100)
}

// Detalle de una línea recibida POR ENCIMA de lo pendiente (para el resumen).
interface OverLine {
  name: string
  received: number
  pending: number
  overPending: number          // recibido − pendiente
  totalAfter: number           // ya recibido + recibido ahora
  ordered: number | null       // pedido total de la línea
  overOrdered: number | null   // cuánto se pasa del pedido total (0 si no se pasa)
}
interface UntouchedLine {
  name: string
  pending: number
}
// Línea que SÍ entra al almacén (desglose "qué entra exacto" del pre-confirmar).
// qtyInBase = lo que se posteará al stock, en la unidad base del artículo.
interface EnterLine {
  name: string
  qtyInBase: number
  baseAbbr: string | null      // unidad base del artículo (g/ml/ud) para mostrar la cantidad de almacén
  convertedNote: string | null // doble columna "480 ud → 6 cajas" (referencia de compra, si existe)
  unitCost: number | null      // coste por unidad de formato del albarán (referencia)
  areaName: string | null      // zona principal del artículo en el local (referencia automática)
}
// Línea que NO entra y por qué (sin contador abstracto: nombre + motivo).
interface NotEnterLine {
  name: string
  reason: 'sin reconocer' | 'sin formato'   // sin artículo casado / sin formato→base resuelto
  // true = la persona marcó "no inventariar esta línea" a propósito (§3.5): no
  // bloquea Confirmar. false = accidental (falta decidir) → si reason es 'sin
  // formato', SÍ bloquea.
  excluded: boolean
}

// Unidad amigable para teclear el contenido de un formato SIN gramos sueltos:
// peso → kg, volumen → L, unidad → ud. Devuelve etiqueta + factor a la unidad base.
function friendlyUnit(baseAbbr: string | null | undefined): { label: string; factor: number } {
  switch ((baseAbbr ?? '').toLowerCase()) {
    case 'g': return { label: 'kg', factor: 1000 }
    case 'ml': return { label: 'L', factor: 1000 }
    case 'kg': return { label: 'kg', factor: 1 }
    case 'l': return { label: 'L', factor: 1 }
    default: return { label: baseAbbr || 'ud', factor: 1 }
  }
}

// Convierte (valor, unidad-del-albarán) a la unidad BASE del artículo. null si la
// dimensión no casa (p.ej. el albarán dice KG pero el artículo se mide en ud).
function unitToArticleBase(v: number, u: string, baseAbbr: string | null | undefined): number | null {
  const b = (baseAbbr ?? '').toLowerCase()
  const uu = u.toLowerCase()
  const isWeight = b === 'g' || b === 'kg'
  const isVolume = b === 'ml' || b === 'l'
  const isUnit = b === 'ud'
  if (isWeight && (uu === 'kg' || uu === 'g')) {
    const inG = v * (uu === 'kg' ? 1000 : 1)
    return b === 'g' ? inG : inG / 1000
  }
  if (isVolume && (uu === 'l' || uu === 'ml' || uu === 'cl')) {
    const inMl = v * (uu === 'l' ? 1000 : uu === 'cl' ? 10 : 1)
    return b === 'ml' ? inMl : inMl / 1000
  }
  if (isUnit && (uu === 'ud' || uu === 'uds' || uu === 'u')) return v
  return null
}

// Lee del TEXTO del albarán el desglose de un formato, DETERMINISTA (sin IA, sin
// inventar): "CAJA 3 UD DE 1 KG" → { n:3, m:1 } (m en unidad amigable: kg/L/ud).
// "PAQUETE 250 UD" (artículo en ud) → { n:250, m:1 }. Si no encaja con la unidad
// base del artículo → null (el editor nace vacío y lo teclea el humano).
function titleCaseWord(w: string): string {
  return w.charAt(0) + w.slice(1).toLowerCase()
}

// Lee del TEXTO del albarán el desglose de un formato, DETERMINISTA (sin IA, sin
// inventar): "CAJA 3 UD DE 1 KG" → { n:3, m:1, container:'Caja', innerLabel:'Ud' }.
// "PAQUETE 250 UD" (artículo en ud) → { n:250, m:1, container:'Paquete' }. Si no
// encaja con la unidad base → null (el editor nace vacío y lo teclea el humano).
function parsePack(rawText: string | null, baseAbbr: string | null | undefined): { n: number; m: number; container: string | null; innerLabel: string } | null {
  if (!rawText) return null
  const t = rawText.toUpperCase()
  const fu = friendlyUnit(baseAbbr)
  // (A) "[contenedor] N UD DE M <unidad>"
  const a = t.match(/(?:(CAJA|CJ|PAQUETE|PAQ|SACO|CUBO|GARRAFA|BIDON|BIDÓN|BANDEJA|ESTUCHE|BOTE|BOLSA|LATA|BARRIL|MALLA|RED|PACK)\s+)?(\d+(?:[.,]\d+)?)\s*UD(?:S|ES)?\s+DE\s+(\d+(?:[.,]\d+)?)\s*(KG|G|L|ML|CL)\b/)
  if (a) {
    const container = a[1] ? titleCaseWord(a[1]) : null
    const n = parseFloat(a[2].replace(',', '.'))
    const v = parseFloat(a[3].replace(',', '.'))
    const base = unitToArticleBase(v, a[4], baseAbbr)
    if (base !== null && n > 0) {
      const mFriendly = base / fu.factor
      if (mFriendly > 0) return { n, m: Math.round(mFriendly * 1000) / 1000, container, innerLabel: 'Ud' }
    }
    return null
  }
  // (B) "[contenedor] N UD" sin "DE", solo para artículos medidos en unidades
  if ((baseAbbr ?? '').toLowerCase() === 'ud') {
    const b = t.match(/(?:(CAJA|CJ|PAQUETE|PAQ|SACO|CUBO|GARRAFA|BIDON|BIDÓN|BANDEJA|ESTUCHE|BOTE|BOLSA|LATA|BARRIL|MALLA|RED|PACK)\s+)?(\d+(?:[.,]\d+)?)\s*UD(?:S|ES)?\b/)
    if (b) {
      const container = b[1] ? titleCaseWord(b[1]) : null
      const n = parseFloat(b[2].replace(',', '.'))
      if (n > 0) return { n, m: 1, container, innerLabel: 'Ud' }
    }
  }
  return null
}

// ── T1: Constructor de formato guiado ──────────────────────────────────────
// Estado del asistente que pregunta en idioma de cocina cómo viene un artículo.
// "shape": en qué llega (caja / paquete / unidad suelta / a peso).
// Si es caja: "boxHas" = qué trae dentro (paquetes / unidades directas).
// Los números se teclean en lenguaje humano; el factor a base lo calcula el wizard
// usando friendlyUnit (kg→g, L→ml) para no pedir gramos al cocinero.
type WizardShape = 'caja' | 'paquete' | 'ud' | 'peso' | null
type WizardBoxHas = 'paquetes' | 'directas' | null
interface WizardState {
  shape: WizardShape
  boxHas: WizardBoxHas
  count: string        // nº de paquetes por caja (si boxHas==='paquetes')
  perInner: string     // unidades/cantidad por paquete o por caja directa
  innerName: string    // nombre de la unidad interior contable ("Paquete", "Ud"…)
  containerName: string // nombre del contenedor de compra ("Caja"…)
}
function emptyWizard(): WizardState {
  return { shape: null, boxHas: null, count: '', perInner: '', innerName: '', containerName: '' }
}
// Pre-rellena el asistente desde lo que parsePack leyó del albarán (si leyó algo):
// "CAJA 3 UD DE 1 KG" → caja con paquetes, 3 × 1 (en unidad amigable). Si no hay
// lectura, devuelve un asistente en blanco para que el humano conteste de cero.
function wizardFromPack(
  pack: { n: number; m: number; container: string | null; innerLabel: string } | null,
  baseAbbr: string | null | undefined,
): WizardState {
  const w = emptyWizard()
  if (!pack) return w
  const isUnit = (baseAbbr ?? '').toLowerCase() === 'ud'
  // m===1 + base en ud → "Caja N Ud" (sin capa interior real); si no, paquetes con contenido.
  if (isUnit && pack.m === 1) {
    w.shape = 'caja'; w.boxHas = 'directas'
    w.perInner = String(pack.n)
    w.containerName = pack.container ?? 'Caja'
    w.innerName = 'Ud'
  } else {
    w.shape = 'caja'; w.boxHas = 'paquetes'
    w.count = String(pack.n)
    w.perInner = String(pack.m)   // en unidad amigable (kg/L/ud)
    w.containerName = pack.container ?? 'Caja'
    w.innerName = pack.innerLabel || 'Paquete'
  }
  return w
}
// Traduce el estado del asistente a (count, innerBase, innerName, container) para
// applyPackFromAlbaran. innerBase va SIEMPRE en unidad base (multiplica por el factor
// amigable). Devuelve null si el asistente aún no está completo.
function wizardToPack(
  wz: WizardState,
  baseAbbr: string | null | undefined,
): { count: number; innerBase: number; innerName: string; container: string } | null {
  const fu = friendlyUnit(baseAbbr)
  const per = parseNum(wz.perInner)
  if (per === null || per <= 0) return null
  if (wz.shape === 'caja' && wz.boxHas === 'paquetes') {
    const c = parseNum(wz.count)
    if (c === null || c <= 0) return null
    return { count: c, innerBase: per * fu.factor, innerName: wz.innerName.trim() || 'Paquete', container: wz.containerName.trim() || 'Caja' }
  }
  if (wz.shape === 'caja' && wz.boxHas === 'directas') {
    // Caja con unidades directas: 1 nivel. count = per (uds por caja), interior = 1 ud/base.
    return { count: per, innerBase: fu.factor, innerName: 'Ud', container: wz.containerName.trim() || 'Caja' }
  }
  if (wz.shape === 'paquete') {
    // Paquete suelto que contiene "per" en unidad amigable → formato plano (count=1).
    return { count: 1, innerBase: per * fu.factor, innerName: 'Ud', container: wz.containerName.trim() || 'Paquete' }
  }
  // shape 'ud' o 'peso' = formato base directo (1 contenedor = "per" en amigable).
  return { count: 1, innerBase: per * fu.factor, innerName: 'Ud', container: wz.containerName.trim() || (wz.shape === 'peso' ? friendlyUnit(baseAbbr).label : 'Ud') }
}

// ── R1' (12/08): casado automático desde la memoria por proveedor ──────────
// ENCARGO CODE feat/recepcion-casado-automatico. `learn_from_receipt` escribe
// en article_supplier (código/texto/formato) al confirmar cada recepción,
// pero `run_mapping` (el casado que sí se consulta hoy) nunca lee ese texto
// aprendido — solo recipe_item.name/alt_names. Lo que falta es leerlo, en
// cliente, con la MISMA normalización en los dos lados (reutiliza
// normalizeWords/wordSet de arriba, ya usado por el casado P1.b
// pedido↔albarán — no se inventa un segundo normalizador para lo mismo).
// Determinista, sin IA, sin tocar el motor — solo lectura de datos ya
// cargados (catalogByItem, el mismo catálogo que resuelve el formato).
const MATCH_STOPWORDS = new Set(['con', 'sin', 'del', 'las', 'los', 'una', 'uno', 'caja', 'cajas', 'paquete', 'unidades', 'unidad'])
// Singular/plural naive (quita "es"/"s" final) para que "servilleta" (línea)
// case con "servilletas" (nombre del artículo) — no es lingüística fina, es
// suficiente para la propuesta §2.2, que además exige candidato ÚNICO: un
// falso negativo aquí solo cuesta un caso más a mano, nunca un casado malo.
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('s')) return w.slice(0, -1)
  return w
}
// Palabras con peso de un nombre (wordSet ya filtra <3 letras); quita además
// el relleno de packaging ("caja", "unidades"…) que aparece en casi todos los
// artículos del proveedor y no distingue nada. Solo para la propuesta §2.2
// (nombre razonable, candidato ÚNICO) — nunca decide si hay más de uno.
function significantWords(s: string): Set<string> {
  return new Set([...wordSet(s)].filter(w => !MATCH_STOPWORDS.has(w)).map(stem))
}

export default function GoodsReceiptForm({ accountId, order, prefill, ocrPrefill, confirmPolicy = 'always', initialSupplierId, focusSearch, onBack, onSaved }: GoodsReceiptFormProps) {
  const { userProfile, authUserId } = useApp()
  const op = useOperativeLocation()
  const againstOrder = !!order
  const correcting = !!prefill
  const fromOcr = !!ocrPrefill
  const fixedHeader = againstOrder || correcting   // en OCR la cabecera es editable (propuesta)
  // ENCARGO CODE (12/08) fix/recepcion-fromocr-borrador. `fromOcr` significa
  // "esta sesión trae ocrPrefill" (escaneo en vivo) — NO "esta línea necesita
  // casado y formato". Revisar un borrador que SÍ vino de OCR (correcting &&
  // prefill) es un camino distinto que nunca pasa ocrPrefill, y las líneas
  // siguen igual de sin-casar y sin-formato que el día que se escanearon.
  // Confundir los dos dejó Fila 1.5, Fila 2 y el casado automático (R1')
  // inalcanzables justo donde Julio revisa — mismo patrón que `correcting`
  // en el efecto de candidatos de pedido (PR #54) y que `updateGoodsReceipt`
  // sin purchaseOrderId. `needsResolution` es la condición correcta: "puede
  // haber algo que casar/formatear" — cierto en escaneo en vivo Y en
  // corregir/revisar (prefill), falso solo contra pedido o catálogo ciego,
  // donde el artículo YA viene fijado por construcción y no hay nada que
  // resolver. `fromOcr` en sí se queda para lo que de verdad depende de la
  // PROPUESTA en vivo (ocrPrefill.proposedSupplierName, el layout foto+lista
  // del escaneo, el aprendizaje de alias) — eso sí es "vengo de escanear ahora".
  const needsResolution = fromOcr || correcting

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [supplierId, setSupplierId] = useState<string>(order?.supplierId ?? prefill?.supplierId ?? ocrPrefill?.supplierId ?? initialSupplierId ?? '')
  const [locationId, setLocationId] = useState<string>(order?.locationId ?? prefill?.locationId ?? ocrPrefill?.locationId ?? '')
  // El local operativo (contexto) prevalece salvo que la cabecera venga fijada por un documento.
  useEffect(() => {
    if (!fixedHeader && op.operativeLocationId) setLocationId(op.operativeLocationId)
  }, [op.operativeLocationId, fixedHeader])
  const [receiptDate, setReceiptDate] = useState<string>(ocrPrefill?.receiptDate ?? new Date().toISOString().slice(0, 10))
  const [supplierDoc, setSupplierDoc] = useState<string>(prefill?.supplierDocNumber ?? ocrPrefill?.supplierDocNumber ?? '')

  // "¿De qué pedido viene?" — SOLO en modo ciego (sin order/prefill/ocrPrefill):
  // los otros modos ya traen su pedido resuelto por su propio camino. No fija la
  // cabecera (a diferencia de `order`): el proveedor/local los sigue eligiendo la
  // persona, esto solo ofrece enlazar lo que ya eligió con un pedido enviado.
  //
  // P1.b (escanear-primero, principio rector del muelle): en modo OCR el
  // trabajador NUNCA elige pedido a mano en el caso normal. `orderMatchMode`
  // decide qué enseñar: 'none' (sin candidato, recepción suelta, no se
  // pregunta nada), 'auto' (1 candidato o score dominante → se enlaza solo,
  // línea informativa discreta) o 'ambiguous' (2-3 tarjetas, "¿Es este?").
  // En modo CIEGO manual (sin OCR) esto no se usa: sigue el picker de botones
  // de siempre, sin auto-elegir nada (el trabajador de oficina ve la lista).
  const [candidateOrders, setCandidateOrders] = useState<PurchaseOrder[]>([])
  const [candidateLineCounts, setCandidateLineCounts] = useState<Map<string, number>>(new Map())
  const [candidateOverdue, setCandidateOverdue] = useState<Map<string, number>>(new Map())
  const [orderMatchMode, setOrderMatchMode] = useState<'none' | 'auto' | 'ambiguous'>('none')
  const [orderMatchOverridden, setOrderMatchOverridden] = useState(false) // "cambiar" tras auto-enlazar
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [pickedOrderId, setPickedOrderId] = useState<string | null>(null)
  // ENCARGO CODE (12/08) — fix/enlace-pedido-recepcion, Corrección A/B: un
  // borrador YA enlazado (prefill.purchaseOrderId) no vuelve a buscar
  // candidatos ni se pisa solo — se muestra tal cual, con "Cambiar" opt-in.
  // "Cambiar" activa esto y a partir de ahí se comporta como no-enlazado.
  const [existingLinkOverridden, setExistingLinkOverridden] = useState(false)
  const [existingLinkedOrder, setExistingLinkedOrder] = useState<PurchaseOrder | null>(null)

  const [draft, setDraft] = useState<DraftLine[]>([])
  const [search, setSearch] = useState(focusSearch ?? '')

  const [loadingMeta, setLoadingMeta] = useState(true)
  const [loadingLines, setLoadingLines] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)   // panel resumen pre-confirmación

  // C2.2.b.1 — casado por línea: candidatos de run_mapping por key + picker abierto.
  const [lineMatch, setLineMatch] = useState<Record<string, { loading: boolean; candidates: LineMatchCandidate[] }>>({})

  // C2.2.c — ajustes de avisos + precios de referencia por artículo del proveedor.
  const [supplySettings, setSupplySettings] = useState<SupplySettings>({
    priceAlertPct: 15, expiryAlertDays: 3, negotiatedAlertPct: 0, driftAlertPct: 25, driftWindowMonths: 6,
    negStockRelPct: 5, negStockAbsQty: 5, negStockWindowDays: 60,
    dockPendingWindowBeforeDays: 7, dockPendingWindowAfterDays: 3, hungOrderDaysThreshold: 14,
  })
  // Unidades de cocina (para expresar el €/base de los avisos en €/kg, €/L, €/ud).
  const [units, setUnits] = useState<KitchenUnit[]>([])
  useEffect(() => {
    listUnits().then(setUnits).catch(() => setUnits([]))
  }, [])
  // €/unidad-base por formato (deriva caja→bote vía SQL). Clave del aviso PUNTUAL.
  const [formatPrices, setFormatPrices] = useState<Record<string, number>>({})
  // recipe_item_id → { lastPrice, negotiatedPrice } (€/base). Clave del aviso de PACTADO.
  const [priceRefs, setPriceRefs] = useState<Record<string, SupplierPriceRef>>({})
  // recipe_item_id → deriva de precio (price_drift_for). Clave del aviso de DERIVA.
  const [driftByItem, setDriftByItem] = useState<Record<string, PriceDrift>>({})
  // Zona principal por artículo en el local (referencia automática del enrutado).
  const [homeAreaByItem, setHomeAreaByItem] = useState<Record<string, string>>({})
  useEffect(() => {
    getSupplySettings(accountId).then(setSupplySettings).catch(() => {})
  }, [accountId])
  useEffect(() => {
    if (!supplierId) { setFormatPrices({}); setPriceRefs({}); return }
    getSupplierFormatPrices(accountId, supplierId).then(setFormatPrices).catch(() => setFormatPrices({}))
    getSupplierLastPrices(accountId, supplierId).then(setPriceRefs).catch(() => setPriceRefs({}))
  }, [accountId, supplierId])
  const [pickerKey, setPickerKey] = useState<string | null>(null)
  // Motivo del descuadre por línea (clave de DraftLine → motivo). Se vuelca a discrepancy_reason.
  const [discrepancyReasons, setDiscrepancyReasons] = useState<Record<string, string>>({})
  // ── T1: Constructor de formato guiado (un asistente por línea) ──
  // Reemplaza las casillas abstractas adjN×adjM por preguntas en idioma de cocina.
  // Escribe en los MISMOS campos (packCount/packInnerBase/packInnerName/formatName)
  // que ya consume persist→ensurePackTree. NO toca el motor.
  const [wizardKey, setWizardKey] = useState<string | null>(null)
  const [wz, setWz] = useState<WizardState>(emptyWizard())
  // ENCARGO CODE (12/08) — fix/recepcion-selector-formato: hoja/modal "Elegir
  // formato" (§3.3). Reutiliza el wizard de arriba como su modo "crear" — no
  // hay dos motores de formato, solo dos puertas de entrada al mismo.
  const [formatSheetKey, setFormatSheetKey] = useState<string | null>(null)

  function chooseMatch(key: string, recipeItemId: string, name: string, semaphore: 'green' | 'yellow' | null, matchType: string | null) {
    setDraft(d => d.map(x => x.key === key
      ? { ...x, recipeItemId, matchedName: name, matchSemaphore: semaphore, matchType,
          // reinicia el formato: lo resolverá el efecto para el artículo recién casado
          purchaseFormatId: null, formatLabel: null, formatQtyInBase: null,
          baseUnit: null, formatSuggested: false, formatTouched: false, skipStock: false,
          // ENCARGO CODE (12/08) R1' — la persona decidió: el casado automático
          // (efecto de abajo) ya no vuelve a tocar esta línea, y la propuesta
          // por nombre (si la había) se limpia — ya no pinta nada.
          matchTouched: true, suggestedRecipeItemId: null, suggestedName: null }
      : x))
    setPickerKey(null)
  }
  function clearMatch(key: string) {
    setDraft(d => d.map(x => x.key === key
      ? { ...x, recipeItemId: null, matchedName: null, matchSemaphore: null, matchType: null,
          purchaseFormatId: null, formatLabel: null, formatQtyInBase: null,
          baseUnit: null, formatSuggested: false, formatTouched: false, skipStock: false,
          matchTouched: true, suggestedRecipeItemId: null, suggestedName: null }
      : x))
  }
  // R1' §2.2 — "¿Es esto?" (Fila 1.5): acepta la propuesta por nombre con UN
  // toque explícito (nunca automático) o la descarta para ir directo a buscar.
  function acceptSuggestion(line: DraftLine) {
    if (!line.suggestedRecipeItemId || !line.suggestedName) return
    chooseMatch(line.key, line.suggestedRecipeItemId, line.suggestedName, 'yellow', 'learned_fuzzy')
  }
  function dismissSuggestion(key: string) {
    // matchTouched: true — si no, el efecto de la propuesta la vuelve a poner
    // en el siguiente render (recalcula desde el mismo catálogo, sin memoria
    // de que la persona ya dijo que no). A partir de aquí busca a mano.
    setDraft(d => d.map(x => x.key === key ? { ...x, suggestedRecipeItemId: null, suggestedName: null, matchTouched: true } : x))
    setPickerKey(key)
  }
  function toggleSkipStock(key: string) {
    setDraft(d => d.map(l => l.key === key ? { ...l, skipStock: !l.skipStock } : l))
  }
  // Abre la hoja de formato. Sin ningún formato existente no hay lista que
  // mostrar (§3.3: "si el artículo no tiene ningún formato, la hoja abre
  // directamente en crear") — entra derecha al wizard.
  function openFormatSheet(line: DraftLine) {
    setFormatSheetKey(line.key)
    if ((line.formatOptions?.length ?? 0) === 0) {
      setWz(wizardFromPack(parsePack(line.rawText, line.baseUnit?.abbr), line.baseUnit?.abbr))
      setWizardKey(line.key)
    } else {
      setWizardKey(null)
      setWz(emptyWizard())
    }
  }
  function closeFormatSheet() {
    setFormatSheetKey(null)
    setWizardKey(null)
    setWz(emptyWizard())
  }
  function startWizardInSheet(line: DraftLine) {
    setWz(wizardFromPack(parsePack(line.rawText, line.baseUnit?.abbr), line.baseUnit?.abbr))
    setWizardKey(line.key)
  }
  // "Volver"/"Cancelar" del wizard dentro de la hoja: si el artículo ya tenía
  // formatos, vuelve a la lista; si no tenía ninguno, no hay a qué volver.
  function cancelWizardInSheet(line: DraftLine) {
    setWizardKey(null)
    setWz(emptyWizard())
    if ((line.formatOptions?.length ?? 0) === 0) setFormatSheetKey(null)
  }
  function applyWizardResult(line: DraftLine) {
    const p = wizardToPack(wz, line.baseUnit?.abbr)
    if (!p) return
    applyPackFromAlbaran(line.key, p.count, p.innerBase, p.innerName, p.container)
    closeFormatSheet()
  }
  function pickFormatAndClose(line: DraftLine, formatId: string) {
    selectFormatOption(line.key, formatId)
    setFormatSheetKey(null)
  }

  // ── Tramo A: captura de formato (solo OCR) ──
  // Catálogo del proveedor (para HEREDAR el formato si el artículo ya lo tiene
  // con él) + caché de unidad base por artículo + ref al draft para el efecto async.
  const [catalogByItem, setCatalogByItem] = useState<Map<string, SupplierCatalogEntry>>(new Map())
  const baseUnitCache = useRef<Map<string, BaseUnitInfo | null>>(new Map())
  const draftRef = useRef<DraftLine[]>([])
  useEffect(() => { draftRef.current = draft }, [draft])

  useEffect(() => {
    if (!needsResolution || !supplierId) { setCatalogByItem(new Map()); return }
    let cancelled = false
    getSupplierCatalog(accountId, supplierId)
      .then(entries => {
        if (cancelled) return
        const m = new Map<string, SupplierCatalogEntry>()
        entries.forEach(e => m.set(e.recipeItemId, e))
        setCatalogByItem(m)
      })
      .catch(() => { if (!cancelled) setCatalogByItem(new Map()) })
    return () => { cancelled = true }
  }, [needsResolution, accountId, supplierId])

  // ── R1' — índices de lectura sobre el MISMO catálogo, por código/texto/
  // palabra. No son consultas nuevas: catalogByItem ya está cargado para el
  // formato (Tramo A); esto solo lo reorganiza para buscar al revés (de lo
  // que dice el albarán, hacia el artículo que ya se compró con ese texto).
  const catalogByCode = useMemo(() => {
    const m = new Map<string, SupplierCatalogEntry>()
    for (const e of catalogByItem.values()) {
      if (e.supplierCode && e.supplierCode.trim() !== '') m.set(e.supplierCode.trim().toLowerCase(), e)
    }
    return m
  }, [catalogByItem])
  const catalogByText = useMemo(() => {
    const m = new Map<string, SupplierCatalogEntry>()
    for (const e of catalogByItem.values()) {
      if (e.supplierItemName) m.set(normalizeWords(e.supplierItemName), e)
    }
    return m
  }, [catalogByItem])
  const catalogWordIndex = useMemo(() => {
    const idx = new Map<string, SupplierCatalogEntry[]>()
    for (const e of catalogByItem.values()) {
      for (const w of significantWords(e.itemName)) {
        const arr = idx.get(w) ?? []
        arr.push(e)
        idx.set(w, arr)
      }
    }
    return idx
  }, [catalogByItem])

  // ── R1' — casado automático (ENCARGO CODE feat/recepcion-casado-automatico,
  // §2.1). Para cada línea sin artículo y sin tocar a mano (matchTouched),
  // busca en el catálogo del proveedor por orden de certeza:
  //   1) supplier_code exacto      → auto-casa, verde, matchType 'code'
  //   2) supplier_item_name exacto → auto-casa, verde, matchType 'learned'
  // Solo estos dos SON casado automático: son señales que un humano ya
  // confirmó alguna vez (el código lo dio el proveedor; el texto exacto es
  // justo lo que learn_from_receipt grabó tras una recepción confirmada).
  // Nunca pisa un casado que ya exista (recipeItemId) ni uno que el humano
  // haya tocado o quitado (matchTouched) — mismo patrón que el formato
  // (formatTouched). Arrastra SOLO el artículo: el formato lo resuelve el
  // efecto de Tramo A en cuanto ve el recipeItemId puesto (misma cadena que
  // ya usa un casado manual desde LineMatchPicker).
  //
  // ENCARGO CODE (12/08) fix/recepcion-fromocr-borrador — guardaba `fromOcr`,
  // que es "esta sesión trae ocrPrefill", no "esta línea necesita casado".
  // Al revisar un borrador (correcting && prefill) las líneas siguen
  // exactamente igual de sin-casar, pero llegan por `prefill`, nunca por
  // `ocrPrefill` — el efecto no corría justo donde Julio revisa. Ahora usa
  // needsResolution (fromOcr || correcting). También rellena `matchedName`
  // para una línea YA casada que llega sin nombre para mostrar (el borrador
  // no lo transporta — ver handleReviewDraft/ReceiptPrefillLine).
  useEffect(() => {
    if (!needsResolution || catalogByItem.size === 0) return
    setDraft(d => {
      let changed = false
      const next = d.map(l => {
        if (l.recipeItemId) {
          if (l.matchedName || l.matchTouched) return l
          const known = catalogByItem.get(l.recipeItemId)
          if (!known) return l
          changed = true
          return { ...l, matchedName: known.itemName }
        }
        if (l.matchTouched) return l
        const text = (l.rawText ?? l.productName ?? '').trim()
        let entry: SupplierCatalogEntry | undefined
        let matchType: string | null = null
        if (l.supplierCode && l.supplierCode.trim() !== '') {
          entry = catalogByCode.get(l.supplierCode.trim().toLowerCase())
          if (entry) matchType = 'code'
        }
        if (!entry && text) {
          entry = catalogByText.get(normalizeWords(text))
          if (entry) matchType = 'learned'
        }
        if (!entry) return l
        changed = true
        return { ...l, recipeItemId: entry.recipeItemId, matchedName: entry.itemName, matchSemaphore: 'green' as const, matchType }
      })
      return changed ? next : d
    })
  }, [needsResolution, catalogByItem, catalogByCode, catalogByText])

  // ── R1' §2.2 — "nombre razonable, candidato ÚNICO": NO se auto-aplica.
  // Medido en datos reales (12/08, cuenta Foodint): de 4 casos que esta regla
  // proponía como candidato único, 3 eran incorrectos (un catálogo con pocos
  // artículos hace que una palabra genérica como "kraft" o "bolsa" parezca
  // "única" sin serlo de verdad — papel de horno y una tarrina de cartón
  // cayeron sobre "Bolsas de papel kraft..." solo por compartir esa palabra).
  // Con "el stock entra al recibir" (diseño de la sesión), un auto-casado
  // equivocado aquí es el MISMO error que el Pan de Pita — silencioso y ya
  // dentro del stock. Por eso esto queda como SUGERENCIA que pide un toque
  // explícito (nunca automática): rellena suggestedRecipeItemId/Name, no
  // recipeItemId. Ver Fila 1.5 ("¿Es esto?") y acceptSuggestion/dismissSuggestion.
  useEffect(() => {
    if (!needsResolution || catalogByItem.size === 0) return
    setDraft(d => {
      let changed = false
      const next = d.map(l => {
        if (l.recipeItemId || l.matchTouched) return l
        const text = (l.rawText ?? l.productName ?? '').trim()
        if (!text) return l.suggestedRecipeItemId ? { ...l, suggestedRecipeItemId: null, suggestedName: null } : l
        const candidates = new Set<SupplierCatalogEntry>()
        for (const w of significantWords(text)) {
          for (const e of catalogWordIndex.get(w) ?? []) candidates.add(e)
        }
        const only = candidates.size === 1 ? [...candidates][0] : null
        if ((only?.recipeItemId ?? null) === (l.suggestedRecipeItemId ?? null)) return l
        changed = true
        return { ...l, suggestedRecipeItemId: only?.recipeItemId ?? null, suggestedName: only?.itemName ?? null }
      })
      return changed ? next : d
    })
  }, [needsResolution, catalogByItem, catalogWordIndex])

  // "Ajustar como el albarán": fija el DESGLOSE (Caja = count × interior) en la línea.
  // El total (formatQtyInBase) se deriva del desglose; al persistir, ensurePackTree
  // crea la unidad interior contable + la Caja con el total derivado.
  function applyPackFromAlbaran(key: string, count: number, innerBase: number, innerName: string, container: string) {
    const total = count * innerBase
    setDraft(d => d.map(l => {
      if (l.key !== key) return l
      const label = l.baseUnit ? `${container} (${formatBaseQty(total, l.baseUnit.abbr)})` : container
      // Sin formato PREVIO no hay €/base del que partir (ENCARGO CODE 12/08,
      // caso rector §4.7): rescaleCostToFormat necesita un ancla anterior y,
      // sin ella, vacía el coste — borraría el precio ya leído del albarán
      // justo al crear el primer formato del artículo. Sin ancla, se conserva
      // tal cual: ese precio YA es el de este formato recién definido.
      const newCost = l.formatQtyInBase != null
        ? rescaleCostToFormat(parseNum(l.unitCost), l.formatQtyInBase, total, l.purchaseFormatId ? (formatPrices[l.purchaseFormatId] ?? null) : null)
        : l.unitCost
      return { ...l, formatName: container, formatQtyInBase: total, unitCost: newCost, formatLabel: label,
        packCount: count, packInnerBase: innerBase, packInnerName: innerName,
        formatTouched: true, formatSuggested: false, purchaseFormatId: null, skipStock: false }
    }))
  }
  // Elegir uno de los formatos existentes del artículo (bote/caja). Fija id+nombre+qty
  // de golpe y marca formatTouched (el humano decidió) → no lo pisa el efecto de herencia.
  function selectFormatOption(key: string, formatId: string) {
    setDraft(d => d.map(l => {
      if (l.key !== key) return l
      const opt = (l.formatOptions ?? []).find(f => f.id === formatId)
      if (!opt) return l
      const label = (opt.qtyInBase != null && l.baseUnit)
        ? `${(opt.name ?? 'Formato')} (${formatBaseQty(opt.qtyInBase, l.baseUnit.abbr)})`
        : (opt.label ?? opt.name ?? null)
      // El coste escala con el contenido del nuevo formato (€/base constante),
      // salvo que no hubiera formato previo — mismo motivo que arriba.
      const newCost = l.formatQtyInBase != null
        ? rescaleCostToFormat(parseNum(l.unitCost), l.formatQtyInBase, opt.qtyInBase ?? null, formatPrices[opt.id] ?? null)
        : l.unitCost
      return { ...l, purchaseFormatId: opt.id, formatName: opt.name, formatQtyInBase: opt.qtyInBase, formatLabel: label, unitCost: newCost, formatTouched: true, formatSuggested: false, skipStock: false }
    }))
  }

  // Resuelve unidad base + formato de cada línea OCR casada: HEREDA el formato que
  // el artículo ya tenga con este proveedor; si no, PROPONE desde la pista del OCR
  // (sin inventar: si la dimensión no cuadra, deja la equivalencia vacía y el humano
  // la teclea). No pisa lo que el humano haya tocado (formatTouched). Se dispara al
  // cambiar el conjunto de artículos casados, el proveedor o el catálogo.
  const matchSignature = useMemo(
    () => draft.map(l => `${l.key}:${l.recipeItemId ?? ''}:${l.formatTouched ? 't' : ''}`).join('|'),
    [draft],
  )
  useEffect(() => {
    if (!needsResolution) return
    let cancelled = false
    ;(async () => {
      const todo = draftRef.current.filter(l => l.recipeItemId && !l.formatTouched)
      for (const line of todo) {
        const itemId = line.recipeItemId as string
        let base = line.baseUnit ?? baseUnitCache.current.get(itemId) ?? null
        if (!base) {
          base = await getItemBaseUnit(itemId)
          if (cancelled) return
          baseUnitCache.current.set(itemId, base)
        }
        const existing = catalogByItem.get(itemId)
        const options = existing?.formats ?? []
        let purchaseFormatId: string | null = null
        let formatName: string | null = line.formatName ?? null
        let formatQtyInBase: number | null = null
        let suggested = false
        if (options.length > 0) {
          // varios formatos posibles: elige el que casa con la unidad/cantidad del albarán
          const { option, confident } = pickFormatForLine(
            options, line.packUnit ?? null, line.packSize ?? null, existing?.purchaseFormatId ?? null,
          )
          if (option) {
            purchaseFormatId = option.id
            formatName = option.name ?? formatName
            formatQtyInBase = option.qtyInBase
            suggested = !confident   // si no hay certeza, queda como "propuesto" (✨/ámbar)
          }
        } else if (existing && existing.purchaseFormatId && existing.formatQtyInBase) {
          purchaseFormatId = existing.purchaseFormatId
          formatName = existing.formatName ?? formatName
          formatQtyInBase = existing.formatQtyInBase
        } else {
          formatQtyInBase = formatQtyInBaseFromPack(line.packSize ?? null, line.packUnit ?? null, base)
          if (!formatName) formatName = defaultFormatName(line.packUnit ?? null, base)
          suggested = formatQtyInBase !== null
        }
        const label = (formatQtyInBase !== null && base)
          ? `${(formatName ?? '').trim() || 'Formato'} (${formatBaseQty(formatQtyInBase, base.abbr)})`
          : null
        // Conversión cantidad-albarán → cantidad-en-formato (opción B). Reexpresa
        // "480 ud" a "6 cajas" SOLO cuando es seguro; ante la duda NO convierte (la
        // cantidad ya está en el formato). Cero falsos positivos.
        //
        // Reglas (todas deben cumplirse):
        //  (1) la unidad del albarán coincide EXACTAMENTE con la unidad base del
        //      artículo (g↔g, ml↔ml, ud↔ud-de-pieza). "ud" NO casa con base en g/ml:
        //      "12 ud" de un artículo medido en gramos = 12 piezas/bolsas, no 12 g.
        //  (2) el formato contiene > 1 base (es un envase, no la unidad suelta).
        //  (3) el resultado es ≥ 1 (recibir 0,01 de un formato = señal de error → no).
        //  (4) la división es limpia: cuadra en envases ~enteros (tolerancia 2%).
        const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
        const baseAbbrNorm = norm(base?.abbr)
        const albUnit = norm(line.albaranUnit)
        // sinónimos de la MISMA unidad base (no mezclamos dimensiones)
        const sameAsBase =
          albUnit === baseAbbrNorm ||
          (baseAbbrNorm === 'g'  && ['g','gr','gramo','gramos'].includes(albUnit)) ||
          (baseAbbrNorm === 'ml' && ['ml','mililitro','mililitros'].includes(albUnit)) ||
          (baseAbbrNorm === 'ud' && ['ud','uds','u','unidad','unidades'].includes(albUnit))
        let convertedNote: string | null = null   // referencia "480 ud → 6 cajas" (NO precarga el recibido: a ciegas)
        if (
          sameAsBase &&
          formatQtyInBase != null && formatQtyInBase > 1 &&
          line.albaranQty != null && line.albaranQty > 0
        ) {
          const enFormato = line.albaranQty / formatQtyInBase
          const redondeo = Math.round(enFormato)
          const limpio = redondeo >= 1 && Math.abs(enFormato - redondeo) / redondeo <= 0.02
          if (limpio) {
            const baseLabel = base ? formatBaseQty(line.albaranQty, base.abbr) : `${line.albaranQty}`
            convertedNote = `${baseLabel} → ${redondeo} ${(formatName ?? 'formato').toLowerCase()}${redondeo === 1 ? '' : 's'}`
          }
        }
        setDraft(d => d.map(x => {
          if (x.key !== line.key || x.formatTouched) return x
          if (x.baseUnit === base && x.purchaseFormatId === purchaseFormatId
              && x.formatQtyInBase === formatQtyInBase && x.formatName === formatName) return x
          return {
            ...x, baseUnit: base, purchaseFormatId, formatName, formatQtyInBase,
            formatLabel: label, formatSuggested: suggested, formatOptions: options,
            ...(convertedNote !== null ? { convertedNote } : {}),
          }
        }))
      }
    })()
    return () => { cancelled = true }
  }, [needsResolution, matchSignature, supplierId, catalogByItem])

  // C2.2.b.2 — alta de proveedor inline (cuando el OCR no casó proveedor).
  const [supCreate, setSupCreate] = useState(false)
  const [supName, setSupName] = useState('')
  const [supNif, setSupNif] = useState('')
  const [supPhone, setSupPhone] = useState('')      // Mejora 1
  const [supEmail, setSupEmail] = useState('')
  const [supAddress, setSupAddress] = useState('')
  const [supHealth, setSupHealth] = useState('')
  const [supSaving, setSupSaving] = useState(false)
  useEffect(() => {
    if (fromOcr && !order && ocrPrefill?.unmatchedSupplier) {
      setSupName(ocrPrefill.proposedSupplierName ?? '')
      setSupNif(ocrPrefill.proposedSupplierNif ?? '')
      setSupPhone(ocrPrefill.proposedSupplierPhone ?? '')
      setSupEmail(ocrPrefill.proposedSupplierEmail ?? '')
      setSupAddress(ocrPrefill.proposedSupplierAddress ?? '')
      setSupHealth(ocrPrefill.proposedSupplierHealthRegistry ?? '')
    }
  }, [fromOcr, ocrPrefill])

  async function createSupplierInline() {
    if (!supName.trim()) { setError('El proveedor necesita un nombre.'); return }
    setSupSaving(true); setError(null)
    try {
      const created = await quickCreateSupplier(
        accountId, supName, supNif || null,
        { phone: supPhone, email: supEmail, address: supAddress, healthRegistryNo: supHealth },
        authUserId ?? null, userProfile?.displayName ?? null,
      )
      setSuppliers(s => [...s, created].sort((a, b) => a.name.localeCompare(b.name)))
      setSupplierId(created.id)
      setSupCreate(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el proveedor.')
    } finally {
      setSupSaving(false)
    }
  }

  // ENCARGO CODE (12/08) — fix/enlace-pedido-recepcion, Corrección A: la
  // guarda ANTES era `order || correcting`, y `correcting = !!prefill` — eso
  // apagaba la búsqueda de candidatos (y con ella, todo el bloque de enlazar
  // pedido, §1690 más abajo) en TODA sesión de oficina que abre un borrador,
  // enlazado o no. Corregir un borrador y crear uno nuevo no son lo mismo: la
  // guarda correcta es sobre si YA hay un pedido enlazado (para no
  // rebuscar ni pisarlo), no sobre el hecho de estar corrigiendo.
  const linkedOrderId = order?.id
    ?? (prefill?.purchaseOrderId && !existingLinkOverridden ? prefill.purchaseOrderId : null)
    ?? pickedOrderId
    ?? null

  // Candidatos de pedido: modo CIEGO (manual o revisión de OCR/borrador SIN
  // pedido ya enlazado, o con el enlace existente descartado con "Cambiar"),
  // cuando ya hay proveedor+local. La revisión de OCR/borrador es este mismo
  // componente (ocrPrefill o prefill sin pedido) — el selector le sirve
  // igual. Mismo criterio de "pendiente" que OrderReceiveFlow (enviado /
  // recibido_parcial), MÁS la ventana de vigencia (dockPendingWindow*Days,
  // configurable): los "enviado" fuera de ventana no son candidatos aquí ni
  // en el muelle — solo lo vivo. Los "recibido_parcial" no se filtran por
  // ventana. Sin expected_date: se usa order_date como referencia (igual
  // que en OrderReceiveFlow) — "sin fecha" no es "candidato para siempre".
  useEffect(() => {
    // ENCARGO CODE (12/08) — Corrección C hace que loadingOrders bloquee el
    // guardado (antes solo pintaba un spinner cosmético). Los dos retornos
    // tempranos de abajo TIENEN que apagarlo explícitamente: si no, una
    // corrida anterior que dejó loadingOrders=true (efecto cancelado a medio
    // fetch al cambiar de guarda) se queda pegada y el botón de guardar no
    // vuelve a habilitarse nunca — la propia corrida "cancelled" nunca llega
    // a su finally() porque cancelled ya es true para entonces.
    if (order || (prefill?.purchaseOrderId && !existingLinkOverridden)) {
      setCandidateOrders([]); setLoadingOrders(false); return
    }
    if (!supplierId || !locationId) {
      setCandidateOrders([]); setPickedOrderId(null); setOrderMatchMode('none'); setOrderMatchOverridden(false)
      setLoadingOrders(false)
      return
    }
    let cancelled = false
    setLoadingOrders(true)
    listPurchaseOrders({ accountId, locationId })
      .then(async rows => {
        if (cancelled) return
        const nowMs = Date.now()
        const before = supplySettings.dockPendingWindowBeforeDays
        const after = supplySettings.dockPendingWindowAfterDays
        const filtered = rows.filter(o => {
          if (o.supplierId !== supplierId) return false
          if (o.status === 'recibido_parcial') return true
          if (o.status !== 'enviado') return false
          const refDate = o.expectedDate ?? o.orderDate
          const diffDays = (nowMs - new Date(refDate + 'T00:00:00').getTime()) / 86400000
          return diffDays <= before && diffDays >= -after
        })
        setCandidateOrders(filtered)
        // Si el pedido elegido deja de ser candidato (cambió proveedor/local), se olvida.
        setPickedOrderId(prev => (prev && filtered.some(o => o.id === prev)) ? prev : null)
        // Días de retraso calculados AQUÍ (una vez, al cargar) — no en el render:
        // Date.now() dentro de JSX rompe la pureza del render (react-hooks/purity).
        setCandidateOverdue(new Map(filtered.map(o => [
          o.id,
          Math.floor((nowMs - new Date((o.expectedDate ?? o.orderDate) + 'T00:00:00').getTime()) / 86400000),
        ])))

        if (filtered.length === 0) {
          setCandidateLineCounts(new Map())
          setOrderMatchMode('none'); setOrderMatchOverridden(false)
          return
        }

        // Líneas de cada candidato: nº (para la ficha) y, en OCR, productName
        // (para el score de solape). Un solo fetch por candidato para ambas cosas.
        const linesByOrder = await Promise.all(filtered.map(o =>
          listPurchaseOrderLines(o.id).then(ls => [o.id, ls] as const).catch(() => [o.id, [] as PurchaseOrderLine[]] as const)))
        if (cancelled) return
        setCandidateLineCounts(new Map(linesByOrder.map(([id, ls]) => [id, ls.length])))

        // ENCARGO CODE (12/08) — candidato único = enlaza solo SIEMPRE, con o
        // sin OCR. No necesita desempate por solape (no hay nada que
        // desempatar): "No preguntes lo que puedes deducir" — el mismo
        // principio que ya regía el modo OCR se extiende a la oficina
        // revisando un borrador (§3.1 del encargo: candidato único queda
        // preseleccionado también ahí, que no pasa ocrPrefill).
        if (filtered.length === 1) {
          setOrderMatchOverridden(false)
          setOrderMatchMode('auto')
          setPickedOrderId(filtered[0].id)
          return
        }

        // Con 2+ candidatos, el desempate por solape de líneas solo puede
        // aplicarse en OCR (es el único momento con líneas de albarán que
        // comparar). Sin OCR, se deja en 'none': el picker manual de
        // siempre lista los candidatos (proveedor+fecha+nº líneas a la
        // vista) — sigue siendo una elección de un vistazo, no un desplegable.
        if (!fromOcr || !ocrPrefill) {
          setOrderMatchMode('none'); setOrderMatchOverridden(false)
          return
        }
        const ocrNames = ocrPrefill.lines.map(l => l.productName).filter(Boolean)
        const windowDays = Math.max(before, after, 1)
        const scores = new Map(linesByOrder.map(([id, ls]) => {
          const order2 = filtered.find(o => o.id === id)!
          const lineScore = lineOverlapScore(ocrNames, ls.map(l => l.productName))
          const dateScore = dateProximityScore(order2.expectedDate, nowMs, windowDays)
          return [id, lineScore * 0.7 + dateScore * 0.3] as const
        }))

        const ranked = [...filtered].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
        const top = ranked[0]
        const topScore = scores.get(top.id) ?? 0
        const secondScore = ranked[1] ? (scores.get(ranked[1].id) ?? 0) : 0
        const dominant = topScore >= 0.5 && topScore - secondScore >= 0.25
        setOrderMatchOverridden(false)
        if (dominant) {
          setOrderMatchMode('auto')
          setPickedOrderId(top.id)
        } else {
          setOrderMatchMode('ambiguous')
        }
      })
      .catch((e: unknown) => {
        console.warn('[GoodsReceiptForm] listPurchaseOrders (candidatos) falló:', e)
        if (!cancelled) { setCandidateOrders([]); setOrderMatchMode('none') }
      })
      .finally(() => { if (!cancelled) setLoadingOrders(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, supplierId, locationId, order, prefill?.purchaseOrderId, existingLinkOverridden, fromOcr,
      supplySettings.dockPendingWindowBeforeDays, supplySettings.dockPendingWindowAfterDays])

  // ENCARGO CODE (12/08) — trae el código/fecha del pedido YA enlazado (para
  // mostrarlo con "Cambiar"), sin volver a listar candidatos. Se limpia si
  // se pulsa "Cambiar" (existingLinkOverridden) — a partir de ahí manda el
  // efecto de candidatos de arriba.
  useEffect(() => {
    if (!prefill?.purchaseOrderId || existingLinkOverridden) { setExistingLinkedOrder(null); return }
    let cancelled = false
    getPurchaseOrderById(prefill.purchaseOrderId)
      .then(o => { if (!cancelled) setExistingLinkedOrder(o) })
      .catch(() => { if (!cancelled) setExistingLinkedOrder(null) })
    return () => { cancelled = true }
  }, [prefill?.purchaseOrderId, existingLinkOverridden])

  // Auto-casado por recipe_item_id contra el pedido elegido (modo ciego, manual
  // u OCR). NO bloquea: lo que no casa se queda sin purchase_order_line_id
  // (línea extra del proveedor — pasa en la vida real; en OCR también puede
  // quedar así si el artículo aún no se ha casado por texto). Recalcula desde
  // cero en cada cambio de pedido elegido, así que "Sin pedido" limpia el casado.
  useEffect(() => {
    if (order || correcting) return
    if (!pickedOrderId) {
      setDraft(d => d.some(l => l.poLineId)
        ? d.map(l => ({ ...l, poLineId: null, qtyOrdered: null, alreadyReceived: null, pending: null }))
        : d)
      return
    }
    let cancelled = false
    Promise.all([
      listPurchaseOrderLines(pickedOrderId),
      listOrderLineReceived(pickedOrderId),
    ]).then(([poLines, received]) => {
      if (cancelled) return
      const byItem = new Map<string, PurchaseOrderLine>()
      for (const l of poLines) if (l.recipeItemId && !byItem.has(l.recipeItemId)) byItem.set(l.recipeItemId, l)
      const receivedByPoLine = new Map(received.map(r => [r.purchaseOrderLineId, r.receivedConfirmed]))
      setDraft(d => d.map(line => {
        const match = line.recipeItemId ? byItem.get(line.recipeItemId) : undefined
        if (!match) return line.poLineId ? { ...line, poLineId: null, qtyOrdered: null, alreadyReceived: null, pending: null } : line
        const already = receivedByPoLine.get(match.id) ?? 0
        return {
          ...line,
          poLineId: match.id,
          qtyOrdered: match.qtyOrdered,
          alreadyReceived: already,
          pending: Math.max(0, match.qtyOrdered - already),
        }
      }))
    }).catch((e: unknown) => {
      console.warn('[GoodsReceiptForm] auto-casado de líneas contra el pedido falló:', e)
      setError('No se pudo enlazar el pedido elegido. Puedes seguir sin enlazarlo.')
    })
    return () => { cancelled = true }
  }, [pickedOrderId, order, correcting, fromOcr])

  useEffect(() => {
    let cancelled = false
    setLoadingMeta(true)
    Promise.all([listSuppliers(accountId), listSupplyLocations(accountId)])
      .then(([sups, locs]) => {
        if (cancelled) return
        setSuppliers(sups)
        setLocations(locs)
        // el local operativo lo fija el hook; no se auto-selecciona el primero
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando datos.') })
      .finally(() => { if (!cancelled) setLoadingMeta(false) })
    return () => { cancelled = true }
  }, [accountId, fixedHeader])

  // Modo OCR: las líneas vienen del albarán leído (no del catálogo) y no dependen
  // del proveedor (que puede estar sin casar). Cantidad PRECARGADA con lo leído.
  useEffect(() => {
    if (!fromOcr || !ocrPrefill) return
    setLoadingLines(false)
    setDraft(ocrPrefill.lines.map((l, i) => ({
      key: `ocr-${i}`,
      recipeItemId: l.recipeItemId,       // null al entrar; lo pone el casado (b.1)
      productName: l.productName,
      purchaseFormatId: null,
      formatLabel: null,
      formatQtyInBase: null,
      qtyOrdered: null,
      alreadyReceived: null,
      pending: null,
      qty: '',   // RECIBIDO A CIEGAS: nace vacío SIEMPRE; la cantidad del albarán queda como referencia (albaranQty)
      unitCost: l.unitCost != null ? String(l.unitCost) : '',
      lineAmount: l.lineAmount ?? null,
      albaranUnit: l.albaranUnit ?? null,
      albaranQty: l.qty ?? null,                  // cantidad original del albarán (antes de convertir)
      convertedNote: null,
      poLineId: null,
      lotCode: l.lotCode,
      expiryDate: l.expiryDate,
      rawText: l.productName,
      supplierCode: l.supplierCode,
      matchedName: null,
      matchSemaphore: null,
      matchType: null,
      // Tramo A — pista de formato (se resuelve a equivalencia al casar el artículo).
      formatName: l.formatName,
      packSize: l.packSize,
      packUnit: l.packUnit,
      baseUnit: null,
      formatSuggested: false,
      formatTouched: false,
    })))
  }, [fromOcr, ocrPrefill])

  // C2.2.b.1 — casado de líneas con la memoria (run_mapping). Por cada línea
  // leída, busca candidatos; si hay un único verde, lo preselecciona (editable).
  useEffect(() => {
    if (!fromOcr || !ocrPrefill) return
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < ocrPrefill.lines.length; i++) {
        const l = ocrPrefill.lines[i]
        const key = `ocr-${i}`
        setLineMatch(m => ({ ...m, [key]: { loading: true, candidates: [] } }))
        try {
          const cands = await matchReceiptLine(accountId, l.productName, l.supplierCode)
          if (cancelled) return
          setLineMatch(m => ({ ...m, [key]: { loading: false, candidates: cands } }))
          const greens = cands.filter(c => c.semaphore === 'green')
          if (greens.length === 1) {
            const g = greens[0]
            setDraft(d => d.map(x => x.key === key
              ? { ...x, recipeItemId: g.recipeItemId, matchedName: g.name, matchSemaphore: g.semaphore, matchType: g.matchType }
              : x))
          }
        } catch {
          if (!cancelled) setLineMatch(m => ({ ...m, [key]: { loading: false, candidates: [] } }))
        }
      }
    })()
    return () => { cancelled = true }
  }, [fromOcr, ocrPrefill, accountId])

  // ── FUSIÓN PEDIDO + OCR: referencia del pedido por artículo ──
  // Cuando se escanea el albarán DE UN PEDIDO (order + ocrPrefill juntos), cargamos
  // las líneas del pedido para casar cada línea leída del albarán contra su línea
  // pedida (por recipe_item_id) → hereda poLineId + pedido/ya-recibido/pendiente.
  // Si un artículo está en varias líneas del pedido, nos quedamos con la que aún
  // tiene pendiente. Sin pedido detrás (OCR ciego) esto no se activa.
  const [orderRefByItem, setOrderRefByItem] = useState<
    Map<string, { poLineId: string; qtyOrdered: number; already: number; pending: number }>
  >(new Map())
  useEffect(() => {
    if (!fromOcr || !order) { setOrderRefByItem(new Map()); return }
    let cancelled = false
    ;(async () => {
      const [poLines, received] = await Promise.all([
        listPurchaseOrderLines(order.id),
        listOrderLineReceived(order.id),
      ])
      if (cancelled) return
      const recvByPo = new Map<string, number>()
      received.forEach(r => recvByPo.set(r.purchaseOrderLineId, r.receivedConfirmed))
      const m = new Map<string, { poLineId: string; qtyOrdered: number; already: number; pending: number }>()
      for (const l of poLines) {
        if (!l.recipeItemId) continue
        const already = recvByPo.get(l.id) ?? 0
        const pending = Math.max(0, l.qtyOrdered - already)
        const prev = m.get(l.recipeItemId)
        // preferimos la línea del pedido que todavía tiene pendiente
        if (!prev || (prev.pending <= 0 && pending > 0)) {
          m.set(l.recipeItemId, { poLineId: l.id, qtyOrdered: l.qtyOrdered, already, pending })
        }
      }
      setOrderRefByItem(m)
    })().catch(() => { if (!cancelled) setOrderRefByItem(new Map()) })
    return () => { cancelled = true }
  }, [fromOcr, order, accountId])

  useEffect(() => {
    if (fromOcr) return                   // en OCR las líneas las pone el efecto de arriba
    if (!supplierId) { setDraft([]); return }
    let cancelled = false
    setLoadingLines(true)
    setError(null)

    async function build() {
      const catalog = await getSupplierCatalog(accountId, supplierId)
      const byFormat = new Map<string, SupplierCatalogEntry>()
      const byItem = new Map<string, SupplierCatalogEntry>()
      catalog.forEach(e => {
        if (e.purchaseFormatId) byFormat.set(e.purchaseFormatId, e)
        byItem.set(e.recipeItemId, e)
      })
      const resolveFmt = (formatId: string | null, itemId: string | null) =>
        (formatId && byFormat.get(formatId)) || (itemId ? byItem.get(itemId) : undefined)

      // Referencia pedido/ya recibido/pendiente (si hay pedido detrás).
      const orderedByPoLine = new Map<string, number>()
      const receivedByPoLine = new Map<string, number>()
      const refOrderId = order?.id ?? prefill?.purchaseOrderId ?? null
      if (refOrderId) {
        const [poLines, received] = await Promise.all([
          listPurchaseOrderLines(refOrderId),
          listOrderLineReceived(refOrderId, correcting ? { excludeReceiptId: prefill!.sourceReceiptId } : undefined),
        ])
        poLines.forEach(l => orderedByPoLine.set(l.id, l.qtyOrdered))
        received.forEach(r => receivedByPoLine.set(r.purchaseOrderLineId, r.receivedConfirmed))
      }
      const refFor = (poLineId: string | null) => {
        if (!poLineId || !orderedByPoLine.has(poLineId)) {
          return { qtyOrdered: null as number | null, already: null as number | null, pending: null as number | null }
        }
        const ordered = orderedByPoLine.get(poLineId)!
        const already = receivedByPoLine.get(poLineId) ?? 0
        return { qtyOrdered: ordered, already, pending: Math.max(0, ordered - already) }
      }

      let lines: DraftLine[]
      if (correcting && prefill) {
        lines = prefill.lines.map((l, i) => {
          const cat = resolveFmt(l.purchaseFormatId, l.recipeItemId)
          const ref = refFor(l.purchaseOrderLineId)
          return {
            key: `pf-${i}`,
            recipeItemId: l.recipeItemId,
            productName: l.productName,
            purchaseFormatId: l.purchaseFormatId ?? cat?.purchaseFormatId ?? null,
            formatLabel: cat?.formatLabel ?? cat?.formatName ?? null,
            formatQtyInBase: cat?.formatQtyInBase ?? null,
            qtyOrdered: ref.qtyOrdered,
            alreadyReceived: ref.already,
            pending: ref.pending,
            // Revisión de BORRADOR → precarga lo que contó el trabajador (para verlo
            // y ajustar). Corrección de una CONFIRMADA → vacío (se re-cuenta).
            qty: prefill.isDraft && l.qtyReceived != null ? String(l.qtyReceived) : '',
            unitCost: l.unitCost != null ? String(l.unitCost) : (cat?.lastPrice != null ? String(cat.lastPrice) : ''),
            poLineId: l.purchaseOrderLineId,
            lotCode: null,
            expiryDate: null,
            // ENCARGO CODE (12/08) fix/recepcion-fromocr-borrador: rawText/
            // supplierCode ya no se hardcodean a null — sin ellos el casado
            // automático (R1') no tiene ancla al revisar un borrador OCR.
            // matchedName se queda null a propósito: el efecto de casado lo
            // rellena desde catalogByItem en cuanto carga (ver "tier 0").
            rawText: l.rawText, supplierCode: l.supplierCode, matchedName: null, matchSemaphore: null, matchType: null,
          }
        })
      } else if (againstOrder && order) {
        const poLines: PurchaseOrderLine[] = await listPurchaseOrderLines(order.id)
        lines = poLines.map(l => {
          const cat = resolveFmt(l.purchaseFormatId, l.recipeItemId)
          const ref = refFor(l.id)
          return {
            key: l.id,
            recipeItemId: l.recipeItemId,
            productName: l.productName,
            purchaseFormatId: l.purchaseFormatId ?? cat?.purchaseFormatId ?? null,
            formatLabel: cat?.formatLabel ?? cat?.formatName ?? null,
            formatQtyInBase: cat?.formatQtyInBase ?? null,
            qtyOrdered: ref.qtyOrdered,
            alreadyReceived: ref.already,
            pending: ref.pending,
            qty: '',
            unitCost: l.estUnitPrice != null ? String(l.estUnitPrice) : (cat?.lastPrice != null ? String(cat.lastPrice) : ''),
            poLineId: l.id,
            lotCode: null,
            expiryDate: null,
            rawText: null, supplierCode: null, matchedName: null, matchSemaphore: null, matchType: null,
          }
        })
      } else {
        lines = catalog.map(e => ({
          key: e.articleSupplierId,
          recipeItemId: e.recipeItemId,
          productName: e.itemName,
          purchaseFormatId: e.purchaseFormatId,
          formatLabel: e.formatLabel ?? e.formatName ?? null,
          formatQtyInBase: e.formatQtyInBase,
          qtyOrdered: null,
          alreadyReceived: null,
          pending: null,
          qty: '',
          unitCost: e.lastPrice != null ? String(e.lastPrice) : '',
          poLineId: null,
          lotCode: null,
          expiryDate: null,
          rawText: null, supplierCode: null, matchedName: null, matchSemaphore: null, matchType: null,
        }))
      }
      if (!cancelled) setDraft(lines)
    }

    build()
      .catch((err: unknown) => { if (!cancelled) { setError(err instanceof Error ? err.message : 'Error cargando líneas.'); setDraft([]) } })
      .finally(() => { if (!cancelled) setLoadingLines(false) })
    return () => { cancelled = true }
  }, [accountId, supplierId, againstOrder, order, correcting, prefill])

  function setQty(key: string, qty: string) {
    setDraft(d => d.map(l => l.key === key ? { ...l, qty, convertedNote: null } : l))
  }
  function setCost(key: string, unitCost: string) {
    setDraft(d => d.map(l => l.key === key ? { ...l, unitCost } : l))
  }
  // Acelerador opt-in: rellena Recibido con el pendiente (solo líneas con pendiente>0).
  function fillWithPending() {
    setDraft(d => d.map(l => (l.pending !== null && l.pending > 0) ? { ...l, qty: String(l.pending) } : l))
  }

  const hasReference = useMemo(() => draft.some(l => l.pending !== null), [draft])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return draft
    return draft.filter(l => l.productName.toLowerCase().includes(q))
  }, [draft, search])

  const filled = useMemo(
    () => draft.filter(l => { const n = parseNum(l.qty); return n !== null && n > 0 }),
    [draft],
  )
  const willPost = useMemo(
    () => filled.filter(l => l.recipeItemId && qtyInBaseFromFormat(parseNum(l.qty)!, l.formatQtyInBase) !== null).length,
    [filled],
  )

  // Deriva de precio por artículo casado. Depende solo de (cuenta, item, ventana),
  // no del proveedor ni del precio tecleado → se recarga cuando cambia el conjunto
  // de artículos casados o la ventana, no en cada tecla. Clave estable = ids unidos.
  const matchedItemIds = useMemo(
    () => Array.from(new Set(draft.map(l => l.recipeItemId).filter((x): x is string => !!x))),
    [draft],
  )
  const matchedItemIdsKey = matchedItemIds.join(',')
  useEffect(() => {
    if (matchedItemIds.length === 0) { setDriftByItem({}); return }
    let cancelled = false
    Promise.all(
      matchedItemIds.map(id =>
        getPriceDrift(accountId, id, supplySettings.driftWindowMonths).then(d => [id, d] as const),
      ),
    )
      .then(pairs => {
        if (cancelled) return
        const m: Record<string, PriceDrift> = {}
        for (const [id, d] of pairs) if (d) m[id] = d
        setDriftByItem(m)
      })
      .catch(() => { if (!cancelled) setDriftByItem({}) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, matchedItemIdsKey, supplySettings.driftWindowMonths])

  // Zona principal por artículo en el local de la recepción. Referencia que se
  // MUESTRA en el resumen ("→ Cámara"); el enrutado real lo hace el servidor.
  // Se recarga al cambiar el conjunto de artículos casados o el local.
  useEffect(() => {
    if (matchedItemIds.length === 0 || !locationId) { setHomeAreaByItem({}); return }
    let cancelled = false
    getItemHomeAreas(accountId, locationId, matchedItemIds)
      .then(m => { if (!cancelled) setHomeAreaByItem(m) })
      .catch(() => { if (!cancelled) setHomeAreaByItem({}) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, locationId, matchedItemIdsKey])

  // FUSIÓN PEDIDO + OCR: en cuanto una línea leída casa un artículo (auto o a
  // mano), hereda la referencia de su línea de pedido (poLineId + pendiente). Si
  // se descasa o el artículo no está en el pedido, se limpia la referencia. Una
  // sola vía (reconciliación) en vez de tocar cada punto donde se asigna artículo.
  useEffect(() => {
    if (!fromOcr || !order) return
    setDraft(d => {
      let changed = false
      const next = d.map(l => {
        const ref = l.recipeItemId ? orderRefByItem.get(l.recipeItemId) : undefined
        if (ref) {
          if (l.poLineId !== ref.poLineId || l.pending !== ref.pending) {
            changed = true
            return { ...l, poLineId: ref.poLineId, qtyOrdered: ref.qtyOrdered, alreadyReceived: ref.already, pending: ref.pending }
          }
          return l
        }
        // artículo no casado o no presente en el pedido → sin referencia (línea extra)
        if (l.poLineId !== null || l.pending !== null) {
          changed = true
          return { ...l, poLineId: null, qtyOrdered: null, alreadyReceived: null, pending: null }
        }
        return l
      })
      return changed ? next : d
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromOcr, order, orderRefByItem, matchedItemIdsKey])

  // ── Resumen anti-error ──
  // Las líneas "de más" se listan con DETALLE (cuánto, contra lo pendiente y
  // contra el pedido total) para que el aviso sea accionable, no genérico.
  const summary = useMemo(() => {
    const linesWithPending = draft.filter(l => l.pending !== null && l.pending > 0)
    let coinciden = 0, deMenos = 0
    const overLines: OverLine[] = []
    for (const l of filled) {
      if (l.pending === null) continue
      const n = parseNum(l.qty)!
      if (n > l.pending) {
        const ordered = l.qtyOrdered
        const already = l.alreadyReceived ?? 0
        overLines.push({
          name: l.productName,
          received: n,
          pending: l.pending,
          overPending: n - l.pending,
          totalAfter: already + n,
          ordered,
          overOrdered: ordered !== null ? Math.max(0, (already + n) - ordered) : null,
        })
      } else if (l.pending > 0 && n < l.pending) deMenos++
      else if (n === l.pending) coinciden++
    }
    const untouchedLines = linesWithPending
      .filter(l => { const n = parseNum(l.qty); return n === null || n <= 0 })
      .map(l => ({ name: l.productName, pending: l.pending as number }))
    const sinTocar = untouchedLines.length
    const sinMapear = filled.length - willPost
    // C2.2.c — recuento de avisos para el resumen pre-confirmación.
    let priceAlerts = 0, expiryAlerts = 0, negotiatedAlerts = 0, driftAlerts = 0
    for (const l of draft) {
      // Mismo criterio que el render: puntual y pactado solo cuentan con cantidad > 0
      // (sin recepción contada no hay entrante que comparar). La deriva no lo exige.
      const qN = parseNum(l.qty)
      const hasQtyL = qN !== null && qN > 0
      if (l.recipeItemId && hasQtyL && priceAlertFor({
        lineAmount: l.lineAmount ?? null,
        unitCost: parseNum(l.unitCost),
        qtyReceived: qN,
        formatQtyInBase: l.formatQtyInBase,
        expectedPerBase: l.purchaseFormatId ? (formatPrices[l.purchaseFormatId] ?? null) : null,
        thresholdPct: supplySettings.priceAlertPct,
      })) priceAlerts++
      if (l.recipeItemId && hasQtyL && negotiatedAlertFor({
        newPrice: lineActualPerBase({
          lineAmount: l.lineAmount ?? null,
          unitCost: parseNum(l.unitCost),
          qtyReceived: parseNum(l.qty),
          formatQtyInBase: l.formatQtyInBase,
        }),
        negotiatedPrice: priceRefs[l.recipeItemId]?.negotiatedPrice ?? null,
        thresholdPct: supplySettings.negotiatedAlertPct,
      })) negotiatedAlerts++
      if (l.recipeItemId) {
        const dr = driftByItem[l.recipeItemId] ?? null
        if (dr && driftAlertFor({
          pctVsMedian: dr.pctVsMedian,
          nRecepciones: dr.nRecepciones,
          medianEurBase: dr.medianEurBase,
          thresholdPct: supplySettings.driftAlertPct,
          minReceptions: 3,
        })) driftAlerts++
      }
      if (expiryAlertFor(l.expiryDate, supplySettings.expiryAlertDays)) expiryAlerts++
    }
    // ── Desglose EXACTO de "qué entra al almacén" (deuda Julio 7/06) ──
    // Misma regla que confirm_goods_receipt: una línea entra si tiene artículo
    // casado Y qty_in_base resoluble. Aquí se muestra ANTES de confirmar, línea a
    // línea, en la unidad de almacén — no un recuento agregado.
    const enterLines: EnterLine[] = []
    const notEnterLines: NotEnterLine[] = []
    for (const l of filled) {
      const n = parseNum(l.qty)!
      const qib = qtyInBaseFromFormat(n, l.formatQtyInBase)
      if (l.recipeItemId && qib !== null) {
        enterLines.push({
          name: l.productName,
          qtyInBase: qib,
          baseAbbr: l.baseUnit?.abbr ?? null,
          convertedNote: l.convertedNote ?? null,
          unitCost: parseNum(l.unitCost),
          areaName: homeAreaByItem[l.recipeItemId] ?? null,
        })
      } else {
        notEnterLines.push({
          name: l.productName,
          reason: !l.recipeItemId ? 'sin reconocer' : 'sin formato',
          excluded: !!l.skipStock,
        })
      }
    }

    // Anomalía = algo de más, o masa sin tocar (>30% de las líneas con pendiente y >3).
    const masaSinTocar = sinTocar > 3 && linesWithPending.length > 0 && (sinTocar / linesWithPending.length) > 0.30
    // Líneas que piden MOTIVO del descuadre: de más / de menos (vs pedido) o
    // importe que no cuadra con el albarán (eje €, limpio). No bloquean.
    const flagLines: { key: string; name: string; why: string }[] = []
    for (const l of filled) {
      const n = parseNum(l.qty)
      if (n === null || n <= 0) continue
      const why: string[] = []
      if (l.pending !== null && n > l.pending) why.push('de más')
      else if (l.pending !== null && l.pending > 0 && n < l.pending) why.push('de menos')
      const cN = parseNum(l.unitCost)
      if (cN !== null && l.lineAmount != null && l.lineAmount > 0) {
        const rec = n * cN
        if (Math.abs(rec - l.lineAmount) > 0.01 && Math.abs(rec - l.lineAmount) / l.lineAmount > 0.005) why.push('importe no cuadra con el albarán')
      }
      if (why.length > 0) flagLines.push({ key: l.key, name: l.productName, why: why.join(' · ') })
    }
    const anomaly = overLines.length > 0 || masaSinTocar
    return {
      filled: filled.length, aStock: willPost, sinMapear,
      coinciden, deMenos, deMas: overLines.length, sinTocar,
      overLines, untouchedLines,
      enterLines, notEnterLines,
      priceAlerts, expiryAlerts, negotiatedAlerts, driftAlerts,
      hasReference, anomaly, masaSinTocar,
      flagLines,
    }
  }, [draft, filled, willPost, hasReference, formatPrices, priceRefs, driftByItem, homeAreaByItem, supplySettings])

  const supplierName = useMemo(() => suppliers.find(s => s.id === supplierId)?.name ?? '—', [suppliers, supplierId])
  const locationName = useMemo(() => locations.find(l => l.id === locationId)?.name ?? '—', [locations, locationId])

  // ¿Puede quien recibe CONFIRMAR (postear a stock), o solo dejar BORRADOR?
  // 'always' → siempre (oficina). 'by-location' → solo si el local NO exige oficina.
  const locApproval = useMemo(
    () => locations.find(l => l.id === locationId)?.receiptApproval ?? 'trabajador',
    [locations, locationId],
  )
  const canConfirm = confirmPolicy === 'always' || locApproval !== 'oficina'

  function startReview() {
    if (!fromOcr && !supplierId) { setError('Elige un proveedor.'); return }
    if (!locationId) { setError('No hay un local operativo definido. Revisa el aviso de local arriba.'); return }
    if (filled.length === 0) { setError('Pon cantidad recibida en al menos un artículo.'); return }
    setError(null)
    setReviewing(true)
  }

  // ¿Revisión de un BORRADOR en sitio? La oficina confirma la MISMA recepción.
  const reviewingDraft = correcting && !!prefill?.isDraft

  async function persist(confirm: boolean) {
    if (!locationId) { setError('No hay un local operativo definido. Revisa el aviso de local arriba.'); return }
    setSaving(true); setError(null)
    try {
      let receipt: { id: string; code: string | null }
      if (reviewingDraft && prefill) {
        // En sitio: actualiza cabecera + limpia líneas para reescribirlas. NO crea
        // recepción nueva ni anula (el borrador nunca posteó).
        // ENCARGO CODE (12/08): purchaseOrderId: linkedOrderId — sin esto, la
        // sesión donde la oficina de verdad confirma nunca escribía el enlace
        // aunque el formulario lo calculara bien (ver GoodsReceiptUpdate).
        const updated = await updateGoodsReceipt(prefill.sourceReceiptId, {
          supplierId: supplierId || null,
          purchaseOrderId: linkedOrderId,
          supplierDocNumber: supplierDoc.trim() || null,
          receiptDate,
        })
        await deleteGoodsReceiptLinesByReceipt(prefill.sourceReceiptId)
        receipt = { id: updated.id, code: updated.code }
      } else {
        receipt = await createGoodsReceipt({
          accountId, locationId, supplierId: supplierId || null,
          purchaseOrderId: linkedOrderId,
          supplierDocNumber: supplierDoc.trim() || null,
          receiptDate,
          receivedAt: new Date().toISOString(),
          source: fromOcr ? 'ocr' : 'manual',
          deliveredBy: fromOcr ? (ocrPrefill?.deliveredBy ?? null) : null,
          aiSessionId: fromOcr ? (ocrPrefill?.aiSessionId ?? null) : null,
          rawDocumentUrl: fromOcr ? (ocrPrefill?.rawDocumentUrl ?? null) : null,
          createdBy: authUserId ?? null,
          createdByName: userProfile?.displayName ?? null,
        })
      }

      let position = 0
      const postingItemIds: string[] = []
      for (const l of filled) {
        const qtyReceived = parseNum(l.qty)!
        const unitCost = parseNum(l.unitCost)
        // Tramo A — crea el NODO de formato si la línea trae equivalencia pero aún no
        // tiene id (formato nuevo/propuesto por la IA). Si ya tiene purchaseFormatId
        // (heredado del proveedor o del catálogo en otros modos), se reutiliza. Sin
        // equivalencia → sin formato → la línea no postea (anti-invención).
        let purchaseFormatId = l.purchaseFormatId
        if (l.recipeItemId && !purchaseFormatId && l.formatQtyInBase != null && l.formatQtyInBase > 0) {
          try {
            if (l.packCount != null && l.packCount > 0 && l.packInnerBase != null && l.packInnerBase > 0) {
              // Desglose del albarán → árbol: unidad interior contable + Caja con
              // total DERIVADO (count × interior), garantía en una sola función.
              const tree = await ensurePackTree({
                accountId,
                itemId: l.recipeItemId,
                count: l.packCount,
                innerQtyInBase: l.packInnerBase,
                innerName: (l.packInnerName ?? '').trim() || 'Ud',
                cajaName: (l.formatName ?? '').trim() || 'Caja',
                source: 'manual',
                createdBy: authUserId ?? null,
                createdByName: userProfile?.displayName ?? null,
              })
              purchaseFormatId = tree.caja.id
            } else {
              const fmt = await createPurchaseFormat({
                accountId,
                itemId: l.recipeItemId,
                name: (l.formatName ?? '').trim() || 'Formato',
                qtyInBase: l.formatQtyInBase,
                source: 'ai_suggested',
                aiConfidence: l.formatSuggested ? 0.8 : null,
                needsReview: false,
              })
              purchaseFormatId = fmt.id
            }
          } catch (e) {
            console.error('persist: no se pudo crear el formato de compra', e)
          }
        }
        const qtyInBase = qtyInBaseFromFormat(qtyReceived, l.formatQtyInBase)
        const unmapped = !l.recipeItemId || qtyInBase === null
        if (!unmapped && l.recipeItemId) postingItemIds.push(l.recipeItemId)
        await createGoodsReceiptLine({
          accountId,
          goodsReceiptId: receipt.id,
          purchaseOrderLineId: l.poLineId,
          recipeItemId: l.recipeItemId,
          productName: l.productName,
          rawText: l.rawText,
          supplierCode: l.supplierCode,
          qtyReceived,
          purchaseFormatId,
          qtyInBase,
          unitCost,
          lotCode: l.lotCode,          // hueco FEFO/APPCC
          expiryDate: l.expiryDate,
          docQty: l.albaranQty ?? null,        // lo que el albarán DICE (cantidad) — ancla del cuadre
          docAmount: l.lineAmount ?? null,     // lo que el albarán DICE (importe)
          discrepancyReason: discrepancyReasons[l.key] ?? null,  // motivo del descuadre (panel de repaso)
          mapSource: l.recipeItemId ? (l.matchType ?? 'manual') : 'unmapped',
          // ENCARGO CODE (12/08) R1' §2.2: un casado por nombre razonable
          // (matchSemaphore 'yellow') queda con artículo puesto —posteará a
          // stock igual, "casado automático... con la opción de modificarlo"—
          // pero SIN certeza determinista, así que pide revisión igual que
          // "nunca casado silencioso" exige.
          mapNeedsReview: unmapped || l.matchSemaphore === 'yellow',
          position: position++,
        })
      }

      if (!confirm) {
        onSaved(`Recepción ${receipt.code ?? ''} guardada como borrador.`)
        return
      }

      // Tramo A — flip de estrategia ANTES de confirmar: los artículos que estaban
      // en 'fixed' pasan a 'last_purchase' para que el precio recibido pise el coste
      // (los nuevos de OCR ya nacen 'last_purchase'). No es fatal si falla.
      if (postingItemIds.length > 0) {
        try { await ensureLastPurchaseStrategy(postingItemIds) }
        catch (e) { console.error('persist: no se pudo ajustar la estrategia de coste', e) }
      }

      const res = await confirmReceipt(receipt.id)

      // C2.2.b.3 — aprendizaje: graba la memoria por proveedor (no es fatal si falla).
      let learnNote = ''
      try {
        const learned = await learnFromReceipt(receipt.id)
        if (learned > 0) learnNote = ` · memoria del proveedor actualizada (${learned})`
      } catch (e) {
        console.error('persist: confirmada OK pero el aprendizaje falló', e)
      }

      // C2.2.b.4 — memoria de intermediario (emisor → comercial), si aplica.
      if (fromOcr) {
        try { await learnSupplierAlias(receipt.id) }
        catch (e) { console.error('persist: confirmada OK pero el alias de intermediario falló', e) }
      }

      // Anular y corregir: solo tras confirmar OK la corregida se anula la original.
      // En revisión de BORRADOR en sitio NO se anula nada (es la misma recepción).
      let voidNote = ''
      if (correcting && !reviewingDraft && prefill?.sourceReceiptId) {
        try { await voidReceipt(prefill.sourceReceiptId); voidNote = ' · anterior anulada' }
        catch (e) { console.error('persist: corregida OK pero no se pudo anular la original', e); voidNote = ' · OJO: anula la anterior a mano' }
      }

      const parts = [`${res.postedLines} línea(s) a stock`]
      if (res.skippedLines > 0) parts.push(`${res.skippedLines} sin postear (revisar)`)
      if (res.recalculatedItems > 0) parts.push(`coste actualizado en ${res.recalculatedItems} ingrediente(s)`)
      onSaved(`Recepción ${receipt.code ?? ''} confirmada: ${parts.join(' · ')}${learnNote}${voidNote}.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la recepción.')
      setSaving(false)
      setReviewing(false)
    }
  }

  const title = againstOrder
    ? `Recibir pedido ${order?.code ?? ''}${fromOcr ? ' · albarán escaneado' : ''}`
    : reviewingDraft ? `Revisar recepción ${prefill?.code ?? ''}` : correcting ? 'Corregir recepción' : fromOcr ? 'Revisar recepción escaneada' : 'Nueva recepción'
  const subtitle = againstOrder
    ? 'Cuenta lo que ha llegado y escríbelo. Lo pedido y lo pendiente están a la derecha como referencia.'
    : reviewingDraft
      ? 'Esto contó quien recibió. Revisa la foto del albarán y las líneas; ajusta lo que falte y confirma — entra a stock con su coste.'
      : correcting
      ? 'Corrige lo que falló y confirma. La recepción anterior se anulará solo al confirmar esta.'
      : fromOcr
        ? 'Esto leyó la IA del albarán. Revisa proveedor, local, cantidades y el formato de cada línea; al confirmar, entra a stock con su coste.'
        : 'Cuenta lo que ha llegado y escríbelo. Al confirmar, entra a stock.'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} disabled={saving}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base disabled:opacity-50">
          <ArrowLeft size={16} />
          {againstOrder ? 'Pedido' : 'Recepciones'}
        </button>
      </div>

      <div>
        <h2 className="text-xl font-display font-medium text-text-primary">{title}</h2>
        <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>
      </div>

      {!fixedHeader && <OperativeLocationBanner op={op} locations={locations} />}

      {/* Foto del albarán al revisar un borrador (la oficina ve lo que firmó el muelle). */}
      {reviewingDraft && prefill?.rawDocumentUrl && (
        <div className="rounded-lg border border-border-default bg-card p-3">
          <p className="text-xs text-text-secondary mb-2">Albarán recibido</p>
          <ReceiptPhotoViewer path={prefill.rawDocumentUrl} />
        </div>
      )}

      {/* Datos de la recepción */}
      <div className="rounded-lg border border-border-default bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Local (entrada)</label>
          <p className="px-2 py-1.5 text-sm text-text-primary">{locationName}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Proveedor</label>
          {fixedHeader ? (
            <p className="px-2 py-1.5 text-sm text-text-primary">{supplierName}</p>
          ) : (
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} disabled={loadingMeta || saving}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50">
              <option value="">— Elige proveedor —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Fecha de recepción</label>
          <input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} disabled={saving}
            className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Nº de albarán (proveedor)</label>
          <input type="text" value={supplierDoc} onChange={e => setSupplierDoc(e.target.value)} disabled={saving} placeholder="Opcional"
            className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
        </div>
      </div>

      {/* ENCARGO CODE (12/08) — Corrección B: pedido YA enlazado (borrador que
          venía con purchase_order_id, típicamente al confirmar en oficina).
          Se muestra tal cual, con "Cambiar" opt-in — no se rebusca ni se pisa
          solo. Al pulsar "Cambiar", existingLinkOverridden pasa a true y el
          bloque de abajo (candidatos) toma el relevo como si no hubiera
          enlace previo. */}
      {!order && prefill?.purchaseOrderId && !existingLinkOverridden && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-md bg-accent-bg/50 border border-accent/20 text-xs text-text-secondary">
          <Truck size={13} className="text-accent shrink-0" />
          <span>
            Enlazada a <strong className="text-text-primary">{existingLinkedOrder?.code ?? 'un pedido'}</strong>
            {existingLinkedOrder?.expectedDate ? ` del ${formatShortDate(existingLinkedOrder.expectedDate)}` : ''}.
          </span>
          <button type="button" onClick={() => setExistingLinkOverridden(true)} disabled={saving}
            className="ml-auto text-accent underline hover:opacity-80 disabled:opacity-50 shrink-0">
            Cambiar
          </button>
        </div>
      )}

      {/* "¿De qué pedido viene?" — modo ciego (sin pedido enlazado, o con el
          enlace existente descartado con "Cambiar"), con proveedor+local ya
          resueltos. PRINCIPIO RECTOR del muelle: en OCR el trabajador NUNCA
          elige a mano el caso normal. Tres presentaciones según orderMatchMode:
            - 'auto' (1 candidato o score dominante): línea discreta + "Cambiar".
            - 'ambiguous' (2-3 candidatos, sin ganador claro): tarjetas grandes,
              UNA pregunta ("¿Es este?").
            - 'none' (sin candidatos): nada — recepción suelta, no se pregunta.
          orderMatchOverridden (clic en "Cambiar", o respuesta a la pregunta)
          pasa al MISMO picker de botones de siempre — el de "Contar a mano"
          no cambia de lógica, solo de cuándo se muestra. */}
      {!order && !(prefill?.purchaseOrderId && !existingLinkOverridden) && supplierId && locationId && (fromOcr ? (
        <>
          {loadingOrders && (
            <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
              <Loader2 size={12} className="animate-spin" /> Buscando el pedido…
            </div>
          )}

          {!loadingOrders && !orderMatchOverridden && orderMatchMode === 'auto' && pickedOrderId && (() => {
            const o = candidateOrders.find(c => c.id === pickedOrderId)
            if (!o) return null
            return (
              <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-md bg-accent-bg/50 border border-accent/20 text-xs text-text-secondary">
                <Truck size={13} className="text-accent shrink-0" />
                <span>
                  Pedido <strong className="text-text-primary">{o.code ?? 'sin código'}</strong>
                  {o.expectedDate ? ` del ${formatShortDate(o.expectedDate)}` : ''} — enlazado solo.
                </span>
                <button type="button" onClick={() => setOrderMatchOverridden(true)} disabled={saving}
                  className="ml-auto text-accent underline hover:opacity-80 disabled:opacity-50 shrink-0">
                  Cambiar
                </button>
              </div>
            )
          })()}

          {!loadingOrders && !orderMatchOverridden && orderMatchMode === 'ambiguous' && (
            <div className="rounded-lg border border-accent/30 bg-accent-bg/30 p-4 space-y-2.5">
              <p className="text-sm font-medium text-text-primary">¿Es este el pedido?</p>
              <div className="grid gap-2">
                {candidateOrders.slice(0, 3).map(o => {
                  const overdueDays = candidateOverdue.get(o.id) ?? 0
                  const nLines = candidateLineCounts.get(o.id) ?? 0
                  return (
                    <button key={o.id} type="button" disabled={saving}
                      onClick={() => { setPickedOrderId(o.id); setOrderMatchOverridden(true) }}
                      className="text-left p-3 rounded-lg border-2 border-border-default bg-card hover:border-accent transition-base disabled:opacity-50">
                      <div className="font-medium text-text-primary">{o.code ?? 'Pedido'}</div>
                      <div className="text-xs text-text-secondary mt-0.5">
                        {nLines} línea{nLines === 1 ? '' : 's'}
                        {o.expectedDate ? ` · esperado ${formatShortDate(o.expectedDate)}` : ''}
                        {overdueDays > 0 ? ` · ${overdueDays} día${overdueDays === 1 ? '' : 's'} de retraso` : ''}
                      </div>
                    </button>
                  )
                })}
                <button type="button" disabled={saving}
                  onClick={() => { setPickedOrderId(null); setOrderMatchOverridden(true) }}
                  className="text-left p-3 rounded-lg border-2 border-dashed border-border-default text-text-secondary hover:border-accent hover:text-text-primary transition-base disabled:opacity-50">
                  Ninguno — es compra directa
                </button>
              </div>
            </div>
          )}

          {orderMatchOverridden && (
            <FullOrderPicker
              candidateOrders={candidateOrders} candidateOverdue={candidateOverdue}
              candidateLineCounts={candidateLineCounts} pickedOrderId={pickedOrderId}
              loadingOrders={loadingOrders} saving={saving} onPick={setPickedOrderId}
            />
          )}
        </>
      ) : (
        <FullOrderPicker
          candidateOrders={candidateOrders} candidateOverdue={candidateOverdue}
          candidateLineCounts={candidateLineCounts} pickedOrderId={pickedOrderId}
          loadingOrders={loadingOrders} saving={saving} onPick={setPickedOrderId}
        />
      ))}

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {fromOcr && (ocrPrefill?.unmatchedSupplier || ocrPrefill?.unmatchedLocation) && (
        <div className="p-3 rounded-md bg-warning-bg text-warning border border-warning/20 text-sm">
          {ocrPrefill?.unmatchedSupplier && !supplierId && (
            <div>
              <p>No he reconocido el proveedor del albarán. Elígelo arriba o créalo:</p>
              {!supCreate ? (
                <button type="button" onClick={() => setSupCreate(true)} disabled={saving}
                  className="mt-1.5 text-accent hover:underline disabled:opacity-50">Crear proveedor</button>
              ) : (
                <div className="mt-2 flex items-end gap-2 flex-wrap text-text-primary">
                  <label className="flex flex-col text-[11px] text-text-secondary">
                    Nombre
                    <input type="text" value={supName} onChange={e => setSupName(e.target.value)} disabled={supSaving}
                      className="mt-0.5 w-56 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                  </label>
                  <label className="flex flex-col text-[11px] text-text-secondary">
                    CIF/NIF
                    <input type="text" value={supNif} onChange={e => setSupNif(e.target.value)} disabled={supSaving}
                      className="mt-0.5 w-40 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                  </label>
                  <label className="flex flex-col text-[11px] text-text-secondary">
                    Teléfono
                    <input type="text" value={supPhone} onChange={e => setSupPhone(e.target.value)} disabled={supSaving}
                      className="mt-0.5 w-36 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                  </label>
                  <label className="flex flex-col text-[11px] text-text-secondary">
                    Email
                    <input type="text" value={supEmail} onChange={e => setSupEmail(e.target.value)} disabled={supSaving}
                      className="mt-0.5 w-52 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                  </label>
                  <label className="flex flex-col text-[11px] text-text-secondary flex-1 min-w-[220px]">
                    Dirección
                    <input type="text" value={supAddress} onChange={e => setSupAddress(e.target.value)} disabled={supSaving}
                      className="mt-0.5 w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                  </label>
                  <label className="flex flex-col text-[11px] text-text-secondary">
                    Reg. sanitario
                    <input type="text" value={supHealth} onChange={e => setSupHealth(e.target.value)} disabled={supSaving}
                      className="mt-0.5 w-40 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                  </label>
                  <button type="button" onClick={createSupplierInline} disabled={supSaving}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
                    {supSaving ? 'Creando…' : 'Crear'}
                  </button>
                  <button type="button" onClick={() => setSupCreate(false)} disabled={supSaving}
                    className="px-2 py-1.5 rounded-md text-sm border border-border-default bg-card hover:bg-page disabled:opacity-50">Cancelar</button>
                </div>
              )}
            </div>
          )}
          {ocrPrefill?.unmatchedLocation && <p className={ocrPrefill?.unmatchedSupplier ? 'mt-1' : ''}>No he reconocido el local de entrega. Elígelo arriba.</p>}
          {ocrPrefill?.deliveredBy && <p className="text-text-secondary mt-0.5">Entregado por: {ocrPrefill.deliveredBy}.</p>}
        </div>
      )}

      {!supplierId && !loadingMeta && (
        <div className="p-8 rounded-lg border border-dashed border-border-default text-center">
          <p className="text-sm text-text-secondary">Elige un proveedor para ver su catálogo.</p>
        </div>
      )}

      {supplierId && (
        <>
          {loadingLines && <p className="text-sm text-text-secondary">Cargando líneas…</p>}

          {!loadingLines && draft.length === 0 && (
            <div className="p-6 rounded-lg border border-dashed border-border-default text-center">
              <p className="text-sm text-text-secondary">
                {againstOrder ? 'Este pedido no tiene líneas.' : correcting ? 'La recepción a corregir no tenía líneas.' : 'Este proveedor aún no tiene artículos en su catálogo.'}
              </p>
            </div>
          )}

          {!loadingLines && draft.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative max-w-sm flex-1 min-w-[200px]">
                  <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar artículo"
                    className="w-full pl-8 pr-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                </div>
                {hasReference && (
                  <button type="button" onClick={fillWithPending} disabled={saving}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm border border-border-default bg-card text-text-secondary hover:bg-page hover:text-text-primary disabled:opacity-50 transition-base"
                    title="Rellena 'Recibido' con lo pendiente. Revísalo: solo si ha llegado todo lo que faltaba.">
                    <ListChecks size={15} />
                    Rellenar con lo pendiente
                  </button>
                )}
              </div>

              {/* ESPEJO DEL ALBARÁN: tarjetas a la izquierda, foto del albarán al lado (disposición A) */}
              <div className={fromOcr && ocrPrefill?.rawDocumentUrl ? 'grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-4 items-start' : ''}>
                <div className="space-y-2 order-1 lg:order-2 min-w-0">
                  {visible.map(l => {
                    const qtyN = parseNum(l.qty)
                    const hasQty = qtyN !== null && qtyN > 0
                    const costN = parseNum(l.unitCost)
                    const willEnter = hasQty && l.recipeItemId && qtyInBaseFromFormat(qtyN!, l.formatQtyInBase) !== null
                    const complete = l.pending !== null && l.pending === 0
                    let cmp: { label: string; cls: string } | null = null
                    if (l.pending !== null && hasQty) {
                      if (qtyN! > l.pending) cmp = { label: 'De más', cls: 'bg-accent-bg text-accent border-accent/20' }
                      else if (l.pending > 0 && qtyN! < l.pending) cmp = { label: 'Parcial', cls: 'bg-warning-bg text-warning border-warning/20' }
                      else cmp = { label: 'OK', cls: 'bg-success-bg text-success border-success/20' }
                    }
                    // Sin cantidad contada (0/vacía) NO hay recepción que comparar: la
                    // puntual y el pactado callan (su €/base entrante se calcula desde la
                    // cantidad → 0/sin sentido). La deriva NO depende del entrante, sí puede salir.
                    const priceAlert = l.recipeItemId && hasQty
                      ? priceAlertFor({
                          lineAmount: l.lineAmount ?? null,
                          unitCost: parseNum(l.unitCost),
                          qtyReceived: qtyN,
                          formatQtyInBase: l.formatQtyInBase,
                          expectedPerBase: l.purchaseFormatId ? (formatPrices[l.purchaseFormatId] ?? null) : null,
                          thresholdPct: supplySettings.priceAlertPct,
                        })
                      : null
                    // Aviso de PACTADO: independiente del puntual. Compara el €/base
                    // entrante con negotiated_price del proveedor. Sin pacto → no salta.
                    const negotiatedAlert = l.recipeItemId && hasQty
                      ? negotiatedAlertFor({
                          newPrice: lineActualPerBase({
                            lineAmount: l.lineAmount ?? null,
                            unitCost: parseNum(l.unitCost),
                            qtyReceived: qtyN,
                            formatQtyInBase: l.formatQtyInBase,
                          }),
                          negotiatedPrice: priceRefs[l.recipeItemId]?.negotiatedPrice ?? null,
                          thresholdPct: supplySettings.negotiatedAlertPct,
                        })
                      : null
                    // Aviso de DERIVA: tendencia sostenida sobre la mediana del periodo.
                    // minReceptions=3: con <3 compras la mediana no es fiable (no es deriva).
                    const drift = l.recipeItemId ? (driftByItem[l.recipeItemId] ?? null) : null
                    const driftAlert = drift
                      ? driftAlertFor({
                          pctVsMedian: drift.pctVsMedian,
                          nRecepciones: drift.nRecepciones,
                          medianEurBase: drift.medianEurBase,
                          thresholdPct: supplySettings.driftAlertPct,
                          minReceptions: 3,
                        })
                      : null
                    const expiryAlert = expiryAlertFor(l.expiryDate, supplySettings.expiryAlertDays)

                    // ── Cuadre con el ALBARÁN (rojo prominente) ──
                    // Eje € (limpio): € recibido (cantidad × precio) vs importe del albarán.
                    let amountDelta: number | null = null
                    if (hasQty && costN !== null && l.lineAmount != null && l.lineAmount > 0) {
                      const rec = qtyN! * costN
                      if (Math.abs(rec - l.lineAmount) > 0.01 && Math.abs(rec - l.lineAmount) / l.lineAmount > 0.005) amountDelta = rec - l.lineAmount
                    }
                    // Eje cantidad: SOLO cuando la unidad del albarán reconcilia con la base
                    // (cero falsos positivos). Compara en unidad base.
                    const normU = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
                    const bAbbr = normU(l.baseUnit?.abbr)
                    const aU = normU(l.albaranUnit)
                    const sameAsBase = !!l.albaranUnit && (
                      aU === bAbbr ||
                      (bAbbr === 'g'  && ['g','gr','gramo','gramos'].includes(aU)) ||
                      (bAbbr === 'ml' && ['ml','mililitro','mililitros'].includes(aU)) ||
                      (bAbbr === 'ud' && ['ud','uds','u','unidad','unidades'].includes(aU))
                    )
                    const recInBase = hasQty ? qtyInBaseFromFormat(qtyN!, l.formatQtyInBase) : null
                    let qtyDeltaBase: number | null = null
                    if (sameAsBase && recInBase !== null && l.albaranQty != null && l.albaranQty > 0) {
                      if (Math.abs(recInBase - l.albaranQty) / l.albaranQty > 0.005) qtyDeltaBase = recInBase - l.albaranQty
                    }
                    const albaranDiff = amountDelta !== null || qtyDeltaBase !== null

                    // "Ajustar como el albarán": leemos los números del TEXTO del albarán
                    // ("CAJA 3 UD DE 1 KG" → 3 × 1 kg), determinista. Si no encaja → no prefijamos.
                    const fu = friendlyUnit(l.baseUnit?.abbr)
                    const albaranPack = needsResolution ? parsePack(l.rawText, l.baseUnit?.abbr) : null
                    const albaranPackTotalBase = albaranPack ? albaranPack.n * albaranPack.m * fu.factor : null
                    const formatMismatchAlbaran = albaranPackTotalBase != null && albaranPackTotalBase > 0 && l.formatQtyInBase != null && Math.abs(l.formatQtyInBase - albaranPackTotalBase) / albaranPackTotalBase > 0.02

                    return (
                      <div key={l.key}
                        className={`rounded-lg border p-3 ${albaranDiff ? 'border-danger bg-danger-bg' : 'border-border-default bg-card'} ${complete && !hasQty ? 'opacity-60' : ''}`}>
                        {/* Fila 1: artículo + estado/avisos */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {!needsResolution && (
                              <span className="text-base font-medium text-text-primary">{l.productName}</span>
                            )}

                            {/* Lo que dice el albarán, agrupado (cantidad/importe arriba, detalle en gris) */}
                            {needsResolution && (l.rawText || l.albaranQty != null || l.lineAmount != null) && (
                              <div className="mt-1.5 rounded-md bg-page px-2.5 py-1.5">
                                <div className="text-[10px] text-text-tertiary">El albarán dice</div>
                                {(l.albaranQty != null || l.lineAmount != null) && (
                                  <div className="text-sm text-text-primary">
                                    {l.albaranQty != null ? `${l.albaranQty}${l.albaranUnit ? ' ' + l.albaranUnit : ''}` : '—'}
                                    {l.lineAmount != null ? ` · ${l.lineAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : ''}
                                  </div>
                                )}
                                {l.rawText && (
                                  <div className="text-[11px] text-text-tertiary mt-0.5">{l.rawText}{l.supplierCode ? ` · cód. ${l.supplierCode}` : ''}</div>
                                )}
                                {(l.lotCode || l.expiryDate) && (
                                  <div className="text-[11px] text-text-tertiary mt-0.5">
                                    {l.lotCode ? `lote ${l.lotCode}` : ''}{l.lotCode && l.expiryDate ? ' · ' : ''}{l.expiryDate ? `caduca ${l.expiryDate}` : ''}
                                  </div>
                                )}
                                {hasReference && (
                                  <div className="text-[11px] text-text-tertiary mt-0.5">
                                    pedido {l.qtyOrdered ?? '—'} · recibido {l.alreadyReceived ?? '—'} · pendiente {l.pending ?? '—'}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* Contra pedido / catálogo ciego: lote/caduca y referencia de pedido sueltos */}
                            {!needsResolution && (l.lotCode || l.expiryDate) && (
                              <div className="text-[11px] text-text-tertiary mt-1">
                                {l.lotCode ? `lote ${l.lotCode}` : ''}{l.lotCode && l.expiryDate ? ' · ' : ''}{l.expiryDate ? `caduca ${l.expiryDate}` : ''}
                              </div>
                            )}
                            {!needsResolution && hasReference && (
                              <div className="text-[11px] text-text-tertiary mt-0.5">
                                pedido {l.qtyOrdered ?? '—'} · recibido {l.alreadyReceived ?? '—'} · pendiente {l.pending ?? '—'}
                              </div>
                            )}
                          </div>

                          <div className="shrink-0 text-right">
                            {complete && !hasQty ? (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-success-bg text-success border border-success/20">✓ completa</span>
                            ) : !hasQty ? (
                              <span className="text-xs text-text-tertiary">—</span>
                            ) : (
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                {cmp && <span className={`text-[10px] px-1 py-0.5 rounded border ${cmp.cls}`}>{cmp.label}</span>}
                                {willEnter ? (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-success-bg text-success border border-success/20">a stock</span>
                                ) : (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-warning-bg text-warning border border-warning/20">sin mapear</span>
                                )}
                                {/* Los avisos de PRECIO (puntual + pactado + deriva) ya no van aquí:
                                    se muestran legibles junto al campo de precio (Fila 3). */}
                                {(priceAlert || negotiatedAlert || driftAlert) && (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-warning-bg text-warning border border-warning/20" title="Hay un aviso de precio en esta línea (abajo, junto al precio)">
                                    ⚠ precio
                                  </span>
                                )}
                                {expiryAlert && (
                                  <span className={`text-[10px] px-1 py-0.5 rounded border ${expiryAlert.kind === 'expired' ? 'bg-danger-bg text-danger border-danger/20' : 'bg-warning-bg text-warning border-warning/20'}`}>
                                    {expiryAlert.kind === 'expired' ? 'caducado' : `caduca en ${expiryAlert.days}d`}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Fila 1.5: artículo — mismo patrón que Fila 2 (formato): estado
                            SIEMPRE visible + botón grande de ancho completo, mismo sitio y
                            mismo gesto tanto si el casado automático ya resolvió la línea
                            como si no. ENCARGO CODE (12/08) R1' feat/recepcion-casado-
                            automatico. Reutiliza LineMatchPicker tal cual — ya trae
                            propuestas + buscador + "Crear artículo nuevo"; no se duplica.
                            needsResolution (no fromOcr): contra pedido o catálogo ciego el
                            artículo ya viene fijado y esta fila no aporta nada; en escaneo
                            en vivo O revisando un borrador (fix/recepcion-fromocr-borrador)
                            sí puede faltar casado, se muestre como se muestre la línea. */}
                        {needsResolution && (
                          <div className="mt-2">
                            {l.recipeItemId ? (
                              <div className="rounded-md border border-border-default bg-page px-3 py-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${l.matchSemaphore === 'green' ? 'bg-success' : 'bg-warning'}`} />
                                  <span className="text-sm font-medium text-text-primary">{l.matchedName}</span>
                                  {l.matchType && <span className="text-[11px] text-text-secondary">({matchTypeLabel(l.matchType)})</span>}
                                </div>
                              </div>
                            ) : l.suggestedRecipeItemId && l.suggestedName ? (
                              // R1' §2.2 — propuesta por nombre razonable: pide un toque
                              // explícito, nunca se aplica sola (ver el efecto que la rellena).
                              <div className="rounded-md border border-accent/30 bg-accent-bg/40 px-3 py-2">
                                <p className="text-sm text-text-primary">¿Es esto <span className="font-medium">{l.suggestedName}</span>?</p>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <button type="button" disabled={saving} onClick={() => acceptSuggestion(l)}
                                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
                                    Sí, es este
                                  </button>
                                  <button type="button" disabled={saving} onClick={() => dismissSuggestion(l.key)}
                                    className="px-3 py-1.5 rounded-md text-sm border border-border-default bg-card text-text-secondary hover:bg-page disabled:opacity-50">
                                    No, buscar otro
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-md border border-warning/40 bg-warning-bg/60 px-3 py-2 flex items-center gap-1.5 text-warning">
                                <AlertTriangle size={14} className="shrink-0" />
                                <span className="text-sm font-medium">Sin reconocer: esta línea no entrará a stock hasta que la cases.</span>
                              </div>
                            )}
                            {/* Con propuesta pendiente, "No, buscar otro" ya abre el picker —
                                un solo botón de más sería el mismo gesto dos veces. */}
                            {!(l.suggestedRecipeItemId && l.suggestedName) && (
                              <button type="button" onClick={() => setPickerKey(l.key)} disabled={saving}
                                className={l.recipeItemId
                                  ? 'mt-1.5 w-full py-3 rounded-md text-sm font-medium border border-border-default bg-card text-text-primary hover:bg-page transition-base disabled:opacity-50'
                                  : 'mt-1.5 w-full py-3 rounded-md text-sm font-semibold border-2 border-warning bg-warning-bg text-warning hover:bg-warning/10 transition-base disabled:opacity-50'}>
                                {l.recipeItemId ? 'Cambiar artículo' : 'Casar artículo'}
                                {lineMatch[l.key]?.loading ? ' · buscando…' : ''}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Fila 2: formato — SIEMPRE visible, nunca un enlace mudo.
                            ENCARGO CODE (12/08) fix/recepcion-selector-formato: sustituye
                            el <select> diminuto + el link "elige formato ↑" por un estado
                            legible (nombre, equivalencia, coste/ud resultante) + un botón
                            grande que abre <FormatPicker/> (hoja con tarjetas + "crear
                            formato nuevo", que reutiliza el wizard T1). "Sin formato" ya
                            no es un gris mudo: es un aviso que no se puede pasar por alto,
                            con una única salida deliberada (marcar "no inventariar").
                            needsResolution, no fromOcr — mismo motivo que Fila 1.5. */}
                        <div className="mt-2">
                          {!needsResolution ? (
                            <p className="text-[11px] text-text-secondary">formato: {l.formatLabel ?? '—'}</p>
                          ) : !l.recipeItemId ? (
                            <span className="text-[11px] text-text-tertiary">casa el artículo primero</span>
                          ) : (() => {
                            const hasFormat = l.formatQtyInBase != null && l.formatQtyInBase > 0
                            const container = (l.formatName ?? 'Formato').trim() || 'Formato'
                            const preferredFormatId = catalogByItem.get(l.recipeItemId!)?.purchaseFormatId ?? null
                            const isHabitual = hasFormat && preferredFormatId != null && l.purchaseFormatId === preferredFormatId
                            const unitCostNum = parseNum(l.unitCost)
                            const baseKU = l.baseUnit ? (units.find(u => u.id === l.baseUnit!.id) ?? null) : null
                            const perBase = hasFormat && unitCostNum != null ? unitCostNum / l.formatQtyInBase! : null
                            const human = perBase != null ? perBaseToHuman(perBase, baseKU, units, l.baseUnit?.abbr ?? '') : null
                            const equivalence = hasFormat && l.baseUnit ? formatBaseQty(l.formatQtyInBase!, l.baseUnit.abbr) : null
                            const hasPack = l.packCount != null && l.packCount > 1 && l.packInnerBase != null && !!l.baseUnit
                            return (
                            <div className="space-y-1.5">
                              {hasFormat ? (
                                <div className="rounded-md border border-border-default bg-page px-3 py-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <Box size={14} className="text-text-tertiary shrink-0" />
                                    <span className="text-sm font-medium text-text-primary">{container}</span>
                                    {equivalence && <span className="text-sm text-text-secondary">· {equivalence}</span>}
                                    {isHabitual && <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-bg text-accent border border-accent/20">el habitual</span>}
                                  </div>
                                  {hasPack && (
                                    <p className="text-[11px] text-text-tertiary mt-0.5">
                                      {l.packCount} × {formatBaseQty(l.packInnerBase!, l.baseUnit!.abbr)} · se cuenta por {l.packInnerName ?? 'Ud'}
                                    </p>
                                  )}
                                  {unitCostNum != null && (
                                    <p className="text-xs text-text-secondary mt-0.5">
                                      {fmtHumanPrice(unitCostNum)} €{human && <> → <span className="font-medium text-text-primary">{fmtHumanPrice(human.value)} €/{human.abbr}</span></>}
                                    </p>
                                  )}
                                  {l.formatSuggested && (
                                    <p className="text-[11px] text-accent mt-1">Propuesto — confírmalo antes de guardar.</p>
                                  )}
                                  {formatMismatchAlbaran && albaranPack && (
                                    <p className="text-[11px] text-danger mt-1">El albarán dice {albaranPack.n} × {albaranPack.m} {fu.label} — revisa el formato.</p>
                                  )}
                                </div>
                              ) : l.skipStock ? (
                                <div className="rounded-md border border-border-default bg-page px-3 py-2">
                                  <p className="text-sm text-text-secondary">Sin formato — excluida a propósito, no entra a stock.</p>
                                </div>
                              ) : (
                                <div className="rounded-md border border-warning/40 bg-warning-bg/60 px-3 py-2 flex items-center gap-1.5 text-warning">
                                  <AlertTriangle size={14} className="shrink-0" />
                                  <span className="text-sm font-medium">Sin formato: esta línea no entrará a stock.</span>
                                </div>
                              )}

                              <button type="button" disabled={saving} onClick={() => openFormatSheet(l)}
                                className={hasFormat
                                  ? 'w-full py-3 rounded-md text-sm font-medium border border-border-default bg-card text-text-primary hover:bg-page transition-base disabled:opacity-50'
                                  : 'w-full py-3 rounded-md text-sm font-semibold border-2 border-warning bg-warning-bg text-warning hover:bg-warning/10 transition-base disabled:opacity-50'}>
                                {hasFormat ? 'Cambiar formato' : 'Elegir formato'}
                              </button>

                              {!hasFormat && hasQty && (
                                <label className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                                  <input type="checkbox" checked={!!l.skipStock} disabled={saving} onChange={() => toggleSkipStock(l.key)}
                                    className="rounded border-border-default" />
                                  No inventariar esta línea
                                </label>
                              )}
                            </div>
                            )
                          })()}
                        </div>

                        {/* Fila 3: recibido (a ciegas) + € / formato */}
                        <div className="mt-2.5 flex items-end gap-4 flex-wrap">
                          <div>
                            <label className="block text-[11px] text-text-secondary mb-1">Recibido <span className="text-text-tertiary">(cuéntalo)</span></label>
                            <div className="flex items-center gap-1.5">
                              <input type="text" inputMode="decimal" value={l.qty} onChange={e => setQty(l.key, e.target.value)} disabled={saving} placeholder="0"
                                className={`w-20 px-2 py-1.5 text-lg text-center font-medium rounded-md border bg-page text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 ${hasQty ? 'border-accent/50' : 'border-accent/30 bg-accent-bg/30'}`} />
                              {(l.formatLabel ?? l.formatName) && (
                                <span className="text-xs text-text-tertiary">{(l.formatLabel ?? l.formatName)!.toLowerCase()}</span>
                              )}
                            </div>
                            {(() => {
                              const qn = parseNum(l.qty)
                              if (qn === null || qn <= 0) return null
                              const unidad = l.formatLabel ?? l.formatName ?? null
                              // El aviso "sin formato" ya vive en la Fila 2, grande y con
                              // botón — no lo dupliques aquí (ENCARGO CODE 12/08, §3.1).
                              if (!unidad) return null
                              const enAlmacen = qtyInBaseFromFormat(qn, l.formatQtyInBase)
                              return (
                                <div className="mt-1 leading-tight">
                                  {enAlmacen !== null && l.baseUnit ? (
                                    <p className="inline-flex items-center gap-1 text-xs text-text-secondary"><ArrowRight size={13} className="shrink-0" /> {formatBaseQty(enAlmacen, l.baseUnit.abbr)} al almacén</p>
                                  ) : null}
                                  {l.convertedNote && <p className="text-[10px] text-text-tertiary mt-0.5">{l.convertedNote}</p>}
                                </div>
                              )
                            })()}
                          </div>
                          <div>
                            <label className="block text-[11px] text-text-secondary mb-1">€ / {((l.formatName ?? '').trim() || 'formato').toLowerCase()}</label>
                            <input type="text" inputMode="decimal" value={l.unitCost} onChange={e => setCost(l.key, e.target.value)} disabled={saving} placeholder="—"
                              className="w-24 px-2 py-1.5 text-sm text-right border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                          </div>
                        </div>

                        {/* Avisos de PRECIO legibles, junto al precio (donde está el ojo al teclear).
                            En unidad humana (€/kg, €/L, €/ud), no en €/base crudo. */}
                        {(priceAlert || negotiatedAlert || driftAlert) && (() => {
                          const baseKU = l.baseUnit ? (units.find(u => u.id === l.baseUnit!.id) ?? null) : null
                          const fb = l.baseUnit?.abbr ?? ''
                          return (
                            <div className="mt-2.5 space-y-1.5">
                              {priceAlert && (() => {
                                const before = perBaseToHuman(priceAlert.lastPrice, baseKU, units, fb)
                                const now = perBaseToHuman(priceAlert.newPrice, baseKU, units, fb)
                                const subio = priceAlert.direction === 'up'
                                return (
                                  <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                    <span>
                                      <span className="font-medium">{subio ? 'Subió' : 'Bajó'} un {Math.abs(priceAlert.pct)}%</span> respecto a la última compra
                                      {' '}(antes {fmtHumanPrice(before.value)} €/{before.abbr}, ahora {fmtHumanPrice(now.value)} €/{now.abbr}).
                                    </span>
                                  </div>
                                )
                              })()}
                              {negotiatedAlert && (() => {
                                const pact = perBaseToHuman(negotiatedAlert.negotiatedPrice, baseKU, units, fb)
                                const now = perBaseToHuman(negotiatedAlert.newPrice, baseKU, units, fb)
                                return (
                                  <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-bg px-3 py-2 text-sm text-accent">
                                    <span className="shrink-0 leading-none text-base">🤝</span>
                                    <span>
                                      <span className="font-medium">Por encima de lo pactado</span>: pactaste {fmtHumanPrice(pact.value)} €/{pact.abbr}, te cobran {fmtHumanPrice(now.value)} €/{now.abbr} <span className="font-medium">(+{negotiatedAlert.pct}%)</span>.
                                    </span>
                                  </div>
                                )
                              })()}
                              {driftAlert && (() => {
                                const med = driftAlert.median != null ? perBaseToHuman(driftAlert.median, baseKU, units, fb) : null
                                return (
                                  <div className="flex items-start gap-2 rounded-md border border-terracota/30 bg-terracota/10 px-3 py-2 text-sm text-terracota">
                                    <span className="shrink-0 leading-none text-base">📈</span>
                                    <span>
                                      <span className="font-medium">Tendencia al alza</span>: este artículo lleva <span className="font-medium">+{driftAlert.pct}%</span> sobre la mediana{med ? ` (${fmtHumanPrice(med.value)} €/${med.abbr})` : ''} de tus últimas {driftAlert.nRecepciones} compras ({supplySettings.driftWindowMonths} meses).
                                    </span>
                                  </div>
                                )
                              })()}
                            </div>
                          )
                        })()}

                        {/* Fila 4: no cuadra con el albarán (rojo prominente) */}
                        {albaranDiff && (
                          <div className="mt-2.5 rounded-md bg-danger-bg px-2.5 py-2">
                            <div className="flex items-center gap-1.5 text-[13px] font-medium text-danger">
                              <AlertTriangle size={15} className="shrink-0" />
                              No cuadra con el albarán
                            </div>
                            {amountDelta !== null && l.lineAmount != null && (
                              <div className="text-[12px] text-danger mt-1">
                                cuentas {(qtyN! * costN!).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € · el albarán dice {l.lineAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                              </div>
                            )}
                            {qtyDeltaBase !== null && recInBase !== null && l.albaranQty != null && l.baseUnit && (
                              <div className="text-[12px] text-danger mt-1">
                                cuentas {formatBaseQty(recInBase, l.baseUnit.abbr)} · el albarán dice {formatBaseQty(l.albaranQty, l.baseUnit.abbr)}
                              </div>
                            )}
                            <div className="text-[11px] text-text-secondary mt-1">Revisa la cantidad o el formato. Al confirmar te pediré el motivo.</div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {fromOcr && ocrPrefill?.rawDocumentUrl && (
                  <div className="order-2 lg:order-1 lg:sticky lg:top-4">
                    <ReceiptPhotoViewer path={ocrPrefill.rawDocumentUrl} />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm text-text-secondary">
                  {filled.length} con cantidad · {willPost} entrarán a stock
                  {filled.length - willPost > 0 && ` · ${filled.length - willPost} sin mapear`}
                  {/* ENCARGO CODE (12/08) — Corrección C: visible, no un spinner
                      mudo. Mismo texto que explica por qué los botones de abajo
                      están deshabilitados mientras se busca el pedido. */}
                  {loadingOrders && (
                    <span className="inline-flex items-center gap-1 ml-2 text-text-tertiary">
                      <Loader2 size={12} className="animate-spin" /> Buscando pedidos…
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => persist(false)} disabled={saving || filled.length === 0 || loadingOrders}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={15} />}
                    {canConfirm ? 'Guardar borrador' : 'Guardar (la oficina confirma)'}
                  </button>
                  {canConfirm && (
                    <button type="button" onClick={startReview} disabled={saving || filled.length === 0 || loadingOrders}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">
                      <Check size={15} />
                      Revisar y confirmar
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Resumen pre-confirmación (siempre) */}
      {reviewing && (
        <ReviewPanel
          summary={summary}
          saving={saving}
          onCancel={() => { if (!saving) setReviewing(false) }}
          onConfirm={() => persist(true)}
          reasons={discrepancyReasons}
          onReason={(key, reason) => setDiscrepancyReasons(r => ({ ...r, [key]: reason }))}
        />
      )}

      {pickerKey && (() => {
        const line = draft.find(x => x.key === pickerKey)
        if (!line) return null
        return (
          <LineMatchPicker
            accountId={accountId}
            rawText={line.rawText ?? line.productName}
            supplierCode={line.supplierCode}
            candidates={lineMatch[pickerKey]?.candidates ?? []}
            currentRecipeItemId={line.recipeItemId}
            createdBy={authUserId ?? null}
            createdByName={userProfile?.displayName ?? null}
            onChoose={(itemId, name, semaphore, matchType) => chooseMatch(pickerKey, itemId, name, semaphore, matchType)}
            onClear={() => { clearMatch(pickerKey); setPickerKey(null) }}
            onClose={() => setPickerKey(null)}
          />
        )
      })()}

      {formatSheetKey && (() => {
        const line = draft.find(x => x.key === formatSheetKey)
        if (!line) return null
        return (
          <FormatPicker
            line={line}
            saving={saving}
            units={units}
            preferredFormatId={catalogByItem.get(line.recipeItemId ?? '')?.purchaseFormatId ?? null}
            wizardActive={wizardKey === line.key}
            wz={wz}
            onSetWz={setWz}
            onSelectFormat={formatId => pickFormatAndClose(line, formatId)}
            onStartWizard={() => startWizardInSheet(line)}
            onUseWizard={() => applyWizardResult(line)}
            onCancelWizard={() => cancelWizardInSheet(line)}
            onClose={closeFormatSheet}
          />
        )
      })()}
    </div>
  )
}

// Picker de botones "de siempre": lo usa "Contar a mano" (sin cambios de
// lógica, per encargo) y el modo OCR cuando el trabajador pide "Cambiar" o
// responde la pregunta de desambiguación. "Sin pedido" es una opción visible,
// nunca implícita.
function FullOrderPicker({
  candidateOrders, candidateOverdue, candidateLineCounts, pickedOrderId, loadingOrders, saving, onPick,
}: {
  candidateOrders: PurchaseOrder[]
  candidateOverdue: Map<string, number>
  candidateLineCounts: Map<string, number>
  pickedOrderId: string | null
  loadingOrders: boolean
  saving: boolean
  onPick: (id: string | null) => void
}) {
  return (
    <div className="rounded-lg border border-border-default bg-card p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Truck size={16} className="text-text-secondary shrink-0" />
        <span className="text-sm font-medium text-text-primary">¿De qué pedido viene?</span>
        {loadingOrders && <Loader2 size={14} className="animate-spin text-text-tertiary" />}
      </div>
      {!loadingOrders && candidateOrders.length === 0 ? (
        <p className="text-xs text-text-tertiary">
          Sin pedidos enviados de este proveedor a este local. Se registra como compra directa.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onPick(null)} disabled={saving}
            className={`text-left px-3 py-2 rounded-md border text-sm transition-base disabled:opacity-50 ${
              !pickedOrderId ? 'border-accent bg-accent/10 text-accent' : 'border-border-default text-text-secondary hover:text-text-primary'}`}>
            Sin pedido (compra directa)
          </button>
          {candidateOrders.map(o => {
            const overdueDays = candidateOverdue.get(o.id) ?? 0
            const on = pickedOrderId === o.id
            const nLines = candidateLineCounts.get(o.id) ?? 0
            return (
              <button key={o.id} type="button" onClick={() => onPick(o.id)} disabled={saving}
                className={`text-left px-3 py-2 rounded-md border text-sm transition-base disabled:opacity-50 ${
                  on ? 'border-accent bg-accent/10 text-accent' : 'border-border-default text-text-secondary hover:text-text-primary'}`}>
                <span className="font-medium">{o.code ?? 'Pedido'}</span>
                <span className="text-xs text-text-tertiary ml-1.5">
                  {formatShortDate(o.orderDate)} · {nLines} línea{nLines === 1 ? '' : 's'}
                  {o.expectedDate ? ` · esperado ${formatShortDate(o.expectedDate)}` : ''}
                </span>
                {overdueDays > 0 && (
                  <span className="block text-[11px] text-danger mt-0.5">{overdueDays} día{overdueDays === 1 ? '' : 's'} de retraso</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {pickedOrderId && (
        <p className="text-[11px] text-text-tertiary mt-2.5">
          Las líneas de abajo que coincidan por artículo se enlazan solas al pedido. Lo que no coincida se queda sin enlazar — no bloquea.
        </p>
      )}
    </div>
  )
}

// Panel de repaso antes de confirmar. Aparece SIEMPRE, en lenguaje llano para
// personal poco formado: sin contadores abstractos ("de más: 1"), sino frases
// con NOMBRE de producto y cantidades. Si todo está bien → confirmación tranquila.
// Si hay algo de más o productos pedidos sin meter → avisos claros + confirmación
// reforzada. "De menos" se informa, no frena (te traen menos: es normal).
function ReviewPanel({
  summary, saving, onCancel, onConfirm, reasons, onReason,
}: {
  summary: {
    filled: number; aStock: number; sinMapear: number
    coinciden: number; deMenos: number; deMas: number; sinTocar: number
    overLines: OverLine[]; untouchedLines: UntouchedLine[]
    enterLines: EnterLine[]; notEnterLines: NotEnterLine[]
    priceAlerts: number; expiryAlerts: number; negotiatedAlerts: number; driftAlerts: number
    flagLines: { key: string; name: string; why: string }[]
    hasReference: boolean; anomaly: boolean; masaSinTocar: boolean
  }
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
  reasons: Record<string, string>
  onReason: (key: string, reason: string) => void
}) {
  const productos = summary.aStock === 1 ? '1 producto' : `${summary.aStock} productos`
  // ENCARGO CODE (12/08) — fix/recepcion-selector-formato, §3.5: Confirmar
  // bloqueado mientras haya líneas CON CANTIDAD y sin formato, salvo que la
  // persona haya marcado "no inventariar esta línea" a propósito (excluded).
  // "sin reconocer" no bloquea aquí (es un problema previo — casar el
  // artículo — que ya tiene su propio camino, sin cambios en este encargo).
  const missingFormatLines = summary.notEnterLines.filter(ne => ne.reason === 'sin formato' && !ne.excluded)
  const blockedByFormat = missingFormatLines.length > 0
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" onClick={onCancel}>
      <div className="bg-card w-full sm:max-w-lg max-h-[92vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border-default flex items-center gap-2 shrink-0">
          {summary.anomaly ? <AlertTriangle size={18} className="text-warning" /> : <ListChecks size={18} className="text-accent" />}
          <h3 className="text-base font-medium text-text-primary">Antes de confirmar</h3>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {/* Qué entra EXACTAMENTE al almacén (línea a línea, en unidad de almacén) */}
          <div className="space-y-2">
            <p className="text-sm text-text-primary">
              Vas a meter <span className="font-medium">{productos}</span> en el almacén:
            </p>

            {summary.enterLines.length > 0 && (
              <ul className="space-y-1 rounded-md border border-success/30 bg-success/5 p-2.5">
                {summary.enterLines.map((e, i) => (
                  <li key={i} className="text-sm text-text-primary flex items-baseline gap-1.5">
                    <Check size={13} className="text-success shrink-0 translate-y-0.5" />
                    <span>
                      <span className="font-medium">{e.name}:</span>{' '}
                      {e.baseAbbr ? formatBaseQty(e.qtyInBase, e.baseAbbr) : e.qtyInBase}
                      {e.areaName && (
                        <span className="text-accent"> · → {e.areaName}</span>
                      )}
                      {e.convertedNote && <span className="text-text-secondary"> · {e.convertedNote}</span>}
                      {e.unitCost !== null && (
                        <span className="text-text-secondary">
                          {' '}· {e.unitCost.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {summary.notEnterLines.length > 0 && (
              <div className="rounded-md border border-border-default bg-page p-2.5 space-y-1">
                <p className="text-sm font-medium text-text-secondary">
                  No entran al almacén ({summary.notEnterLines.length}):
                </p>
                <ul className="space-y-0.5">
                  {summary.notEnterLines.map((ne, i) => (
                    <li key={i} className="text-sm text-text-secondary">
                      {ne.name} <span className="text-xs">
                        — {ne.reason === 'sin reconocer'
                          ? 'sin reconocer (cásalo a un artículo)'
                          : ne.excluded ? 'excluida a propósito (no inventariar)' : 'sin formato (elige o crea uno)'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {blockedByFormat && (
              <div className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 flex items-start gap-1.5">
                <AlertTriangle size={15} className="text-danger shrink-0 mt-0.5" />
                <p className="text-sm text-danger">
                  {missingFormatLines.length === 1 ? '1 línea no entrará a stock: falta el formato.' : `${missingFormatLines.length} líneas no entrarán a stock: falta el formato.`}
                  {' '}Vuelve, elige el formato o marca "no inventariar esta línea".
                </p>
              </div>
            )}
          </div>

          {(summary.priceAlerts > 0 || summary.expiryAlerts > 0 || summary.negotiatedAlerts > 0 || summary.driftAlerts > 0) && (
            <div className="text-sm rounded-md bg-warning-bg text-warning border border-warning/20 px-3 py-2">
              {summary.priceAlerts > 0 && <p>⚠ {summary.priceAlerts} artículo(s) con salto de precio respecto a la última compra.</p>}
              {summary.negotiatedAlerts > 0 && <p>🤝 {summary.negotiatedAlerts} artículo(s) por encima del precio pactado.</p>}
              {summary.driftAlerts > 0 && <p>📈 {summary.driftAlerts} artículo(s) con tendencia de precio al alza.</p>}
              {summary.expiryAlerts > 0 && <p>⚠ {summary.expiryAlerts} artículo(s) con caducidad vencida o próxima.</p>}
              <p className="text-text-secondary text-xs mt-0.5">Revísalos en la lista; no impiden confirmar.</p>
            </div>
          )}

          {/* Aviso: cuentas más de lo que faltaba */}
          {summary.overLines.length > 0 && (
            <div className="rounded-md border border-warning/30 bg-warning-bg/50 p-3 space-y-2">
              <p className="text-sm font-medium text-warning">Cuentas más de lo que faltaba:</p>
              <ul className="space-y-1.5">
                {summary.overLines.map((o, i) => (
                  <li key={i} className="text-sm text-text-primary">
                    <span className="font-medium">{o.name}:</span> cuentas {o.received}, solo faltaban {o.pending}
                    <span className="text-warning"> (te sobran {o.overPending})</span>.
                    {o.ordered !== null && o.overOrdered !== null && o.overOrdered > 0 && (
                      <span className="text-text-secondary"> Con esto tendrías {o.totalAfter} de un pedido de {o.ordered}.</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Aviso: productos pedidos que no has metido (solo si es mucho) */}
          {summary.masaSinTocar && summary.untouchedLines.length > 0 && (
            <div className="rounded-md border border-warning/30 bg-warning-bg/50 p-3 space-y-1">
              <p className="text-sm font-medium text-warning">No has puesto nada de:</p>
              <p className="text-sm text-text-primary">
                {summary.untouchedLines.map(u => u.name).join(', ')}.
              </p>
              <p className="text-xs text-text-secondary">Si no han llegado, está bien. Si llegaron, cuéntalos antes de confirmar.</p>
            </div>
          )}

          {/* Motivo de las diferencias (responsabilidad, no bloquea) */}
          {summary.flagLines.length > 0 && (
            <div className="rounded-md border border-border-default bg-page p-3 space-y-2">
              <p className="text-sm font-medium text-text-secondary">
                Motivo de las diferencias <span className="text-xs font-normal text-text-tertiary">(opcional, queda registrado)</span>
              </p>
              <ul className="space-y-2">
                {summary.flagLines.map(f => (
                  <li key={f.key} className="text-sm">
                    <span className="font-medium text-text-primary">{f.name}</span>{' '}
                    <span className="text-xs text-text-secondary">— {f.why}</span>
                    <select value={reasons[f.key] ?? ''} onChange={e => onReason(f.key, e.target.value)} disabled={saving}
                      className="mt-1 block w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50">
                      <option value="">Sin especificar</option>
                      <option value="faltó">Faltó</option>
                      <option value="llegó de más">Llegó de más</option>
                      <option value="roto / mal estado">Roto / mal estado</option>
                      <option value="caducidad corta">Caducidad corta</option>
                      <option value="ya hablado con el proveedor">Ya hablado con el proveedor</option>
                      <option value="otro">Otro</option>
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cierre del mensaje según haya o no aviso */}
          {summary.anomaly ? (
            <p className="text-sm text-text-primary">Revisa que has contado bien antes de confirmar.</p>
          ) : summary.deMenos > 0 ? (
            <p className="text-sm text-text-secondary">Has recibido menos de lo pedido. Es normal; el pedido quedará a medias.</p>
          ) : (
            <p className="text-sm text-success">Todo correcto.</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default shrink-0">
          <button type="button" onClick={onCancel} disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">
            Volver a contar
          </button>
          <button type="button" onClick={onConfirm} disabled={saving || blockedByFormat} title={blockedByFormat ? 'Falta el formato en alguna línea con cantidad' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base ${summary.anomaly ? 'bg-warning' : 'bg-accent'}`}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
            {summary.anomaly ? 'He contado, confirmar' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ENCARGO CODE (12/08) — fix/recepcion-selector-formato. Hoja/modal "Elegir
// formato" (§3.3): tarjetas grandes con nombre + equivalencia + coste/ud que
// resultaría con lo YA tecleado en la línea (unitCost), "el habitual" marcado,
// y "Crear formato nuevo" siempre al final. Sin ningún formato → abre
// directa en el modo crear (wizardActive desde el primer render, decidido por
// el padre en openFormatSheet). El modo crear ES el wizard T1 existente
// (mismos wz/setWz/wizardToPack): una sola puerta de entrada, dos accesos.
function FormatPicker({
  line, saving, units, preferredFormatId, wizardActive, wz, onSetWz,
  onSelectFormat, onStartWizard, onUseWizard, onCancelWizard, onClose,
}: {
  line: DraftLine
  saving: boolean
  units: KitchenUnit[]
  preferredFormatId: string | null
  wizardActive: boolean
  wz: WizardState
  onSetWz: (updater: (w: WizardState) => WizardState) => void
  onSelectFormat: (formatId: string) => void
  onStartWizard: () => void
  onUseWizard: () => void
  onCancelWizard: () => void
  onClose: () => void
}) {
  const hasOptions = (line.formatOptions?.length ?? 0) > 0
  const unitCostNum = parseNum(line.unitCost)
  const baseKU = line.baseUnit ? (units.find(u => u.id === line.baseUnit!.id) ?? null) : null

  const fwz = friendlyUnit(line.baseUnit?.abbr)
  const baseLabel = (line.baseUnit?.abbr ?? '').toLowerCase()
  const isUnitBase = baseLabel === 'ud' || baseLabel === ''
  const preview = wizardToPack(wz, line.baseUnit?.abbr)
  const previewTotal = preview ? preview.count * preview.innerBase : null

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-md max-h-[92vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border-default flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-medium text-text-primary">{wizardActive ? '¿Cómo viene este artículo?' : 'Elige formato'}</h3>
            <p className="text-xs text-text-tertiary truncate">{line.productName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving}
            className="shrink-0 text-sm text-text-tertiary hover:text-text-secondary disabled:opacity-50">Cerrar</button>
        </div>

        {wizardActive ? (
          <div className="px-4 py-4 space-y-2.5 overflow-y-auto">
            {line.rawText && <p className="text-[11px] text-text-tertiary">el albarán dice: <span className="text-text-secondary">{line.rawText}</span></p>}

            {/* Paso 1: forma */}
            <div className="flex flex-wrap gap-1.5">
              {([['caja','En caja'],['paquete','En paquete'],['ud','Unidad suelta'],['peso','A peso']] as [WizardShape,string][]).map(([s,lab]) => (
                <button key={s} type="button" disabled={saving}
                  onClick={() => onSetWz(() => ({ ...emptyWizard(), shape: s, containerName: s === 'caja' ? 'Caja' : s === 'paquete' ? 'Paquete' : '' }))}
                  className={`px-2.5 py-1.5 rounded-md text-[12px] border transition-base disabled:opacity-50 ${wz.shape === s ? 'border-accent bg-accent text-text-on-accent' : 'border-border-default bg-card text-text-secondary hover:bg-page'}`}>
                  {lab}
                </button>
              ))}
            </div>

            {/* Paso 2: si es caja, qué trae dentro */}
            {wz.shape === 'caja' && (
              <div className="flex flex-wrap gap-1.5">
                {([['paquetes','Trae paquetes dentro'],['directas','Unidades directas']] as [WizardBoxHas,string][]).map(([b,lab]) => (
                  <button key={b} type="button" disabled={saving}
                    onClick={() => onSetWz(w => ({ ...w, boxHas: b }))}
                    className={`px-2.5 py-1.5 rounded-md text-[12px] border transition-base disabled:opacity-50 ${wz.boxHas === b ? 'border-accent bg-accent text-text-on-accent' : 'border-border-default bg-card text-text-secondary hover:bg-page'}`}>
                    {lab}
                  </button>
                ))}
              </div>
            )}

            {/* Paso 3: cantidades, en idioma humano */}
            {wz.shape === 'caja' && wz.boxHas === 'paquetes' && (
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                  <span className="min-w-[150px]">¿Cuántos paquetes por caja?</span>
                  <input type="text" inputMode="decimal" value={wz.count} onChange={e => onSetWz(w => ({ ...w, count: e.target.value }))} disabled={saving} placeholder="ej. 12"
                    className="w-20 px-1.5 py-1 text-sm text-right border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                </label>
                <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                  <span className="min-w-[150px]">¿Cuánto trae cada paquete?</span>
                  <input type="text" inputMode="decimal" value={wz.perInner} onChange={e => onSetWz(w => ({ ...w, perInner: e.target.value }))} disabled={saving} placeholder="ej. 20"
                    className="w-20 px-1.5 py-1 text-sm text-right border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                  <span className="text-text-tertiary">{fwz.label}</span>
                </label>
              </div>
            )}
            {((wz.shape === 'caja' && wz.boxHas === 'directas') || wz.shape === 'paquete' || wz.shape === 'ud' || wz.shape === 'peso') && wz.shape && (
              <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <span className="min-w-[150px]">
                  {wz.shape === 'caja' ? '¿Cuántas unidades por caja?' : wz.shape === 'paquete' ? '¿Cuánto trae el paquete?' : wz.shape === 'peso' ? '¿Cuánto pesa?' : '¿Cuántas unidades?'}
                </span>
                <input type="text" inputMode="decimal" value={wz.perInner} onChange={e => onSetWz(w => ({ ...w, perInner: e.target.value }))} disabled={saving} placeholder="cantidad"
                  className="w-20 px-1.5 py-1 text-sm text-right border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-text-tertiary">{wz.shape === 'caja' || (wz.shape === 'ud') ? (isUnitBase ? 'ud' : fwz.label) : fwz.label}</span>
              </label>
            )}

            {/* Paso 4 (cierre): unidad base — visible, confirmable */}
            {preview && line.baseUnit && (
              <div className="rounded-md bg-page border border-border-default px-2.5 py-1.5">
                <p className="text-[12px] text-text-primary">
                  {wz.boxHas === 'paquetes'
                    ? `1 ${(wz.containerName||'caja').toLowerCase()} = ${wz.count} ${(wz.innerName||'paquetes').toLowerCase()} × ${wz.perInner} ${fwz.label}`
                    : `1 ${(wz.containerName||(wz.shape==='peso'?fwz.label:'ud')).toLowerCase()} = ${wz.perInner} ${isUnitBase && wz.shape!=='peso' ? 'ud' : fwz.label}`}
                  {previewTotal !== null && <span className="text-text-secondary"> → {formatBaseQty(previewTotal, line.baseUnit.abbr)}</span>}
                </p>
                <p className="text-[10px] text-text-tertiary mt-0.5">se cuenta en {line.baseUnit.abbr}</p>
              </div>
            )}
            {!line.baseUnit && (
              <p className="text-[11px] text-warning">Este artículo aún no tiene unidad base definida. Resuélvela en su ficha antes de montar el formato.</p>
            )}
          </div>
        ) : (
          <div className="px-4 py-4 space-y-2 overflow-y-auto">
            {(line.formatOptions ?? []).map(opt => {
              const selected = line.purchaseFormatId === opt.id
              const isPreferred = preferredFormatId != null && opt.id === preferredFormatId
              const perBase = unitCostNum != null && opt.qtyInBase ? unitCostNum / opt.qtyInBase : null
              const human = perBase != null ? perBaseToHuman(perBase, baseKU, units, line.baseUnit?.abbr ?? '') : null
              return (
                <button key={opt.id} type="button" disabled={saving} onClick={() => onSelectFormat(opt.id)}
                  className={`w-full text-left px-3.5 py-3 rounded-lg border transition-base disabled:opacity-50 ${selected ? 'border-accent bg-accent/10' : 'border-border-default bg-card hover:bg-page'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary">{opt.label ?? opt.name ?? 'Formato'}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isPreferred && <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-bg text-accent border border-accent/20">el habitual</span>}
                      {selected && <Check size={15} className="text-accent" />}
                    </div>
                  </div>
                  {human && (
                    <p className="text-xs text-text-secondary mt-0.5">→ {fmtHumanPrice(human.value)} €/{human.abbr}</p>
                  )}
                </button>
              )
            })}
            <button type="button" disabled={saving} onClick={onStartWizard}
              className="w-full text-left px-3.5 py-3 rounded-lg border border-dashed border-border-default text-text-secondary hover:text-text-primary hover:bg-page transition-base disabled:opacity-50">
              + Crear formato nuevo
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 px-4 py-3 border-t border-border-default shrink-0">
          {wizardActive ? (
            <>
              <button type="button" disabled={saving || !preview || !line.baseUnit} onClick={onUseWizard}
                className="px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
                Usar este formato
              </button>
              <button type="button" disabled={saving} onClick={onCancelWizard}
                className="px-3 py-2 rounded-md text-sm border border-border-default bg-card text-text-secondary hover:bg-page disabled:opacity-50">
                {hasOptions ? 'Volver a los formatos' : 'Cancelar'}
              </button>
            </>
          ) : (
            <p className="text-xs text-text-tertiary">Elige una tarjeta, o crea un formato nuevo si no está en la lista.</p>
          )}
        </div>
      </div>
    </div>
  )
}
