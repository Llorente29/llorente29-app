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
import { Plus, PackageCheck, Search, Loader2, Check, RotateCcw, PencilLine, ScanLine, Settings2 } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { useIsMobile } from '@/shell/useIsMobile'
import {
  listGoodsReceipts,
  getGoodsReceiptById,
  listGoodsReceiptLines,
  confirmReceipt,
  voidReceipt,
  type GoodsReceipt,
  type GoodsReceiptStatus,
  getSupplySettings,
  saveSupplySettings,
  type SupplySettings,
} from '@/modules/supply/services/goodsReceiptService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import { listSupplyLocations, type SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import type { Supplier } from '@/types/kitchen'
import GoodsReceiptForm, { type ReceiptPrefill, type OcrPrefill } from '@/modules/supply/pages/GoodsReceiptForm'
import ReceiptScanPanel from '@/modules/supply/pages/ReceiptScanPanel'

const STATUS_LABEL: Record<GoodsReceiptStatus, string> = {
  borrador: 'Borrador',
  confirmado: 'Confirmado',
  anulado: 'Anulado',
}

const STATUS_CLASS: Record<GoodsReceiptStatus, string> = {
  borrador: 'bg-page text-text-secondary border-border-default',
  confirmado: 'bg-success-bg text-success border-success/20',
  anulado: 'bg-danger-bg text-danger border-danger/20',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(value))
}

type View = 'list' | 'form' | 'scan'

export default function GoodsReceiptsPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { resolvedLocationId } = useLocationScope()
  const isMobile = useIsMobile()

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

  // C2.2.c — ajustes de avisos (umbral precio %, días caducidad).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<SupplySettings>({ priceAlertPct: 15, expiryAlertDays: 3 })
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
    if (q === '') return receipts
    return receipts.filter(r => {
      const code = (r.code ?? '').toLowerCase()
      const sup = (r.supplierId ? supplierNameById.get(r.supplierId) ?? '' : '').toLowerCase()
      const doc = (r.supplierDocNumber ?? '').toLowerCase()
      return code.includes(q) || sup.includes(q) || doc.includes(q)
    })
  }, [receipts, search, supplierNameById])

  async function handleConfirm(id: string) {
    setBusyId(id); setFlash(null); setError(null)
    try {
      const res = await confirmReceipt(id)
      const parts = [`${res.postedLines} línea(s) a stock`]
      if (res.skippedLines > 0) parts.push(`${res.skippedLines} sin postear (revisar)`)
      if (res.recalculatedItems > 0) parts.push(`coste actualizado en ${res.recalculatedItems} ingrediente(s)`)
      setFlash(`Recepción confirmada: ${parts.join(' · ')}.`)
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar la recepción.')
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
      const pf: ReceiptPrefill = {
        sourceReceiptId: r.id,
        supplierId: r.supplierId ?? '',
        locationId: r.locationId,
        purchaseOrderId: r.purchaseOrderId,
        supplierDocNumber: r.supplierDocNumber,
        lines: lines.map(l => ({
          recipeItemId: l.recipeItemId,
          productName: l.productName,
          purchaseFormatId: l.purchaseFormatId,
          qtyReceived: l.qtyReceived,
          unitCost: l.unitCost,
          purchaseOrderLineId: l.purchaseOrderLineId,
        })),
      }
      setPrefill(pf)
      setView('form')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la corrección.')
    } finally {
      setBusyId(null)
    }
  }

  // ── Vista SCAN: escanear albarán (OCR) ──
  if (view === 'scan' && activeAccountId) {
    return (
      <ReceiptScanPanel
        accountId={activeAccountId}
        onBack={() => { setView('list'); setReloadTick(t => t + 1) }}
        onCreateReceipt={(ocr) => { setPrefill(null); setOcrPrefill(ocr); setView('form') }}
      />
    )
  }

  // ── Vista FORM: nueva recepción ciega, corrección (prefill) o propuesta OCR ──
  if (view === 'form' && activeAccountId) {
    return (
      <GoodsReceiptForm
        accountId={activeAccountId}
        prefill={prefill}
        ocrPrefill={ocrPrefill}
        onBack={() => { setView(ocrPrefill ? 'scan' : 'list'); setPrefill(null); setOcrPrefill(null); setReloadTick(t => t + 1) }}
        onSaved={(msg) => { setView('list'); setPrefill(null); setOcrPrefill(null); if (msg) setFlash(msg); setReloadTick(t => t + 1) }}
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
            onClick={() => setView('scan')}
            disabled={!activeAccountId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            <ScanLine size={16} />
            Escanear albarán
          </button>
          <button
            type="button"
            onClick={() => { setPrefill(null); setView('form') }}
            disabled={!activeAccountId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            <Plus size={16} />
            Nueva recepción
          </button>
        </div>
      </div>

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
                </div>
                <div className="mt-2">
                  <RowActions r={r} busy={busyId === r.id} onConfirm={handleConfirm} onVoid={handleVoid} onCorrect={handleCorrect} />
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
                    <td className="px-3 py-2 text-text-primary">{r.code ?? '—'}</td>
                    <td className="px-3 py-2 text-text-primary">{r.supplierId ? supplierNameById.get(r.supplierId) ?? '—' : '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">{locationNameById.get(r.locationId) ?? '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">{formatDate(r.receiptDate)}</td>
                    <td className="px-3 py-2 text-text-secondary">{r.supplierDocNumber ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.needsReview && (
                        <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-warning-bg text-warning border border-warning/20">revisar</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end">
                        <RowActions r={r} busy={busyId === r.id} onConfirm={handleConfirm} onVoid={handleVoid} onCorrect={handleCorrect} />
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
              <span className="text-sm text-text-primary">Avisar de caducidad si quedan</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={0} max={60} value={settings.expiryAlertDays}
                  onChange={e => setSettings(s => ({ ...s, expiryAlertDays: Number(e.target.value) }))} disabled={savingSettings}
                  className="w-24 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-sm text-text-secondary">días o menos</span>
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
    </div>
  )
}

function RowActions({
  r, busy, onConfirm, onVoid, onCorrect,
}: {
  r: GoodsReceipt
  busy: boolean
  onConfirm: (id: string) => void
  onVoid: (id: string) => void
  onCorrect: (id: string) => void
}) {
  if (r.status === 'borrador') {
    return (
      <button
        type="button"
        onClick={() => onConfirm(r.id)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={15} />}
        Confirmar
      </button>
    )
  }
  if (r.status === 'confirmado') {
    return (
      <div className="flex items-center gap-2">
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
