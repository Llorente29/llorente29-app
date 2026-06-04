// src/modules/supply/pages/LineMatchPicker.tsx
//
// C2.2.b.1 — Casar una línea de albarán con un artículo (recipe_item type='raw').
// Muestra los candidatos que propuso run_mapping (con semáforo y por qué casó) y
// un buscador manual sobre los artículos de la cuenta. IA propone, humano decide.
// (Crear artículo nuevo al vuelo = b.2; se añadirá aquí.)

import { useEffect, useRef, useState } from 'react'
import { X, Search, Check, Loader2 } from 'lucide-react'
import { listRecipeItems } from '@/modules/kitchen/services/recipeItemService'
import { matchTypeLabel, type LineMatchCandidate } from '@/modules/supply/services/goodsReceiptService'

interface LineMatchPickerProps {
  accountId: string
  rawText: string
  supplierCode: string | null
  candidates: LineMatchCandidate[]
  currentRecipeItemId: string | null
  onChoose: (recipeItemId: string, name: string, semaphore: 'green' | 'yellow' | null, matchType: string | null) => void
  onClear: () => void
  onClose: () => void
}

interface SearchHit { id: string; name: string }

export default function LineMatchPicker({
  accountId, rawText, supplierCode, candidates, currentRecipeItemId, onChoose, onClear, onClose,
}: LineMatchPickerProps) {
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

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
              <p className="text-xs text-text-secondary mt-2">Sin resultados. (Crear artículo nuevo llega en el siguiente paso.)</p>
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
