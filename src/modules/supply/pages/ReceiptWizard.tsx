// src/modules/supply/pages/ReceiptWizard.tsx
//
// ENCARGO CODE (13/08) feat/recepcion-v2-asistente, Tramo A — el asistente de
// recepción: pantalla móvil para QUIEN RECIBE, arrancada del albarán escaneado
// (ReceiptScanPanel → onCreateReceipt). Sustituye, solo para este camino, al
// GoodsReceiptForm grande — que sigue siendo el camino para pedido/manual/
// revisión de oficina (ver claude_folvy_recepcion_pantalla_diseno_20260813.md).
//
// Diseño (§3, §5):
//   · Sin teclado para lo resuelto: contador ±60px, número grande.
//   · Lo resuelto se colapsa a una frase con tic verde. Lo no reconocido pide
//     acción con botones grandes ("¿Qué es esto?" → buscar/crear).
//   · Se pide el IMPORTE TOTAL de la línea (el número impreso en el albarán),
//     nunca el €/unidad — unit_cost se deriva (total ÷ cantidad) antes de
//     guardar. Elimina la trampa que ya duplicó un coste real.
//   · €/unidad resultante SIEMPRE visible, recalculado en vivo; rojo si es
//     implausible frente al precio de referencia del proveedor — AVISA, no
//     bloquea (el bloqueo con pregunta de dos botones es cosa de la ficha del
//     ingrediente / oficina, no de este asistente).
//   · ⚑ "que lo mire la oficina" en CADA línea: la única forma de terminar sin
//     resolver algo. El trabajador SIEMPRE completa la recepción.
//   · El stock entra al pulsar "Recibir y meter al stock" (receive_goods_receipt),
//     no al confirmar la oficina — decisión ya tomada en el diseño rector.
//
// Alcance deliberado (v1, ver informe del encargo): sin pedido enlazado (ese
// camino sigue en OrderReceiveFlow/GoodsReceiptForm, donde el formato ya viene
// dado); si el artículo casado no tiene NINGÚN formato de compra, la línea no
// puede entrar a stock — se marca ⚑ automáticamente y lo resuelve oficina (no
// se construye aquí el asistente de creación de formato, ya grande en
// GoodsReceiptForm). Proveedor/local sin casar: se guarda tal cual (null /
// local operativo), editable después desde "Anular y corregir".

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, AlertTriangle, Flag, Minus, Plus, Loader2, ImageIcon, Search, HelpCircle } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { listFormatsByItem } from '@/modules/kitchen/services/purchaseFormatService'
import type { PurchaseFormat } from '@/types/kitchen'
import { buildFormatLabel } from '@/modules/supply/services/supplierCatalogService'
import ReceiptPhotoViewer from '@/modules/supply/components/ReceiptPhotoViewer'
import LineMatchPicker from '@/modules/supply/pages/LineMatchPicker'
import type { OcrPrefill } from '@/modules/supply/pages/GoodsReceiptForm'
import {
  createGoodsReceipt,
  createGoodsReceiptLine,
  receiveGoodsReceipt,
  matchReceiptLine,
  getItemBaseUnit,
  getSupplierFormatPrices,
  priceAlertFor,
  qtyInBaseFromFormat,
  type LineMatchCandidate,
  type BaseUnitInfo,
} from '@/modules/supply/services/goodsReceiptService'

interface ReceiptWizardProps {
  accountId: string
  locationId: string | null
  ocrPrefill: OcrPrefill
  onBack: () => void
  onDone: (message?: string) => void
}

interface WizardLine {
  key: string
  manual: boolean               // añadida a mano ("Añadir artículo"), no viene del OCR
  rawText: string
  supplierCode: string | null
  albaranQty: number | null
  albaranUnit: string | null
  albaranLineAmount: number | null
  lotCode: string | null
  expiryDate: string | null

  recipeItemId: string | null
  matchedName: string | null
  matchSemaphore: 'green' | 'yellow' | null
  matchType: string | null
  matchLoading: boolean
  matchCandidates: LineMatchCandidate[]
  pickerOpen: boolean

  baseUnit: BaseUnitInfo | null
  formats: PurchaseFormat[]
  formatsLoading: boolean
  purchaseFormatId: string | null

  qty: number
  total: string   // IMPORTE TOTAL de la línea (texto editable, es-ES)

  flagged: boolean
}

function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
function fmtMoney(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtHumanPrice(v: number): string {
  return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2 })
}

function lineFromOcr(l: OcrPrefill['lines'][number], i: number): WizardLine {
  return {
    key: `w-${i}`,
    manual: false,
    rawText: l.productName,
    supplierCode: l.supplierCode,
    albaranQty: l.qty,
    albaranUnit: l.albaranUnit ?? null,
    albaranLineAmount: l.lineAmount,
    lotCode: l.lotCode,
    expiryDate: l.expiryDate,
    recipeItemId: null,
    matchedName: null,
    matchSemaphore: null,
    matchType: null,
    matchLoading: true,
    matchCandidates: [],
    pickerOpen: false,
    baseUnit: null,
    formats: [],
    formatsLoading: false,
    purchaseFormatId: null,
    // Punto de partida del contador: lo que dice el albarán, redondeado — el
    // trabajador lo ajusta mirando la caja delante, no confiando en la lectura.
    qty: l.qty != null && l.qty > 0 ? Math.round(l.qty) : 1,
    total: l.lineAmount != null ? l.lineAmount.toLocaleString('es-ES', { useGrouping: false, maximumFractionDigits: 2 }) : '',
    flagged: false,
  }
}

let manualCounter = 0
function blankLine(): WizardLine {
  manualCounter += 1
  return {
    key: `manual-${manualCounter}`,
    manual: true,
    rawText: '',
    supplierCode: null,
    albaranQty: null,
    albaranUnit: null,
    albaranLineAmount: null,
    lotCode: null,
    expiryDate: null,
    recipeItemId: null,
    matchedName: null,
    matchSemaphore: null,
    matchType: null,
    matchLoading: false,
    matchCandidates: [],
    pickerOpen: false,
    baseUnit: null,
    formats: [],
    formatsLoading: false,
    purchaseFormatId: null,
    qty: 1,
    total: '',
    flagged: false,
  }
}

export default function ReceiptWizard({ accountId, locationId, ocrPrefill, onBack, onDone }: ReceiptWizardProps) {
  const { authUserId, userProfile } = useApp()
  const effectiveLocationId = ocrPrefill.locationId || locationId || ''

  const [lines, setLines] = useState<WizardLine[]>(() => ocrPrefill.lines.map(lineFromOcr))
  const [showPhoto, setShowPhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // C2.2.b.1 — casado por línea (misma RPC/memoria que el form grande). Se
  // preselecciona un único candidato verde; el resto se decide a mano.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const l of ocrPrefill.lines.map(lineFromOcr)) {
        if (cancelled) return
        try {
          const cands = await matchReceiptLine(accountId, l.rawText, l.supplierCode)
          if (cancelled) return
          const greens = cands.filter(c => c.semaphore === 'green')
          setLines(prev => prev.map(x => x.key === l.key
            ? {
                ...x, matchLoading: false, matchCandidates: cands,
                ...(greens.length === 1
                  ? { recipeItemId: greens[0].recipeItemId, matchedName: greens[0].name, matchSemaphore: greens[0].semaphore, matchType: greens[0].matchType }
                  : {}),
              }
            : x))
        } catch {
          if (!cancelled) setLines(prev => prev.map(x => x.key === l.key ? { ...x, matchLoading: false } : x))
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Formatos del artículo en cuanto una línea casa. Un solo formato → se
  // preselecciona sola (nada que preguntar); con varios, el trabajador elige.
  useEffect(() => {
    let cancelled = false
    const pending = lines.filter(l => l.recipeItemId && l.formats.length === 0 && !l.formatsLoading)
    if (pending.length === 0) return
    ;(async () => {
      // Marca "cargando" dentro del async: nunca setState síncrono en el
      // cuerpo del efecto (mismo criterio que el resto del fetching de Supply).
      setLines(prev => prev.map(x => pending.some(p => p.key === x.key) ? { ...x, formatsLoading: true } : x))
      for (const l of pending) {
        if (cancelled || !l.recipeItemId) continue
        try {
          const [fmts, base] = await Promise.all([
            listFormatsByItem(l.recipeItemId),
            getItemBaseUnit(l.recipeItemId),
          ])
          const active = fmts.filter(f => f.isActive && f.qtyInBase != null && f.qtyInBase > 0)
          if (cancelled) return
          setLines(prev => prev.map(x => x.key === l.key
            ? {
                ...x, formats: active, formatsLoading: false, baseUnit: base,
                purchaseFormatId: active.length === 1 ? active[0].id : x.purchaseFormatId,
              }
            : x))
        } catch {
          if (!cancelled) setLines(prev => prev.map(x => x.key === l.key ? { ...x, formatsLoading: false } : x))
        }
      }
    })()
    return () => { cancelled = true }
  }, [lines])

  // Precios de referencia del proveedor (€/base por formato) — solo si el
  // proveedor casó. Alimenta el aviso rojo/verde; sin proveedor, no hay con
  // qué comparar y el €/ud se muestra neutro (cero falsos positivos).
  const [formatPrices, setFormatPrices] = useState<Record<string, number>>({})
  useEffect(() => {
    // Sin proveedor casado, resuelve a {} igual, pero SIEMPRE por la vía
    // async — nunca setState síncrono en el cuerpo del efecto.
    const fetchPromise = ocrPrefill.supplierId
      ? getSupplierFormatPrices(accountId, ocrPrefill.supplierId)
      : Promise.resolve({})
    fetchPromise.then(setFormatPrices).catch(() => setFormatPrices({}))
  }, [accountId, ocrPrefill.supplierId])

  function chooseMatch(key: string, recipeItemId: string, name: string, semaphore: 'green' | 'yellow' | null, matchType: string | null) {
    setLines(prev => prev.map(x => x.key === key
      ? { ...x, recipeItemId, matchedName: name, matchSemaphore: semaphore, matchType, formats: [], purchaseFormatId: null, baseUnit: null, pickerOpen: false }
      : x))
  }
  function clearMatch(key: string) {
    setLines(prev => prev.map(x => x.key === key
      ? { ...x, recipeItemId: null, matchedName: null, matchSemaphore: null, matchType: null, formats: [], purchaseFormatId: null, baseUnit: null }
      : x))
  }
  function setQty(key: string, qty: number) {
    setLines(prev => prev.map(x => x.key === key ? { ...x, qty: Math.max(0, qty) } : x))
  }
  function setTotal(key: string, total: string) {
    setLines(prev => prev.map(x => x.key === key ? { ...x, total } : x))
  }
  function setFormat(key: string, purchaseFormatId: string) {
    setLines(prev => prev.map(x => x.key === key ? { ...x, purchaseFormatId } : x))
  }
  function toggleFlag(key: string) {
    setLines(prev => prev.map(x => x.key === key ? { ...x, flagged: !x.flagged } : x))
  }
  function setRawText(key: string, rawText: string) {
    setLines(prev => prev.map(x => x.key === key ? { ...x, rawText } : x))
  }
  function addLine() {
    setLines(prev => [...prev, blankLine()])
  }

  // Resuelta = puede entrar a stock sola (artículo + formato + cantidad>0).
  function isResolved(l: WizardLine): boolean {
    return !!l.recipeItemId && !!l.purchaseFormatId && l.qty > 0
  }
  // Lista para terminar = resuelta, o marcada ⚑ (el trabajador SIEMPRE termina).
  function isReady(l: WizardLine): boolean {
    return isResolved(l) || l.flagged
  }

  const pendingCount = lines.filter(l => !isReady(l)).length
  const flagCount = lines.filter(l => l.flagged).length

  const totalCounted = useMemo(
    () => lines.reduce((sum, l) => { const t = parseNum(l.total); return t != null ? sum + t : sum }, 0),
    [lines],
  )
  const anyTotal = lines.some(l => parseNum(l.total) != null)
  const docTotal = ocrPrefill.docTotal
  const shortfall = docTotal != null && anyTotal ? Math.round((docTotal - totalCounted) * 100) / 100 : null

  const canSubmit = lines.length > 0 && pendingCount === 0 && !!effectiveLocationId && !saving

  async function handleReceive() {
    if (!canSubmit) return
    setSaving(true); setError(null)
    try {
      const receipt = await createGoodsReceipt({
        accountId,
        locationId: effectiveLocationId,
        supplierId: ocrPrefill.supplierId || null,
        supplierDocNumber: ocrPrefill.supplierDocNumber,
        receiptDate: ocrPrefill.receiptDate ?? new Date().toISOString().slice(0, 10),
        source: 'ocr',
        deliveredBy: ocrPrefill.deliveredBy,
        aiSessionId: ocrPrefill.aiSessionId,
        rawDocumentUrl: ocrPrefill.rawDocumentUrl,
        createdBy: authUserId ?? null,
        createdByName: userProfile?.displayName ?? null,
      })

      let position = 0
      for (const l of lines) {
        const resolved = isResolved(l)
        const totalN = parseNum(l.total)
        const unitCost = resolved && totalN != null && l.qty > 0 ? totalN / l.qty : null
        const format = l.formats.find(f => f.id === l.purchaseFormatId)
        const qtyInBase = resolved ? qtyInBaseFromFormat(l.qty, format?.qtyInBase ?? null) : null
        await createGoodsReceiptLine({
          accountId,
          goodsReceiptId: receipt.id,
          recipeItemId: l.recipeItemId,
          productName: l.rawText.trim() || '(sin descripción)',
          rawText: l.manual ? null : l.rawText,
          supplierCode: l.supplierCode,
          qtyReceived: l.qty,
          purchaseFormatId: l.purchaseFormatId || null,
          qtyInBase,
          unitCost,
          lotCode: l.lotCode,
          expiryDate: l.expiryDate,
          docQty: l.albaranQty,
          docAmount: l.albaranLineAmount,
          mapSource: l.recipeItemId ? (l.matchType ?? 'manual') : 'unmapped',
          mapNeedsReview: !resolved || l.matchSemaphore === 'yellow',
          flaggedForOffice: l.flagged,
          position: position++,
        })
      }

      const res = await receiveGoodsReceipt(receipt.id)
      const parts = [`${res.postedLines} línea(s) al almacén`]
      if (flagCount > 0) parts.push(`${flagCount} para que lo mire oficina`)
      if (res.skippedLines > 0) parts.push(`${res.skippedLines} sin postear`)
      onDone(`Recepción ${receipt.code ?? ''} recibida: ${parts.join(' · ')}.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo recibir la mercancía.')
      setSaving(false)
    }
  }

  const activePicker = lines.find(l => l.pickerOpen)

  return (
    <div className="space-y-3 pb-28">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} disabled={saving}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base disabled:opacity-50">
          <ArrowLeft size={16} />
          Volver
        </button>
      </div>

      {/* Cabecera: albarán + proveedor + progreso + ver foto */}
      <div className="rounded-lg border border-border-default bg-card p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-display font-medium text-text-primary truncate">
              Albarán {ocrPrefill.supplierDocNumber ?? ''} · {ocrPrefill.proposedSupplierName ?? 'proveedor sin identificar'}
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              {pendingCount === 0 ? 'Todo listo' : `Falta ${pendingCount} de ${lines.length} línea(s)`}
            </p>
          </div>
          {ocrPrefill.rawDocumentUrl && (
            <button type="button" onClick={() => setShowPhoto(v => !v)}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border-default bg-page text-text-secondary hover:text-text-primary transition-base">
              <ImageIcon size={14} /> {showPhoto ? 'Ocultar foto' : 'Ver foto'}
            </button>
          )}
        </div>
        {showPhoto && <div className="mt-3"><ReceiptPhotoViewer path={ocrPrefill.rawDocumentUrl} /></div>}
      </div>

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {/* Líneas */}
      <div className="space-y-2.5">
        {lines.map(l => (
          <WizardLineCard
            key={l.key}
            line={l}
            formatPrices={formatPrices}
            onQty={n => setQty(l.key, n)}
            onTotal={v => setTotal(l.key, v)}
            onFormat={id => setFormat(l.key, id)}
            onFlag={() => toggleFlag(l.key)}
            onOpenPicker={() => setLines(prev => prev.map(x => ({ ...x, pickerOpen: x.key === l.key })))}
            onRawText={v => setRawText(l.key, v)}
          />
        ))}
      </div>

      <button type="button" onClick={addLine} disabled={saving}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border border-dashed border-border-default text-text-secondary hover:text-text-primary hover:bg-page transition-base disabled:opacity-50">
        <Plus size={15} /> Añadir artículo
      </button>

      {/* Cuadre + terminar — fijo abajo, como el mockup del diseño */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border-default bg-card p-3 space-y-2 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        {docTotal != null && anyTotal && (
          <div className="text-sm text-center">
            {shortfall !== null && Math.abs(shortfall) > 0.01 ? (
              <span className="text-danger">
                Albarán {fmtMoney(docTotal)} € · contado {fmtMoney(totalCounted)} € · {shortfall > 0 ? `faltan ${fmtMoney(shortfall)} €` : `sobran ${fmtMoney(-shortfall)} €`}
              </span>
            ) : (
              <span className="text-success">Albarán {fmtMoney(docTotal)} € · contado {fmtMoney(totalCounted)} € ✓</span>
            )}
          </div>
        )}
        {flagCount > 0 && (
          <p className="text-xs text-center text-text-secondary">
            <Flag size={12} className="inline mb-0.5 mr-1 text-warning" />
            {flagCount} línea(s) para que lo mire oficina
          </p>
        )}
        <button type="button" onClick={handleReceive} disabled={!canSubmit}
          title={pendingCount > 0 ? `${pendingCount} línea(s) sin resolver — márcalas ⚑ para terminar igualmente` : undefined}
          className="w-full inline-flex items-center justify-center gap-2 h-touch-base rounded-lg text-base font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-base">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check size={18} />}
          Recibir y meter al stock
        </button>
      </div>

      {activePicker && (
        <LineMatchPicker
          accountId={accountId}
          rawText={activePicker.rawText}
          supplierCode={activePicker.supplierCode}
          candidates={activePicker.matchCandidates}
          currentRecipeItemId={activePicker.recipeItemId}
          createdBy={authUserId ?? null}
          createdByName={userProfile?.displayName ?? null}
          onChoose={(id, name, sem, mt) => chooseMatch(activePicker.key, id, name, sem, mt)}
          onClear={() => clearMatch(activePicker.key)}
          onClose={() => setLines(prev => prev.map(x => ({ ...x, pickerOpen: false })))}
        />
      )}
    </div>
  )
}

function WizardLineCard({
  line: l, formatPrices, onQty, onTotal, onFormat, onFlag, onOpenPicker, onRawText,
}: {
  line: WizardLine
  formatPrices: Record<string, number>
  onQty: (n: number) => void
  onTotal: (v: string) => void
  onFormat: (id: string) => void
  onFlag: () => void
  onOpenPicker: () => void
  onRawText: (v: string) => void
}) {
  const resolved = !!l.recipeItemId && !!l.purchaseFormatId
  const format = l.formats.find(f => f.id === l.purchaseFormatId)
  const formatLabel = format ? buildFormatLabel(format.name, format.qtyInBase, l.baseUnit?.abbr ?? null) ?? format.name : null
  const totalN = parseNum(l.total)
  const perBase = resolved && totalN != null && l.qty > 0 && format?.qtyInBase
    ? totalN / (l.qty * format.qtyInBase)
    : null
  const alert = resolved && perBase != null
    ? priceAlertFor({
        unitCost: l.qty > 0 ? totalN! / l.qty : null,
        qtyReceived: l.qty,
        formatQtyInBase: format?.qtyInBase ?? null,
        expectedPerBase: l.purchaseFormatId ? (formatPrices[l.purchaseFormatId] ?? null) : null,
        thresholdPct: 15,
      })
    : null
  const hasReference = l.purchaseFormatId ? formatPrices[l.purchaseFormatId] != null : false

  return (
    <div className={`rounded-xl border p-3.5 ${l.flagged ? 'border-warning bg-warning-bg/40' : 'border-border-default bg-card'}`}>
      {/* Texto literal del albarán, siempre visible como referencia gris */}
      {!l.manual && (
        <p className="text-[11px] text-text-tertiary">
          El albarán dice: <span className="text-text-secondary">{l.rawText}</span>
          {l.albaranQty != null ? ` · ${l.albaranQty}${l.albaranUnit ? ` ${l.albaranUnit}` : ''}` : ''}
        </p>
      )}
      {l.manual && (
        <input type="text" value={l.rawText} onChange={e => onRawText(e.target.value)}
          placeholder="¿Qué falta? descríbelo"
          className="w-full mb-1.5 px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
      )}

      {l.matchLoading ? (
        <p className="mt-1.5 text-sm text-text-secondary inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> buscando…</p>
      ) : !l.recipeItemId ? (
        // ── NO RECONOCIDO: pregunta con botón grande, nunca un enlace de texto ──
        <div className="mt-2 space-y-2">
          <p className="text-sm font-medium text-text-primary flex items-center gap-1.5">
            <HelpCircle size={16} className="text-warning shrink-0" /> ¿Qué es esto?
          </p>
          {l.matchCandidates.filter(c => c.semaphore === 'yellow').slice(0, 1).map(c => (
            <button key={c.recipeItemId} type="button" onClick={onOpenPicker}
              className="w-full text-left px-3 py-2 rounded-lg border border-accent/30 bg-accent-bg text-sm text-text-primary hover:bg-accent-bg/80 transition-base">
              ¿Es <span className="font-medium">{c.name}</span>? — toca para confirmar o buscar otro
            </button>
          ))}
          <button type="button" onClick={onOpenPicker}
            className="w-full inline-flex items-center justify-center gap-1.5 h-touch-base rounded-lg text-sm font-medium border border-border-default bg-page text-text-primary hover:bg-card transition-base">
            <Search size={15} /> Buscar artículo
          </button>
        </div>
      ) : (
        // ── RECONOCIDO: colapsado, nombre grande + ✓ + formato ──
        <div className="mt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Check size={16} className="text-success shrink-0" />
              <span className="text-base font-medium text-text-primary truncate">{l.matchedName}</span>
            </span>
            <button type="button" onClick={onOpenPicker} className="shrink-0 text-xs text-text-secondary hover:text-text-primary underline">
              Cambiar
            </button>
          </div>

          {l.formatsLoading ? (
            <p className="mt-1.5 text-xs text-text-secondary inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> mirando formatos…</p>
          ) : l.formats.length === 0 ? (
            <p className="mt-1.5 text-xs text-warning">Sin formato de compra definido — márcalo ⚑ para que oficina lo resuelva.</p>
          ) : l.formats.length > 1 && !l.purchaseFormatId ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {l.formats.map(f => (
                <button key={f.id} type="button" onClick={() => onFormat(f.id)}
                  className="px-2.5 py-1.5 rounded-md text-xs border border-border-default bg-page text-text-primary hover:bg-card transition-base">
                  {buildFormatLabel(f.name, f.qtyInBase, l.baseUnit?.abbr ?? null) ?? f.name}
                </button>
              ))}
            </div>
          ) : formatLabel ? (
            l.formats.length > 1 ? (
              <button type="button" onClick={() => onFormat('')} className="mt-0.5 text-xs text-text-secondary hover:text-text-primary underline decoration-dotted">
                {formatLabel} · cambiar
              </button>
            ) : (
              <p className="mt-0.5 text-xs text-text-secondary">{formatLabel}</p>
            )
          ) : null}

          {/* Contador ±60px */}
          <div className="mt-2.5 flex items-center justify-center gap-3">
            <button type="button" onClick={() => onQty(l.qty - 1)}
              className="w-[52px] h-[52px] rounded-full border border-border-default bg-page text-text-primary flex items-center justify-center hover:bg-card active:scale-95 transition-base">
              <Minus size={22} />
            </button>
            <span className="text-3xl font-display tabular-nums text-text-primary min-w-[64px] text-center">{l.qty}</span>
            <button type="button" onClick={() => onQty(l.qty + 1)}
              className="w-[52px] h-[52px] rounded-full border border-border-default bg-page text-text-primary flex items-center justify-center hover:bg-card active:scale-95 transition-base">
              <Plus size={22} />
            </button>
          </div>

          {/* Importe TOTAL de la línea — nunca €/unidad */}
          <div className="mt-2.5 flex items-center gap-2">
            <label className="text-xs text-text-secondary shrink-0">Importe de esta línea</label>
            <input type="text" inputMode="decimal" value={l.total} onChange={e => onTotal(e.target.value)}
              placeholder="0,00"
              className="flex-1 px-2.5 py-1.5 text-sm text-right border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            <span className="text-xs text-text-secondary">€</span>
          </div>

          {/* Coste unitario resultante, recalculado en vivo — rojo si es implausible, sin bloquear */}
          {perBase != null && (
            <p className={`mt-1.5 text-xs ${alert ? 'text-danger font-medium' : hasReference ? 'text-success' : 'text-text-secondary'}`}>
              {alert && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}
              → {fmtHumanPrice(perBase)} €/{l.baseUnit?.abbr ?? 'ud'}
              {alert && ` · ${alert.pct > 0 ? '+' : ''}${alert.pct}% sobre lo habitual`}
            </p>
          )}
        </div>
      )}

      <button type="button" onClick={onFlag}
        className={`mt-3 w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border transition-base ${
          l.flagged ? 'border-warning bg-warning text-text-on-accent' : 'border-border-default bg-page text-text-secondary hover:text-text-primary'
        }`}>
        <Flag size={13} /> {l.flagged ? 'Oficina lo revisará' : 'Que lo mire la oficina'}
      </button>
    </div>
  )
}
