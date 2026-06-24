// src/modules/supply/components/PostPendingModal.tsx
//
// Modal "Meter al stock" — solución definitiva. Lista las líneas de una recepción
// confirmada que NO han entrado al almacén, cada una con su RAZÓN y la ACCIÓN para
// resolverla SIN SALIR del modal:
//   · sin_articulo  → casar a un ingrediente (reusa LineMatchPicker, que además
//                     crea artículos nuevos al vuelo con sugerencia IA).
//   · sin_formato   → montar el formato de compra aquí mismo (reusa ensurePackTree).
//   · sin_cantidad  → corregir la cantidad recibida.
// Al resolver una línea, se postea sola y desaparece de la lista. Cuando no queda
// ninguna, el modal avisa de que está todo metido.

import { useEffect, useState } from 'react'
import { X, AlertTriangle, PackageCheck, Loader2, Link2, Box } from 'lucide-react'
import LineMatchPicker from '@/modules/supply/pages/LineMatchPicker'
import {
  updateGoodsReceiptLine,
  postPendingReceiptLine,
} from '@/modules/supply/services/goodsReceiptService'
import {
  ensurePackTree,
  createPurchaseFormat,
  linkSupplierFormat,
  updateArticleSupplier,
  listSuppliersByItem,
} from '@/modules/kitchen/services/purchaseFormatService'
import { convertToBase } from '@/modules/kitchen/lib/unitConversion'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import { getRecipeItemById, updateRecipeItem } from '@/modules/kitchen/services/recipeItemService'
import type { KitchenUnit } from '@/types/kitchen'

export interface PendingLine {
  lineId: string
  itemId: string | null
  name: string
  reason: string // 'sin_articulo' | 'sin_formato' | 'sin_cantidad'
  rawText?: string | null
  supplierCode?: string | null
  baseUnitId?: string | null
  costStrategy?: string | null
}

interface PostPendingModalProps {
  accountId: string
  receiptCode: string
  supplierId: string | null
  posted: number
  lines: PendingLine[]
  actorId: string | null
  actorName: string | null
  onClose: () => void
  /** Tras resolver una o varias líneas: refresca la lista de fuera. */
  onChanged: () => void
}

export default function PostPendingModal({
  accountId, receiptCode, supplierId, posted, lines: initialLines, actorId, actorName, onClose, onChanged,
}: PostPendingModalProps) {
  const [lines, setLines] = useState<PendingLine[]>(initialLines)
  const [postedCount, setPostedCount] = useState(posted)
  // Estado de qué línea está siendo resuelta y con qué herramienta.
  const [matchFor, setMatchFor] = useState<PendingLine | null>(null)
  const [formatFor, setFormatFor] = useState<PendingLine | null>(null)
  const [busyLine, setBusyLine] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function removeLine(lineId: string) {
    setLines(prev => prev.filter(l => l.lineId !== lineId))
  }

  // Reintenta postear una línea ya resuelta (casada o con formato).
  async function tryPost(line: PendingLine, itemId: string | null) {
    setBusyLine(line.lineId); setError(null)
    try {
      const ok = await postPendingReceiptLine(line.lineId, itemId)
      if (ok) {
        setPostedCount(c => c + 1)
        removeLine(line.lineId)
        onChanged()
      } else {
        setError(`"${line.name}" aún no ha podido entrar. Revisa que el formato tenga una cantidad válida.`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo meter la línea al stock.')
    } finally {
      setBusyLine(null)
    }
  }

  // Casado elegido en el LineMatchPicker: persiste el recipe_item_id en la línea
  // y reintenta postear (puede que aún le falte formato → entonces pasa a sin_formato).
  async function handleChoose(recipeItemId: string) {
    const line = matchFor
    if (!line) return
    setMatchFor(null)
    setBusyLine(line.lineId); setError(null)
    try {
      await updateGoodsReceiptLine(line.lineId, { recipeItemId })
      const ok = await postPendingReceiptLine(line.lineId, recipeItemId)
      if (ok) {
        setPostedCount(c => c + 1)
        removeLine(line.lineId)
        onChanged()
      } else {
        // Casó pero falta formato: la línea cambia de razón y muestra el botón de formato.
        setLines(prev => prev.map(l =>
          l.lineId === line.lineId
            ? { ...l, itemId: recipeItemId, reason: 'sin_formato' }
            : l))
        onChanged()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo casar el artículo.')
    } finally {
      setBusyLine(null)
    }
  }

  const allDone = lines.length === 0

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border-default flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">{receiptCode} · Meter al stock</h3>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {postedCount > 0 && (
            <div className="flex items-center gap-2 text-sm text-success bg-success-bg border border-success/20 rounded-md px-3 py-2">
              <PackageCheck size={15} className="shrink-0" /> {postedCount} línea(s) metida(s) al almacén.
            </div>
          )}

          {error && (
            <div className="text-sm text-danger bg-danger-bg border border-danger/20 rounded-md px-3 py-2">{error}</div>
          )}

          {allDone ? (
            <div className="text-center py-6">
              <PackageCheck size={32} className="mx-auto text-success mb-2" />
              <p className="text-sm text-text-primary font-medium">Todo el género entró al almacén.</p>
              <p className="text-xs text-text-secondary mt-1">No queda nada pendiente en esta recepción.</p>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-danger flex items-center gap-1.5">
                <AlertTriangle size={15} /> {lines.length} línea(s) sin meter — resuélvelas aquí:
              </p>
              <ul className="space-y-2">
                {lines.map(line => (
                  <li key={line.lineId} className="border border-border-default rounded-md px-3 py-2.5">
                    <div className="font-medium text-text-primary text-sm">{line.name}</div>
                    <div className="text-xs text-text-secondary mt-0.5 mb-2">
                      {line.reason === 'sin_articulo' && 'No se sabe qué ingrediente es. Cásalo a uno (o crea uno nuevo).'}
                      {line.reason === 'sin_formato' && 'Falta el formato de compra (cuánto trae cada caja/pieza).'}
                      {line.reason === 'sin_cantidad' && 'La cantidad recibida es 0 o está vacía.'}
                    </div>

                    {busyLine === line.lineId ? (
                      <div className="text-xs text-text-secondary flex items-center gap-1.5">
                        <Loader2 size={13} className="animate-spin" /> Metiendo al stock…
                      </div>
                    ) : line.reason === 'sin_articulo' ? (
                      <button type="button" onClick={() => setMatchFor(line)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">
                        <Link2 size={13} /> Casar artículo
                      </button>
                    ) : line.reason === 'sin_formato' ? (
                      <button type="button" onClick={() => setFormatFor(line)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">
                        <Box size={13} /> Montar formato
                      </button>
                    ) : (
                      <p className="text-xs text-text-secondary">
                        Corrige la cantidad desde "Anular y corregir".
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="p-4 border-t border-border-default flex justify-end">
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">
            {allDone ? 'Listo' : 'Cerrar'}
          </button>
        </div>
      </div>

      {/* Casar artículo: reusa el picker del flujo de recepción (busca, propone IA, crea nuevo) */}
      {matchFor && (
        <LineMatchPicker
          accountId={accountId}
          rawText={matchFor.rawText ?? matchFor.name}
          supplierCode={matchFor.supplierCode ?? null}
          candidates={[]}
          currentRecipeItemId={matchFor.itemId}
          createdBy={actorId}
          createdByName={actorName}
          onChoose={(itemId) => void handleChoose(itemId)}
          onClear={() => setMatchFor(null)}
          onClose={() => setMatchFor(null)}
        />
      )}

      {/* Montar formato: editor compacto que reusa ensurePackTree */}
      {formatFor && formatFor.itemId && (
        <FormatEditor
          accountId={accountId}
          itemId={formatFor.itemId}
          supplierId={supplierId}
          baseUnitId={formatFor.baseUnitId ?? null}
          costStrategy={formatFor.costStrategy ?? null}
          actorId={actorId}
          actorName={actorName}
          onCancel={() => setFormatFor(null)}
          onSaved={() => {
            const line = formatFor
            setFormatFor(null)
            if (line) void tryPost(line, line.itemId)
          }}
        />
      )}
    </div>
  )
}

// ── Editor de formato compacto (mismo modelo que la ficha: simple o caja×pieza) ──

interface FormatEditorProps {
  accountId: string
  itemId: string
  supplierId: string | null
  baseUnitId: string | null
  costStrategy: string | null
  actorId: string | null
  actorName: string | null
  onCancel: () => void
  onSaved: () => void
}

function FormatEditor({
  accountId, itemId, supplierId, baseUnitId, costStrategy, actorId, actorName, onCancel, onSaved,
}: FormatEditorProps) {
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [baseUnit, setBaseUnit] = useState<KitchenUnit | null>(null)
  const [loadingUnits, setLoadingUnits] = useState(true)
  const [mode, setMode] = useState<'simple' | 'pack'>('simple')
  // simple: un total (Saco 25 kg)
  const [simpleName, setSimpleName] = useState('Formato')
  const [simpleQty, setSimpleQty] = useState('')
  const [simpleUnit, setSimpleUnit] = useState<string>('')
  // pack: caja con N piezas
  const [cajaName, setCajaName] = useState('Caja')
  const [count, setCount] = useState('')
  const [innerName, setInnerName] = useState('Pieza')
  const [innerQty, setInnerQty] = useState('')
  const [innerUnit, setInnerUnit] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Carga las unidades y resuelve la unidad base real del artículo.
  useEffect(() => {
    let cancelled = false
    Promise.all([listUnits(), baseUnitId ? Promise.resolve(baseUnitId) : getRecipeItemById(itemId).then(i => i?.baseUnitId ?? null)])
      .then(([us, bId]) => {
        if (cancelled) return
        setUnits(us)
        const bu = us.find(u => u.id === bId) ?? null
        setBaseUnit(bu)
        // Por defecto, el selector arranca en la unidad base.
        if (bu) { setSimpleUnit(bu.id); setInnerUnit(bu.id) }
        else if (us[0]) { setSimpleUnit(us[0].id); setInnerUnit(us[0].id) }
      })
      .catch(() => { if (!cancelled) setErr('No se pudieron cargar las unidades.') })
      .finally(() => { if (!cancelled) setLoadingUnits(false) })
    return () => { cancelled = true }
  }, [itemId, baseUnitId])

  async function flipStrategyIfNeeded() {
    if (costStrategy === 'fixed') {
      await updateRecipeItem(itemId, { costStrategy: 'last_purchase' })
    }
  }

  // Enlaza el formato al proveedor del artículo (UPDATE → recostea). Si el
  // artículo aún no tiene proveedor (recién creado al casar), lo enlaza al
  // proveedor de la recepción (el del albarán). Si no hay ni eso, avisa.
  async function attachFormatToSupplier(formatId: string): Promise<boolean> {
    const links = await listSuppliersByItem(itemId)
    const target = links.find(l => l.isPreferred) ?? links[0] ?? null
    if (target) {
      await updateArticleSupplier(target.id, { purchaseFormatId: formatId })
      return true
    }
    if (supplierId) {
      await linkSupplierFormat({
        accountId, recipeItemId: itemId, supplierId,
        purchaseFormatId: formatId, isPreferred: true,
      })
      return true
    }
    setErr('Este artículo no tiene proveedor y la recepción tampoco. Añádele uno desde su ficha (Compra / Proveedores).')
    return false
  }

  async function save() {
    setErr(null)
    if (!baseUnit) { setErr('No se pudo resolver la unidad base del artículo.'); return }
    try {
      await flipStrategyIfNeeded()
      if (mode === 'simple') {
        const qty = Number(simpleQty.replace(',', '.'))
        if (!(qty > 0)) { setErr('Pon una cantidad válida.'); return }
        const unit = units.find(u => u.id === simpleUnit) ?? baseUnit
        const conv = convertToBase(qty, unit, baseUnit)
        if (!conv || !conv.ok || !(conv.qtyInBase > 0)) { setErr('Esa unidad no se puede convertir a la base del artículo.'); return }
        setSaving(true)
        const fmt = await createPurchaseFormat({
          accountId, itemId, name: simpleName.trim() || 'Formato',
          qtyInBase: conv.qtyInBase, source: 'manual', createdBy: actorId, createdByName: actorName,
        })
        const ok = await attachFormatToSupplier(fmt.id)
        if (!ok) { setSaving(false); return }
      } else {
        const n = Number(count.replace(',', '.'))
        const iq = Number(innerQty.replace(',', '.'))
        if (!(n > 0)) { setErr('¿Cuántas piezas por caja?'); return }
        if (!(iq > 0)) { setErr('¿Cuánto trae cada pieza?'); return }
        const unit = units.find(u => u.id === innerUnit) ?? baseUnit
        const conv = convertToBase(iq, unit, baseUnit)
        if (!conv || !conv.ok || !(conv.qtyInBase > 0)) { setErr('La unidad de la pieza no se puede convertir a la base.'); return }
        setSaving(true)
        const { caja } = await ensurePackTree({
          accountId, itemId, count: n, innerQtyInBase: conv.qtyInBase,
          innerName: innerName.trim() || 'Pieza', cajaName: cajaName.trim() || 'Caja',
          source: 'manual', createdBy: actorId, createdByName: actorName,
        })
        const ok = await attachFormatToSupplier(caja.id)
        if (!ok) { setSaving(false); return }
      }
      onSaved()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar el formato.')
      setSaving(false)
    }
  }

  const unitOptions = units.length > 0 ? units : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="bg-card rounded-lg shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border-default flex items-center justify-between">
          <h3 className="font-medium text-text-primary text-sm">Montar formato de compra</h3>
          <button type="button" onClick={onCancel} className="text-text-secondary hover:text-text-primary"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          {loadingUnits ? (
            <div className="text-sm text-text-secondary flex items-center gap-2 py-4 justify-center">
              <Loader2 size={15} className="animate-spin" /> Cargando unidades…
            </div>
          ) : (
          <>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('simple')}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium border transition-base ${mode === 'simple' ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
              Un total
            </button>
            <button type="button" onClick={() => setMode('pack')}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium border transition-base ${mode === 'pack' ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
              Caja con piezas
            </button>
          </div>

          {mode === 'simple' ? (
            <div className="space-y-2">
              <input type="text" value={simpleName} onChange={e => setSimpleName(e.target.value)} placeholder="Nombre (ej: Saco)"
                className="w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
              <div className="flex gap-2">
                <input type="text" inputMode="decimal" value={simpleQty} onChange={e => setSimpleQty(e.target.value)} placeholder="Cantidad"
                  className="flex-1 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <select value={simpleUnit} onChange={e => setSimpleUnit(e.target.value)}
                  className="px-2 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent">
                  {unitOptions.map(u => <option key={u.id} value={u.id}>{u.abbreviation}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <input type="text" value={cajaName} onChange={e => setCajaName(e.target.value)} placeholder="Caja"
                  className="flex-1 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-xs text-text-secondary">=</span>
                <input type="text" inputMode="decimal" value={count} onChange={e => setCount(e.target.value)} placeholder="¿cuántas?"
                  className="w-24 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
              </div>
              <div className="flex gap-2 items-center">
                <input type="text" value={innerName} onChange={e => setInnerName(e.target.value)} placeholder="Pieza (ej: Lata)"
                  className="flex-1 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <span className="text-xs text-text-secondary">de</span>
                <input type="text" inputMode="decimal" value={innerQty} onChange={e => setInnerQty(e.target.value)} placeholder="contenido"
                  className="w-20 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                <select value={innerUnit} onChange={e => setInnerUnit(e.target.value)}
                  className="px-2 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent">
                  {unitOptions.map(u => <option key={u.id} value={u.id}>{u.abbreviation}</option>)}
                </select>
              </div>
              {Number(count.replace(',', '.')) > 0 && Number(innerQty.replace(',', '.')) > 0 && (
                <p className="text-xs text-text-secondary">
                  1 {cajaName || 'Caja'} = {count} × {innerQty} = {Number(count.replace(',', '.')) * Number(innerQty.replace(',', '.'))}
                </p>
              )}
            </div>
          )}

          {err && <p className="text-xs text-danger">{err}</p>}
          </>
          )}
        </div>
        <div className="p-4 border-t border-border-default flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={saving}
            className="px-3 py-2 rounded-md text-sm border border-border-default bg-card hover:bg-page disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => void save()} disabled={saving || loadingUnits}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />} Guardar y meter al stock
          </button>
        </div>
      </div>
    </div>
  )
}
