// src/modules/pos/components/PosItemConfigModal.tsx
//
// Pop-up de modificadores + combo del TPV (§2.1 del encargo T1). Reutiliza
// TAL CUAL la lógica de selección/precio/validación de dishConfigService.ts
// (ya construida y probada en Folvy Shop — DishConfigModal.tsx es la
// hermana visual de este componente, con los mismos mutadores de estado).
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
//
// TPV T1.f (11/08), Tarea D: sistema de diseño aplicado — tema oscuro
// (tpvTokens.css, heredado del .tpv-root que envuelve TpvSalePage), sin
// cambiar nada de la lógica de arriba. Dos cautelas de contraste medidas
// por Julio 11/08 y aplicadas aquí: --danger y --ok NUNCA como color de
// texto pequeño (fallan 4,5:1) — donde antes había texto rojo/verde suelto,
// ahora es un relleno de color con texto blanco encima, o el semántico vive
// solo en el borde/fondo mientras el texto se queda neutro.

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
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-tpv-surface w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] rounded-t-tpv sm:rounded-tpv shadow-2xl flex flex-col border border-tpv-line" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-tpv-line shrink-0">
          <h3 className="text-lg font-extrabold text-tpv-txt truncate">
            {status === 'ready' && config ? config.name : 'Cargando…'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-10 h-10 rounded-full flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface-2 transition-base shrink-0">
            <X size={20} />
          </button>
        </div>

        {status === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-16 text-tpv-txt-2"><Loader2 className="animate-spin" size={20} /> Cargando…</div>
        )}
        {status === 'error' && (
          <div className="p-6 text-center text-tpv-txt-2">No se pudo cargar este producto.</div>
        )}

        {status === 'ready' && config && (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
              {config.description && <p className="text-sm text-tpv-txt-2">{config.description}</p>}

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
                      <span className="text-tpv-name font-bold text-tpv-txt">{slot.name}</span>
                      {slot.min > 0 && <ObligatorioBadge />}
                    </div>
                    <p className="text-xs text-tpv-txt-2 mb-2">
                      {slot.max === 1 ? `Elige una opción · llevas ${chosen.length}` : `Elige de ${slot.min} a ${slot.max} · llevas ${chosen.length}`}
                    </p>
                    {slotErr && <ErrorPill text={`Elige ${slot.min === 1 ? 'una opción' : `al menos ${slot.min}`}.`} />}

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
                              className={`w-full flex items-center gap-3 p-3 rounded-tpv border text-left transition-base ${checked ? 'border-tpv-accent bg-tpv-accent/15 active:scale-[0.99]' : blocked ? 'border-tpv-line bg-tpv-surface-2 opacity-55 cursor-not-allowed' : 'border-tpv-line bg-tpv-surface-2 hover:bg-tpv-bg active:scale-[0.99]'}`}
                            >
                              {opt.photoUrl && <img src={opt.photoUrl} alt="" className="w-10 h-10 rounded-tpv object-cover shrink-0" />}
                              <span className="flex-1 min-w-0 text-tpv-name font-bold text-tpv-txt">{opt.name}</span>
                              {opt.priceImpact !== 0 && <span className="text-sm font-extrabold text-tpv-note shrink-0">{plus(opt.priceImpact)}</span>}
                            </button>

                            {checked && opt.modifierGroups.map(g => {
                              const k = nestedKey(slot.id, opt.menuItemId, g.id)
                              const scope = `${opt.name} · ${g.name}`
                              return (
                                <div key={g.id} className="ml-4 mt-2 pl-3 border-l-2 border-tpv-line">
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

            <div className="px-4 py-3 border-t border-tpv-line shrink-0">
              {showErrors && !valid && (
                <p className="text-xs font-bold text-center mb-2"><ErrorPill text="Completa las opciones obligatorias marcadas." /></p>
              )}
              <button
                type="button" onClick={handleAdd}
                className={`w-full min-h-tap-critical rounded-tpv text-lg font-extrabold transition-base ${valid ? 'bg-tpv-ok text-white hover:opacity-90 active:scale-[0.99]' : 'bg-tpv-surface-2 text-tpv-txt-2 cursor-not-allowed'}`}
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

// Verde/rojo nunca como texto pequeño suelto (medido 11/08: falla 4,5:1) —
// siempre relleno de color + texto blanco encima.
function ErrorPill({ text }: { text: string }) {
  return <span className="inline-block bg-tpv-danger text-white text-xs font-bold rounded px-2 py-1">{text}</span>
}
function ObligatorioBadge() {
  return <span className="inline-block bg-tpv-accent/25 text-white text-[11px] font-extrabold uppercase tracking-wide rounded px-1.5 py-0.5">obligatorio</span>
}

function SectionHeader({ section }: { section: SectionKey }) {
  return (
    <div className={section === 'cross_sell' ? 'mt-6 pt-4 border-t border-tpv-line' : ''}>
      <span className="text-[11px] font-extrabold text-tpv-txt-2 uppercase tracking-wider">{SECTION_LABEL[section]}</span>
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
        <span className="text-tpv-name font-bold text-tpv-txt">{group.name}</span>
        {group.min > 0 && <ObligatorioBadge />}
      </div>
      <p className="text-xs text-tpv-txt-2 mb-1">{counterText}</p>
      {belowMin && (
        showError ? <ErrorPill text={`Te falta ${group.min - count}.`} /> : <p className="text-xs font-bold text-tpv-warn mb-2">Te falta {group.min - count}.</p>
      )}
      {atMax && (
        <p className="text-xs font-bold text-tpv-warn mb-2">Máximo {group.max} — quita uno para cambiar.</p>
      )}
      {showError && !belowMin && !atMax && (
        <ErrorPill text={`Elige ${group.min === 1 ? 'al menos 1 opción' : `al menos ${group.min}`}.`} />
      )}
      <div className="space-y-2 mt-2">
        {group.options.map(o => {
          const checked = isChecked(o.id)
          const blocked = !checked && atMax
          return (
            <div key={o.id} className={`flex items-center gap-3 p-3 rounded-tpv border transition-base ${checked ? 'border-tpv-accent bg-tpv-accent/15' : blocked ? 'border-tpv-line bg-tpv-surface-2 opacity-55' : 'border-tpv-line bg-tpv-surface-2'}`}>
              <button
                type="button" disabled={blocked}
                onClick={() => onToggle(o.id, !checked)}
                className={`flex-1 min-w-0 flex items-center gap-3 text-left min-h-tap-small ${blocked ? 'cursor-not-allowed' : 'active:scale-[0.99]'}`}
              >
                <span className="flex-1 min-w-0 text-tpv-name font-bold text-tpv-txt">{o.name}</span>
                {o.priceImpact !== 0 && <span className="text-sm font-extrabold text-tpv-note shrink-0">{plus(o.priceImpact)}</span>}
              </button>
              {checked && group.allowRepetition && (
                <span className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => onQty(o.id, -1)} className="min-w-tap-small min-h-tap-small rounded-tpv border border-tpv-line flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-bg"><Minus size={16} /></button>
                  <span className="min-w-[1.4em] text-center text-base font-extrabold text-tpv-txt">{checked.qty}</span>
                  <button type="button" onClick={() => onQty(o.id, 1)} disabled={atMax} className={`min-w-tap-small min-h-tap-small rounded-tpv border border-tpv-line flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-bg ${atMax ? 'opacity-40 cursor-not-allowed' : ''}`}><Plus size={16} /></button>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
