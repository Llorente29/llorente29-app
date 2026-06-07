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
import { ArrowLeft, Search, Loader2, Check, Save, ListChecks, AlertTriangle } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useOperativeLocation } from '@/modules/supply/hooks/useOperativeLocation'
import OperativeLocationBanner from '@/modules/supply/components/OperativeLocationBanner'
import { listSuppliers, createPurchaseFormat } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import {
  getSupplierCatalog,
  listSupplyLocations,
  type SupplierCatalogEntry,
  type SupplierFormatOption,
  type SupplyLocation,
} from '@/modules/supply/services/supplierCatalogService'
import {
  listPurchaseOrderLines,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from '@/modules/supply/services/purchaseOrderService'
import {
  createGoodsReceipt,
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
  ensureLastPurchaseStrategy,
  formatQtyInBaseFromPack,
  getSupplySettings,
  getSupplierFormatPrices,
  priceAlertFor,
  expiryAlertFor,
  type LineMatchCandidate,
  type SupplySettings,
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
}
export interface ReceiptPrefillLine {
  recipeItemId: string | null
  productName: string
  purchaseFormatId: string | null
  qtyReceived: number
  unitCost: number | null
  purchaseOrderLineId: string | null
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
  qty: string                  // RECIBIDO — nace vacío SIEMPRE
  unitCost: string
  lineAmount?: number | null   // importe de línea del albarán (OCR), dato duro p/ aviso de precio
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
}

function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
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

export default function GoodsReceiptForm({ accountId, order, prefill, ocrPrefill, onBack, onSaved }: GoodsReceiptFormProps) {
  const { userProfile, authUserId } = useApp()
  const op = useOperativeLocation()
  const againstOrder = !!order
  const correcting = !!prefill
  const fromOcr = !!ocrPrefill
  const fixedHeader = againstOrder || correcting   // en OCR la cabecera es editable (propuesta)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [supplierId, setSupplierId] = useState<string>(order?.supplierId ?? prefill?.supplierId ?? ocrPrefill?.supplierId ?? '')
  const [locationId, setLocationId] = useState<string>(order?.locationId ?? prefill?.locationId ?? ocrPrefill?.locationId ?? '')
  // El local operativo (contexto) prevalece salvo que la cabecera venga fijada por un documento.
  useEffect(() => {
    if (!fixedHeader && op.operativeLocationId) setLocationId(op.operativeLocationId)
  }, [op.operativeLocationId, fixedHeader])
  const [receiptDate, setReceiptDate] = useState<string>(ocrPrefill?.receiptDate ?? new Date().toISOString().slice(0, 10))
  const [supplierDoc, setSupplierDoc] = useState<string>(prefill?.supplierDocNumber ?? ocrPrefill?.supplierDocNumber ?? '')

  const [draft, setDraft] = useState<DraftLine[]>([])
  const [search, setSearch] = useState('')

  const [loadingMeta, setLoadingMeta] = useState(true)
  const [loadingLines, setLoadingLines] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)   // panel resumen pre-confirmación

  // C2.2.b.1 — casado por línea: candidatos de run_mapping por key + picker abierto.
  const [lineMatch, setLineMatch] = useState<Record<string, { loading: boolean; candidates: LineMatchCandidate[] }>>({})

  // C2.2.c — ajustes de avisos + last_price por artículo del proveedor.
  const [supplySettings, setSupplySettings] = useState<SupplySettings>({ priceAlertPct: 15, expiryAlertDays: 3 })
  // €/unidad-base por formato (deriva caja→bote vía SQL). Clave del aviso de precio.
  const [formatPrices, setFormatPrices] = useState<Record<string, number>>({})
  useEffect(() => {
    getSupplySettings(accountId).then(setSupplySettings).catch(() => {})
  }, [accountId])
  useEffect(() => {
    if (!supplierId) { setFormatPrices({}); return }
    getSupplierFormatPrices(accountId, supplierId).then(setFormatPrices).catch(() => setFormatPrices({}))
  }, [accountId, supplierId])
  const [pickerKey, setPickerKey] = useState<string | null>(null)

  function chooseMatch(key: string, recipeItemId: string, name: string, semaphore: 'green' | 'yellow' | null, matchType: string | null) {
    setDraft(d => d.map(x => x.key === key
      ? { ...x, recipeItemId, matchedName: name, matchSemaphore: semaphore, matchType,
          // reinicia el formato: lo resolverá el efecto para el artículo recién casado
          purchaseFormatId: null, formatLabel: null, formatQtyInBase: null,
          baseUnit: null, formatSuggested: false, formatTouched: false }
      : x))
    setPickerKey(null)
  }
  function clearMatch(key: string) {
    setDraft(d => d.map(x => x.key === key
      ? { ...x, recipeItemId: null, matchedName: null, matchSemaphore: null, matchType: null,
          purchaseFormatId: null, formatLabel: null, formatQtyInBase: null,
          baseUnit: null, formatSuggested: false, formatTouched: false }
      : x))
  }

  // ── Tramo A: captura de formato (solo OCR) ──
  // Catálogo del proveedor (para HEREDAR el formato si el artículo ya lo tiene
  // con él) + caché de unidad base por artículo + ref al draft para el efecto async.
  const [catalogByItem, setCatalogByItem] = useState<Map<string, SupplierCatalogEntry>>(new Map())
  const baseUnitCache = useRef<Map<string, BaseUnitInfo | null>>(new Map())
  const draftRef = useRef<DraftLine[]>([])
  useEffect(() => { draftRef.current = draft }, [draft])

  useEffect(() => {
    if (!fromOcr || !supplierId) { setCatalogByItem(new Map()); return }
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
  }, [fromOcr, accountId, supplierId])

  function setFormatName(key: string, name: string) {
    setDraft(d => d.map(l => {
      if (l.key !== key) return l
      const label = (l.formatQtyInBase !== null && l.baseUnit)
        ? `${name.trim() || 'Formato'} (${formatBaseQty(l.formatQtyInBase, l.baseUnit.abbr)})`
        : l.formatLabel
      return { ...l, formatName: name, formatTouched: true, formatSuggested: false, purchaseFormatId: null, formatLabel: label }
    }))
  }
  function setFormatQty(key: string, value: string) {
    const n = parseNum(value)
    setDraft(d => d.map(l => {
      if (l.key !== key) return l
      const label = (n !== null && l.baseUnit)
        ? `${(l.formatName ?? '').trim() || 'Formato'} (${formatBaseQty(n, l.baseUnit.abbr)})`
        : null
      return { ...l, formatQtyInBase: n, formatTouched: true, formatSuggested: false, purchaseFormatId: null, formatLabel: label }
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
      return { ...l, purchaseFormatId: opt.id, formatName: opt.name, formatQtyInBase: opt.qtyInBase, formatLabel: label, formatTouched: true, formatSuggested: false }
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
    if (!fromOcr) return
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
        setDraft(d => d.map(x => {
          if (x.key !== line.key || x.formatTouched) return x
          if (x.baseUnit === base && x.purchaseFormatId === purchaseFormatId
              && x.formatQtyInBase === formatQtyInBase && x.formatName === formatName) return x
          return { ...x, baseUnit: base, purchaseFormatId, formatName, formatQtyInBase, formatLabel: label, formatSuggested: suggested, formatOptions: options }
        }))
      }
    })()
    return () => { cancelled = true }
  }, [fromOcr, matchSignature, supplierId, catalogByItem])

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
    if (fromOcr && ocrPrefill?.unmatchedSupplier) {
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

  const linkedOrderId = order?.id ?? prefill?.purchaseOrderId ?? null

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
      qty: l.qty != null ? String(l.qty) : '',   // precargada (excepción consciente: el albarán ya tiene la cantidad)
      unitCost: l.unitCost != null ? String(l.unitCost) : '',
      lineAmount: l.lineAmount ?? null,
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
            qty: '',
            unitCost: l.unitCost != null ? String(l.unitCost) : (cat?.lastPrice != null ? String(cat.lastPrice) : ''),
            poLineId: l.purchaseOrderLineId,
            lotCode: null,
            expiryDate: null,
            rawText: null, supplierCode: null, matchedName: null, matchSemaphore: null, matchType: null,
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
    setDraft(d => d.map(l => l.key === key ? { ...l, qty } : l))
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
    let priceAlerts = 0, expiryAlerts = 0
    for (const l of draft) {
      if (l.recipeItemId && priceAlertFor({
        lineAmount: l.lineAmount ?? null,
        qtyReceived: parseNum(l.qty),
        formatQtyInBase: l.formatQtyInBase,
        expectedPerBase: l.purchaseFormatId ? (formatPrices[l.purchaseFormatId] ?? null) : null,
        thresholdPct: supplySettings.priceAlertPct,
      })) priceAlerts++
      if (expiryAlertFor(l.expiryDate, supplySettings.expiryAlertDays)) expiryAlerts++
    }
    // Anomalía = algo de más, o masa sin tocar (>30% de las líneas con pendiente y >3).
    const masaSinTocar = sinTocar > 3 && linesWithPending.length > 0 && (sinTocar / linesWithPending.length) > 0.30
    const anomaly = overLines.length > 0 || masaSinTocar
    return {
      filled: filled.length, aStock: willPost, sinMapear,
      coinciden, deMenos, deMas: overLines.length, sinTocar,
      overLines, untouchedLines,
      priceAlerts, expiryAlerts,
      hasReference, anomaly, masaSinTocar,
    }
  }, [draft, filled, willPost, hasReference, formatPrices, supplySettings])

  const supplierName = useMemo(() => suppliers.find(s => s.id === supplierId)?.name ?? '—', [suppliers, supplierId])
  const locationName = useMemo(() => locations.find(l => l.id === locationId)?.name ?? '—', [locations, locationId])

  function startReview() {
    if (!fromOcr && !supplierId) { setError('Elige un proveedor.'); return }
    if (!locationId) { setError('No hay un local operativo definido. Revisa el aviso de local arriba.'); return }
    if (filled.length === 0) { setError('Pon cantidad recibida en al menos un artículo.'); return }
    setError(null)
    setReviewing(true)
  }

  async function persist(confirm: boolean) {
    if (!locationId) { setError('No hay un local operativo definido. Revisa el aviso de local arriba.'); return }
    setSaving(true); setError(null)
    try {
      const receipt = await createGoodsReceipt({
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
          mapSource: l.recipeItemId ? (l.matchType ?? 'manual') : 'unmapped',
          mapNeedsReview: unmapped,
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
      let voidNote = ''
      if (correcting && prefill?.sourceReceiptId) {
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

  const title = againstOrder ? `Recibir pedido ${order?.code ?? ''}` : correcting ? 'Corregir recepción' : fromOcr ? 'Revisar recepción escaneada' : 'Nueva recepción'
  const subtitle = againstOrder
    ? 'Cuenta lo que ha llegado y escríbelo. Lo pedido y lo pendiente están a la derecha como referencia.'
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

              <div className="rounded-lg border border-border-default overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: hasReference ? 860 : 720 }}>
                  <thead className="bg-page text-text-secondary">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Artículo</th>
                      <th className="text-left font-medium px-3 py-2">Formato</th>
                      {hasReference && <th className="text-right font-medium px-3 py-2">Pedido</th>}
                      {hasReference && <th className="text-right font-medium px-3 py-2">Ya recibido</th>}
                      {hasReference && <th className="text-right font-medium px-3 py-2">Pendiente</th>}
                      <th className="text-center font-medium px-3 py-2" style={{ width: 110 }}>Recibido</th>
                      <th className="text-right font-medium px-3 py-2" style={{ width: 110 }}>€ / formato</th>
                      <th className="text-left font-medium px-3 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(l => {
                      const qtyN = parseNum(l.qty)
                      const hasQty = qtyN !== null && qtyN > 0
                      const willEnter = hasQty && l.recipeItemId && qtyInBaseFromFormat(qtyN!, l.formatQtyInBase) !== null
                      const complete = l.pending !== null && l.pending === 0
                      let cmp: { label: string; cls: string } | null = null
                      if (l.pending !== null && hasQty) {
                        if (qtyN! > l.pending) cmp = { label: 'De más', cls: 'bg-accent-bg text-accent border-accent/20' }
                        else if (l.pending > 0 && qtyN! < l.pending) cmp = { label: 'Parcial', cls: 'bg-warning-bg text-warning border-warning/20' }
                        else cmp = { label: 'OK', cls: 'bg-success-bg text-success border-success/20' }
                      }
                      // C2.2.c — avisos copiloto (informativos)
                      const priceAlert = l.recipeItemId
                        ? priceAlertFor({
                            lineAmount: l.lineAmount ?? null,
                            qtyReceived: qtyN,
                            formatQtyInBase: l.formatQtyInBase,
                            expectedPerBase: l.purchaseFormatId ? (formatPrices[l.purchaseFormatId] ?? null) : null,
                            thresholdPct: supplySettings.priceAlertPct,
                          })
                        : null
                      const expiryAlert = expiryAlertFor(l.expiryDate, supplySettings.expiryAlertDays)
                      return (
                        <tr key={l.key} className={`border-t border-border-default ${complete && !hasQty ? 'opacity-60' : ''}`}>
                          <td className="px-3 py-2 text-text-primary align-top">
                            {fromOcr ? (
                              <div className="space-y-1">
                                {l.recipeItemId ? (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`inline-block w-2 h-2 rounded-full ${l.matchSemaphore === 'green' ? 'bg-success' : 'bg-warning'}`} />
                                    <span className="font-medium text-text-primary">{l.matchedName}</span>
                                    {l.matchType && <span className="text-[10px] text-text-secondary">({matchTypeLabel(l.matchType)})</span>}
                                  </div>
                                ) : (
                                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-warning-bg text-warning border border-warning/20">sin casar</span>
                                )}
                                <div className="text-[11px] text-text-tertiary">
                                  albarán: {l.rawText}{l.supplierCode ? ` · cód. ${l.supplierCode}` : ''}
                                </div>
                                <button type="button" onClick={() => setPickerKey(l.key)} disabled={saving}
                                  className={`inline-flex items-center gap-1 mt-0.5 px-2 py-1 rounded-md text-[11px] font-medium border transition-base disabled:opacity-50 ${
                                    l.recipeItemId
                                      ? 'border-border-default bg-card text-text-secondary hover:bg-page'
                                      : 'border-accent bg-accent text-text-on-accent hover:opacity-90'
                                  }`}>
                                  {l.recipeItemId ? 'Cambiar artículo' : '➜ Casar artículo'}
                                  {lineMatch[l.key]?.loading ? ' · buscando…' : ''}
                                </button>
                              </div>
                            ) : (
                              l.productName
                            )}
                          </td>
                          <td className="px-3 py-2 text-text-primary align-top">
                            {!fromOcr ? (
                              l.formatLabel ?? '—'
                            ) : !l.recipeItemId ? (
                              <span className="text-[11px] text-text-tertiary">casa el artículo primero</span>
                            ) : (
                              <div className="space-y-1">
                                {(l.formatOptions?.length ?? 0) > 1 && (
                                  <select
                                    value={l.purchaseFormatId ?? ''}
                                    onChange={e => selectFormatOption(l.key, e.target.value)}
                                    disabled={saving}
                                    className="w-full px-1.5 py-1 text-xs border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 mb-1"
                                  >
                                    <option value="">Elige formato…</option>
                                    {l.formatOptions!.map(opt => (
                                      <option key={opt.id} value={opt.id}>{opt.label ?? opt.name ?? 'Formato'}</option>
                                    ))}
                                  </select>
                                )}
                                <div className="flex items-center gap-1">
                                  <input type="text" value={l.formatName ?? ''} onChange={e => setFormatName(l.key, e.target.value)} disabled={saving}
                                    placeholder="Formato"
                                    className="w-24 px-1.5 py-1 text-xs border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                                  <span className="text-[11px] text-text-secondary">=</span>
                                  <input type="text" inputMode="decimal"
                                    value={l.formatQtyInBase != null ? String(l.formatQtyInBase) : ''}
                                    onChange={e => setFormatQty(l.key, e.target.value)} disabled={saving} placeholder="?"
                                    className={`w-16 px-1.5 py-1 text-xs text-right rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 border ${l.formatQtyInBase == null ? 'border-warning/60 bg-warning-bg/30' : 'border-border-default'}`} />
                                  <span className="text-[11px] text-text-secondary">{l.baseUnit?.abbr ?? ''}</span>
                                  {l.formatSuggested && <span className="text-[10px] text-accent" title="Propuesto por la IA — confírmalo">✨</span>}
                                </div>
                                {l.formatSuggested && (l.formatOptions?.length ?? 0) > 1 && (
                                  <p className="text-[10px] text-warning">Confirma el formato: el albarán no indicaba cuál con certeza.</p>
                                )}
                                {l.formatQtyInBase == null && (
                                  <p className="text-[10px] text-warning">¿Cuánto contiene un {(l.formatName ?? '').trim() || 'formato'}? (en {l.baseUnit?.abbr ?? 'base'})</p>
                                )}
                                {l.purchaseFormatId && !l.formatTouched && !l.formatSuggested && (
                                  <p className="text-[10px] text-text-tertiary">formato que ya tenías con este proveedor</p>
                                )}
                              </div>
                            )}
                          </td>
                          {hasReference && <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{l.qtyOrdered ?? '—'}</td>}
                          {hasReference && <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{l.alreadyReceived ?? '—'}</td>}
                          {hasReference && (
                            <td className="px-3 py-2 text-right tabular-nums font-medium text-text-primary">
                              {l.pending === null ? '—' : l.pending}
                            </td>
                          )}
                          <td className="px-3 py-2 text-center">
                            <input type="text" inputMode="decimal" value={l.qty}
                              onChange={e => setQty(l.key, e.target.value)} disabled={saving} placeholder="0"
                              className={`w-20 px-2 py-1.5 text-sm text-center font-medium rounded-md border bg-page text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 ${hasQty ? 'border-accent/50' : 'border-accent/30 bg-accent-bg/30'}`} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="text" inputMode="decimal" value={l.unitCost}
                              onChange={e => setCost(l.key, e.target.value)} disabled={saving} placeholder="—"
                              className="w-24 px-2 py-1 text-sm text-right border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                          </td>
                          <td className="px-3 py-2">
                            {complete && !hasQty ? (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-success-bg text-success border border-success/20">✓ completa</span>
                            ) : !hasQty ? (
                              <span className="text-xs text-text-tertiary">—</span>
                            ) : (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {cmp && <span className={`text-[10px] px-1 py-0.5 rounded border ${cmp.cls}`}>{cmp.label}</span>}
                                {willEnter ? (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-success-bg text-success border border-success/20">a stock</span>
                                ) : (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-warning-bg text-warning border border-warning/20">sin mapear</span>
                                )}
                                {priceAlert && (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-warning-bg text-warning border border-warning/20"
                                    title={`Última compra: ${priceAlert.lastPrice.toFixed(2)} € → ahora ${priceAlert.newPrice.toFixed(2)} €`}>
                                    {priceAlert.direction === 'up' ? '↑' : '↓'}{Math.abs(priceAlert.pct)}% precio
                                  </span>
                                )}
                                {expiryAlert && (
                                  <span className={`text-[10px] px-1 py-0.5 rounded border ${expiryAlert.kind === 'expired' ? 'bg-danger-bg text-danger border-danger/20' : 'bg-warning-bg text-warning border-warning/20'}`}>
                                    {expiryAlert.kind === 'expired' ? 'caducado' : `caduca en ${expiryAlert.days}d`}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm text-text-secondary">
                  {filled.length} con cantidad · {willPost} entrarán a stock
                  {filled.length - willPost > 0 && ` · ${filled.length - willPost} sin mapear`}
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => persist(false)} disabled={saving || filled.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={15} />}
                    Guardar borrador
                  </button>
                  <button type="button" onClick={startReview} disabled={saving || filled.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">
                    <Check size={15} />
                    Revisar y confirmar
                  </button>
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
    </div>
  )
}

// Panel de repaso antes de confirmar. Aparece SIEMPRE, en lenguaje llano para
// personal poco formado: sin contadores abstractos ("de más: 1"), sino frases
// con NOMBRE de producto y cantidades. Si todo está bien → confirmación tranquila.
// Si hay algo de más o productos pedidos sin meter → avisos claros + confirmación
// reforzada. "De menos" se informa, no frena (te traen menos: es normal).
function ReviewPanel({
  summary, saving, onCancel, onConfirm,
}: {
  summary: {
    filled: number; aStock: number; sinMapear: number
    coinciden: number; deMenos: number; deMas: number; sinTocar: number
    overLines: OverLine[]; untouchedLines: UntouchedLine[]
    priceAlerts: number; expiryAlerts: number
    hasReference: boolean; anomaly: boolean; masaSinTocar: boolean
  }
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const productos = summary.aStock === 1 ? '1 producto' : `${summary.aStock} productos`
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" onClick={onCancel}>
      <div className="bg-card w-full sm:max-w-lg max-h-[92vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border-default flex items-center gap-2 shrink-0">
          {summary.anomaly ? <AlertTriangle size={18} className="text-warning" /> : <ListChecks size={18} className="text-accent" />}
          <h3 className="text-base font-medium text-text-primary">Antes de confirmar</h3>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {/* Repaso en una frase */}
          <p className="text-sm text-text-primary">
            Vas a meter <span className="font-medium">{productos}</span> en el almacén.
            {summary.sinMapear > 0 && (
              <span className="text-text-secondary"> ({summary.sinMapear} sin reconocer no entrarán.)</span>
            )}
          </p>

          {(summary.priceAlerts > 0 || summary.expiryAlerts > 0) && (
            <div className="text-sm rounded-md bg-warning-bg text-warning border border-warning/20 px-3 py-2">
              {summary.priceAlerts > 0 && <p>⚠ {summary.priceAlerts} artículo(s) con salto de precio respecto a la última compra.</p>}
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
          <button type="button" onClick={onConfirm} disabled={saving}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base ${summary.anomaly ? 'bg-warning' : 'bg-accent'}`}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
            {summary.anomaly ? 'He contado, confirmar' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
