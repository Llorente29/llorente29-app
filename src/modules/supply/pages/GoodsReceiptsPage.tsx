// src/modules/supply/pages/GoodsReceiptsPage.tsx
//
// Lista de RECEPCIONES (goods_receipt) del módulo Folvy Supply. Vistas por
// estado (sin react-router):
//   - list (por defecto)
//   - form: "Nueva recepción" (ciega) o "Anular y corregir" (prefill)
//
// El alta contra un pedido concreto se hace desde el detalle del pedido.
//
// Acciones desde la fila:
//   - borrador → Confirmar (postea al ledger)
//   - confirmado → Anular (reverso) | Anular y corregir
//
// "Anular y corregir": NO anula al pulsar. Abre el formulario precargado con las
// líneas (lectura, sin tocar la base); la recepción original solo se anula al
// CONFIRMAR la corregida (lógica en GoodsReceiptForm). Si sales sin confirmar,
// la original sigue confirmada.
//
// El aviso (flash) se auto-cierra a los segundos (no obliga a teclear).

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, PackageCheck, PackagePlus, AlertTriangle, Search, Loader2, Eye, RotateCcw, PencilLine, ScanLine, Settings2 } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { useIsMobile } from '@/shell/useIsMobile'
import { useApp } from '@/context/AppContext'
import {
  listGoodsReceipts,
  getGoodsReceiptById,
  listGoodsReceiptLines,
  voidReceipt,
  archiveGoodsReceipt,
  postPendingReceipt,
  getReceiptDocTotal,
  getReceiptCorrectionStreak,
  getLineCounts,
  type GoodsReceipt,
  type GoodsReceiptStatus,
  type CorrectionStreak,
  getSupplySettings,
  saveSupplySettings,
  type SupplySettings,
} from '@/modules/supply/services/goodsReceiptService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import { listSupplyLocations, type SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import PostPendingModal, { type PendingLine } from '@/modules/supply/components/PostPendingModal'
import type { Supplier } from '@/types/kitchen'
import GoodsReceiptForm, { type ReceiptPrefill, type OcrPrefill } from '@/modules/supply/pages/GoodsReceiptForm'
import ReceiptScanPanel from '@/modules/supply/pages/ReceiptScanPanel'
import ReceiptWizard from '@/modules/supply/pages/ReceiptWizard'
import OrderReceiveFlow from '@/modules/supply/components/OrderReceiveFlow'

const STATUS_LABEL: Record<GoodsReceiptStatus, string> = {
  borrador: 'Borrador',
  recibido: 'Recibido',
  confirmado: 'Confirmado',
  anulado: 'Anulado',
}

const STATUS_CLASS: Record<GoodsReceiptStatus, string> = {
  borrador: 'bg-page text-text-secondary border-border-default',
  recibido: 'bg-accent-bg text-accent border-accent/20',
  confirmado: 'bg-success-bg text-success border-success/20',
  anulado: 'bg-danger-bg text-danger border-danger/20',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(value))
}

type View = 'list' | 'form' | 'scan' | 'receive-order' | 'wizard'

export default function GoodsReceiptsPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { authUserId } = useApp()
  const { resolvedLocationId } = useLocationScope()
  const isMobile = useIsMobile()
  const location = useLocation()
  const navigate = useNavigate()

  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [view, setView] = useState<View>('list')
  const [prefill, setPrefill] = useState<ReceiptPrefill | null>(null)
  const [ocrPrefill, setOcrPrefill] = useState<OcrPrefill | null>(null)

  // Arranque rápido desde el vigía de stock negativo (Almacén → Teórico vs
  // Real → Stock negativo): llega por navigate(state), no por props (esta
  // página es una ruta de nivel superior). Se consume UNA vez al montar y se
  // limpia el state de navegación para que atrás/refrescar no lo reabra solo.
  const [quickReceipt, setQuickReceipt] = useState<{ supplierId: string; search: string } | null>(null)
  useEffect(() => {
    const state = location.state as { quickReceipt?: { supplierId: string; search: string } } | null
    if (state?.quickReceipt) {
      setQuickReceipt(state.quickReceipt)
      setPrefill(null)
      setOcrPrefill(null)
      setView('form')
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // C2.2.c — ajustes de avisos (umbral precio %, días caducidad).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<SupplySettings>({
    priceAlertPct: 15, expiryAlertDays: 3, negotiatedAlertPct: 0, driftAlertPct: 25, driftWindowMonths: 6,
    negStockRelPct: 5, negStockAbsQty: 5, negStockWindowDays: 60,
    dockPendingWindowBeforeDays: 7, dockPendingWindowAfterDays: 3, hungOrderDaysThreshold: 14,
  })
  const [savingSettings, setSavingSettings] = useState(false)
  async function openSettings() {
    if (!activeAccountId) return
    try { setSettings(await getSupplySettings(activeAccountId)) } catch { /* defaults */ }
    setSettingsOpen(true)
  }
  async function saveSettings() {
    if (!activeAccountId) return
    setSavingSettings(true)
    try {
      await saveSupplySettings(activeAccountId, settings, null, null)
      setSettingsOpen(false)
      setFlash('Ajustes de avisos guardados.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar los ajustes.')
    } finally {
      setSavingSettings(false)
    }
  }

  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  // Datos para el modal "Meter al stock" (resolver pendientes sin salir).
  const [postModal, setPostModal] = useState<{
    receiptCode: string
    supplierId: string | null
    posted: number
    lines: PendingLine[]
  } | null>(null)

  // El aviso se auto-cierra a los 6 s (no obliga a teclear nada).
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 6000)
    return () => clearTimeout(t)
  }, [flash])

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) {
      setReceipts([]); setSuppliers([]); setLocations([]); setLoading(false); return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      listGoodsReceipts({ accountId: activeAccountId, locationId: resolvedLocationId ?? undefined }),
      listSuppliers(activeAccountId),
      listSupplyLocations(activeAccountId),
    ])
      .then(([rows, sups, locs]) => {
        if (cancelled) return
        setReceipts(rows); setSuppliers(sups); setLocations(locs)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error desconocido')
        setReceipts([]); setSuppliers([]); setLocations([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading, resolvedLocationId, reloadTick])

  // ENCARGO CODE (13/08) fix/recepcion-p2-oficina, §5 — "¿sigue haciendo falta
  // revisar?" Solo lectura, por local (un local a la vez elegido — con "todos
  // los locales" no se muestra, mezclar locales no dice nada útil de UNO). Usa
  // los ids ya cargados arriba (receipts, ya viene ordenado por receipt_date
  // desc) — no repite la consulta de recepciones, solo lee sus líneas.
  //
  // ENCARGO CODE (14/08) fix/recepcion-lista-recibido, §3 — candidatos =
  // 'recibido' o 'confirmado' (antes solo 'confirmado': mezclaba el histórico
  // entero del flujo clásico con las recepciones del asistente).
  // getReceiptCorrectionStreak filtra a las del asistente y aplica el tope.
  // 200 en bruto es margen de sobra para llegar a 60 del asistente sin barrer
  // toda la tabla.
  const [streak, setStreak] = useState<CorrectionStreak | null>(null)
  useEffect(() => {
    let cancelled = false
    const candidates = resolvedLocationId
      ? receipts
          .filter(r => r.status === 'confirmado' || r.status === 'recibido')
          .slice(0, 200)
          .map(r => ({ id: r.id, status: r.status }))
      : []
    // Sin local elegido o sin candidatos: resuelve a null igual, pero SIEMPRE
    // por la vía async (nunca setState síncrono en el cuerpo del efecto —
    // mismo criterio que el resto del fetching de esta página).
    const fetchPromise = candidates.length > 0
      ? getReceiptCorrectionStreak(candidates)
      : Promise.resolve(null)
    fetchPromise
      .then(s => { if (!cancelled) setStreak(s) })
      .catch(() => { if (!cancelled) setStreak(null) })
    return () => { cancelled = true }
  }, [receipts, resolvedLocationId])

  // ENCARGO CODE (13/08) feat/recepcion-v2-asistente, §"8 borradores
  // atascados" — código/fecha/autor YA están en la fila; solo falta el nº de
  // líneas para que Julio decida cuáles recibir (revisar y confirmar) y
  // cuáles descartar sin abrir cada uno. Los borradores YA salen primero en
  // `visible` (rank 0) — no se duplica la lista en una pantalla aparte.
  const [borradorLineCounts, setBorradorLineCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let cancelled = false
    const ids = receipts.filter(r => r.status === 'borrador').map(r => r.id)
    const fetchPromise = ids.length > 0 ? getLineCounts(ids) : Promise.resolve({})
    fetchPromise
      .then(counts => { if (!cancelled) setBorradorLineCounts(counts) })
      .catch(() => { if (!cancelled) setBorradorLineCounts({}) })
    return () => { cancelled = true }
  }, [receipts])

  const supplierNameById = useMemo(() => {
    const m = new Map<string, string>()
    suppliers.forEach(s => m.set(s.id, s.name))
    return m
  }, [suppliers])

  const locationNameById = useMemo(() => {
    const m = new Map<string, string>()
    locations.forEach(l => m.set(l.id, l.name))
    return m
  }, [locations])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q === ''
      ? receipts
      : receipts.filter(r => {
          const code = (r.code ?? '').toLowerCase()
          const sup = (r.supplierId ? supplierNameById.get(r.supplierId) ?? '' : '').toLowerCase()
          const doc = (r.supplierDocNumber ?? '').toLowerCase()
          return code.includes(q) || sup.includes(q) || doc.includes(q)
        })
    // Lo accionable primero: BORRADORES y RECIBIDO arriba (esperan acción —
    // confirmar o revisar), luego CONFIRMADO/ANULADO (histórico); dentro de
    // cada grupo, por fecha de recepción descendente (lo reciente antes). Así
    // la oficina ve de un vistazo lo que tiene que revisar.
    //
    // ENCARGO CODE (14/08) fix/recepcion-lista-recibido, §2 — 'recibido' caía
    // en el mismo rango que 'confirmado'/'anulado' (rango 2): con 99
    // confirmadas por delante, una recepción 'recibido' quedaba enterrada al
    // fondo de la lista — "no aparece en pantalla" aunque la fila existiera.
    const rank = (s: string) => (s === 'borrador' ? 0 : s === 'recibido' ? 1 : s === 'confirmado' ? 2 : 3)
    return [...base].sort((a, b) => {
      const dr = rank(a.status) - rank(b.status)
      if (dr !== 0) return dr
      return (b.receiptDate ?? '').localeCompare(a.receiptDate ?? '')
    })
  }, [receipts, search, supplierNameById])

  // ENCARGO CODE (14/08) fix/recepcion-lista-recibido, §2.2 — contador visible:
  // es lo único que espera acción de la oficina (lo confirmado es histórico).
  const recibidoCount = useMemo(() => receipts.filter(r => r.status === 'recibido').length, [receipts])

  // Revisar y confirmar un BORRADOR: lee la recepción + líneas + la foto del
  // albarán y abre el form EN SITIO (isDraft). La oficina ve lo que se contó,
  // ajusta lo que falte y confirma la MISMA recepción (no crea otra ni anula).
  async function handleReviewDraft(id: string) {
    setBusyId(id); setFlash(null); setError(null)
    try {
      const [r, lines] = await Promise.all([
        getGoodsReceiptById(id),
        listGoodsReceiptLines(id),
      ])
      if (!r) throw new Error('No se pudo recuperar la recepción.')
      // ENCARGO CODE (13/08) fix/recepcion-p2-oficina, §3 — el total que leyó la
      // IA ya vive en goods_receipt_ai_session (se escribió al escanear); se lee
      // de vuelta para el cuadre. Best-effort: sin OCR (r.aiSessionId null) o si
      // falla, el cuadre simplemente no se muestra — no rompe abrir la recepción.
      let docTotal: number | null = null
      if (r.aiSessionId) {
        try { docTotal = await getReceiptDocTotal(r.aiSessionId) }
        catch (e) { console.error('handleReviewDraft: no se pudo leer el total del albarán', e) }
      }
      const pf: ReceiptPrefill = {
        sourceReceiptId: r.id,
        supplierId: r.supplierId ?? '',
        locationId: r.locationId,
        purchaseOrderId: r.purchaseOrderId,
        supplierDocNumber: r.supplierDocNumber,
        isDraft: true,
        code: r.code,
        rawDocumentUrl: r.rawDocumentUrl,
        docTotal,
        lines: lines.map(l => ({
          id: l.id,
          recipeItemId: l.recipeItemId,
          productName: l.productName,
          purchaseFormatId: l.purchaseFormatId,
          qtyReceived: l.qtyReceived,
          unitCost: l.unitCost,
          purchaseOrderLineId: l.purchaseOrderLineId,
          // ENCARGO CODE (12/08) fix/recepcion-fromocr-borrador: sin esto el
          // casado automático no tenía con qué casar al revisar un borrador.
          rawText: l.rawText,
          supplierCode: l.supplierCode,
          // ENCARGO CODE (13/08) fix/recepcion-p2-oficina, §3 — igual que
          // rawText/supplierCode arriba: YA existían en BBDD y no se leían de
          // vuelta (se perdía el cuadre por línea y el motivo ya puesto).
          docQty: l.docQty,
          docAmount: l.docAmount,
          discrepancyReason: l.discrepancyReason,
          flaggedForOffice: l.flaggedForOffice,
        })),
      }
      setPrefill(pf)
      setQuickReceipt(null)
      setView('form')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la recepción.')
    } finally {
      setBusyId(null)
    }
  }

  // ENCARGO CODE (13/08) feat/recepcion-v2-asistente, Tramo C — abre una
  // recepción 'recibido' (el asistente ya metió el stock) para que oficina
  // verifique. Mismo patrón que handleReviewDraft, pero marca isReceived (no
  // isDraft): persist() en GoodsReceiptForm toma la rama que NO borra y
  // recrea líneas — las ajusta en sitio.
  async function handleReviewReceived(id: string) {
    setBusyId(id); setFlash(null); setError(null)
    try {
      const [r, lines] = await Promise.all([
        getGoodsReceiptById(id),
        listGoodsReceiptLines(id),
      ])
      if (!r) throw new Error('No se pudo recuperar la recepción.')
      let docTotal: number | null = null
      if (r.aiSessionId) {
        try { docTotal = await getReceiptDocTotal(r.aiSessionId) }
        catch (e) { console.error('handleReviewReceived: no se pudo leer el total del albarán', e) }
      }
      const pf: ReceiptPrefill = {
        sourceReceiptId: r.id,
        supplierId: r.supplierId ?? '',
        locationId: r.locationId,
        purchaseOrderId: r.purchaseOrderId,
        supplierDocNumber: r.supplierDocNumber,
        isReceived: true,
        code: r.code,
        rawDocumentUrl: r.rawDocumentUrl,
        docTotal,
        receivedByName: r.createdByName,
        receivedAt: r.receivedAt,
        lines: lines.map(l => ({
          id: l.id,
          recipeItemId: l.recipeItemId,
          productName: l.productName,
          purchaseFormatId: l.purchaseFormatId,
          qtyReceived: l.qtyReceived,
          unitCost: l.unitCost,
          purchaseOrderLineId: l.purchaseOrderLineId,
          rawText: l.rawText,
          supplierCode: l.supplierCode,
          docQty: l.docQty,
          docAmount: l.docAmount,
          discrepancyReason: l.discrepancyReason,
          flaggedForOffice: l.flaggedForOffice,
        })),
      }
      setPrefill(pf)
      setQuickReceipt(null)
      setView('form')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la recepción.')
    } finally {
      setBusyId(null)
    }
  }

  // ENCARGO CODE (13/08) feat/recepcion-v2-asistente — "descartar" un
  // borrador atascado (no encaja/duplicado/prueba): no hay stock que
  // revertir (nunca posteó), así que archivar (is_active=false) es
  // suficiente y reversible en BBDD si hiciera falta — no un borrado físico.
  async function handleDiscardDraft(id: string) {
    setBusyId(id); setFlash(null); setError(null)
    try {
      await archiveGoodsReceipt(id)
      setFlash('Borrador descartado.')
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo descartar el borrador.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleVoid(id: string) {
    setBusyId(id); setFlash(null); setError(null)
    try {
      const reversed = await voidReceipt(id)
      setFlash(`Recepción anulada: ${reversed} movimiento(s) revertido(s).`)
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo anular la recepción.')
    } finally {
      setBusyId(null)
    }
  }

  // Mete al stock las líneas pendientes (las que quedaron sin postear al confirmar
  // por falta de formato). Las que ya tienen formato entran; las que no, avisan.
  async function handlePostPending(id: string) {
    setBusyId(id); setFlash(null); setError(null)
    try {
      const res = await postPendingReceipt(id)
      const receipt = receipts.find(r => r.id === id)
      const code = receipt?.code ?? ''
      if (res.posted > 0 && res.stillPending === 0) {
        setFlash(`${code}: ${res.posted} línea(s) metida(s) al almacén.`)
      } else {
        const lines: PendingLine[] = res.pendingItems.map(it => ({
          lineId: it.lineId,
          itemId: it.itemId,
          name: it.name,
          reason: it.reason,
          rawText: it.name,
          supplierCode: null,
        }))
        setPostModal({ receiptCode: code, supplierId: receipt?.supplierId ?? null, posted: res.posted, lines })
      }
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo meter al stock.')
    } finally {
      setBusyId(null)
    }
  }

  // Anular y corregir: NO anula aquí. Lee la recepción + líneas (sin tocar nada)
  // y abre el formulario precargado. La original se anulará al CONFIRMAR la
  // corregida (orden seguro, en GoodsReceiptForm).
  async function handleCorrect(id: string) {
    setBusyId(id); setFlash(null); setError(null)
    try {
      const [r, lines] = await Promise.all([
        getGoodsReceiptById(id),
        listGoodsReceiptLines(id),
      ])
      if (!r) throw new Error('No se pudo recuperar la recepción.')
      // ENCARGO CODE (13/08) fix/recepcion-p2-oficina, §3 — mismo cuadre que en
      // handleReviewDraft (ver comentario allí). No bloquea si falla.
      let docTotal: number | null = null
      if (r.aiSessionId) {
        try { docTotal = await getReceiptDocTotal(r.aiSessionId) }
        catch (e) { console.error('handleCorrect: no se pudo leer el total del albarán', e) }
      }
      const pf: ReceiptPrefill = {
        sourceReceiptId: r.id,
        supplierId: r.supplierId ?? '',
        locationId: r.locationId,
        purchaseOrderId: r.purchaseOrderId,
        supplierDocNumber: r.supplierDocNumber,
        docTotal,
        lines: lines.map(l => ({
          id: l.id,
          recipeItemId: l.recipeItemId,
          productName: l.productName,
          purchaseFormatId: l.purchaseFormatId,
          qtyReceived: l.qtyReceived,
          unitCost: l.unitCost,
          purchaseOrderLineId: l.purchaseOrderLineId,
          rawText: l.rawText,
          supplierCode: l.supplierCode,
          docQty: l.docQty,
          docAmount: l.docAmount,
          discrepancyReason: l.discrepancyReason,
          flaggedForOffice: l.flaggedForOffice,
        })),
      }
      setPrefill(pf)
      setQuickReceipt(null)
      setView('form')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la corrección.')
    } finally {
      setBusyId(null)
    }
  }

  console.log('[DEBUG-wizard-routing] render', { view, hasActiveAccountId: !!activeAccountId, hasOcrPrefill: !!ocrPrefill })

  // ── Vista SCAN: escanear albarán (OCR) ──
  if (view === 'scan' && activeAccountId) {
    return (
      <ReceiptScanPanel
        accountId={activeAccountId}
        onBack={() => { setView('list'); setReloadTick(t => t + 1) }}
        // ENCARGO CODE (13/08) feat/recepcion-v2-asistente, Tramo A — el
        // escaneo ciego (sin pedido detrás) ya no abre GoodsReceiptForm: abre
        // el asistente móvil, una línea por pantalla. El escaneo CONTRA
        // PEDIDO (OrderReceiveFlow) es un camino aparte, no tocado — sigue en
        // el form grande (el formato ya viene dado por el pedido).
        onCreateReceipt={(ocr) => {
          console.log('[DEBUG-wizard-routing] GoodsReceiptsPage.onCreateReceipt recibido', { hasOcr: !!ocr, lines: ocr?.lines?.length })
          setOcrPrefill(ocr); setQuickReceipt(null); setView('wizard')
          console.log('[DEBUG-wizard-routing] setView(\'wizard\') llamado')
        }}
      />
    )
  }

  // ── Vista ASISTENTE: una línea por pantalla, "Recibir y meter al stock" ──
  if (view === 'wizard' && activeAccountId && ocrPrefill) {
    return (
      <ReceiptWizard
        accountId={activeAccountId}
        locationId={resolvedLocationId}
        ocrPrefill={ocrPrefill}
        onBack={() => { setView('scan'); setOcrPrefill(null); setReloadTick(t => t + 1) }}
        onDone={(msg) => { setView('list'); setOcrPrefill(null); if (msg) setFlash(msg); setReloadTick(t => t + 1) }}
      />
    )
  }

  // ── Vista RECIBIR PEDIDO: selector de pedidos pendientes → recepción ──
  if (view === 'receive-order' && activeAccountId) {
    return (
      <OrderReceiveFlow
        accountId={activeAccountId}
        locationId={resolvedLocationId}
        onBack={() => { setView('list'); setReloadTick(t => t + 1) }}
        onSaved={(msg) => { setView('list'); if (msg) setFlash(msg); setReloadTick(t => t + 1) }}
      />
    )
  }

  // ── Vista FORM: nueva recepción ciega, corrección (prefill), propuesta OCR
  //    o arranque rápido del vigía de stock negativo (quickReceipt) ──
  if (view === 'form' && activeAccountId) {
    return (
      <GoodsReceiptForm
        accountId={activeAccountId}
        prefill={prefill}
        ocrPrefill={ocrPrefill}
        initialSupplierId={quickReceipt?.supplierId ?? null}
        focusSearch={quickReceipt?.search ?? null}
        onBack={() => { setView(ocrPrefill ? 'scan' : 'list'); setPrefill(null); setOcrPrefill(null); setQuickReceipt(null); setReloadTick(t => t + 1) }}
        onSaved={(msg) => { setView('list'); setPrefill(null); setOcrPrefill(null); setQuickReceipt(null); if (msg) setFlash(msg); setReloadTick(t => t + 1) }}
      />
    )
  }

  // ── Vista LISTA ──
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">Recepciones</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Registra lo que llega del proveedor. Al confirmar, entra a stock.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openSettings}
            disabled={!activeAccountId}
            title="Ajustes de avisos"
            className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base"
          >
            <Settings2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => setView('receive-order')}
            disabled={!activeAccountId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            <PackageCheck size={16} />
            Recibir pedido
          </button>
          <button
            type="button"
            onClick={() => setView('scan')}
            disabled={!activeAccountId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            <ScanLine size={16} />
            Escanear albarán
          </button>
          <button
            type="button"
            onClick={() => { setPrefill(null); setQuickReceipt(null); setView('form') }}
            disabled={!activeAccountId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            <Plus size={16} />
            Nueva recepción
          </button>
        </div>
      </div>

      {/* ENCARGO CODE (14/08) fix/recepcion-lista-recibido, §2.2 — "la oficina
          no puede confirmar lo que no ve": destacado arriba, es lo único que
          espera acción de oficina (lo confirmado es histórico). */}
      {!loading && !error && recibidoCount > 0 && (
        <div className="p-3 rounded-md border border-accent/30 bg-accent-bg flex items-center gap-2">
          <Eye size={16} className="text-accent shrink-0" />
          <p className="text-sm font-medium text-text-primary">
            {recibidoCount} recepción{recibidoCount === 1 ? '' : 'es'} {recibidoCount === 1 ? 'espera' : 'esperan'} tu revisión
          </p>
        </div>
      )}

      {/* ENCARGO CODE (13/08) fix/recepcion-p2-oficina, §5 — solo lectura + una
          propuesta, nada automático. Sin botón que escriba receipt_approval=
          'directo': ese valor no lo consume ninguna pantalla todavía (modo
          directo es P4, encargo aparte) — sería un estado huérfano. */}
      {streak && streak.totalCount > 0 && (
        <div className="p-3 rounded-md border border-border-default bg-page space-y-1.5">
          <p className="text-sm font-medium text-text-primary">¿Sigue haciendo falta revisar?</p>
          <p className="text-xs text-text-secondary">
            La revisión se apaga sola cuando cocina acierte {streak.streakGoal} recepciones seguidas.
          </p>
          <div className="flex items-center gap-6 pt-0.5">
            <div>
              <p className="text-lg font-display tabular-nums text-text-primary">{streak.correctedCount} de {streak.totalCount}</p>
              <p className="text-[11px] text-text-secondary">Corregidas por oficina</p>
            </div>
            <div>
              <p className={`text-lg font-display tabular-nums ${streak.metGoal ? 'text-success' : 'text-text-primary'}`}>
                {streak.streak} de {streak.streakGoal}
              </p>
              <p className="text-[11px] text-text-secondary">Seguidas sin fallo</p>
            </div>
          </div>
          {streak.metGoal && (
            <p className="text-xs text-success pt-0.5">
              Racha cumplida — ya podrías pasar este local a confirmación directa (sin revisión de oficina).
            </p>
          )}
        </div>
      )}

      {flash && (
        <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm">{flash}</div>
      )}
      {error && (
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {!loading && !error && receipts.length > 0 && (
        <div className="relative max-w-sm">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por código, proveedor o nº de albarán"
            className="w-full pl-8 pr-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}

      {loading && <p className="text-sm text-text-secondary">Cargando recepciones…</p>}

      {!loading && !error && receipts.length === 0 && (
        <div className="p-8 rounded-lg border border-dashed border-border-default text-center">
          <PackageCheck size={28} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm font-medium text-text-primary">Aún no hay recepciones</p>
          <p className="text-sm text-text-secondary mt-1">
            Registra la primera entrega de un proveedor para empezar a controlar el stock.
          </p>
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        isMobile ? (
          <div className="space-y-2">
            {visible.map(r => (
              <div key={r.id} className="p-3 rounded-lg border border-border-default bg-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text-primary truncate">{r.code ?? 'Albarán'}</span>
                  <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <CardField label="Proveedor" value={r.supplierId ? supplierNameById.get(r.supplierId) ?? '—' : '—'} />
                  <CardField label="Local" value={locationNameById.get(r.locationId) ?? '—'} />
                  <CardField label="Fecha" value={formatDate(r.receiptDate)} />
                  <CardField label="Nº albarán" value={r.supplierDocNumber ?? '—'} />
                  {r.status === 'borrador' && (
                    <>
                      <CardField label="Quién lo dejó" value={r.createdByName ?? '—'} />
                      <CardField label="Líneas" value={String(borradorLineCounts[r.id] ?? '—')} />
                    </>
                  )}
                </div>
                {r.needsReview && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger bg-danger-bg border border-danger/30 rounded-md px-2 py-1.5">
                    <AlertTriangle size={13} className="shrink-0" /> Falta meter género al stock
                  </div>
                )}
                <div className="mt-2">
                  <RowActions r={r} busy={busyId === r.id} onReview={handleReviewDraft} onReviewReceived={handleReviewReceived} onVoid={handleVoid} onCorrect={handleCorrect} onPostPending={handlePostPending} onDiscard={handleDiscardDraft} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border-default overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-page text-text-secondary">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Código</th>
                  <th className="text-left font-medium px-3 py-2">Proveedor</th>
                  <th className="text-left font-medium px-3 py-2">Local</th>
                  <th className="text-left font-medium px-3 py-2">Fecha</th>
                  <th className="text-left font-medium px-3 py-2">Nº albarán</th>
                  <th className="text-left font-medium px-3 py-2">Estado</th>
                  <th className="text-right font-medium px-3 py-2">Acción</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <tr key={r.id} className="border-t border-border-default">
                    <td className="px-3 py-2 text-text-primary">
                      {r.code ?? '—'}
                      {r.status === 'borrador' && (
                        <span className="block text-[11px] text-text-tertiary font-normal">
                          {r.createdByName ?? 'quién lo dejó: —'} · {borradorLineCounts[r.id] ?? '—'} línea(s)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-primary">{r.supplierId ? supplierNameById.get(r.supplierId) ?? '—' : '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">{locationNameById.get(r.locationId) ?? '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">{formatDate(r.receiptDate)}</td>
                    <td className="px-3 py-2 text-text-secondary">{r.supplierDocNumber ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.needsReview && (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-danger-bg text-danger border border-danger/30 font-medium">
                          <AlertTriangle size={11} /> Falta meter al stock
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end">
                        <RowActions r={r} busy={busyId === r.id} onReview={handleReviewDraft} onReviewReceived={handleReviewReceived} onVoid={handleVoid} onCorrect={handleCorrect} onPostPending={handlePostPending} onDiscard={handleDiscardDraft} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* C2.2.c — modal de ajustes de avisos */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={() => !savingSettings && setSettingsOpen(false)}>
          <div className="bg-card rounded-lg border border-border-default shadow-lg w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-medium text-text-primary">Ajustes de avisos</h3>
              <p className="text-sm text-text-secondary mt-0.5">Cuándo avisar en la recepción. Afecta a todo el negocio.</p>
            </div>
            <label className="block">
              <span className="text-sm text-text-primary">Avisar si el precio varía más de</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={1} max={100} value={settings.priceAlertPct}
                  onChange={e => setSettings(s => ({ ...s, priceAlertPct: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-24 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">% respecto a la última compra</span>
              </div>
            </label>
            <label className="block">
              <span className="text-sm text-text-primary">Avisar si supera lo pactado en</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={0} max={100} value={settings.negotiatedAlertPct}
                  onChange={e => setSettings(s => ({ ...s, negotiatedAlertPct: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-24 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">% sobre el precio pactado (0 = en cuanto lo supere)</span>
              </div>
            </label>
            <label className="block">
              <span className="text-sm text-text-primary">Avisar de caducidad si quedan</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={0} max={60} value={settings.expiryAlertDays}
                  onChange={e => setSettings(s => ({ ...s, expiryAlertDays: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-24 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">días o menos</span>
              </div>
            </label>

            <div className="pt-1 border-t border-border-default">
              <h4 className="text-sm font-medium text-text-primary pt-3">Vigía de stock negativo</h4>
              <p className="text-xs text-text-secondary mt-0.5">
                Cuándo un artículo en negativo pasa de "ruido" a "alerta" en Almacén → Teórico vs Real.
              </p>
            </div>
            <label className="block">
              <span className="text-sm text-text-primary">Alertar si el negativo supera</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={0} max={100} value={settings.negStockRelPct}
                  onChange={e => setSettings(s => ({ ...s, negStockRelPct: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-24 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">% del consumo reciente</span>
              </div>
            </label>
            <label className="block">
              <span className="text-sm text-text-primary">…o al menos (suelo, evita ruido)</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={0} value={settings.negStockAbsQty}
                  onChange={e => setSettings(s => ({ ...s, negStockAbsQty: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-24 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">unidades base (g/ml/ud)</span>
              </div>
            </label>
            <label className="block">
              <span className="text-sm text-text-primary">Consumo reciente = ventana de</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={1} max={365} value={settings.negStockWindowDays}
                  onChange={e => setSettings(s => ({ ...s, negStockWindowDays: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-24 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">días (sin consumo en la ventana, usa el histórico)</span>
              </div>
            </label>

            <div className="pt-1 border-t border-border-default">
              <h4 className="text-sm font-medium text-text-primary pt-3">Muelle y vigía de pedidos</h4>
              <p className="text-xs text-text-secondary mt-0.5">
                Qué ventana de pedidos ve el trabajador al recepcionar, y cuándo un pedido colgado entra en el vigía de gestión.
              </p>
            </div>
            <label className="block">
              <span className="text-sm text-text-primary">El muelle enseña pedidos con entrega entre</span>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <input type="number" min={0} max={90} value={settings.dockPendingWindowBeforeDays}
                  onChange={e => setSettings(s => ({ ...s, dockPendingWindowBeforeDays: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-20 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">días atrás y</span>
                <input type="number" min={0} max={30} value={settings.dockPendingWindowAfterDays}
                  onChange={e => setSettings(s => ({ ...s, dockPendingWindowAfterDays: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-20 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">días adelante (los "recibido parcial" salen siempre)</span>
              </div>
            </label>
            <label className="block">
              <span className="text-sm text-text-primary">Pedido enviado vencido más de</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={1} max={90} value={settings.hungOrderDaysThreshold}
                  onChange={e => setSettings(s => ({ ...s, hungOrderDaysThreshold: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-24 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">días → aparece en Saneado con propuesta de cierre corto</span>
              </div>
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setSettingsOpen(false)} disabled={savingSettings}
                className="px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">Cancelar</button>
              <button type="button" onClick={saveSettings} disabled={savingSettings}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                {savingSettings && <Loader2 size={14} className="animate-spin" />} Guardar
              </button>
            </div>
          </div>
        </div>
      )}
      {postModal && (
        <PostPendingModal
          accountId={activeAccountId ?? ''}
          receiptCode={postModal.receiptCode}
          supplierId={postModal.supplierId}
          posted={postModal.posted}
          lines={postModal.lines}
          actorId={authUserId}
          actorName={null}
          onClose={() => setPostModal(null)}
          onChanged={() => setReloadTick(t => t + 1)}
        />
      )}
    </div>
  )
}

function RowActions({
  r, busy, onReview, onReviewReceived, onVoid, onCorrect, onPostPending, onDiscard,
}: {
  r: GoodsReceipt
  busy: boolean
  onReview: (id: string) => void
  onReviewReceived: (id: string) => void
  onVoid: (id: string) => void
  onCorrect: (id: string) => void
  onPostPending: (id: string) => void
  onDiscard: (id: string) => void
}) {
  if (r.status === 'borrador') {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onReview(r.id)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye size={15} />}
          Revisar y confirmar
        </button>
        <button
          type="button"
          onClick={() => { if (window.confirm('¿Descartar este borrador? No entró a stock, así que no hay nada que revertir.')) onDiscard(r.id) }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm border border-border-default bg-card text-text-secondary hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base"
        >
          Descartar
        </button>
      </div>
    )
  }
  {/* ENCARGO CODE (13/08) feat/recepcion-v2-asistente, Tramo B/C — el stock ya
      entró (vía el asistente); oficina VERIFICA y cierra, no revisa a ciegas. */}
  if (r.status === 'recibido') {
    return (
      <button
        type="button"
        onClick={() => onReviewReceived(r.id)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye size={15} />}
        Verificar y confirmar
      </button>
    )
  }
  if (r.status === 'confirmado') {
    return (
      <div className="flex items-center gap-2">
        {r.needsReview && (
          <button
            type="button"
            onClick={() => onPostPending(r.id)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium bg-danger text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus size={15} />}
            Meter al stock
          </button>
        )}
        <button
          type="button"
          onClick={() => onCorrect(r.id)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PencilLine size={15} />}
          Anular y corregir
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('¿Anular esta recepción? Se revertirán sus movimientos de stock.')) onVoid(r.id)
          }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base"
        >
          <RotateCcw size={15} />
          Anular
        </button>
      </div>
    )
  }
  return <span className="text-xs text-text-tertiary">—</span>
}

function CardField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-sm text-text-primary truncate">{value}</p>
    </div>
  )
}
