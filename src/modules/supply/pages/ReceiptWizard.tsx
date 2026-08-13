// src/modules/supply/pages/ReceiptWizard.tsx
//
// ENCARGO CODE (13/08 noche) feat/recepcion-wizard-una-linea — terminar el
// asistente de recepción: UNA línea por pantalla (no una lista con scroll),
// contar SIEMPRE en el formato físico (packs/cajas/sacos, nunca "192" a
// secas), y acabado comercial ("que lo use una mujer de cocina de 60 años y
// también el CEO"). Construido sobre feat/recepcion-v2-asistente (PR #64) y
// fix/hubrise... no, sobre PR #66 (routing) — el casado, el enrutado del
// pedido, el stock al recibir y la revisión de oficina NO se tocan aquí.
//
// Diseño (claude_folvy_recepcion_pantalla_diseno_20260813.md, §3/§5):
//   · Progreso "Proveedor · N de M" + barra. Nada de otra línea visible.
//   · Se cuenta en el FORMATO en que llega físicamente (pack, caja, saco) —
//     nunca en la unidad base suelta. Si el albarán trae columna de bultos,
//     manda esa; si no, se divide qty_albarán ÷ qty_in_base del formato. Si
//     la división no es exacta, NO se redondea en silencio: se avisa.
//   · Se pide el IMPORTE TOTAL de la línea (el número impreso en el
//     albarán), nunca el €/unidad — unit_cost se deriva antes de guardar.
//   · €/unidad resultante siempre visible, recalculado en vivo; rojo si es
//     implausible — avisa, no bloquea.
//   · "No lo tengo claro — que lo mire la oficina" en CADA línea: la única
//     forma de avanzar sin resolver algo. El trabajador SIEMPRE termina.
//   · El stock entra al pulsar "Recibir y meter al stock" (receive_goods_receipt).
//
// Alcance deliberado (heredado de PR #64, sin cambios): sin pedido enlazado
// (sigue en OrderReceiveFlow/GoodsReceiptForm); sin NINGÚN formato de compra
// para el artículo casado, la línea no puede entrar a stock — se marca ⚑
// automáticamente. Proveedor/local sin casar se guardan tal cual.

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Check, AlertTriangle, Flag, Minus, Plus, Loader2, ImageIcon, Search,
  ChevronRight, PackagePlus,
} from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { listFormatsByItem } from '@/modules/kitchen/services/purchaseFormatService'
import type { PurchaseFormat } from '@/types/kitchen'
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

// De dónde sale el número que ve el trabajador — decide el aviso de "no cuadra".
type QtySource = 'albaran' | 'packages' | 'division' | 'inexact' | 'manual'

interface WizardLine {
  key: string
  manual: boolean               // añadida a mano ("Añadir artículo"), no viene del OCR
  rawText: string
  supplierCode: string | null
  albaranQty: number | null
  albaranPackages: number | null // columna de bultos/cajas del albarán, si la trae — manda sobre la división
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
  qtySource: QtySource
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
function fmtQty(n: number): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 })
}

// Nombre del formato en plural discreto ("Pack" → "packs", "Caja" → "cajas").
// Heurística simple (no pretende ser un motor de gramática): el riesgo de una
// "s" de más es cosmético, nunca de dato.
function pluralFormatName(name: string, qty: number): string {
  const lower = name.trim().toLowerCase()
  if (qty === 1 || lower.endsWith('s')) return lower
  return `${lower}s`
}

// Palabra natural de la unidad base, para la frase de traducción ("→ Entran
// 192 unidades al almacén") — mejor que repetir la abreviatura técnica.
function baseUnitWord(abbr: string | null | undefined): string {
  switch ((abbr ?? '').toLowerCase()) {
    case 'ud': return 'unidades'
    case 'g': return 'gramos'
    case 'kg': return 'kg'
    case 'ml': return 'mililitros'
    case 'l': return 'litros'
    default: return abbr || 'unidades'
  }
}

// ── Cuenta SIEMPRE en el formato físico (§3 del encargo) ────────────────────
// Manda la columna de bultos del albarán si existe (Julio: "si el albarán
// trae columna de packs y de unidades, mandan los packs"). Si no, se divide
// la cantidad del albarán entre el contenido del formato. Si no divide
// exacto, se marca 'inexact' — el número se sugiere (redondeado) pero se
// avisa, nunca se redondea en silencio.
function deriveFormatQty(
  albaranQty: number | null, albaranPackages: number | null, formatQtyInBase: number | null,
): { qty: number; source: QtySource } | null {
  if (formatQtyInBase == null || formatQtyInBase <= 0) return null
  if (albaranPackages != null && albaranPackages > 0) {
    return { qty: Math.round(albaranPackages), source: 'packages' }
  }
  if (albaranQty != null && albaranQty > 0) {
    const divided = albaranQty / formatQtyInBase
    const rounded = Math.max(1, Math.round(divided))
    const exact = Math.abs(divided - rounded) < 0.02
    return { qty: rounded, source: exact ? 'division' : 'inexact' }
  }
  return null
}

function lineFromOcr(l: OcrPrefill['lines'][number], i: number): WizardLine {
  return {
    key: `w-${i}`,
    manual: false,
    rawText: l.productName,
    supplierCode: l.supplierCode,
    albaranQty: l.qty,
    albaranPackages: l.packages ?? null,
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
    // Sin formato conocido todavía: se cuenta en la unidad del ALBARÁN
    // (§3 — "sin formato conocido, se cuenta en la unidad del albarán, y se
    // dice cuál"). En cuanto case el artículo y resuelva un formato, se
    // recalcula a packs/cajas/sacos (ver deriveFormatQty).
    qty: l.qty != null && l.qty > 0 ? Math.round(l.qty) : 1,
    qtySource: 'albaran',
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
    albaranPackages: null,
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
    qtySource: 'manual',
    total: '',
    flagged: false,
  }
}

export default function ReceiptWizard({ accountId, locationId, ocrPrefill, onBack, onDone }: ReceiptWizardProps) {
  const { authUserId, userProfile } = useApp()
  const effectiveLocationId = ocrPrefill.locationId || locationId || ''

  const [lines, setLines] = useState<WizardLine[]>(() => ocrPrefill.lines.map(lineFromOcr))
  // ── Una pantalla por línea: 0..lines.length-1 son líneas; lines.length es
  //    la pantalla final (resumen + Recibir y meter al stock). ──
  const [screenIndex, setScreenIndex] = useState(0)
  const [showPhoto, setShowPhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // C2.2.b.1 — casado por línea (misma RPC/memoria que el form grande). Se
  // preselecciona un único candidato verde; el resto se decide a mano. Corre
  // en segundo plano para TODAS las líneas, aunque el trabajador solo vea la
  // pantalla actual — así al llegar a la línea 4 ya suele estar resuelta.
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
  // preselecciona sola (nada que preguntar) y el contador se recalcula a
  // packs/cajas/sacos; con varios, el trabajador elige (setFormat hace lo mismo).
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
          setLines(prev => prev.map(x => {
            if (x.key !== l.key) return x
            if (active.length !== 1) return { ...x, formats: active, formatsLoading: false, baseUnit: base }
            const derived = deriveFormatQty(x.albaranQty, x.albaranPackages, active[0].qtyInBase)
            return {
              ...x, formats: active, formatsLoading: false, baseUnit: base, purchaseFormatId: active[0].id,
              ...(derived ? { qty: derived.qty, qtySource: derived.source } : {}),
            }
          }))
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
      ? {
          ...x, recipeItemId, matchedName: name, matchSemaphore: semaphore, matchType, pickerOpen: false,
          formats: [], purchaseFormatId: null, baseUnit: null,
          // Nuevo artículo casado → el formato anterior ya no vale; vuelve a
          // contarse en la unidad del albarán hasta que resuelva el nuevo.
          qty: x.albaranQty != null && x.albaranQty > 0 ? Math.round(x.albaranQty) : 1, qtySource: 'albaran',
        }
      : x))
  }
  function clearMatch(key: string) {
    setLines(prev => prev.map(x => x.key === key
      ? {
          ...x, recipeItemId: null, matchedName: null, matchSemaphore: null, matchType: null,
          formats: [], purchaseFormatId: null, baseUnit: null,
          qty: x.albaranQty != null && x.albaranQty > 0 ? Math.round(x.albaranQty) : 1, qtySource: 'albaran',
        }
      : x))
  }
  function setQty(key: string, qty: number) {
    setLines(prev => prev.map(x => x.key === key ? { ...x, qty: Math.max(0, qty), qtySource: 'manual' } : x))
  }
  function setTotal(key: string, total: string) {
    setLines(prev => prev.map(x => x.key === key ? { ...x, total } : x))
  }
  function setFormat(key: string, purchaseFormatId: string) {
    setLines(prev => prev.map(x => {
      if (x.key !== key) return x
      if (!purchaseFormatId) return { ...x, purchaseFormatId: '' }
      const fmt = x.formats.find(f => f.id === purchaseFormatId)
      const derived = fmt ? deriveFormatQty(x.albaranQty, x.albaranPackages, fmt.qtyInBase) : null
      return { ...x, purchaseFormatId, ...(derived ? { qty: derived.qty, qtySource: derived.source } : {}) }
    }))
  }
  function toggleFlag(key: string) {
    setLines(prev => prev.map(x => x.key === key ? { ...x, flagged: !x.flagged } : x))
  }
  function setRawText(key: string, rawText: string) {
    setLines(prev => prev.map(x => x.key === key ? { ...x, rawText } : x))
  }
  function addLine() {
    const bl = blankLine()
    setLines(prev => [...prev, bl])
    // Salta directa a rellenarla — si no, se añade pero nunca se visita en
    // el modelo de una-pantalla-por-línea.
    setScreenIndex(lines.length)
  }

  // Resuelta = puede entrar a stock sola (artículo + formato + cantidad>0).
  function isResolved(l: WizardLine): boolean {
    return !!l.recipeItemId && !!l.purchaseFormatId && l.qty > 0
  }
  // Lista para avanzar = resuelta, o marcada ⚑ (el trabajador SIEMPRE avanza).
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
  const totalScreens = lines.length + 1 // + pantalla final
  const onSummary = screenIndex >= lines.length
  const current = !onSummary ? lines[screenIndex] : null

  function goNext() {
    setScreenIndex(i => Math.min(lines.length, i + 1))
  }
  function goPrev() {
    if (screenIndex === 0) { onBack(); return }
    setScreenIndex(i => Math.max(0, i - 1))
  }

  return (
    <div className="min-h-screen bg-page flex flex-col">
      {/* Cabecera: volver del todo + progreso */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <button type="button" onClick={onBack} disabled={saving} aria-label="Salir del asistente"
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:bg-accent-bg transition-base disabled:opacity-50">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary truncate">
            {ocrPrefill.proposedSupplierName ?? 'Proveedor sin identificar'}
            {' · '}
            {onSummary ? 'resumen' : `${screenIndex + 1} de ${lines.length}`}
          </p>
          <div className="mt-1 h-1.5 rounded-full bg-border-default overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-base"
              style={{ width: `${((screenIndex + 1) / totalScreens) * 100}%` }} />
          </div>
        </div>
        {ocrPrefill.rawDocumentUrl && (
          <button type="button" onClick={() => setShowPhoto(v => !v)} aria-label="Ver foto del albarán"
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:bg-accent-bg transition-base">
            <ImageIcon size={16} />
          </button>
        )}
      </div>

      {showPhoto && (
        <div className="px-4 pb-2"><ReceiptPhotoViewer path={ocrPrefill.rawDocumentUrl} /></div>
      )}

      {error && <div className="mx-4 mb-2 p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {/* Cuerpo: SOLO la línea actual, o el resumen — nunca las dos cosas ni otra línea */}
      <div className="flex-1 px-4 pb-4 flex flex-col">
        {current && (
          <LineScreen
            line={current}
            formatPrices={formatPrices}
            onQty={n => setQty(current.key, n)}
            onTotal={v => setTotal(current.key, v)}
            onFormat={id => setFormat(current.key, id)}
            onFlag={() => toggleFlag(current.key)}
            onOpenPicker={() => setLines(prev => prev.map(x => ({ ...x, pickerOpen: x.key === current.key })))}
            onRawText={v => setRawText(current.key, v)}
          />
        )}
        {onSummary && (
          <SummaryScreen
            docTotal={docTotal} totalCounted={totalCounted} anyTotal={anyTotal} shortfall={shortfall}
            flagCount={flagCount} lineCount={lines.length}
            onAddLine={addLine}
          />
        )}
      </div>

      {/* Navegación fija abajo */}
      <div className="sticky bottom-0 border-t border-border-default bg-card p-3 space-y-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={goPrev} disabled={saving}
            className="shrink-0 h-touch-base px-4 rounded-lg text-sm font-medium border border-border-default bg-card text-text-secondary hover:bg-page transition-base disabled:opacity-40">
            Atrás
          </button>
          {!onSummary ? (
            <button type="button" onClick={goNext} disabled={!current || !isReady(current)}
              title={current && !isReady(current) ? 'Resuelve el artículo o marca "que lo mire la oficina" para seguir' : undefined}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-touch-base rounded-lg text-base font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-base">
              Siguiente <ChevronRight size={18} />
            </button>
          ) : (
            <button type="button" onClick={handleReceive} disabled={!canSubmit}
              title={pendingCount > 0 ? `${pendingCount} línea(s) sin resolver` : undefined}
              className="flex-1 inline-flex items-center justify-center gap-2 h-touch-base rounded-lg text-base font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-base">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check size={18} />}
              Recibir y meter al stock
            </button>
          )}
        </div>
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

// ── Pantalla final: cuadre + marcadas ⚑ + añadir artículo + terminar ────────
function SummaryScreen({
  docTotal, totalCounted, anyTotal, shortfall, flagCount, lineCount, onAddLine,
}: {
  docTotal: number | null
  totalCounted: number
  anyTotal: boolean
  shortfall: number | null
  flagCount: number
  lineCount: number
  onAddLine: () => void
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-6">
      <div className="w-16 h-16 rounded-full bg-accent-bg flex items-center justify-center">
        <Check size={30} className="text-accent" />
      </div>
      <div>
        <h2 className="text-xl font-display font-medium text-text-primary">Todo revisado</h2>
        <p className="text-sm text-text-secondary mt-1">{lineCount} línea(s) del albarán.</p>
      </div>

      {docTotal != null && anyTotal && (
        <div className={`w-full max-w-sm rounded-xl border p-4 ${shortfall !== null && Math.abs(shortfall) > 0.01 ? 'border-danger bg-danger-bg' : 'border-success bg-success-bg'}`}>
          <p className="text-sm text-text-secondary">Albarán</p>
          <p className="text-lg font-display font-medium text-text-primary">{fmtMoney(docTotal)} €</p>
          <p className="text-sm text-text-secondary mt-2">Contado</p>
          <p className="text-lg font-display font-medium text-text-primary">{fmtMoney(totalCounted)} €</p>
          {shortfall !== null && Math.abs(shortfall) > 0.01 ? (
            <p className="mt-2 text-sm font-medium text-danger">
              {shortfall > 0 ? `Faltan ${fmtMoney(shortfall)} €` : `Sobran ${fmtMoney(-shortfall)} €`}
            </p>
          ) : (
            <p className="mt-2 text-sm font-medium text-success">Cuadra ✓</p>
          )}
        </div>
      )}

      {flagCount > 0 && (
        <p className="text-sm text-text-secondary flex items-center gap-1.5">
          <Flag size={14} className="text-warning" /> {flagCount} línea(s) para que lo mire oficina
        </p>
      )}

      <button type="button" onClick={onAddLine}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium border border-dashed border-border-default text-text-secondary hover:text-text-primary hover:bg-card transition-base">
        <PackagePlus size={16} /> Falta un artículo — añadirlo
      </button>
    </div>
  )
}

// ── Pantalla de una línea (el corazón del asistente) ─────────────────────────
function LineScreen({
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
  const totalN = parseNum(l.total)

  // Unidad que se muestra junto al número: la del formato si se conoce, si
  // no la del propio albarán (§3 — "nunca un número a secas").
  const countingUnitLabel = format
    ? pluralFormatName(format.name, l.qty)
    : (l.albaranUnit || 'unidades')

  // Traducción a unidad base ("→ Entran 192 unidades al almacén") — solo
  // tiene sentido si el formato de verdad agrupa más de 1 unidad base.
  const baseTotal = format && format.qtyInBase && format.qtyInBase !== 1 ? l.qty * format.qtyInBase : null

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
    <div className="flex-1 flex flex-col">
      {/* Texto literal del albarán, referencia gris — nunca protagonista */}
      {!l.manual ? (
        <p className="text-xs text-text-tertiary">
          El albarán dice: <span className="text-text-secondary">{l.rawText}</span>
          {l.albaranQty != null ? ` · ${fmtQty(l.albaranQty)}${l.albaranUnit ? ` ${l.albaranUnit}` : ''}` : ''}
        </p>
      ) : (
        <input type="text" value={l.rawText} onChange={e => onRawText(e.target.value)}
          placeholder="¿Qué falta? Descríbelo"
          className="w-full mb-1 px-3 py-2 text-sm border border-border-default rounded-lg bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30" />
      )}

      {l.matchLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-text-tertiary" />
        </div>
      ) : !l.recipeItemId ? (
        // ── NO RECONOCIDO: pregunta grande y centrada, botones debajo ──
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-4">
          <p className="text-xl font-display font-medium text-text-primary">¿Qué es esto?</p>
          <div className="w-full max-w-sm space-y-2.5">
            {l.matchCandidates.filter(c => c.semaphore === 'yellow').slice(0, 1).map(c => (
              <button key={c.recipeItemId} type="button" onClick={onOpenPicker}
                className="w-full text-center px-4 py-3.5 rounded-xl border-2 border-accent bg-accent-bg text-base text-text-primary hover:bg-accent-bg/70 transition-base">
                ¿Es <span className="font-semibold">{c.name}</span>?
              </button>
            ))}
            <button type="button" onClick={onOpenPicker}
              className="w-full inline-flex items-center justify-center gap-2 h-touch-base rounded-xl text-base font-medium border border-border-default bg-card text-text-primary hover:bg-page transition-base">
              <Search size={17} /> Buscar artículo
            </button>
          </div>
        </div>
      ) : (
        // ── RECONOCIDO: nombre grande + ✓, contador con unidad, importe, ⚑ ──
        <div className="flex-1 flex flex-col">
          <div className="mt-3 flex items-start justify-between gap-2">
            <span className="inline-flex items-center gap-2 min-w-0">
              <Check size={20} className="text-success shrink-0" />
              <span className="text-xl font-display font-medium text-text-primary truncate">{l.matchedName}</span>
            </span>
            <button type="button" onClick={onOpenPicker}
              className="shrink-0 text-xs text-text-tertiary hover:text-text-secondary underline">
              Cambiar
            </button>
          </div>

          {l.formatsLoading ? (
            <div className="mt-2 flex justify-center"><Loader2 size={14} className="animate-spin text-text-tertiary" /></div>
          ) : l.formats.length === 0 ? (
            <p className="mt-1.5 text-sm text-warning">Sin formato de compra definido — márcalo abajo para que oficina lo resuelva.</p>
          ) : l.formats.length > 1 && !l.purchaseFormatId ? (
            <div className="mt-2 space-y-1.5">
              <p className="text-sm text-text-secondary text-center">¿En qué viene?</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {l.formats.map(f => (
                  <button key={f.id} type="button" onClick={() => onFormat(f.id)}
                    className="px-3 py-2 rounded-lg text-sm border border-border-default bg-card text-text-primary hover:bg-page transition-base">
                    {f.name}
                    {f.qtyInBase != null && (
                      <span className="text-text-tertiary"> · {fmtQty(f.qtyInBase)} {baseUnitWord(l.baseUnit?.abbr)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : format ? (
            <p className="mt-0.5 text-sm text-text-secondary">
              viene en {pluralFormatName(format.name, 2)} de {fmtQty(format.qtyInBase ?? 0)} {baseUnitWord(l.baseUnit?.abbr)}
              {l.formats.length > 1 && (
                <button type="button" onClick={() => onFormat('')} className="ml-1.5 text-xs text-accent hover:underline">cambiar</button>
              )}
            </p>
          ) : null}

          {/* Aviso de división no exacta — se pregunta, no se redondea en silencio */}
          {l.qtySource === 'inexact' && format && (
            <div className="mt-2 flex items-start gap-1.5 text-xs rounded-lg px-3 py-2 bg-warning-bg text-warning">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              El albarán dice {fmtQty(l.albaranQty ?? 0)} {l.albaranUnit ?? 'ud'} y el formato es de {fmtQty(format.qtyInBase ?? 0)} — no cuadra exacto. Cuenta lo que ves y ajusta.
            </div>
          )}

          {/* Pregunta + contador ±60px, unidad SIEMPRE junto al número */}
          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-4">
            <p className="text-base text-text-secondary">
              ¿Cuántos{format ? ` ${pluralFormatName(format.name, 2)}` : ` ${l.albaranUnit ?? ''}`} han llegado?
            </p>
            <div className="flex items-center justify-center gap-4">
              <button type="button" onClick={() => onQty(l.qty - 1)}
                className="w-[60px] h-[60px] rounded-full border border-border-default bg-card text-text-primary flex items-center justify-center hover:bg-page active:scale-95 transition-base">
                <Minus size={26} />
              </button>
              <div className="min-w-[110px] text-center">
                <span className="text-4xl font-display tabular-nums text-text-primary">{fmtQty(l.qty)}</span>
                <p className="text-sm text-text-secondary mt-0.5">{countingUnitLabel}</p>
              </div>
              <button type="button" onClick={() => onQty(l.qty + 1)}
                className="w-[60px] h-[60px] rounded-full border border-border-default bg-card text-text-primary flex items-center justify-center hover:bg-page active:scale-95 transition-base">
                <Plus size={26} />
              </button>
            </div>
          </div>

          {/* Franja verde: traducción a unidad base */}
          {baseTotal != null && (
            <div className="rounded-lg bg-success-bg px-3 py-2 text-center">
              <p className="text-sm font-medium text-success">
                → Entran {fmtQty(baseTotal)} {baseUnitWord(l.baseUnit?.abbr)} al almacén
                {totalN != null && ` · ${fmtMoney(totalN)} €`}
              </p>
            </div>
          )}

          {/* Importe TOTAL de la línea — el € vive dentro del campo */}
          <div className="mt-3">
            <label className="block text-xs text-text-secondary mb-1">Importe de esta línea (el total que pone el albarán)</label>
            <div className="flex items-center rounded-lg border border-border-default bg-card focus-within:ring-2 focus-within:ring-accent/30">
              <input type="text" inputMode="decimal" value={l.total} onChange={e => onTotal(e.target.value)}
                placeholder="0,00"
                className="flex-1 min-w-0 px-3 py-2.5 text-base text-right bg-transparent text-text-primary focus:outline-none" />
              <span className="pr-3 text-base text-text-secondary">€</span>
            </div>
          </div>

          {/* Coste unitario resultante, recalculado en vivo — rojo si es implausible, sin bloquear */}
          {perBase != null && (
            <p className={`mt-1.5 text-xs text-center ${alert ? 'text-danger font-medium' : hasReference ? 'text-success' : 'text-text-secondary'}`}>
              {alert && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}
              {fmtHumanPrice(perBase)} €/{l.baseUnit?.abbr ?? 'ud'}
              {alert && ` · ${alert.pct > 0 ? '+' : ''}${alert.pct}% sobre lo habitual`}
            </p>
          )}
        </div>
      )}

      <button type="button" onClick={onFlag}
        className={`mt-3 self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-base ${
          l.flagged ? 'bg-warning text-text-on-accent' : 'text-text-tertiary hover:text-text-secondary'
        }`}>
        <Flag size={12} /> {l.flagged ? 'Oficina lo revisará' : 'No lo tengo claro — que lo mire la oficina'}
      </button>
    </div>
  )
}
