// src/modules/pos/components/PosItemConfigModal.tsx
//
// Pop-up de modificadores + combo del TPV (§2.1 del encargo T1). Reutiliza
// TAL CUAL la lógica de selección/precio/validación de dishConfigService.ts
// (ya construida y probada en Folvy Shop — DishConfigModal.tsx es la
// hermana visual de este componente, con los mismos mutadores de estado).
// Diferencias deliberadas frente a la de Shop: estilo Tailwind (el TPV vive
// dentro del admin, no de la piel de marca de Shop), botones grandes
// (principio rector: móvil/táctil primero), y un campo de nota de cocina
// por línea (hueco que Last no tiene).
//
// TPV T1.d (11/08), Tareas C y D: nada se deshabilita sin decir por qué
// (contador siempre visible, mensaje de máximo/mínimo, foco al grupo que
// bloquea "Añadir"), y los 4 group_type reales (verificado en vivo: choice
// 80 grupos activos, extras 17, removal 8, cross_sell 2 — ninguno fuera de
// esos 4 hoy) tienen su propia cabecera y orden: obligatorios de elección →
// elección opcional → quitar → añadir → ¿algo más? (separado al final). Un
// group_type que no sea ninguno de los 4 se trata como 'extras' — no hay
// combinación real hoy que lo dispare, pero si apareciera no rompe nada,
// solo se agrupa ahí (ver dishConfigService.mapModGroup, mismo fallback).

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Loader2, Minus, Plus } from 'lucide-react'
import {
  emptySelection, unitPrice, totalPrice, validateSelection, isValid,
  toOrderLine, nestedKey, selectionSummary,
  type DishConfig, type DishSelection, type ModifierGroup, type ModSelection, type OrderLine,
} from '@/modules/shop/services/dishConfigService'
import { getPosItemConfig } from '@/modules/pos/services/posSaleService'
import KitchenNoteField from './KitchenNoteField'

export interface PosConfiguredLine {
  orderLine: OrderLine
  kitchenNote: string | null
  unitPrice: number
  totalPrice: number
  summary: string[]
}

interface Props {
  accountId: string
  locationId: string
  menuItemId: string
  onClose: () => void
  onAdd: (line: PosConfiguredLine) => void
}

// eslint-disable-next-line no-restricted-syntax -- n es un cálculo local (unitPrice/totalPrice), nunca dato crudo del servidor
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }
function plus(n: number): string { return n > 0 ? `+${eur(n)}` : n < 0 ? eur(n) : '' }

// ── Tarea D: 4 group_type reales, orden y cabecera de sección ───────────

type KnownGroupType = 'choice' | 'extras' | 'removal' | 'cross_sell'
const KNOWN_GROUP_TYPES: readonly string[] = ['choice', 'extras', 'removal', 'cross_sell']

function normalizedGroupType(raw: string): KnownGroupType {
  return (KNOWN_GROUP_TYPES.includes(raw) ? raw : 'extras') as KnownGroupType
}

// Orden pedido por el encargo: elección-obligatoria → elección-opcional →
// quitar → añadir → ¿algo más?. El sort es estable (motores JS modernos, no
// hay que forzarlo) así que dentro de cada bloque se conserva el orden de
// llegada, que ya viene por `position` desde _modgroups_of_item.
function groupSortRank(g: ModifierGroup): number {
  const t = normalizedGroupType(g.groupType)
  if (t === 'choice') return g.min > 0 ? 0 : 1
  if (t === 'removal') return 2
  if (t === 'extras') return 3
  return 4 // cross_sell
}

type SectionKey = 'choice' | 'removal' | 'extras' | 'cross_sell'
function sectionKeyOf(rank: number): SectionKey {
  if (rank <= 1) return 'choice'
  if (rank === 2) return 'removal'
  if (rank === 3) return 'extras'
  return 'cross_sell'
}
const SECTION_LABEL: Record<SectionKey, string> = {
  choice: 'Elige', removal: 'Quitar', extras: 'Añadir', cross_sell: '¿Algo más?',
}

function sortGroups(groups: ModifierGroup[]): ModifierGroup[] {
  return [...groups].sort((a, b) => groupSortRank(a) - groupSortRank(b))
}

export default function PosItemConfigModal({ accountId, locationId, menuItemId, onClose, onAdd }: Props) {
  const [config, setConfig] = useState<DishConfig | null>(null)
  const [sel, setSel] = useState<DishSelection>(emptySelection())
  const [kitchenNote, setKitchenNote] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showErrors, setShowErrors] = useState(false)
  // Tarea C: al fallar "Añadir", se hace scroll+foco al primer grupo que
  // bloquea — clave = el mismo `scope` que usa validateSelection (nombre del
  // grupo, o "opción de slot · nombre del grupo" para anidados).
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    let alive = true
    setStatus('loading')
    getPosItemConfig(accountId, locationId, menuItemId)
      .then(c => {
        if (!alive) return
        if (!c) { setStatus('error'); return }
        const init = emptySelection()
        for (const g of c.modifierGroups) {
          const defs = g.options.filter(o => o.isDefault).map(o => ({ optionId: o.id, qty: 1 }))
          if (defs.length) init.baseMods[g.id] = defs
        }
        for (const slot of c.slots) {
          const def = slot.options.find(o => o.isDefault)
          if (def) init.slotChoices[slot.id] = [def.menuItemId]
        }
        setConfig(c); setSel(init); setStatus('ready')
      })
      .catch(() => { if (alive) setStatus('error') })
    return () => { alive = false }
  }, [accountId, locationId, menuItemId])

  const errors = useMemo(() => (config ? validateSelection(config, sel) : []), [config, sel])
  const valid = config ? isValid(config, sel) : false
  const total = config ? totalPrice(config, sel) : 0
  const sortedBaseGroups = useMemo(() => (config ? sortGroups(config.modifierGroups) : []), [config])

  function setSlotChoice(slotId: string, itemId: string, max: number, checked: boolean) {
    setSel(prev => {
      const cur = prev.slotChoices[slotId] ?? []
      let next: string[]
      if (max === 1) next = checked ? [itemId] : []
      else {
        next = checked ? [...cur, itemId] : cur.filter(id => id !== itemId)
        if (max > 0 && next.length > max) next = next.slice(next.length - max)
      }
      return { ...prev, slotChoices: { ...prev.slotChoices, [slotId]: next } }
    })
  }

  function toggleMod(key: string, group: ModifierGroup, optionId: string, checked: boolean) {
    setSel(prev => {
      const isBase = !key.includes(':')
      const store = isBase ? prev.baseMods : prev.nestedMods
      const cur = store[key] ?? []
      let next: ModSelection[]
      if (group.max === 1) next = checked ? [{ optionId, qty: 1 }] : []
      else next = checked ? [...cur, { optionId, qty: 1 }] : cur.filter(c => c.optionId !== optionId)
      const patched = { ...store, [key]: next }
      return isBase ? { ...prev, baseMods: patched } : { ...prev, nestedMods: patched }
    })
  }

  function setModQty(key: string, optionId: string, delta: number, isBase: boolean) {
    setSel(prev => {
      const store = isBase ? prev.baseMods : prev.nestedMods
      const cur = store[key] ?? []
      const next = cur.map(c => c.optionId === optionId ? { ...c, qty: Math.max(1, c.qty + delta) } : c)
      const patched = { ...store, [key]: next }
      return isBase ? { ...prev, baseMods: patched } : { ...prev, nestedMods: patched }
    })
  }

  function isModChecked(key: string, optionId: string, isBase: boolean): ModSelection | undefined {
    const store = isBase ? sel.baseMods : sel.nestedMods
    return (store[key] ?? []).find(c => c.optionId === optionId)
  }

  function registerGroupRef(scope: string) {
    return (el: HTMLDivElement | null) => {
      if (el) groupRefs.current.set(scope, el)
      else groupRefs.current.delete(scope)
    }
  }

  function handleAdd() {
    if (!config) return
    if (!valid) {
      setShowErrors(true)
      const firstScope = errors[0]?.scope
      const el = firstScope ? groupRefs.current.get(firstScope) : undefined
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const orderLine = toOrderLine(config, sel)
    onAdd({
      orderLine,
      kitchenNote: kitchenNote.trim() || null,
      unitPrice: unitPrice(config, sel),
      totalPrice: total,
      summary: selectionSummary(config, sel),
    })
  }

  let lastSection: SectionKey | null = null

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
          <h3 className="text-lg font-display font-medium text-text-primary truncate">
            {status === 'ready' && config ? config.name : 'Cargando…'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:bg-page transition-base shrink-0">
            <X size={20} />
          </button>
        </div>

        {status === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-16 text-text-secondary"><Loader2 className="animate-spin" size={20} /> Cargando…</div>
        )}
        {status === 'error' && (
          <div className="p-6 text-center text-text-secondary">No se pudo cargar este producto.</div>
        )}

        {status === 'ready' && config && (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
              {config.description && <p className="text-sm text-text-secondary">{config.description}</p>}

              {sortedBaseGroups.map(g => {
                const section = sectionKeyOf(groupSortRank(g))
                const showHeader = section !== lastSection
                lastSection = section
                return (
                  <div key={g.id}>
                    {showHeader && <SectionHeader section={section} />}
                    <GroupBlock
                      group={g}
                      isChecked={oid => isModChecked(g.id, oid, true)}
                      onToggle={(oid, ch) => toggleMod(g.id, g, oid, ch)}
                      onQty={(oid, d) => setModQty(g.id, oid, d, true)}
                      showError={showErrors && errors.some(e => e.scope === g.name)}
                      registerRef={registerGroupRef(g.name)}
                    />
                  </div>
                )
              })}

              {config.slots.map(slot => {
                const chosen = sel.slotChoices[slot.id] ?? []
                const slotErr = showErrors && errors.some(e => e.scope === slot.name)
                return (
                  <div key={slot.id} ref={registerGroupRef(slot.name)}>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-base font-semibold text-text-primary">{slot.name}</span>
                      {slot.min > 0 && <span className="text-[11px] font-bold text-accent uppercase tracking-wide">obligatorio</span>}
                    </div>
                    <p className={`text-xs mb-2 ${slotErr ? 'text-danger font-medium' : 'text-text-secondary'}`}>
                      {slot.max === 1 ? `Elige una opción · llevas ${chosen.length}` : `Elige de ${slot.min} a ${slot.max} · llevas ${chosen.length}`}
                    </p>
                    {slotErr && <p className="text-xs font-medium text-danger mb-2">Elige {slot.min === 1 ? 'una opción' : `al menos ${slot.min}`}.</p>}

                    <div className="space-y-2">
                      {slot.options.map(opt => {
                        const checked = chosen.includes(opt.menuItemId)
                        const atMax = slot.max > 1 && chosen.length >= slot.max
                        const blocked = !checked && atMax
                        return (
                          <div key={opt.menuItemId}>
                            <button
                              type="button"
                              disabled={blocked}
                              onClick={() => setSlotChoice(slot.id, opt.menuItemId, slot.max, !checked)}
                              className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-base ${checked ? 'border-accent bg-accent-bg active:scale-[0.99]' : blocked ? 'border-border-default bg-page opacity-50 cursor-not-allowed' : 'border-border-default bg-card hover:bg-page active:scale-[0.99]'}`}
                            >
                              {opt.photoUrl && <img src={opt.photoUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />}
                              <span className="flex-1 min-w-0 text-sm font-medium text-text-primary">{opt.name}</span>
                              {opt.priceImpact !== 0 && <span className="text-sm font-semibold text-text-primary shrink-0">{plus(opt.priceImpact)}</span>}
                            </button>

                            {checked && opt.modifierGroups.map(g => {
                              const k = nestedKey(slot.id, opt.menuItemId, g.id)
                              const scope = `${opt.name} · ${g.name}`
                              return (
                                <div key={g.id} className="ml-4 mt-2 pl-3 border-l-2 border-border-default">
                                  <GroupBlock
                                    group={g}
                                    isChecked={oid => isModChecked(k, oid, false)}
                                    onToggle={(oid, ch) => toggleMod(k, g, oid, ch)}
                                    onQty={(oid, d) => setModQty(k, oid, d, false)}
                                    showError={showErrors && errors.some(e => e.scope === scope)}
                                    registerRef={registerGroupRef(scope)}
                                  />
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              <KitchenNoteField value={kitchenNote} onChange={setKitchenNote} />
            </div>

            <div className="px-4 py-3 border-t border-border-default shrink-0">
              {showErrors && !valid && (
                <p className="text-xs font-medium text-danger text-center mb-2">Completa las opciones obligatorias marcadas.</p>
              )}
              <button
                type="button" onClick={handleAdd}
                className={`w-full py-4 rounded-xl text-base font-semibold transition-base ${valid ? 'bg-accent text-text-on-accent hover:opacity-90 active:scale-[0.99]' : 'bg-page text-text-tertiary cursor-not-allowed'}`}
              >
                Añadir · {eur(total)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ section }: { section: SectionKey }) {
  return (
    <div className={section === 'cross_sell' ? 'mt-6 pt-4 border-t border-border-default' : ''}>
      <span className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">{SECTION_LABEL[section]}</span>
    </div>
  )
}

function GroupBlock({ group, isChecked, onToggle, onQty, showError, registerRef }: {
  group: ModifierGroup
  isChecked: (optionId: string) => ModSelection | undefined
  onToggle: (optionId: string, checked: boolean) => void
  onQty: (optionId: string, delta: number) => void
  showError?: boolean
  registerRef?: (el: HTMLDivElement | null) => void
}) {
  const single = group.max === 1
  const count = group.options.reduce((n, o) => { const c = isChecked(o.id); return n + (c ? c.qty : 0) }, 0)
  const atMax = !single && group.max > 0 && count >= group.max
  const belowMin = group.min > 0 && count < group.min
  const counterText = single
    ? `Elige una opción · llevas ${count}`
    : group.min > 0
      ? `Elige de ${group.min} a ${group.max} · llevas ${count}`
      : `Añade hasta ${group.max} · llevas ${count}`

  return (
    <div ref={registerRef} className="mt-2">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-base font-semibold text-text-primary">{group.name}</span>
        {group.min > 0 && <span className="text-[11px] font-bold text-accent uppercase tracking-wide">obligatorio</span>}
      </div>
      <p className={`text-xs mb-1 ${belowMin && showError ? 'text-danger font-medium' : 'text-text-secondary'}`}>{counterText}</p>
      {belowMin && (
        <p className={`text-xs font-medium mb-2 ${showError ? 'text-danger' : 'text-accent'}`}>Te falta {group.min - count}.</p>
      )}
      {atMax && (
        <p className="text-xs font-medium text-accent mb-2">Máximo {group.max} — quita uno para cambiar.</p>
      )}
      {showError && !belowMin && !atMax && (
        <p className="text-xs font-medium text-danger mb-2">Elige {group.min === 1 ? 'al menos 1 opción' : `al menos ${group.min}`}.</p>
      )}
      <div className="space-y-2">
        {group.options.map(o => {
          const checked = isChecked(o.id)
          const blocked = !checked && atMax
          return (
            <div key={o.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-base ${checked ? 'border-accent bg-accent-bg' : blocked ? 'border-border-default bg-page opacity-50' : 'border-border-default bg-card'}`}>
              <button
                type="button" disabled={blocked}
                onClick={() => onToggle(o.id, !checked)}
                className={`flex-1 min-w-0 flex items-center gap-3 text-left ${blocked ? 'cursor-not-allowed' : 'active:scale-[0.99]'}`}
              >
                <span className="flex-1 min-w-0 text-sm font-medium text-text-primary">{o.name}</span>
                {o.priceImpact !== 0 && <span className="text-sm font-semibold text-text-primary shrink-0">{plus(o.priceImpact)}</span>}
              </button>
              {checked && group.allowRepetition && (
                <span className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => onQty(o.id, -1)} className="w-7 h-7 rounded-full border border-border-default flex items-center justify-center text-text-secondary hover:bg-page"><Minus size={13} /></button>
                  <span className="min-w-[1.2em] text-center text-sm font-semibold text-text-primary">{checked.qty}</span>
                  <button type="button" onClick={() => onQty(o.id, 1)} disabled={atMax} className={`w-7 h-7 rounded-full border border-border-default flex items-center justify-center text-text-secondary hover:bg-page ${atMax ? 'opacity-40 cursor-not-allowed' : ''}`}><Plus size={13} /></button>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
