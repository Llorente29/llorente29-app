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

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Search, Loader2, Check, Save, ListChecks, AlertTriangle } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import {
  getSupplierCatalog,
  listSupplyLocations,
  type SupplierCatalogEntry,
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
  type LineMatchCandidate,
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
  lotCode: string | null
  expiryDate: string | null
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
  poLineId: string | null
  lotCode: string | null       // hueco FEFO/APPCC (se persiste; UI en su frente)
  expiryDate: string | null
  // C2.2.b — casado de línea de albarán (solo modo OCR)
  rawText: string | null            // texto leído del albarán (referencia gris)
  supplierCode: string | null       // código del proveedor (ancla de casado)
  matchedName: string | null        // nombre del artículo casado (tu nombre)
  matchSemaphore: 'green' | 'yellow' | null
  matchType: string | null
}

function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
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
  const againstOrder = !!order
  const correcting = !!prefill
  const fromOcr = !!ocrPrefill
  const fixedHeader = againstOrder || correcting   // en OCR la cabecera es editable (propuesta)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [supplierId, setSupplierId] = useState<string>(order?.supplierId ?? prefill?.supplierId ?? ocrPrefill?.supplierId ?? '')
  const [locationId, setLocationId] = useState<string>(order?.locationId ?? prefill?.locationId ?? ocrPrefill?.locationId ?? '')
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
  const [pickerKey, setPickerKey] = useState<string | null>(null)

  function chooseMatch(key: string, recipeItemId: string, name: string, semaphore: 'green' | 'yellow' | null, matchType: string | null) {
    setDraft(d => d.map(x => x.key === key
      ? { ...x, recipeItemId, matchedName: name, matchSemaphore: semaphore, matchType }
      : x))
    setPickerKey(null)
  }
  function clearMatch(key: string) {
    setDraft(d => d.map(x => x.key === key
      ? { ...x, recipeItemId: null, matchedName: null, matchSemaphore: null, matchType: null }
      : x))
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
        if (!fixedHeader && locs.length === 1) setLocationId(locs[0].id)
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
      poLineId: null,
      lotCode: l.lotCode,
      expiryDate: l.expiryDate,
      rawText: l.productName,
      supplierCode: l.supplierCode,
      matchedName: null,
      matchSemaphore: null,
      matchType: null,
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
    // Anomalía = algo de más, o masa sin tocar (>30% de las líneas con pendiente y >3).
    const masaSinTocar = sinTocar > 3 && linesWithPending.length > 0 && (sinTocar / linesWithPending.length) > 0.30
    const anomaly = overLines.length > 0 || masaSinTocar
    return {
      filled: filled.length, aStock: willPost, sinMapear,
      coinciden, deMenos, deMas: overLines.length, sinTocar,
      overLines, untouchedLines,
      hasReference, anomaly, masaSinTocar,
    }
  }, [draft, filled, willPost, hasReference])

  const supplierName = useMemo(() => suppliers.find(s => s.id === supplierId)?.name ?? '—', [suppliers, supplierId])
  const locationName = useMemo(() => locations.find(l => l.id === locationId)?.name ?? '—', [locations, locationId])

  function startReview() {
    if (!fromOcr && !supplierId) { setError('Elige un proveedor.'); return }
    if (!locationId) { setError('Elige el local de entrega.'); return }
    if (filled.length === 0) { setError('Pon cantidad recibida en al menos un artículo.'); return }
    setError(null)
    setReviewing(true)
  }

  async function persist(confirm: boolean) {
    if (!locationId) { setError('Elige el local de entrega.'); return }
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
      for (const l of filled) {
        const qtyReceived = parseNum(l.qty)!
        const unitCost = parseNum(l.unitCost)
        const qtyInBase = qtyInBaseFromFormat(qtyReceived, l.formatQtyInBase)
        const unmapped = !l.recipeItemId || qtyInBase === null
        await createGoodsReceiptLine({
          accountId,
          goodsReceiptId: receipt.id,
          purchaseOrderLineId: l.poLineId,
          recipeItemId: l.recipeItemId,
          productName: l.productName,
          rawText: l.rawText,
          supplierCode: l.supplierCode,
          qtyReceived,
          purchaseFormatId: l.purchaseFormatId,
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

      const res = await confirmReceipt(receipt.id)

      // C2.2.b.3 — aprendizaje: graba la memoria por proveedor (no es fatal si falla).
      let learnNote = ''
      try {
        const learned = await learnFromReceipt(receipt.id)
        if (learned > 0) learnNote = ` · memoria del proveedor actualizada (${learned})`
      } catch (e) {
        console.error('persist: confirmada OK pero el aprendizaje falló', e)
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
        ? 'Esto leyó la IA del albarán. Revisa proveedor, local y cantidades, y guarda el borrador. Los artículos se casan en el siguiente paso.'
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

      {/* Datos de la recepción */}
      <div className="rounded-lg border border-border-default bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Local (entrada)</label>
          {fixedHeader ? (
            <p className="px-2 py-1.5 text-sm text-text-primary">{locationName}</p>
          ) : (
            <select value={locationId} onChange={e => setLocationId(e.target.value)} disabled={loadingMeta || saving}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50">
              <option value="">— Elige local —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
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
          {ocrPrefill?.unmatchedSupplier && <p>No he reconocido el proveedor del albarán. Elígelo arriba (o créalo en el siguiente paso).</p>}
          {ocrPrefill?.unmatchedLocation && <p>No he reconocido el local de entrega. Elígelo arriba.</p>}
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
                                  className="text-[11px] text-accent hover:underline disabled:opacity-50">
                                  {l.recipeItemId ? 'Cambiar artículo' : 'Casar artículo'}
                                  {lineMatch[l.key]?.loading ? ' · buscando…' : ''}
                                </button>
                              </div>
                            ) : (
                              l.productName
                            )}
                          </td>
                          <td className="px-3 py-2 text-text-primary align-top">{l.formatLabel ?? '—'}</td>
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
