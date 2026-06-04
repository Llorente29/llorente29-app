// src/modules/supply/pages/LineMatchPicker.tsx
//
// C2.2.b.1 — Casar una línea de albarán con un artículo (recipe_item type='raw').
// Muestra los candidatos que propuso run_mapping (con semáforo y por qué casó) y
// un buscador manual sobre los artículos de la cuenta. IA propone, humano decide.
// (Crear artículo nuevo al vuelo = b.2; se añadirá aquí.)

import { useEffect, useRef, useState } from 'react'
import { X, Search, Check, Loader2, Plus } from 'lucide-react'
import { listRecipeItems } from '@/modules/kitchen/services/recipeItemService'
import {
  matchTypeLabel,
  quickCreateRawItem,
  listSupplyFamilies,
  suggestItemAttributes,
  BASE_UNITS,
  type LineMatchCandidate,
  type SupplyFamily,
} from '@/modules/supply/services/goodsReceiptService'

interface LineMatchPickerProps {
  accountId: string
  rawText: string
  supplierCode: string | null
  candidates: LineMatchCandidate[]
  currentRecipeItemId: string | null
  createdBy: string | null
  createdByName: string | null
  onChoose: (recipeItemId: string, name: string, semaphore: 'green' | 'yellow' | null, matchType: string | null) => void
  onClear: () => void
  onClose: () => void
}

interface SearchHit { id: string; name: string }

export default function LineMatchPicker({
  accountId, rawText, supplierCode, candidates, currentRecipeItemId, createdBy, createdByName, onChoose, onClear, onClose,
}: LineMatchPickerProps) {
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // C2.2.b.2 — alta de artículo nuevo (nombre prerelleno con el raw_text).
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState(rawText)
  const [newUnit, setNewUnit] = useState(BASE_UNITS[0].id)
  const [newFamily, setNewFamily] = useState('')
  const [families, setFamilies] = useState<SupplyFamily[]>([])
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  // C2.2.b.6 — sugerencia IA al abrir el alta (degrada limpio si falla).
  const [suggesting, setSuggesting] = useState(false)
  const [suggested, setSuggested] = useState<{ name: boolean; family: boolean; unit: boolean }>({ name: false, family: false, unit: false })

  useEffect(() => {
    if (!createOpen) return
    let cancelled = false
    // Familias primero (las necesita la sugerencia y el selector).
    listSupplyFamilies(accountId)
      .then(fams => {
        if (cancelled) return
        setFamilies(fams)
        setSuggesting(true)
        return suggestItemAttributes(rawText, null, fams.map(f => ({ id: f.id, name: f.name })))
      })
      .then(sug => {
        if (cancelled || !sug) return
        setSuggested({
          name: !!sug.name,
          family: !!sug.familyId,
          unit: !!sug.baseUnit,
        })
        if (sug.name) setNewName(sug.name)
        if (sug.familyId) setNewFamily(sug.familyId)
        if (sug.baseUnit) {
          const u = BASE_UNITS.find(b => b.dimension === sug.baseUnit)
          if (u) setNewUnit(u.id)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSuggesting(false) })
    return () => { cancelled = true }
  }, [createOpen, accountId, rawText])

  async function handleCreate() {
    if (!newName.trim()) { setCreateErr('Pon un nombre.'); return }
    setCreating(true); setCreateErr(null)
    try {
      const item = await quickCreateRawItem(accountId, newName, newUnit, newFamily || null, createdBy, createdByName)
      onChoose(item.id, item.name, 'green', 'created')
    } catch (err: unknown) {
      setCreateErr(err instanceof Error ? err.message : 'No se pudo crear el artículo.')
      setCreating(false)
    }
  }

  useEffect(() => {
    if (search.trim().length < 2) { setHits([]); return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const items = await listRecipeItems({ accountId, type: 'raw', search: search.trim(), includeInactive: false, limit: 20 })
        setHits(items.map(i => ({ id: i.id, name: i.name })))
      } catch {
        setHits([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [search, accountId])

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-card rounded-lg border border-border-default shadow-lg w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border-default">
          <div className="min-w-0">
            <h3 className="text-base font-medium text-text-primary">Casar artículo</h3>
            <p className="text-xs text-text-secondary mt-0.5 truncate">
              Albarán: {rawText}{supplierCode ? ` · cód. ${supplierCode}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-text-secondary hover:text-text-primary" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Candidatos propuestos por la memoria (run_mapping) */}
          {candidates.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-secondary mb-1.5">Propuestas</p>
              <ul className="space-y-1">
                {candidates.map(c => (
                  <li key={c.recipeItemId}>
                    <button type="button"
                      onClick={() => onChoose(c.recipeItemId, c.name, c.semaphore, c.matchType)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm text-left transition-base hover:bg-page ${c.recipeItemId === currentRecipeItemId ? 'border-accent bg-accent-bg/40' : 'border-border-default bg-page'}`}>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${c.semaphore === 'green' ? 'bg-success' : 'bg-warning'}`} />
                        <span className="truncate text-text-primary">{c.name}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 text-[11px] text-text-secondary">
                        {matchTypeLabel(c.matchType)} · {Math.round(c.confidence * 100)}%
                        {c.recipeItemId === currentRecipeItemId && <Check size={13} className="text-accent" />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Buscador manual */}
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-secondary mb-1.5">Buscar artículo</p>
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} autoFocus
                placeholder="Nombre del artículo…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            {searching && <p className="text-xs text-text-secondary mt-2 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Buscando…</p>}
            {!searching && search.trim().length >= 2 && hits.length === 0 && (
              <p className="text-xs text-text-secondary mt-2">Sin resultados.</p>
            )}
            {hits.length > 0 && (
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {hits.map(h => (
                  <li key={h.id}>
                    <button type="button"
                      onClick={() => onChoose(h.id, h.name, null, 'manual')}
                      className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-base hover:bg-page ${h.id === currentRecipeItemId ? 'border-accent bg-accent-bg/40' : 'border-border-default bg-page'}`}>
                      <span className="text-text-primary">{h.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Crear artículo nuevo (create-on-scan) */}
          <div className="pt-1 border-t border-border-default">
            {!createOpen ? (
              <button type="button" onClick={() => { setNewName(rawText); setCreateOpen(true) }}
                className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
                <Plus size={14} /> Crear artículo nuevo
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-text-secondary flex items-center gap-1.5">
                  Nuevo artículo
                  {suggesting && <span className="inline-flex items-center gap-1 text-text-tertiary normal-case tracking-normal"><Loader2 size={11} className="animate-spin" /> sugiriendo…</span>}
                </p>
                <label className="block">
                  <span className="text-[11px] text-text-secondary">Nombre {suggested.name && <span className="text-accent">✨ sugerido</span>}</span>
                  <input type="text" value={newName} onChange={e => { setNewName(e.target.value); setSuggested(s => ({ ...s, name: false })) }} disabled={creating}
                    placeholder="Nombre del artículo"
                    className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                </label>
                <div className="flex gap-2 flex-wrap">
                  <label className="flex flex-col text-[11px] text-text-secondary">
                    Unidad base {suggested.unit && <span className="text-accent">✨</span>}
                    <select value={newUnit} onChange={e => { setNewUnit(e.target.value); setSuggested(s => ({ ...s, unit: false })) }} disabled={creating}
                      className="mt-0.5 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent">
                      {BASE_UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col text-[11px] text-text-secondary flex-1 min-w-[180px]">
                    Familia (opcional) {suggested.family && <span className="text-accent">✨</span>}
                    <select value={newFamily} onChange={e => { setNewFamily(e.target.value); setSuggested(s => ({ ...s, family: false })) }} disabled={creating}
                      className="mt-0.5 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent">
                      <option value="">— Sin familia —</option>
                      {families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </label>
                </div>
                {createErr && <p className="text-xs text-danger">{createErr}</p>}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleCreate} disabled={creating}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Crear y casar
                  </button>
                  <button type="button" onClick={() => setCreateOpen(false)} disabled={creating}
                    className="px-3 py-2 rounded-md text-sm border border-border-default bg-card hover:bg-page disabled:opacity-50">Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-border-default">
          <button type="button" onClick={onClear} disabled={!currentRecipeItemId}
            className="text-sm text-text-secondary hover:text-danger disabled:opacity-40 transition-base">
            Quitar casado
          </button>
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page transition-base">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
