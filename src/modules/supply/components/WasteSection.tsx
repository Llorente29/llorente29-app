// src/modules/supply/components/WasteSection.tsx
//
// Pestaña "Merma" de Inventario (T2.3). Registro proactivo: el cocinero apunta
// lo que tira en el momento. Fila de alta rápida arriba (artículo → cantidad en
// unidad base → causa → foto opcional → registrar) + listado del periodo con €.
//
// "Rápido y reflejo" (lo que hace que un waste log se use, según el benchmark):
// alta siempre visible, un registro = una merma, coste mostrado al vuelo.
//
// Unidad: BASE del artículo (g/ml/ud) hoy. Las unidades de uso amigables entran
// con su propio frente (7); la RPC ya las admite.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Trash2, Loader2, Plus, RefreshCw, Search, Camera, X, Image as ImageIcon, Calculator,
} from 'lucide-react'
import FormatCalculator from '@/modules/kitchen/components/FormatCalculator'
import {
  listInventoryItems,
  type InventoryItem,
} from '@/modules/supply/services/storageAreaService'
import {
  registerWaste,
  listWaste,
  uploadWastePhoto,
  WASTE_REASONS,
  reasonLabel,
  type WasteEvent,
} from '@/modules/supply/services/wasteService'

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'all'

function rangeFor(key: RangeKey): { from: string | null; to: string | null } {
  const now = new Date()
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const iso = (d: Date) => d.toISOString()
  const tomorrow = startOfDay(new Date(now.getTime() + 86400000))
  switch (key) {
    case 'today': return { from: iso(startOfDay(now)), to: iso(tomorrow) }
    case '7d':    return { from: iso(startOfDay(new Date(now.getTime() - 6 * 86400000))), to: iso(tomorrow) }
    case '30d':   return { from: iso(startOfDay(new Date(now.getTime() - 29 * 86400000))), to: iso(tomorrow) }
    case 'month': return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(tomorrow) }
    case 'all':   return { from: null, to: null }
  }
}

const fmtEur = (v: number | null) =>
  v === null || v === undefined ? '—'
    : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
const fmtQty = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(v)
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function WasteSection({
  accountId, locationId, userId, userName, onError, onFlash,
}: {
  accountId: string
  locationId: string
  userId: string | null
  userName: string | null
  onError: (m: string) => void
  onFlash: (m: string) => void
}) {
  // Catálogo de artículos del local (raw activos).
  const [items, setItems] = useState<InventoryItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)

  // Alta rápida.
  const [search, setSearch] = useState('')
  const [pickedItem, setPickedItem] = useState<InventoryItem | null>(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Modal de calculadora de formatos abierto (para el artículo elegido).
  const [calcOpen, setCalcOpen] = useState(false)

  // Listado.
  const [rangeKey, setRangeKey] = useState<RangeKey>('today')
  const [rows, setRows] = useState<WasteEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  const range = useMemo(() => rangeFor(rangeKey), [rangeKey])

  // Cargar artículos (raw activos de la cuenta) una vez.
  useEffect(() => {
    if (!accountId) { setItems([]); return }
    let cancelled = false
    setItemsLoading(true)
    ;(async () => {
      try {
        const data = await listInventoryItems(accountId)
        if (!cancelled) setItems(data)
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando artículos.')
      } finally {
        if (!cancelled) setItemsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cargar mermas del periodo.
  useEffect(() => {
    if (!accountId || !locationId) { setRows([]); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const data = await listWaste({ accountId, locationId, from: range.from, to: range.to })
        if (!cancelled) setRows(data)
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando las mermas.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId, locationId, range.from, range.to, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [] as InventoryItem[]
    return items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 8)
  }, [items, search])

  const totalEur = useMemo(() => rows.reduce((s, r) => s + (r.costEur ?? 0), 0), [rows])

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setPhotoFile(f)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(f ? URL.createObjectURL(f) : null)
  }

  function clearForm() {
    setPickedItem(null); setSearch(''); setQty(''); setReason(''); setNotes('')
    setPhotoFile(null)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const qtyNum = qty.trim() === '' ? null : Number(qty.replace(',', '.'))
  const canSave =
    !!pickedItem && qtyNum !== null && !Number.isNaN(qtyNum) && qtyNum > 0 &&
    reason !== '' && (reason !== 'otro' || notes.trim() !== '') && !saving

  async function handleRegister() {
    if (!pickedItem || qtyNum === null) return
    setSaving(true); onError('')
    try {
      let photoUrl: string | null = null
      if (photoFile) {
        const up = await uploadWastePhoto(photoFile)
        photoUrl = up.url
      }
      const res = await registerWaste({
        accountId, locationId,
        recipeItemId: pickedItem.recipeItemId,
        reasonCode: reason,
        qtyBase: qtyNum,
        photoUrl,
        notes: notes.trim() || null,
        userId, userName,
      })
      onFlash(`Merma registrada: ${pickedItem.name} · ${fmtEur(res.costEur)}.`)
      clearForm()
      setReloadTick(t => t + 1)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo registrar la merma.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Apunta lo que tiras en el momento. Baja el stock y queda con su causa — luego
        aparece como merma explicada en el AvT.
      </p>

      {/* Alta rápida */}
      <div className="border border-border-default rounded-lg p-3 bg-card space-y-3">
        {/* Artículo */}
        {pickedItem ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-text-primary font-medium">{pickedItem.name}</span>
            <button type="button" onClick={() => { setPickedItem(null); setSearch('') }}
              className="text-text-tertiary hover:text-text-primary p-1"><X size={15} /></button>
          </div>
        ) : (
          <div className="relative">
            <div className="flex items-center gap-2 border border-border-default rounded-md px-2 bg-page">
              <Search size={15} className="text-text-tertiary" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder={itemsLoading ? 'Cargando artículos…' : 'Busca el artículo que tiras…'}
                className="flex-1 px-1 py-2 text-sm bg-transparent text-text-primary focus:outline-none" />
            </div>
            {filtered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-card border border-border-default rounded-md shadow-lg max-h-56 overflow-y-auto">
                {filtered.map(i => (
                  <button key={i.recipeItemId} type="button"
                    onClick={() => { setPickedItem(i); setSearch('') }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-page text-text-primary">
                    <span className="flex-1">{i.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Cantidad + causa */}
        <div className="flex items-end gap-2 flex-wrap">
          <div className="block">
            <span className="text-[11px] text-text-secondary">Cantidad (en unidad base)</span>
            <div className="mt-0.5 flex items-center gap-1">
              <input type="text" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)}
                placeholder="0" disabled={!pickedItem}
                className="w-28 px-3 py-2 text-sm text-right border border-border-default rounded-md bg-page text-text-primary disabled:opacity-50" />
              <button type="button" onClick={() => setCalcOpen(true)} disabled={!pickedItem}
                title="Calculadora de formatos (cuenta por cajas y suma solo)"
                aria-label="Abrir calculadora de formatos"
                className="p-2 rounded-md border border-border-default text-text-secondary hover:text-accent hover:bg-accent-bg disabled:opacity-50 disabled:cursor-not-allowed transition-base">
                <Calculator size={15} />
              </button>
            </div>
          </div>
          <label className="block flex-1 min-w-[160px]">
            <span className="text-[11px] text-text-secondary">Causa</span>
            <select value={reason} onChange={e => setReason(e.target.value)} disabled={!pickedItem}
              className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary disabled:opacity-50">
              <option value="">— Elige causa —</option>
              {WASTE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          {/* Foto opcional */}
          <div>
            <span className="text-[11px] text-text-secondary block">Foto</span>
            <input ref={fileRef} type="file" accept="image/*" capture="environment"
              onChange={onPickPhoto} className="hidden" id="waste-photo" />
            <label htmlFor="waste-photo"
              className="mt-0.5 inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-border-default text-text-secondary hover:bg-page cursor-pointer transition-base">
              {photoPreview ? <ImageIcon size={15} className="text-accent" /> : <Camera size={15} />}
              {photoPreview ? 'Cambiar' : 'Añadir'}
            </label>
          </div>
        </div>

        {/* Nota (obligatoria si causa = otro) */}
        {(reason === 'otro' || notes) && (
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={reason === 'otro' ? 'Describe el motivo (obligatorio)' : 'Nota (opcional)'}
            className="w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
        )}

        {photoPreview && (
          <div className="flex items-center gap-2">
            <img src={photoPreview} alt="merma" className="h-16 w-16 object-cover rounded-md border border-border-default" />
            <button type="button" onClick={() => { setPhotoFile(null); if (photoPreview) URL.revokeObjectURL(photoPreview); setPhotoPreview(null); if (fileRef.current) fileRef.current.value = '' }}
              className="text-xs text-text-tertiary hover:text-danger">Quitar foto</button>
          </div>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={handleRegister} disabled={!canSave}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Registrar merma
          </button>
        </div>
      </div>

      {/* Rango + recargar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {([['today', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['month', 'Mes'], ['all', 'Todo']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setRangeKey(k)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-base ${rangeKey === k ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setReloadTick(t => t + 1)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border-default text-text-secondary hover:bg-page transition-base">
          <RefreshCw size={13} /> Actualizar
        </button>
      </div>

      {/* Listado */}
      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          <Trash2 size={28} className="mx-auto mb-2 text-text-tertiary" />
          Sin mermas en este periodo.
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
            <span className="flex-1">Artículo</span>
            <span className="w-24 text-right">Cantidad</span>
            <span className="w-32">Causa</span>
            <span className="w-28">Cuándo</span>
            <span className="w-20 text-right">Coste</span>
            <span className="w-8" />
          </div>
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
              <span className="flex-1 text-text-primary">
                {r.itemName}
                {r.notes && <span className="block text-xs text-text-tertiary">{r.notes}</span>}
              </span>
              <span className="w-24 text-right text-text-secondary tabular-nums">
                {fmtQty(r.qtyBase)}{r.unitAbbr ? ` ${r.unitAbbr}` : ''}
              </span>
              <span className="w-32 text-xs text-text-secondary">{reasonLabel(r.reasonCode)}</span>
              <span className="w-28 text-xs text-text-tertiary">{fmtDate(r.occurredAt)}</span>
              <span className="w-20 text-right text-text-primary font-medium tabular-nums">{fmtEur(r.costEur)}</span>
              <span className="w-8 text-right">
                {r.photoUrl && (
                  <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" title="Ver foto"
                    className="text-text-tertiary hover:text-accent inline-flex"><ImageIcon size={15} /></a>
                )}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-3 px-3 py-2.5 border-t-2 border-border-default bg-page">
            <span className="flex-1 text-sm font-medium text-text-primary">{rows.length} merma{rows.length === 1 ? '' : 's'}</span>
            <span className="w-24" /><span className="w-32" /><span className="w-28" />
            <span className="w-20 text-right text-text-primary font-semibold tabular-nums">{fmtEur(totalEur)}</span>
            <span className="w-8" />
          </div>
        </div>
      )}

      {calcOpen && pickedItem && (
        <FormatCalculator
          itemId={pickedItem.recipeItemId}
          itemName={pickedItem.name}
          baseAbbr={null}
          initialQtyInBase={qtyNum !== null && Number.isFinite(qtyNum) ? qtyNum : null}
          onAccept={(q) => { setQty(String(q)); setCalcOpen(false) }}
          onClose={() => setCalcOpen(false)}
        />
      )}
    </div>
  )
}
