// src/modules/supply/pages/ReceiptOfficeReview.tsx
//
// ENCARGO CODE (14/08) feat/recepcion-oficina-cierre, Tramo B — la pantalla de
// OFICINA, separada de GoodsReceiptForm. El asistente de cocina (ReceiptWizard)
// ya metió el stock; esta pantalla VERIFICA, no rehace la recepción. Especificación
// visual OBLIGATORIA: docs/folvy_recepcion_oficina_maqueta.html (14/08, datos
// reales de ALB-00113) — B.8: idéntica en textos, estructura y orden.
//
// B.2 — qty_in_base/unit_cost/doc_qty/doc_amount se leen de la línea y se
// muestran TAL CUAL. Cero re-derivación desde el catálogo del proveedor. El
// catálogo solo se consulta para RESOLVER una línea que la oficina cambia.

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import {
  getGoodsReceiptById,
  listGoodsReceiptLines,
  getReceiptDocTotal,
  getRecipeItemDisplayInfo,
  getPurchaseFormatNames,
  adjustGoodsReceiptLine,
  updateGoodsReceiptLine,
  confirmReceipt,
  matchReceiptLine,
  OFFICE_QTY_REASON_PREFIX,
  OFFICE_QTY_REASONS,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type LineMatchCandidate,
  type OcrDocTotals,
} from '@/modules/supply/services/goodsReceiptService'
import { getSupplierCatalog, listSupplyLocations, type SupplierCatalogEntry } from '@/modules/supply/services/supplierCatalogService'
import { listSuppliers, createPurchaseFormat } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import { fmtMoney, isNum, DASH } from '@/lib/format'
import LineMatchPicker from '@/modules/supply/pages/LineMatchPicker'

const NOT_GOODS_KINDS: { value: string; label: string }[] = [
  { value: 'portes', label: 'Portes' },
  { value: 'envases', label: 'Envases' },
  { value: 'descuento', label: 'Descuento' },
  { value: 'impuesto', label: 'Impuesto' },
  { value: 'otro', label: 'Otro' },
]

type LineClass = 'resuelta' | 'dudosa' | 'sin_decidir' | 'not_goods'

function classify(l: GoodsReceiptLine): LineClass {
  if (l.notGoods) return 'not_goods'
  const undecided = !l.recipeItemId || l.qtyInBase == null || l.qtyInBase <= 0
  if (undecided) return 'sin_decidir'
  if (l.flaggedForOffice || l.mapNeedsReview) return 'dudosa'
  return 'resuelta'
}
const CLASS_RANK: Record<LineClass, number> = { resuelta: 0, dudosa: 1, sin_decidir: 2, not_goods: 3 }

function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
function numToInputStr(n: number): string {
  return n.toLocaleString('es-ES', { useGrouping: false, maximumFractionDigits: 6 })
}
// Naive pluralizador ES para nombres de formato ("Pack" -> "packs", "Caja" ->
// "cajas"). Mismo espíritu que el stem() naive que ya usa el casado (R1'):
// sirve para el vocabulario de compra habitual de esta cuenta, no aspira a
// ser lingüística fina.
function pluralizeEs(name: string, n: number): string {
  const base = name.trim().toLowerCase()
  if (n === 1) return base
  return base.endsWith('s') ? base : base + 's'
}
function unitNoun(abbr: string | null, n: number): string {
  const a = (abbr ?? 'ud').toLowerCase()
  if (a === 'ud') return n === 1 ? 'unidad' : 'unidades'
  return a
}
function sentenceCase(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}
function fmtQtyDisplay(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString('es-ES', { maximumFractionDigits: 3 })
}
function relativeDay(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (diffDays === 0) return 'hoy'
  if (diffDays === 1) return 'ayer'
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}
function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso: string | null): string {
  if (!iso) return DASH
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface ReceiptOfficeReviewProps {
  accountId: string
  receiptId: string
  onBack: () => void
  onSaved: (message?: string) => void
}

export default function ReceiptOfficeReview({ accountId, receiptId, onBack, onSaved }: ReceiptOfficeReviewProps) {
  const [receipt, setReceipt] = useState<GoodsReceipt | null>(null)
  const [lines, setLines] = useState<GoodsReceiptLine[]>([])
  const [docTotal, setDocTotal] = useState<OcrDocTotals | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locationName, setLocationName] = useState<string>('')
  const [itemInfo, setItemInfo] = useState<Record<string, { name: string; baseUnitAbbr: string | null }>>({})
  const [formatNames, setFormatNames] = useState<Record<string, string>>({})
  const [catalog, setCatalog] = useState<SupplierCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [closedPeriodNote, setClosedPeriodNote] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // ── Carga ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const [r, ls, sups] = await Promise.all([
          getGoodsReceiptById(receiptId),
          listGoodsReceiptLines(receiptId),
          listSuppliers(accountId),
        ])
        if (cancelled) return
        if (!r) throw new Error('No se pudo recuperar la recepción.')
        setReceipt(r)
        setLines(ls)
        setSuppliers(sups)

        const [locs, cat] = await Promise.all([
          listSupplyLocations(accountId),
          r.supplierId ? getSupplierCatalog(accountId, r.supplierId, r.locationId) : Promise.resolve([]),
        ])
        if (cancelled) return
        setLocationName(locs.find(l => l.id === r.locationId)?.name ?? '')
        setCatalog(cat)

        if (r.aiSessionId) {
          try { setDocTotal(await getReceiptDocTotal(r.aiSessionId)) }
          catch (e) { console.error('ReceiptOfficeReview: no se pudo leer el total del albarán', e) }
        } else {
          setDocTotal(null)
        }

        const itemIds = ls.map(l => l.recipeItemId).filter((x): x is string => !!x)
        const formatIds = ls.map(l => l.purchaseFormatId).filter((x): x is string => !!x)
        const [info, fmts] = await Promise.all([
          getRecipeItemDisplayInfo(itemIds),
          getPurchaseFormatNames(formatIds),
        ])
        if (cancelled) return
        setItemInfo(info)
        setFormatNames(fmts)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo abrir la recepción.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [accountId, receiptId, reloadTick])

  const supplierName = useMemo(
    () => suppliers.find(s => s.id === receipt?.supplierId)?.name ?? '',
    [suppliers, receipt],
  )

  // ── Reordenar: lo decidido primero (resuelta · dudosa), luego lo pendiente ──
  const ordered = useMemo(
    () => [...lines].sort((a, b) => CLASS_RANK[classify(a)] - CLASS_RANK[classify(b)] || a.position - b.position),
    [lines],
  )

  const pendingLines = useMemo(() => lines.filter(l => classify(l) === 'sin_decidir'), [lines])
  const decidedInStockCount = useMemo(
    () => lines.filter(l => { const c = classify(l); return c === 'resuelta' || c === 'dudosa' }).length,
    [lines],
  )
  const verifiedSum = useMemo(
    () => lines.reduce((sum, l) => {
      const c = classify(l)
      if (c !== 'resuelta' && c !== 'dudosa') return sum
      const amt = l.docAmount ?? (l.unitCost != null ? l.unitCost * l.qtyReceived : 0)
      return sum + amt
    }, 0),
    [lines],
  )
  // ENCARGO CODE (14/08) fix/recepcion-iva-y-enlace-pedido, §A.2 — el cuadre
  // compara contra la BASE imponible (lo que Folvy cuenta: qty × coste, sin
  // IVA), nunca contra el total con IVA. Verificado contra ALB-00115:
  // sum(doc_amount) = sum(qty_received × unit_cost) = tax_base_total exacto
  // (550,48 €) — doc_amount por línea YA es sin IVA. Si el albarán solo trae
  // grand_total (sin base), no se inventa un descuadre: docOnlyGrandTotal
  // avisa de qué se compara, sin marcar diferencia.
  const docBaseTotal = docTotal?.base ?? null
  const docOnlyGrandTotal = docTotal != null && docBaseTotal == null && docTotal.grandTotal != null
  const totalSum = useMemo(() => {
    if (docBaseTotal != null) return docBaseTotal
    return lines.reduce((sum, l) => sum + (l.docAmount ?? 0), 0)
  }, [docBaseTotal, lines])
  const missingSum = docOnlyGrandTotal ? 0 : Math.max(0, totalSum - verifiedSum)
  const allDecided = pendingLines.length === 0

  // ── Picker de artículo (se reutiliza en las 3 clases: cambiar/dudosa/sin decidir) ──
  const [pickerLineId, setPickerLineId] = useState<string | null>(null)
  const [pickerCreateOpen, setPickerCreateOpen] = useState(false)
  const [pickerCandidates, setPickerCandidates] = useState<LineMatchCandidate[]>([])
  useEffect(() => {
    if (!pickerLineId) { setPickerCandidates([]); return }
    const line = lines.find(l => l.id === pickerLineId)
    if (!line) return
    let cancelled = false
    matchReceiptLine(accountId, line.productName, line.supplierCode)
      .then(cands => { if (!cancelled) setPickerCandidates(cands) })
      .catch(() => { if (!cancelled) setPickerCandidates([]) })
    return () => { cancelled = true }
  }, [pickerLineId, accountId, lines])

  function openPicker(lineId: string, createOpen = false) {
    setPickerCreateOpen(createOpen)
    setPickerLineId(lineId)
  }

  // Resuelve purchaseFormatId/qtyInBase para un artículo (elegido o recién
  // creado) desde el catálogo del proveedor de ESTE albarán. Si el artículo no
  // tiene ningún formato con este proveedor, se crea un formato 1:1 con la
  // unidad base (mismo criterio, sin inventar una equivalencia que nadie dio).
  async function resolveFormatForItem(itemId: string): Promise<{ formatId: string | null; qtyInBaseFactor: number | null }> {
    const entry = catalog.find(c => c.recipeItemId === itemId)
    if (entry?.purchaseFormatId && entry.formatQtyInBase) {
      return { formatId: entry.purchaseFormatId, qtyInBaseFactor: entry.formatQtyInBase }
    }
    try {
      const fmt = await createPurchaseFormat({
        accountId, itemId, name: 'Ud', qtyInBase: 1, source: 'manual', needsReview: false,
      })
      return { formatId: fmt.id, qtyInBaseFactor: 1 }
    } catch (e) {
      console.error('ReceiptOfficeReview: no se pudo resolver/crear formato', e)
      return { formatId: null, qtyInBaseFactor: null }
    }
  }

  async function persistLineResolution(
    line: GoodsReceiptLine,
    args: { recipeItemId: string | null; purchaseFormatId: string | null; qtyReceived: number; unitCost: number | null; mapSource: string | null },
  ) {
    setSaving(true); setError(null)
    try {
      const res = await adjustGoodsReceiptLine(line.id, {
        recipeItemId: args.recipeItemId,
        purchaseFormatId: args.purchaseFormatId,
        qtyReceived: args.qtyReceived,
        unitCost: args.unitCost,
        discrepancyReason: line.discrepancyReason,
        notGoods: false,
        notGoodsKind: null,
      })
      await updateGoodsReceiptLine(line.id, {
        mapSource: args.mapSource,
        mapNeedsReview: false,
        flaggedForOffice: false,
      })
      if (res.closedPeriodNote) setClosedPeriodNote(res.closedPeriodNote)
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la línea.')
    } finally {
      setSaving(false)
    }
  }

  async function handlePickerChoose(recipeItemId: string, _name: string, _semaphore: 'green' | 'yellow' | null, matchType: string | null) {
    const line = lines.find(l => l.id === pickerLineId)
    setPickerLineId(null)
    if (!line) return
    const { formatId, qtyInBaseFactor } = await resolveFormatForItem(recipeItemId)
    const qty = line.qtyReceived > 0 ? line.qtyReceived : (line.docQty ?? 1)
    const unitCost = qtyInBaseFactor && line.docAmount != null ? line.docAmount / qty : (line.unitCost ?? null)
    await persistLineResolution(line, {
      recipeItemId, purchaseFormatId: formatId, qtyReceived: qty, unitCost,
      mapSource: matchType ?? 'manual',
    })
  }

  // "Sí, es esta" (dudosa): nada cambia en el stock, solo se levanta la duda.
  async function handleConfirmDudosa(line: GoodsReceiptLine) {
    setSaving(true); setError(null)
    try {
      await updateGoodsReceiptLine(line.id, { mapNeedsReview: false, flaggedForOffice: false })
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar la línea.')
    } finally {
      setSaving(false)
    }
  }

  // "No es mercancía" (sin decidir): reversa si había algo posteado, no repostea.
  const [notGoodsLineId, setNotGoodsLineId] = useState<string | null>(null)
  async function handleNotGoods(line: GoodsReceiptLine, kind: string) {
    setNotGoodsLineId(null)
    setSaving(true); setError(null)
    try {
      await adjustGoodsReceiptLine(line.id, {
        recipeItemId: null,
        purchaseFormatId: null,
        qtyReceived: line.qtyReceived,
        unitCost: null,
        discrepancyReason: line.discrepancyReason,
        notGoods: true,
        notGoodsKind: kind,
      })
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar la línea.')
    } finally {
      setSaving(false)
    }
  }

  // ── "Cambiar" (resuelta): mini editor de cantidad/coste con motivo tipificado ──
  const [editLineId, setEditLineId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editCost, setEditCost] = useState('')
  const [editReason, setEditReason] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  function openEditor(line: GoodsReceiptLine) {
    setEditLineId(line.id)
    setEditQty(numToInputStr(line.qtyReceived))
    setEditCost(line.unitCost != null ? numToInputStr(line.unitCost) : '')
    setEditReason(null)
    setEditError(null)
  }
  function closeEditor() {
    setEditLineId(null); setEditError(null)
  }
  async function saveEditor(line: GoodsReceiptLine) {
    const newQty = parseNum(editQty)
    if (newQty === null) { setEditError('Pon una cantidad. Una casilla vacía no es cero.'); return }
    const newCost = parseNum(editCost)
    const qtyChanged = newQty !== line.qtyReceived
    if (qtyChanged && !editReason) { setEditError('Elige un motivo para el cambio de cantidad.'); return }
    setSaving(true); setError(null)
    try {
      const res = await adjustGoodsReceiptLine(line.id, {
        recipeItemId: line.recipeItemId,
        purchaseFormatId: line.purchaseFormatId,
        qtyReceived: newQty,
        unitCost: newCost,
        discrepancyReason: qtyChanged && editReason ? OFFICE_QTY_REASON_PREFIX + editReason : line.discrepancyReason,
        notGoods: false,
        notGoodsKind: null,
      })
      if (res.closedPeriodNote) setClosedPeriodNote(res.closedPeriodNote)
      setEditLineId(null)
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'No se pudo guardar el cambio.')
    } finally {
      setSaving(false)
    }
  }

  // ── Cierre ───────────────────────────────────────────────────────────
  async function handleClose() {
    if (!receipt || !allDecided) return
    setSaving(true); setError(null)
    try {
      await confirmReceipt(receipt.id)
      onSaved(`Recepción ${receipt.code ?? ''} verificada y cerrada.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar el albarán.')
      setSaving(false)
    }
  }
  function handleLeaveHalfway() {
    onSaved(receipt?.code ? `${receipt.code}: cambios guardados, sigue pendiente de verificar.` : undefined)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…
      </div>
    )
  }
  if (!receipt) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft size={16} /> Volver
        </button>
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error ?? 'No se pudo abrir la recepción.'}</div>
      </div>
    )
  }

  const pickerLine = pickerLineId ? lines.find(l => l.id === pickerLineId) ?? null : null

  return (
    <div className="max-w-3xl mx-auto space-y-3.5">
      <button type="button" onClick={onBack} disabled={saving}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50">
        <ArrowLeft size={16} /> Volver
      </button>

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}
      {closedPeriodNote && (
        <div className="p-3 rounded-md bg-accent-bg text-accent border border-accent/20 text-sm">{closedPeriodNote}</div>
      )}

      {/* ══ CABECERA ══ */}
      <div className="bg-card border border-border-default rounded-lg px-5 py-4.5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-display font-semibold tracking-tight text-text-primary">
              Albarán {receipt.code ?? ''} · {supplierName}
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              {receipt.createdByName ?? 'Alguien'} lo recibió {relativeDay(receipt.receivedAt)} a las {fmtTime(receipt.receivedAt)} en {locationName}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1 rounded-full bg-success-bg text-success border border-success/20">
            ✓ La mercancía ya está en el almacén
          </span>
        </div>
        <div className="flex gap-6 flex-wrap mt-3.5 pt-3.5 border-t border-border-default">
          <div>
            <div className="text-xs text-text-secondary">Fecha del albarán</div>
            <div className="text-sm text-text-primary font-medium">{fmtDate(receipt.receiptDate)}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">Nº de albarán</div>
            <div className="text-sm text-text-primary font-medium">{receipt.supplierDocNumber ?? DASH}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">Total del papel (base)</div>
            <div className="text-sm text-text-primary font-medium">
              {isNum(docBaseTotal) ? fmtMoney(docBaseTotal) : isNum(docTotal?.grandTotal) ? `${fmtMoney(docTotal!.grandTotal!)} (con IVA)` : DASH}
            </div>
            {isNum(docBaseTotal) && isNum(docTotal?.tax) && isNum(docTotal?.grandTotal) && (
              <div className="text-xs text-text-secondary mt-0.5">
                IVA {fmtMoney(docTotal!.tax!)} · total {fmtMoney(docTotal!.grandTotal!)}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-text-secondary">Tu trabajo aquí</div>
            <div className="text-sm text-text-primary font-medium">Verificar, no recontar</div>
          </div>
        </div>
      </div>

      {/* ══ PROGRESO ══ */}
      <div className={`rounded-lg border px-4 py-3 flex items-center gap-2.5 ${allDecided ? 'bg-success-bg border-success/30' : 'bg-warning-bg border-warning/30'}`}>
        <div>
          <div className="font-semibold text-base text-text-primary">
            {allDecided ? `Las ${lines.length} líneas están decididas` : `Faltan ${pendingLines.length} de ${lines.length} líneas por decidir`}
          </div>
          {!allDecided && decidedInStockCount > 0 && (
            <div className="text-sm text-text-primary mt-0.5">
              {decidedInStockCount === 1
                ? 'La primera está bien y no tienes que tocarla.'
                : `Las ${decidedInStockCount} primeras están bien y no tienes que tocarlas.`}
            </div>
          )}
        </div>
      </div>

      {/* ══ LÍNEAS ══ */}
      <div className="flex flex-col gap-2">
        {ordered.map(l => {
          const cls = classify(l)
          if (cls === 'resuelta') return <ResueltaRow key={l.id} line={l} itemInfo={itemInfo} formatNames={formatNames} saving={saving} isEditing={editLineId === l.id} editQty={editQty} editCost={editCost} editReason={editReason} editError={editError} onOpenEditor={() => openEditor(l)} onCloseEditor={closeEditor} onSetQty={setEditQty} onSetCost={setEditCost} onSetReason={setEditReason} onSave={() => saveEditor(l)} onChangeArticle={() => openPicker(l.id)} />
          if (cls === 'dudosa') return <DudosaRow key={l.id} line={l} itemInfo={itemInfo} formatNames={formatNames} saving={saving} onConfirm={() => handleConfirmDudosa(l)} onChangeArticle={() => openPicker(l.id)} />
          if (cls === 'not_goods') return <NotGoodsRow key={l.id} line={l} />
          return (
            <SinDecidirRow key={l.id} line={l} saving={saving}
              onSearch={() => openPicker(l.id, false)}
              onCreate={() => openPicker(l.id, true)}
              notGoodsOpen={notGoodsLineId === l.id}
              onToggleNotGoods={() => setNotGoodsLineId(n => n === l.id ? null : l.id)}
              onPickNotGoods={kind => handleNotGoods(l, kind)}
            />
          )
        })}
      </div>

      {/* ══ PIE ══ */}
      <div className="bg-card border border-border-default rounded-lg px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-text-secondary tabular-nums">
          Lo que has verificado suma
          <span className="block text-lg font-display font-semibold text-text-primary">{fmtMoney(verifiedSum)} de {fmtMoney(totalSum)}</span>
          {docOnlyGrandTotal && (
            <div className="text-xs mt-0.5">
              El albarán solo da el total con IVA ({fmtMoney(docTotal!.grandTotal!)}) — comparo con lo que cuentas sin IVA.
            </div>
          )}
          {!allDecided && !docOnlyGrandTotal && <>faltan {fmtMoney(missingSum)} en las {pendingLines.length} línea{pendingLines.length === 1 ? '' : 's'} sin decidir</>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleLeaveHalfway} disabled={saving}
            className="px-3 py-2 rounded-md text-sm text-text-secondary border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
            Dejar a medias
          </button>
          <button type="button" onClick={handleClose} disabled={!allDecided || saving}
            title={!allDecided ? `Faltan por decidir: ${pendingLines.map(l => itemInfo[l.recipeItemId ?? '']?.name ?? sentenceCase(l.productName)).join(', ')}` : undefined}
            className="min-h-close-desktop px-6 rounded-lg text-base font-bold bg-success text-text-on-accent disabled:bg-border-default disabled:text-text-secondary disabled:cursor-not-allowed transition-base">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificado — cerrar albarán'}
          </button>
        </div>
        <p className="text-sm text-text-secondary w-full">
          El botón se enciende cuando las {lines.length} líneas tengan decisión. Ninguna se pierde en silencio:
          o entra al almacén, o dices tú que no es mercancía.
        </p>
      </div>

      {pickerLine && (
        <LineMatchPicker
          accountId={accountId}
          rawText={pickerLine.rawText ?? pickerLine.productName}
          supplierCode={pickerLine.supplierCode}
          candidates={pickerCandidates}
          currentRecipeItemId={pickerLine.recipeItemId}
          createdBy={null}
          createdByName={null}
          initialCreateOpen={pickerCreateOpen}
          onChoose={handlePickerChoose}
          onClear={() => setPickerLineId(null)}
          onClose={() => setPickerLineId(null)}
        />
      )}
    </div>
  )
}

// ── Fila CLASE 1 · resuelta ────────────────────────────────────────────
function ResueltaRow({
  line, itemInfo, formatNames, saving, isEditing, editQty, editCost, editReason, editError,
  onOpenEditor, onCloseEditor, onSetQty, onSetCost, onSetReason, onSave, onChangeArticle,
}: {
  line: GoodsReceiptLine
  itemInfo: Record<string, { name: string; baseUnitAbbr: string | null }>
  formatNames: Record<string, string>
  saving: boolean
  isEditing: boolean
  editQty: string
  editCost: string
  editReason: string | null
  editError: string | null
  onOpenEditor: () => void
  onCloseEditor: () => void
  onSetQty: (v: string) => void
  onSetCost: (v: string) => void
  onSetReason: (v: string) => void
  onSave: () => void
  onChangeArticle: () => void
}) {
  const info = line.recipeItemId ? itemInfo[line.recipeItemId] : undefined
  const name = info?.name ?? sentenceCase(line.productName)
  const formatName = line.purchaseFormatId ? formatNames[line.purchaseFormatId] : null
  const qtyInBase = line.qtyInBase ?? 0
  const perUnit = qtyInBase > 0 ? (line.docAmount ?? (line.unitCost ?? 0) * line.qtyReceived) / qtyInBase : null
  const uNoun = unitNoun(info?.baseUnitAbbr ?? null, qtyInBase)

  if (isEditing) {
    const qtyChanged = parseNum(editQty) !== null && parseNum(editQty) !== line.qtyReceived
    return (
      <div className="rounded-lg border border-border-default bg-card px-4 py-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text-primary">{name}</span>
          <button type="button" onClick={onChangeArticle} disabled={saving} className="text-xs font-medium text-accent hover:underline disabled:opacity-50">Cambiar artículo</button>
        </div>
        <div className="flex gap-3 flex-wrap">
          <label className="text-xs text-text-secondary">
            Cantidad ({formatName ?? 'formato'})
            <input type="text" value={editQty} onChange={e => onSetQty(e.target.value)} disabled={saving}
              className="mt-0.5 block w-28 px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label className="text-xs text-text-secondary">
            Coste del {formatName ?? 'formato'}
            <input type="text" value={editCost} onChange={e => onSetCost(e.target.value)} disabled={saving}
              className="mt-0.5 block w-28 px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
        </div>
        {qtyChanged && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-text-secondary">Motivo:</span>
            {OFFICE_QTY_REASONS.map(r => (
              <button key={r} type="button" disabled={saving} onClick={() => onSetReason(r)}
                className={`px-2 py-1 rounded-md text-xs font-medium border transition-base disabled:opacity-50 ${editReason === r ? 'border-accent bg-accent-bg text-accent' : 'border-border-default bg-page text-text-primary hover:bg-card'}`}>
                {r}
              </button>
            ))}
          </div>
        )}
        {editError && <p className="text-xs text-danger">{editError}</p>}
        <div className="flex items-center gap-2">
          <button type="button" onClick={onSave} disabled={saving}
            className="px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">Guardar</button>
          <button type="button" onClick={onCloseEditor} disabled={saving}
            className="px-3 py-2 rounded-md text-sm border border-border-default bg-card hover:bg-page disabled:opacity-50">Cancelar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border-default border-l-4 border-l-success bg-card px-4 py-3 flex items-center gap-3">
      <span className="text-success font-bold text-base shrink-0" aria-hidden="true">✓</span>
      <span className="font-semibold text-text-primary shrink-0">{name}</span>
      <span className="text-sm text-text-secondary min-w-0 flex-1">
        {fmtQtyDisplay(line.qtyReceived)} {formatName ? pluralizeEs(formatName, line.qtyReceived) : ''} ·{' '}
        <b className="text-text-primary">{fmtQtyDisplay(qtyInBase)} {uNoun} al almacén</b>
        {line.docAmount != null && <> · {fmtMoney(line.docAmount)}</>}
        {perUnit != null && <> · {fmtMoney(perUnit)} la {unitNoun(info?.baseUnitAbbr ?? null, 1)}</>}
      </span>
      <button type="button" onClick={onOpenEditor} disabled={saving}
        className="shrink-0 min-h-touch px-3.5 rounded-md text-sm font-semibold border border-border-default bg-card text-text-primary hover:bg-page disabled:opacity-50 transition-base">
        Cambiar
      </button>
    </div>
  )
}

// ── Fila CLASE 2 · dudosa ───────────────────────────────────────────────
function DudosaRow({ line, itemInfo, formatNames, saving, onConfirm, onChangeArticle }: {
  line: GoodsReceiptLine
  itemInfo: Record<string, { name: string; baseUnitAbbr: string | null }>
  formatNames: Record<string, string>
  saving: boolean
  onConfirm: () => void
  onChangeArticle: () => void
}) {
  const info = line.recipeItemId ? itemInfo[line.recipeItemId] : undefined
  const name = info?.name ?? sentenceCase(line.productName)
  const shortName = name.split(' ')[0]
  const formatName = line.purchaseFormatId ? formatNames[line.purchaseFormatId] : null
  const qtyInBase = line.qtyInBase ?? 0
  const perUnit = qtyInBase > 0 ? (line.docAmount ?? 0) / qtyInBase : null
  const uNoun = unitNoun(info?.baseUnitAbbr ?? null, qtyInBase)
  const uNounSingular = unitNoun(info?.baseUnitAbbr ?? null, 1)
  const docQty = line.docQty
  const docUdLabel = docQty != null ? (docQty === 1 ? 'ud' : 'uds') : ''

  return (
    <div className="rounded-lg border border-border-default border-l-4 border-l-warning bg-card overflow-hidden">
      <div className="px-4 pt-3.5">
        <div className="text-base font-semibold text-text-primary">{name}</div>
        {(line.rawText || docQty != null || line.docAmount != null) && (
          <div className="text-sm text-text-secondary mt-0.5 tabular-nums">
            El albarán dice:{' '}
            <b className="text-text-primary">
              {line.rawText}{docQty != null ? ` · ${fmtQtyDisplay(docQty)} ${docUdLabel}` : ''}{line.docAmount != null ? ` · ${fmtMoney(line.docAmount)}` : ''}
            </b>
          </div>
        )}
      </div>
      <div className="mx-4 mt-3 px-3.5 py-3 rounded-md bg-warning-bg text-base font-semibold text-text-primary">
        ¿Es esta {shortName} la que tienes tú en el catálogo?
        <span className="block font-normal text-sm text-text-primary mt-1">
          Lo emparejó el sistema por parecido de nombre, no por código. Nadie lo ha confirmado todavía, y ya entró al almacén.
        </span>
      </div>
      {qtyInBase > 0 && line.docAmount != null && (
        <div className="mx-4 mt-2.5 px-3 py-2.5 rounded-md border border-dashed border-border-default bg-page text-sm text-text-secondary tabular-nums">
          {fmtQtyDisplay(line.qtyReceived)} {formatName ? pluralizeEs(formatName, line.qtyReceived) : ''} × {fmtQtyDisplay(qtyInBase / Math.max(line.qtyReceived, 1))} {uNoun} = <b className="text-text-primary">{fmtQtyDisplay(qtyInBase)} {uNoun}</b> · {fmtMoney(line.docAmount)} ÷ {fmtQtyDisplay(qtyInBase)} = <b className="text-text-primary">{perUnit != null ? fmtMoney(perUnit) : DASH} la {uNounSingular}</b>
        </div>
      )}
      <div className="flex gap-2.5 flex-wrap px-4 py-3.5">
        <button type="button" onClick={onConfirm} disabled={saving}
          className="min-h-touch px-4.5 rounded-md text-sm font-semibold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
          Sí, es esta
        </button>
        <button type="button" onClick={onChangeArticle} disabled={saving}
          className="min-h-touch px-4.5 rounded-md text-sm font-semibold border border-border-default bg-card text-text-primary hover:bg-page disabled:opacity-50 transition-base">
          No, es otro artículo
        </button>
      </div>
    </div>
  )
}

// ── Fila CLASE 3 · sin decidir ───────────────────────────────────────────
function SinDecidirRow({ line, saving, onSearch, onCreate, notGoodsOpen, onToggleNotGoods, onPickNotGoods }: {
  line: GoodsReceiptLine
  saving: boolean
  onSearch: () => void
  onCreate: () => void
  notGoodsOpen: boolean
  onToggleNotGoods: () => void
  onPickNotGoods: (kind: string) => void
}) {
  const name = sentenceCase(line.productName)
  const docQty = line.docQty
  const docUdLabel = docQty != null ? (docQty === 1 ? 'ud' : 'uds') : ''
  return (
    <div className="rounded-lg border border-border-default border-l-4 border-l-accent bg-card overflow-hidden">
      <div className="px-4 pt-3.5">
        <div className="text-base font-semibold text-text-primary">{name}</div>
        {(line.rawText || docQty != null || line.docAmount != null) && (
          <div className="text-sm text-text-secondary mt-0.5 tabular-nums">
            El albarán dice:{' '}
            <b className="text-text-primary">
              {line.rawText}{docQty != null ? ` · ${fmtQtyDisplay(docQty)} ${docUdLabel}` : ''}{line.docAmount != null ? ` · ${fmtMoney(line.docAmount)}` : ''}
            </b>
          </div>
        )}
      </div>
      <div className="mx-4 mt-3 px-3.5 py-3 rounded-md bg-accent-bg text-base font-semibold text-text-primary">
        Esto no lo tienes en el catálogo. ¿Qué hacemos?
        <span className="block font-normal text-sm text-text-primary mt-1">
          No ha entrado al almacén. Si lo dejas así, estos {line.docAmount != null ? fmtMoney(line.docAmount) : DASH} de género no aparecerán en tu inventario ni en tu coste.
        </span>
      </div>
      {!notGoodsOpen ? (
        <div className="flex gap-2.5 flex-wrap px-4 py-3.5">
          <button type="button" onClick={onSearch} disabled={saving}
            className="min-h-touch px-4.5 rounded-md text-sm font-semibold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            Buscar en mi catálogo
          </button>
          <button type="button" onClick={onCreate} disabled={saving}
            className="min-h-touch px-4.5 rounded-md text-sm font-semibold border border-border-default bg-card text-text-primary hover:bg-page disabled:opacity-50 transition-base">
            Crear artículo nuevo
          </button>
          <button type="button" onClick={onToggleNotGoods} disabled={saving}
            className="min-h-touch px-3.5 rounded-md text-sm text-text-secondary border border-transparent hover:border-border-default hover:bg-page disabled:opacity-50 transition-base">
            No es mercancía (portes, envases…)
          </button>
        </div>
      ) : (
        <div className="px-4 py-3.5 space-y-2">
          <p className="text-xs text-text-secondary">¿Qué es?</p>
          <div className="flex gap-1.5 flex-wrap">
            {NOT_GOODS_KINDS.map(k => (
              <button key={k.value} type="button" disabled={saving} onClick={() => onPickNotGoods(k.value)}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-border-default bg-page text-text-primary hover:bg-card disabled:opacity-50 transition-base">
                {k.label}
              </button>
            ))}
            <button type="button" onClick={onToggleNotGoods} disabled={saving}
              className="px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary disabled:opacity-50">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Fila "no es mercancía" ya decidida (sin ejemplo en la maqueta — colapsada
// como la resuelta, pero neutra: no es un tick de éxito, es una exclusión) ──
function NotGoodsRow({ line }: { line: GoodsReceiptLine }) {
  const kindLabel = NOT_GOODS_KINDS.find(k => k.value === line.notGoodsKind)?.label ?? line.notGoodsKind ?? 'otro'
  return (
    <div className="rounded-lg border border-border-default border-l-4 border-l-border-default bg-card px-4 py-3 flex items-center gap-3">
      <span className="text-text-secondary shrink-0">—</span>
      <span className="text-sm text-text-secondary min-w-0 flex-1">
        {sentenceCase(line.productName)} · No es mercancía ({kindLabel}){line.docAmount != null ? ` · ${fmtMoney(line.docAmount)}` : ''}
      </span>
    </div>
  )
}
