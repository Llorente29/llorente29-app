// src/modules/kitchen/components/ComboEditorSection.tsx
//
// Editor de combo (grupos/slots y sus opciones) de la pestaña "En carta" de la
// ficha unificada de plato (CatalogFichaPage). Extraído MECÁNICAMENTE de
// CatalogProductDetailPage.tsx (función local `ComboEditorSection`, antes en
// la sección S0 "Grupos del combo", id="s-combo"). Ver plan
// C:\Users\jgcol\.claude\plans\polished-sniffing-walrus.md, Fase 4.
// Regla de oro: unificar no pierde nada — "mover, no inventar". Sin cambios
// de lógica respecto al original: mismo estado, mismos handlers, mismo JSX.
//
// menu_item-scoped (el combo ES un menu_item, product_type='combo'). El padre
// (EnCartaTab) resuelve "¿es combo?"/"marca del combo"/slots iniciales vía
// getComboContext y solo monta este componente cuando isCombo === true.

import { useEffect, useState } from 'react'
import { Trash2, X, Plus } from 'lucide-react'
import {
  getComboContext, getComboCost,
  createSlot, updateSlot, deleteSlot,
  addOption, updateOption, deleteOption,
  searchOptionCandidates,
  type ComboSlotDetail, type OptionCandidate, type ComboCost,
} from '@/modules/kitchen/services/comboEditService'
import ConfirmDialog from '@/components/ConfirmDialog'

function fmtEur(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

export default function ComboEditorSection({
  accountId, brandId, comboItemId, initialSlots, onChanged,
}: {
  accountId: string; brandId: string | null; comboItemId: string
  initialSlots: ComboSlotDetail[]; onChanged: () => void
}) {
  const [slots, setSlots] = useState<ComboSlotDetail[]>(initialSlots)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // edición inline de nombre de slot
  const [editingSlot, setEditingSlot] = useState<string | null>(null)
  const [slotNameDraft, setSlotNameDraft] = useState('')
  // añadir opción: slot abierto + buscador
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<OptionCandidate[]>([])
  const [searching, setSearching] = useState(false)
  // coste del combo (se recalcula al cambiar slots/opciones)
  const [cost, setCost] = useState<ComboCost | null>(null)
  // Fase 6, B4: confirmación antes de borrar (antes disparaba al instante).
  const [confirmRemoveSlot, setConfirmRemoveSlot] = useState<ComboSlotDetail | null>(null)
  const [confirmRemoveOption, setConfirmRemoveOption] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    getComboCost(comboItemId).then((c) => { if (!cancelled) setCost(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [comboItemId])

  async function reload() {
    const ctx = await getComboContext(accountId, comboItemId)
    setSlots(ctx.slots)
    getComboCost(comboItemId).then(setCost).catch(() => {})
    onChanged()
  }

  function wrap(fn: () => Promise<void>) {
    setBusy(true); setErr(null)
    fn().then(reload).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false))
  }

  // ── Slots ──
  function startRename(s: ComboSlotDetail) { setEditingSlot(s.id); setSlotNameDraft(s.name) }
  function saveRename(slotId: string) {
    const name = slotNameDraft.trim()
    setEditingSlot(null)
    if (!name) return
    wrap(() => updateSlot(accountId, slotId, { name }))
  }
  function setRequired(s: ComboSlotDetail, required: boolean) {
    // obligatorio = min 1; opcional = min 0. max no baja de 1.
    wrap(() => updateSlot(accountId, s.id, { minSelections: required ? Math.max(1, s.minSelections) : 0 }))
  }
  function setMax(s: ComboSlotDetail, max: number) {
    const m = Math.max(1, max)
    wrap(() => updateSlot(accountId, s.id, { maxSelections: m, minSelections: Math.min(s.minSelections, m) }))
  }
  function addSlot() { wrap(() => createSlot(accountId, comboItemId, 'Nuevo grupo', 1, 1).then(() => {})) }
  function doRemoveSlot() {
    if (!confirmRemoveSlot) return
    const id = confirmRemoveSlot.id
    setConfirmRemoveSlot(null)
    wrap(() => deleteSlot(accountId, id))
  }

  // ── Opciones ──
  function openAdd(slotId: string) {
    setAddingTo(slotId); setSearch(''); setCandidates([]); setErr(null)
    if (brandId) runSearch('')
  }
  function runSearch(q: string) {
    if (!brandId) return
    setSearching(true)
    searchOptionCandidates(accountId, brandId, q)
      .then(setCandidates)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setSearching(false))
  }
  function pickOption(slotId: string, c: OptionCandidate) {
    setAddingTo(null)
    wrap(() => addOption(accountId, slotId, c.id, 0, false).then(() => {}))
  }
  function doRemoveOption() {
    if (!confirmRemoveOption) return
    const id = confirmRemoveOption.id
    setConfirmRemoveOption(null)
    wrap(() => deleteOption(accountId, id))
  }
  function toggleDefault(o: { id: string; isDefault: boolean }) {
    wrap(() => updateOption(accountId, o.id, { isDefault: !o.isDefault }))
  }
  function setPriceImpact(optionId: string, raw: string) {
    const v = raw.trim() === '' ? 0 : Number(raw.replace(',', '.'))
    if (Number.isNaN(v)) return
    wrap(() => updateOption(accountId, optionId, { priceImpact: v }))
  }

  return (
    <div className="space-y-3">
      {err && <div className="p-2 rounded-lg bg-red-50 text-red-700 text-xs">{err}</div>}

      {/* Panel de coste del combo (suma de componentes) */}
      {cost && (
        <div className="rounded-lg border border-stone-200 overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-stone-200 bg-stone-50">
            <div className="px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-0.5">Coste</div>
              <div className="font-mono text-sm font-medium">
                {cost.isIncomplete ? `≥ ${fmtEur(cost.cost)}` : fmtEur(cost.cost)}
              </div>
            </div>
            <div className="px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-0.5">Margen</div>
              <div className="font-mono text-sm font-medium">
                {cost.margin != null ? fmtEur(cost.margin) : '—'}
              </div>
            </div>
            <div className="px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-0.5">FC %</div>
              <div className="font-mono text-sm font-medium">
                {cost.fcPct != null ? `${cost.fcPct}%` : '—'}
              </div>
            </div>
          </div>

          {cost.isIncomplete && (
            <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
              <p className="font-medium mb-1">Coste incompleto. Falta costear:</p>
              <ul className="space-y-0.5">
                {cost.detail
                  .filter((d) => d.required && (d.state === 'incomplete' || d.state === 'empty'))
                  .map((d) => (
                    <li key={d.slotId}>
                      · <span className="font-medium">{d.slotName}</span>
                      {d.state === 'empty'
                        ? ' — sin opciones'
                        : d.option ? ` — «${d.option}» sin escandallo` : ' — sin escandallo'}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {!cost.isIncomplete && cost.slotsProvisional > 0 && (
            <div className="px-3 py-2 bg-blue-50 border-t border-blue-200 text-[11px] text-blue-700">
              {cost.slotsProvisional} grupo{cost.slotsProvisional !== 1 ? 's' : ''} con coste provisional (reventa pendiente de factura): el coste subirá cuando entre el precio real.
            </div>
          )}
        </div>
      )}

      {slots.length === 0 && (
        <p className="text-sm text-stone-500">
          Este combo no tiene grupos todavía. Añade el primero (por ejemplo «Elige tu bebida»).
        </p>
      )}

      {slots.map((s) => {
        const required = s.minSelections >= 1
        return (
          <div key={s.id} className="border border-stone-200 rounded-lg overflow-hidden">
            {/* Cabecera del slot */}
            <div className="flex items-center gap-2 px-3 py-2 bg-stone-50">
              {editingSlot === s.id ? (
                <input
                  autoFocus
                  value={slotNameDraft}
                  onChange={(e) => setSlotNameDraft(e.target.value)}
                  onBlur={() => saveRename(s.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(s.id); if (e.key === 'Escape') setEditingSlot(null) }}
                  className="flex-1 text-sm font-medium px-2 py-1 border border-stone-300 rounded"
                />
              ) : (
                <button onClick={() => startRename(s)} className="flex-1 text-left text-sm font-medium hover:text-accent" title="Renombrar grupo">
                  {s.name}
                </button>
              )}

              {/* Obligatorio / opcional */}
              <label className="flex items-center gap-1 text-[11px] text-stone-600 cursor-pointer">
                <input type="checkbox" checked={required} disabled={busy} onChange={(e) => setRequired(s, e.target.checked)} />
                Obligatorio
              </label>

              {/* Máximo a elegir */}
              <label className="flex items-center gap-1 text-[11px] text-stone-600">
                Elige hasta
                <input
                  type="number" min={1} value={s.maxSelections} disabled={busy}
                  onChange={(e) => setMax(s, Number(e.target.value))}
                  className="w-12 px-1 py-0.5 border border-stone-300 rounded text-center"
                />
              </label>

              <button onClick={() => setConfirmRemoveSlot(s)} disabled={busy} className="text-stone-400 hover:text-red-600 p-1" title="Quitar grupo">
                <Trash2 size={14} />
              </button>
            </div>

            {/* Opciones del slot */}
            <div className="px-3 py-2 space-y-1.5">
              {s.options.length === 0 && (
                <p className="text-xs text-stone-400">Sin opciones. Añade productos elegibles.</p>
              )}
              {s.options.map((o) => (
                <div key={o.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{o.optionName}</span>
                  <label className="flex items-center gap-1 text-[11px] text-stone-500" title="Opción por defecto">
                    <input type="checkbox" checked={o.isDefault} disabled={busy} onChange={() => toggleDefault(o)} />
                    Defecto
                  </label>
                  <div className="flex items-center gap-0.5 text-[11px] text-stone-500" title="Suplemento de precio (€)">
                    <span>+€</span>
                    <input
                      type="text" defaultValue={o.priceImpact ? String(o.priceImpact) : ''}
                      placeholder="0" disabled={busy}
                      onBlur={(e) => setPriceImpact(o.id, e.target.value)}
                      className="w-14 px-1 py-0.5 border border-stone-200 rounded text-right"
                    />
                  </div>
                  <button onClick={() => setConfirmRemoveOption({ id: o.id, name: o.optionName })} disabled={busy} className="text-stone-300 hover:text-red-600 p-0.5" title="Quitar opción">
                    <X size={13} />
                  </button>
                </div>
              ))}

              {/* Añadir opción */}
              {addingTo === s.id ? (
                <div className="mt-2 p-2 rounded-lg bg-stone-50 border border-stone-200">
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); runSearch(e.target.value) }}
                    placeholder="Buscar producto de la marca…"
                    className="w-full text-sm px-2 py-1 border border-stone-300 rounded mb-1.5"
                  />
                  {searching ? (
                    <p className="text-xs text-stone-400 px-1">Buscando…</p>
                  ) : candidates.length === 0 ? (
                    <p className="text-xs text-stone-400 px-1">{brandId ? 'Sin resultados.' : 'Combo sin marca; no se puede buscar.'}</p>
                  ) : (
                    <div className="max-h-44 overflow-y-auto divide-y divide-stone-100">
                      {candidates.map((c) => (
                        <button key={c.id} onClick={() => pickOption(s.id, c)} disabled={busy}
                          className="flex items-center justify-between w-full px-2 py-1.5 text-sm hover:bg-white text-left">
                          <span className="truncate">{c.name}</span>
                          <span className="text-xs text-stone-400 ml-2 shrink-0">{fmtEur(c.price)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setAddingTo(null)} className="text-xs text-stone-500 underline mt-1.5">Cerrar</button>
                </div>
              ) : (
                <button onClick={() => openAdd(s.id)} disabled={busy}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline mt-1">
                  <Plus size={12} /> Añadir opción
                </button>
              )}
            </div>
          </div>
        )
      })}

      <button onClick={addSlot} disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-50">
        <Plus size={13} /> Añadir grupo
      </button>

      <ConfirmDialog
        open={confirmRemoveSlot !== null}
        title="Quitar grupo"
        message={confirmRemoveSlot ? `¿Quitar el grupo «${confirmRemoveSlot.name}»? Se perderán sus opciones.` : ''}
        tone="danger"
        confirmLabel="Quitar"
        busy={busy}
        onConfirm={doRemoveSlot}
        onCancel={() => setConfirmRemoveSlot(null)}
      />
      <ConfirmDialog
        open={confirmRemoveOption !== null}
        title="Quitar opción"
        message={confirmRemoveOption ? `¿Quitar la opción «${confirmRemoveOption.name}»?` : ''}
        tone="danger"
        confirmLabel="Quitar"
        busy={busy}
        onConfirm={doRemoveOption}
        onCancel={() => setConfirmRemoveOption(null)}
      />
    </div>
  )
}
