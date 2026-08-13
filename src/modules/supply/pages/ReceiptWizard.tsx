// src/modules/supply/pages/ReceiptWizard.tsx
//
// ENCARGO CODE (14/08) feat/recepcion-wizard-acabado — acabado visual. La
// estructura (una línea por pantalla, PR #68) está bien; lo que fallaba era
// CÓMO SE VE: agujero de ~400px con spinner, el contador se pintaba antes de
// saber el formato (192 ud → 8 packs a la vista), gris claro sobre blanco
// ilegible, jerarquía invertida (Siguiente apagado, Cambiar en color), nada
// agrupado, sin franja de resultado. Este encargo NO toca estructura, unidad/
// división, casado ni stock al recibir (PR #64/#66/#68) — solo el render.
//
// Contraste medido antes de tocar nada (WCAG, sobre los colores REALES de
// tailwind.config.js — Julio pidió los tokens del sistema; no todos llegan a
// 4.5:1, y se reporta en vez de parchear con un color suelto):
//   text-secondary #6B7077 / blanco   → 4.99:1  PASA texto normal
//   text-tertiary  #9CA1A8 / blanco   → 2.60:1  FALLA — causa de la queja de
//     Julio ("gris claro sobre blanco"); NO se usa en este fichero para
//     ningún contenido legible, solo texto-secondary o texto-primary.
//   text-warning   #C2890F / blanco   → 3.05:1  solo válido como texto
//     grande/negrita (umbral 3:1) — se usa corto y en negrita, o directo
//     como icono/borde (los bordes solo exigen 3:1, ahí sí cumple).
//   text-success   #1F9D6B / success-bg → 3.05:1  mismo caso: la FRASE
//     dentro de la franja verde va en text-primary (17.96:1), la franja en
//     sí (el fondo) usa success-bg tal como pide el encargo.
//   blanco / fill success #1F9D6B     → 3.45:1  el botón "Siguiente" pasa a
//     fill success + texto claro por decisión explícita de Julio (§4.c); no
//     llega a 4.5:1 de texto normal — declarado aquí, no se inventa un color
//     fuera del sistema para forzarlo. A 17-18px/medio araña el umbral de
//     "texto grande" (3:1) pero conviene que Julio lo sepa.
//
// Diseño (claude_folvy_recepcion_pantalla_diseno_20260813.md + este encargo):
//   · Progreso "Proveedor · N de M" + barra de 5px.
//   · Se cuenta en el FORMATO físico — nunca la unidad base suelta. Si el
//     albarán trae bultos, manda esa columna; si no, se divide. División no
//     exacta → se avisa, nunca se redondea en silencio.
//   · Nunca se pinta el contador antes de saber el formato: esqueleto del
//     tamaño final mientras se resuelve.
//   · Se pide el IMPORTE TOTAL, con la referencia del albarán SIEMPRE visible
//     debajo; si el operario lo cambia, aviso ámbar con la diferencia.
//   · La bandera "que lo mire la oficina" es un botón NEUTRO, nunca de alarma
//     — marcar es la salida correcta, no un error.
//   · "Siguiente" es la acción principal (fill success, ancho completo); si
//     está bloqueado, dice por qué en texto visible, nunca solo un title.

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
  // Por qué no puede avanzar todavía — texto visible, nunca un title mudo
  // (§4.c del encargo: "si está bloqueado, decir por qué").
  function blockedReason(l: WizardLine): string | null {
    if (isReady(l)) return null
    if (l.matchLoading) return 'Un momento, buscando el artículo…'
    if (!l.recipeItemId) return 'Elige el artículo para continuar'
    if (l.formatsLoading) return 'Un momento, mirando el formato…'
    if (l.formats.length > 1 && !l.purchaseFormatId) return 'Elige en qué viene para continuar'
    if (l.formats.length === 0) return 'Sin formato — marca "que lo mire la oficina" para continuar'
    return 'Pon la cantidad para continuar'
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
  const blockReason = current ? blockedReason(current) : null

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
          <div className="mt-1.5 h-[5px] rounded-full bg-border-default overflow-hidden">
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

      {/* Pie: hairline + bandera (en LineScreen) + navegación */}
      <div className="sticky bottom-0 border-t border-border-default bg-card p-3 space-y-2">
        {!onSummary && blockReason && (
          <p className="text-sm text-text-secondary text-center">{blockReason}</p>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={goPrev} disabled={saving}
            className="shrink-0 h-tap-small px-4 rounded-lg text-base font-medium border border-border-default bg-card text-text-primary hover:bg-page transition-base disabled:opacity-40">
            Atrás
          </button>
          {!onSummary ? (
            <button type="button" onClick={goNext} disabled={!current || !isReady(current)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-tap-small rounded-lg text-base font-medium bg-success text-text-on-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-base">
              Siguiente <ChevronRight size={20} />
            </button>
          ) : (
            <button type="button" onClick={handleReceive} disabled={!canSubmit}
              className="flex-1 inline-flex items-center justify-center gap-2 h-tap-small rounded-lg text-base font-medium bg-success text-text-on-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-base">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check size={20} />}
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
      <div className="w-16 h-16 rounded-full bg-success-bg flex items-center justify-center">
        <Check size={30} className="text-success" />
      </div>
      <div>
        <h2 className="text-xl font-display font-medium text-text-primary">Todo revisado</h2>
        <p className="text-sm text-text-secondary mt-1">{lineCount} línea(s) del albarán.</p>
      </div>

      {docTotal != null && anyTotal && (
        <div className={`w-full max-w-sm rounded-xl border p-4 ${shortfall !== null && Math.abs(shortfall) > 0.01 ? 'border-warning bg-warning-bg' : 'border-success bg-success-bg'}`}>
          <p className="text-sm text-text-secondary">Albarán</p>
          <p className="text-lg font-display font-medium text-text-primary">{fmtMoney(docTotal)} €</p>
          <p className="text-sm text-text-secondary mt-2">Contado</p>
          <p className="text-lg font-display font-medium text-text-primary">{fmtMoney(totalCounted)} €</p>
          {shortfall !== null && Math.abs(shortfall) > 0.01 ? (
            <p className="mt-2 text-sm font-semibold text-text-primary">
              {shortfall > 0 ? `Faltan ${fmtMoney(shortfall)} €` : `Sobran ${fmtMoney(-shortfall)} €`}
            </p>
          ) : (
            <p className="mt-2 text-sm font-semibold text-text-primary">Cuadra ✓</p>
          )}
        </div>
      )}

      {flagCount > 0 && (
        <p className="text-sm text-text-secondary flex items-center gap-1.5">
          <Flag size={14} /> {flagCount} línea(s) para que lo mire oficina
        </p>
      )}

      <button type="button" onClick={onAddLine}
        className="inline-flex items-center gap-1.5 px-4 h-tap-small rounded-lg text-sm font-medium border border-border-default text-text-primary hover:bg-card transition-base">
        <PackagePlus size={16} /> Falta un artículo — añadirlo
      </button>
    </div>
  )
}

// ── Esqueleto: mismo hueco que el bloque final, nunca un spinner suelto en
//    medio de una pantalla vacía (§1.1 y §5 del encargo). ──────────────────
function LineSkeleton() {
  return (
    <div className="flex-1 flex flex-col animate-pulse" aria-hidden="true">
      <div className="mt-3 h-6 w-2/3 rounded bg-border-default" />
      <div className="mt-2.5 h-4 w-1/2 rounded bg-border-default" />
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-4">
        <div className="h-[18px] w-44 rounded bg-border-default" />
        <div className="flex items-center justify-center gap-5">
          <div className="w-[52px] h-[52px] rounded-full bg-border-default" />
          <div className="w-[70px] h-9 rounded bg-border-default" />
          <div className="w-[52px] h-[52px] rounded-full bg-border-default" />
        </div>
      </div>
      <div className="h-10 rounded-lg bg-border-default" />
      <div className="mt-3 h-11 rounded-lg bg-border-default" />
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

  // Nunca se pinta el contador antes de saber el formato (§5 del encargo):
  // mientras se cargan los formatos, esqueleto — jamás "192 ud" para
  // cambiarlo luego a "8 packs" delante del trabajador.
  const waitingForFormat = !!l.recipeItemId && l.formatsLoading
  // Con varias opciones de formato aún sin elegir, no hay "cuántos X" que
  // preguntar todavía — se pregunta el formato primero.
  const needsFormatChoice = l.formats.length > 1 && !l.purchaseFormatId

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

  // Decisión de Julio (§4.b): el importe SIEMPRE muestra la referencia del
  // albarán debajo. Si el operario la cambia, todo pasa a ámbar y aparece la
  // diferencia — nunca en rojo, a veces el albarán está mal.
  const totalChanged = totalN != null && l.albaranLineAmount != null && Math.abs(totalN - l.albaranLineAmount) > 0.01
  const totalDiff = totalChanged ? Math.round((totalN! - l.albaranLineAmount!) * 100) / 100 : null

  return (
    <div className="flex-1 flex flex-col">
      {/* Texto literal del albarán — 14px secundario / 16px primario (§2 del encargo) */}
      {!l.manual ? (
        <p className="text-sm">
          <span className="text-text-secondary">El albarán dice: </span>
          <span className="text-base text-text-primary">
            {l.rawText}
            {l.albaranQty != null ? ` · ${fmtQty(l.albaranQty)}${l.albaranUnit ? ` ${l.albaranUnit}` : ''}` : ''}
          </span>
        </p>
      ) : (
        <input type="text" value={l.rawText} onChange={e => onRawText(e.target.value)}
          placeholder="¿Qué falta? Descríbelo"
          className="w-full mb-1 px-3 h-tap-small text-base border border-border-default rounded-lg bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30" />
      )}

      {l.matchLoading ? (
        <LineSkeleton />
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
              className="w-full inline-flex items-center justify-center gap-2 h-tap-small rounded-xl text-base font-medium border border-border-default bg-card text-text-primary hover:bg-page transition-base">
              <Search size={17} /> Buscar artículo
            </button>
          </div>
        </div>
      ) : (
        // ── RECONOCIDO: bloque de artículo agrupado, contador, franja, importe ──
        <div className="flex-1 flex flex-col">
          {/* Bloque del artículo: superficie propia, todo agrupado (§1.5 / §3.3) */}
          <div className="mt-3 rounded-xl bg-card border border-border-default p-3.5">
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex items-center gap-2 min-w-0">
                <Check size={20} className="text-success shrink-0" />
                <span className="text-lg font-display font-medium text-text-primary truncate">{l.matchedName}</span>
              </span>
              <button type="button" onClick={onOpenPicker}
                className="shrink-0 text-sm text-text-secondary hover:text-text-primary underline">
                Cambiar
              </button>
            </div>

            {l.formats.length === 0 && !l.formatsLoading ? (
              <p className="mt-1.5 text-sm text-text-primary">
                <AlertTriangle size={14} className="inline mr-1 -mt-0.5 text-warning" />
                Sin formato de compra definido — marca abajo que lo mire la oficina.
              </p>
            ) : needsFormatChoice ? (
              <div className="mt-2.5 space-y-1.5">
                <p className="text-sm text-text-secondary">¿En qué viene?</p>
                <div className="flex flex-wrap gap-2">
                  {l.formats.map(f => (
                    <button key={f.id} type="button" onClick={() => onFormat(f.id)}
                      className="px-3 h-tap-small rounded-lg text-sm border border-border-default bg-page text-text-primary hover:bg-border-default/40 transition-base">
                      {f.name}
                      {f.qtyInBase != null && (
                        <span className="text-text-secondary"> · {fmtQty(f.qtyInBase)} {baseUnitWord(l.baseUnit?.abbr)}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : format ? (
              <p className="mt-1 text-sm text-text-secondary">
                viene en {pluralFormatName(format.name, 2)} de {fmtQty(format.qtyInBase ?? 0)} {baseUnitWord(l.baseUnit?.abbr)}
                {l.formats.length > 1 && (
                  <button type="button" onClick={() => onFormat('')} className="ml-1.5 text-sm text-text-primary underline">cambiar</button>
                )}
              </p>
            ) : null}
          </div>

          {waitingForFormat ? (
            <LineSkeleton />
          ) : needsFormatChoice ? null : (
            <>
              {/* Aviso de división no exacta — se pregunta, no se redondea en silencio */}
              {l.qtySource === 'inexact' && format && (
                <div className="mt-2.5 flex items-start gap-1.5 text-sm rounded-lg px-3 py-2.5 bg-warning-bg text-text-primary">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-warning" />
                  <span>El albarán dice {fmtQty(l.albaranQty ?? 0)} {l.albaranUnit ?? 'ud'} y el formato es de {fmtQty(format.qtyInBase ?? 0)} — no cuadra exacto. Cuenta lo que ves y ajusta.</span>
                </div>
              )}

              {/* Pregunta + contador, unidad SIEMPRE junto al número */}
              <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
                <p className="text-[18px] font-medium text-text-primary text-center">
                  ¿Cuántos{format ? ` ${pluralFormatName(format.name, 2)}` : ` ${l.albaranUnit ?? ''}`} han llegado?
                </p>
                <div className="flex items-center justify-center gap-5">
                  <button type="button" onClick={() => onQty(l.qty - 1)} aria-label="Menos"
                    className="w-[52px] h-[52px] rounded-full border border-border-default bg-card text-text-primary flex items-center justify-center hover:bg-page active:scale-95 transition-base">
                    <Minus size={24} />
                  </button>
                  <div className="min-w-[96px] text-center">
                    <span className="text-3xl font-display font-medium tabular-nums text-text-primary">{fmtQty(l.qty)}</span>
                    <p className="text-[15px] text-text-secondary mt-0.5">{countingUnitLabel}</p>
                  </div>
                  <button type="button" onClick={() => onQty(l.qty + 1)} aria-label="Más"
                    className="w-[52px] h-[52px] rounded-full border border-border-default bg-card text-text-primary flex items-center justify-center hover:bg-page active:scale-95 transition-base">
                    <Plus size={24} />
                  </button>
                </div>
              </div>

              {/* Franja de resultado: fondo success, texto en primary (el verde
                  del propio texto no llega a 4.5:1 sobre el fondo — ver cabecera) */}
              {baseTotal != null && (
                <div className="rounded-lg bg-success-bg px-3 py-2.5 text-center">
                  <p className="text-[15px] font-medium text-text-primary">
                    → Entran {fmtQty(baseTotal)} {baseUnitWord(l.baseUnit?.abbr)} al almacén
                  </p>
                </div>
              )}

              {/* Importe: en fila, referencia del albarán siempre visible debajo de la etiqueta */}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className="block text-sm text-text-secondary">Importe de esta línea</label>
                  {l.albaranLineAmount != null && (
                    <p className={`text-sm mt-0.5 ${totalChanged ? 'text-warning font-medium' : 'text-text-secondary'}`}>
                      el albarán dice {fmtMoney(l.albaranLineAmount)} €
                    </p>
                  )}
                </div>
                <div className={`shrink-0 w-[108px] flex items-center rounded-lg border bg-card focus-within:ring-2 focus-within:ring-accent/30 ${totalChanged ? 'border-warning' : 'border-border-default'}`}>
                  <input type="text" inputMode="decimal" value={l.total} onChange={e => onTotal(e.target.value)}
                    placeholder="0,00"
                    className="w-full min-w-0 pl-2.5 py-2.5 text-[17px] text-right bg-transparent text-text-primary focus:outline-none" />
                  <span className="pr-2 text-sm text-text-secondary">€</span>
                </div>
              </div>

              {totalChanged && totalDiff != null && (
                <div className="mt-2 rounded-lg bg-warning-bg px-3 py-2.5 text-center">
                  <p className="text-sm font-medium text-text-primary">
                    No coincide con el albarán. {totalDiff > 0 ? `Sobran ${fmtMoney(totalDiff)} €` : `Faltan ${fmtMoney(-totalDiff)} €`}
                  </p>
                </div>
              )}

              {/* Coste unitario resultante, recalculado en vivo — avisa, no bloquea */}
              {perBase != null && (
                <p className={`mt-2 text-sm text-center ${alert ? 'text-text-primary font-semibold' : hasReference ? 'text-text-secondary' : 'text-text-secondary'}`}>
                  {alert && <AlertTriangle size={14} className="inline mr-1 -mt-0.5 text-warning" />}
                  {fmtHumanPrice(perBase)} €/{l.baseUnit?.abbr ?? 'ud'}
                  {alert && ` · ${alert.pct > 0 ? '+' : ''}${alert.pct}% sobre lo habitual`}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Bandera: botón secundario NEUTRO, ancho completo, 48px — NUNCA color
          de alarma (§4.a del encargo: marcar es la salida correcta, no un error). */}
      {!l.matchLoading && (
        <button type="button" onClick={onFlag}
          className={`mt-3 w-full inline-flex items-center justify-center gap-2 h-touch-base rounded-lg text-sm font-medium border transition-base ${
            l.flagged ? 'border-accent bg-accent-bg text-text-primary' : 'border-border-default bg-card text-text-primary hover:bg-page'
          }`}>
          <Flag size={16} /> {l.flagged ? 'Marcada — oficina lo revisará' : 'No lo tengo claro — que lo mire la oficina'}
        </button>
      )}
    </div>
  )
}
