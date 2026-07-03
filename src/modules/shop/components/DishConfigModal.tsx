// src/modules/shop/components/DishConfigModal.tsx
//
// Modal de configuración de un plato del Shop. Pinta el árbol de
// shop_item_config: slots de combo (con opciones que despliegan sus
// modificadores anidados) o modificadores directos de un plato suelto.
// Precio en vivo, validación de min/max, alérgenos reales por opción.
// Al confirmar, devuelve la línea configurada lista para el carrito.

import { useEffect, useMemo, useState } from 'react'
import {
  getDishConfig, emptySelection, unitPrice, totalPrice, validateSelection,
  isValid, selectionSummary, selectionAllergens, nestedKey,
  type DishConfig, type DishSelection, type ModifierGroup, type ModSelection, type Allergen,
} from '@/modules/shop/services/dishConfigService'

const C = {
  bg: '#FBF7F0', surface: '#FFFFFF', ink: '#1A1714', inkDim: '#7A726A', line: '#ECE5DA',
  accent: '#FF5436', accentHover: '#E8472B', accentBg: '#FFE9E3', green: '#1FA85B',
  amber: '#7A5A12', amberBg: '#FFF3D6', amberLine: '#F2DCA0', overlay: 'rgba(26,23,20,.55)',
}

function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }
function plus(n: number): string { return n > 0 ? `+${eur(n)}` : n < 0 ? eur(n) : '' }

/** Línea configurada que se añade al carrito. */
export interface ConfiguredLine {
  menuItemId: string
  name: string
  photoUrl: string | null
  unitPrice: number
  quantity: number
  summary: string[]
  allergens: Allergen[]
  config: DishConfig
  selection: DishSelection
}

interface Props {
  slug: string
  menuItemId: string
  // Oferta de carta activa (item_percent). Se aplica al precio final para que el
  // carrito y el checkout muestren y cobren lo mismo que la carta.
  offer?: { pct: number; wasPrice: number | null } | null
  // BOGO (2x1 / 2ª unidad): gancho visual. NO cambia el precio unitario ni el total
  // del modal; el descuento de la 2ª unidad se aplica en el resumen/cobro (servidor).
  bogo?: { pct: number } | null
  onClose: () => void
  onAdd: (line: ConfiguredLine) => void
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

export default function DishConfigModal({ slug, menuItemId, offer, bogo, onClose, onAdd }: Props) {
  const [config, setConfig] = useState<DishConfig | null>(null)
  const [sel, setSel] = useState<DishSelection>(emptySelection())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    let alive = true
    setStatus('loading')
    getDishConfig(slug, menuItemId)
      .then((c) => {
        if (!alive) return
        if (!c) { setStatus('error'); return }
        // Selección inicial: aplicar defaults
        const init = emptySelection()
        for (const g of c.modifierGroups) {
          const defs = g.options.filter((o) => o.isDefault).map((o) => ({ optionId: o.id, qty: 1 }))
          if (defs.length) init.baseMods[g.id] = defs
        }
        for (const slot of c.slots) {
          const def = slot.options.find((o) => o.isDefault)
          if (def) init.slotChoices[slot.id] = [def.menuItemId]
        }
        setConfig(c); setSel(init); setStatus('ready')
      })
      .catch(() => { if (alive) setStatus('error') })
    return () => { alive = false }
  }, [slug, menuItemId])

  const errors = useMemo(() => (config ? validateSelection(config, sel) : []), [config, sel])
  const valid = config ? isValid(config, sel) : false
  const off = offer && offer.pct > 0 ? offer : null
  const bg = bogo && bogo.pct > 0 ? bogo : null
  const baseTotal = config ? totalPrice(config, sel) : 0
  const total = off ? round2(baseTotal * (1 - off.pct / 100)) : baseTotal

  // ── Mutadores de selección ────────────────────────────────────────────

  function setSlotChoice(slotId: string, menuItemId: string, max: number, checked: boolean) {
    setSel((prev) => {
      const cur = prev.slotChoices[slotId] ?? []
      let next: string[]
      if (max === 1) {
        next = checked ? [menuItemId] : []
      } else {
        next = checked ? [...cur, menuItemId] : cur.filter((id) => id !== menuItemId)
        if (max > 0 && next.length > max) next = next.slice(next.length - max)
      }
      return { ...prev, slotChoices: { ...prev.slotChoices, [slotId]: next } }
    })
  }

  function toggleMod(key: string, group: ModifierGroup, optionId: string, checked: boolean) {
    setSel((prev) => {
      const isBase = !key.includes(':')
      const store = isBase ? prev.baseMods : prev.nestedMods
      const cur = store[key] ?? []
      let next: ModSelection[]
      if (group.max === 1) {
        next = checked ? [{ optionId, qty: 1 }] : []
      } else {
        if (checked) {
          next = [...cur, { optionId, qty: 1 }]
        } else {
          next = cur.filter((c) => c.optionId !== optionId)
        }
      }
      const patched = { ...store, [key]: next }
      return isBase ? { ...prev, baseMods: patched } : { ...prev, nestedMods: patched }
    })
  }

  function setModQty(key: string, optionId: string, delta: number, isBase: boolean) {
    setSel((prev) => {
      const store = isBase ? prev.baseMods : prev.nestedMods
      const cur = store[key] ?? []
      const next = cur.map((c) => c.optionId === optionId ? { ...c, qty: Math.max(1, c.qty + delta) } : c)
      const patched = { ...store, [key]: next }
      return isBase ? { ...prev, baseMods: patched } : { ...prev, nestedMods: patched }
    })
  }

  function isModChecked(key: string, optionId: string, isBase: boolean): ModSelection | undefined {
    const store = isBase ? sel.baseMods : sel.nestedMods
    return (store[key] ?? []).find((c) => c.optionId === optionId)
  }

  function setQuantity(delta: number) {
    setSel((prev) => ({ ...prev, quantity: Math.max(1, prev.quantity + delta) }))
  }

  function handleAdd() {
    if (!config) return
    if (!valid) { setShowErrors(true); return }
    const u = unitPrice(config, sel)
    onAdd({
      menuItemId: config.id,
      name: config.name,
      photoUrl: config.photoUrl,
      unitPrice: off ? round2(u * (1 - off.pct / 100)) : u,
      quantity: sel.quantity,
      summary: selectionSummary(config, sel),
      allergens: selectionAllergens(config, sel),
      config, selection: sel,
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (status === 'loading') {
    return <div style={S.overlay} onClick={onClose}><div style={S.modal} onClick={(e) => e.stopPropagation()}><div style={S.center}>Cargando…</div></div></div>
  }
  if (status === 'error' || !config) {
    return <div style={S.overlay} onClick={onClose}><div style={S.modal} onClick={(e) => e.stopPropagation()}><div style={S.center}>No se pudo cargar este plato.<br /><button style={S.closeTextBtn} onClick={onClose}>Cerrar</button></div></div></div>
  }

  const hasGroupsOrSlots = config.modifierGroups.length > 0 || config.slots.length > 0

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <style>{`
          .fvm-x:hover { background: #fff; }
          .fvm-add:not([disabled]):hover { filter: brightness(.94); }
        `}</style>
        <button className="fvm-x" style={S.closeX} onClick={onClose} aria-label="Cerrar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ display: 'block' }}><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>

        {/* Columna izquierda: configuración */}
        <div style={S.left}>
          {!hasGroupsOrSlots && (
            <div style={{ color: C.inkDim, fontSize: 14, padding: '8px 0' }}>
              Este plato no necesita personalización. Elige la cantidad y añádelo.
            </div>
          )}

          {/* Modificadores del plato base (plato suelto) */}
          {config.modifierGroups.map((g) => (
            <GroupBlock
              key={g.id} group={g} keyId={g.id} isBase
              isChecked={(oid) => isModChecked(g.id, oid, true)}
              onToggle={(oid, ch) => toggleMod(g.id, g, oid, ch)}
              onQty={(oid, d) => setModQty(g.id, oid, d, true)}
              showError={showErrors && errors.some((e) => e.scope === g.name)}
            />
          ))}

          {/* Slots del combo */}
          {config.slots.map((slot) => {
            const chosen = sel.slotChoices[slot.id] ?? []
            const slotErr = showErrors && errors.some((e) => e.scope === slot.name)
            return (
              <div key={slot.id} style={S.slotBlock}>
                <div style={S.slotTitle}>{slot.name}</div>
                <div style={S.slotSub}>
                  {slot.max === 1 ? 'Selecciona una opción' : `Selecciona entre ${slot.min} y ${slot.max}`}
                  <span style={{ color: slot.min > 0 ? C.accent : C.inkDim, fontWeight: 700, marginLeft: 6 }}>
                    {slot.min > 0 ? '*obligatorio' : 'opcional'}
                  </span>
                </div>
                {slotErr && <div style={S.errMsg}>Elige {slot.min === 1 ? 'una opción' : `al menos ${slot.min}`}.</div>}

                {slot.options.map((opt) => {
                  const checked = chosen.includes(opt.menuItemId)
                  return (
                    <div key={opt.menuItemId}>
                      <label style={{ ...S.optRow, ...(checked ? S.optRowOn : {}) }}>
                        <input
                          type={slot.max === 1 ? 'radio' : 'checkbox'}
                          name={`slot-${slot.id}`}
                          checked={checked}
                          onChange={(e) => setSlotChoice(slot.id, opt.menuItemId, slot.max, e.target.checked)}
                          style={S.input}
                        />
                        {opt.photoUrl && <img src={opt.photoUrl} alt="" style={S.optThumb} />}
                        <span style={S.optName}>
                          {opt.name}
                          {opt.allergens.length > 0 && (
                            <span style={S.allergenLine}>{opt.allergens.map((a) => a.nameEs).join(' · ')}</span>
                          )}
                        </span>
                        {opt.priceImpact !== 0 && <span style={S.optPrice}>{plus(opt.priceImpact)}</span>}
                      </label>

                      {/* Modificadores anidados de la opción elegida */}
                      {checked && opt.modifierGroups.map((g) => {
                        const k = nestedKey(slot.id, opt.menuItemId, g.id)
                        return (
                          <div key={g.id} style={S.nestedWrap}>
                            <GroupBlock
                              group={g} keyId={k} isBase={false} nested
                              isChecked={(oid) => isModChecked(k, oid, false)}
                              onToggle={(oid, ch) => toggleMod(k, g, oid, ch)}
                              onQty={(oid, d) => setModQty(k, oid, d, false)}
                              showError={showErrors && errors.some((e) => e.scope === `${opt.name} · ${g.name}`)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Columna derecha: foto, descripción, añadir */}
        <div style={S.right}>
          {config.photoUrl
            ? <img src={config.photoUrl} alt={config.name} style={S.heroImg} />
            : <div style={{ ...S.heroImg, background: C.accentBg }} />}
          <h2 style={S.dishName}>{config.name}</h2>
          {config.description && <p style={S.dishDesc}>{config.description}</p>}

          {/* Alérgenos agregados de la selección */}
          {(() => {
            const al = selectionAllergens(config, sel)
            return al.length > 0 ? (
              <div style={S.allergenBox}>
                <strong style={{ color: C.amber }}>Alérgenos:</strong>{' '}
                {al.map((a) => a.nameEs).join(', ')}
              </div>
            ) : null
          })()}

          <div style={S.qtyRow}>
            <button style={S.qtyBtn} onClick={() => setQuantity(-1)} disabled={sel.quantity <= 1}>–</button>
            <span style={S.qtyNum}>{sel.quantity}</span>
            <button style={S.qtyBtn} onClick={() => setQuantity(1)}>+</button>
          </div>

          {off && (
            <div style={S.offerRow}>
              <span style={S.offerBadge}>−{Math.round(off.pct)}% hoy</span>
              <span style={S.offerWas}>{eur(baseTotal)}</span>
              {off.wasPrice != null && <span style={S.offerOmni}>Precio más bajo 30 días: {eur(off.wasPrice)}</span>}
            </div>
          )}
          {bg && (
            <div style={S.offerRow}>
              <span style={S.bogoBadge}>{bg.pct >= 100 ? '2x1' : `2ª al −${Math.round(bg.pct)}%`}</span>
              <span style={S.bogoHint}>
                {sel.quantity >= 2
                  ? (bg.pct >= 100 ? 'La 2ª unidad sale gratis — se aplica en el pago.' : `La 2ª unidad, −${Math.round(bg.pct)}% — se aplica en el pago.`)
                  : (bg.pct >= 100 ? 'Añade otra y la 2ª sale gratis.' : `Añade otra y la 2ª sale al −${Math.round(bg.pct)}%.`)}
              </span>
            </div>
          )}
          <button
            className="fvm-add"
            style={{ ...S.addBtn, ...(valid ? {} : S.addBtnDisabled) }}
            onClick={handleAdd}
          >
            Añadir {eur(total)}
          </button>
          {showErrors && !valid && (
            <div style={S.addHint}>Completa las opciones obligatorias marcadas.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Bloque de un grupo de modificadores (base o anidado) ─────────────────

function GroupBlock({ group, keyId, nested, isChecked, onToggle, onQty, showError }: {
  group: ModifierGroup
  keyId: string
  isBase: boolean
  nested?: boolean
  isChecked: (optionId: string) => ModSelection | undefined
  onToggle: (optionId: string, checked: boolean) => void
  onQty: (optionId: string, delta: number) => void
  showError?: boolean
}) {
  const single = group.max === 1
  return (
    <div style={nested ? S.nestedGroup : S.groupBlock}>
      <div style={S.groupTitle}>{group.name}</div>
      <div style={S.groupSub}>
        {single
          ? 'Selecciona una opción'
          : group.min > 0
            ? `Mínimo ${group.min}, máximo ${group.max}`
            : `Máximo ${group.max}`}
        {group.min > 0 && <span style={{ color: C.accent, fontWeight: 700, marginLeft: 6 }}>*obligatorio</span>}
      </div>
      {showError && <div style={S.errMsg}>Elige {group.min === 1 ? 'al menos 1 opción' : `al menos ${group.min}`}.</div>}
      {group.options.map((o) => {
        const checked = isChecked(o.id)
        return (
          <label key={o.id} style={{ ...S.optRow, ...(checked ? S.optRowOn : {}) }}>
            <input
              type={single ? 'radio' : 'checkbox'}
              name={single ? `grp-${keyId}` : undefined}
              checked={!!checked}
              onChange={(e) => onToggle(o.id, e.target.checked)}
              style={S.input}
            />
            <span style={S.optName}>
              {o.name}
              {o.allergens.length > 0 && (
                <span style={S.allergenLine}>{o.allergens.map((a) => a.nameEs).join(' · ')}</span>
              )}
            </span>
            {o.priceImpact !== 0 && <span style={S.optPrice}>{plus(o.priceImpact)}</span>}
            {/* Cantidad por opción si el grupo permite repetición */}
            {checked && group.allowRepetition && (
              <span style={S.miniQty} onClick={(e) => e.preventDefault()}>
                <button style={S.miniQtyBtn} onClick={(e) => { e.preventDefault(); onQty(o.id, -1) }}>–</button>
                <span style={S.miniQtyNum}>{checked.qty}</span>
                <button style={S.miniQtyBtn} onClick={(e) => { e.preventDefault(); onQty(o.id, 1) }}>+</button>
              </span>
            )}
          </label>
        )
      })}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: C.overlay, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { position: 'relative', background: C.surface, borderRadius: 20, width: 'min(920px, 96vw)', maxHeight: '90vh', display: 'flex', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,.3)' },
  closeX: { position: 'absolute', top: 12, right: 14, zIndex: 5, background: 'rgba(255,255,255,.9)', border: `1px solid ${C.line}`, borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', color: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  left: { flex: '1 1 56%', padding: '26px 26px 26px', overflowY: 'auto' },
  right: { flex: '1 1 44%', padding: '26px 26px 22px', borderLeft: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', background: C.bg },
  center: { padding: '60px 28px', textAlign: 'center', color: C.inkDim, width: '100%' },
  closeTextBtn: { marginTop: 14, background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '8px 18px', fontWeight: 800, cursor: 'pointer' },

  slotBlock: { marginBottom: 22 },
  slotTitle: { fontSize: 17, fontWeight: 900, letterSpacing: '-.02em', textTransform: 'uppercase', marginBottom: 2 },
  slotSub: { fontSize: 12.5, color: C.inkDim, marginBottom: 10 },
  groupBlock: { marginBottom: 18 },
  groupTitle: { fontSize: 15, fontWeight: 800, marginBottom: 2 },
  groupSub: { fontSize: 12, color: C.inkDim, marginBottom: 8 },
  nestedWrap: { marginLeft: 18, marginTop: 6, marginBottom: 8, paddingLeft: 12, borderLeft: `2px solid ${C.line}` },
  nestedGroup: { marginBottom: 12 },

  optRow: { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 7, cursor: 'pointer', background: '#fff' },
  optRowOn: { borderColor: C.accent, background: C.accentBg },
  input: { width: 17, height: 17, accentColor: C.accent, flexShrink: 0, cursor: 'pointer' },
  optThumb: { width: 38, height: 38, borderRadius: 8, objectFit: 'cover', flexShrink: 0 },
  optName: { flex: 1, fontSize: 14, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 2 },
  allergenLine: { fontSize: 11, color: C.amber, fontWeight: 600 },
  optPrice: { fontSize: 13, fontWeight: 800, color: C.ink, whiteSpace: 'nowrap' },
  errMsg: { fontSize: 12, color: C.accent, fontWeight: 700, marginBottom: 8 },

  miniQty: { display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 4 },
  miniQtyBtn: { width: 24, height: 24, borderRadius: '50%', border: `1px solid ${C.line}`, background: '#fff', cursor: 'pointer', fontSize: 15, lineHeight: 1, color: C.ink },
  miniQtyNum: { minWidth: 14, textAlign: 'center', fontWeight: 800, fontSize: 14 },

  heroImg: { width: '100%', height: 200, objectFit: 'cover', borderRadius: 16, marginBottom: 14, display: 'block' },
  dishName: { fontSize: 24, fontWeight: 900, letterSpacing: '-.03em', marginBottom: 8, lineHeight: 1.1 },
  dishDesc: { fontSize: 13.5, color: C.inkDim, lineHeight: 1.45, marginBottom: 12 },
  allergenBox: { fontSize: 12.5, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberLine}`, borderRadius: 10, padding: '8px 11px', marginBottom: 14 },
  qtyRow: { display: 'flex', alignItems: 'center', gap: 14, marginTop: 'auto', marginBottom: 14 },
  qtyBtn: { width: 38, height: 38, borderRadius: '50%', border: `1px solid ${C.line}`, background: '#fff', cursor: 'pointer', fontSize: 20, lineHeight: 1, color: C.ink },
  qtyNum: { minWidth: 24, textAlign: 'center', fontWeight: 900, fontSize: 18 },
  addBtn: { background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '15px 18px', fontWeight: 900, fontSize: 16, cursor: 'pointer', width: '100%', transition: 'filter .14s ease' },
  addBtnDisabled: { background: '#C9C3BB', cursor: 'not-allowed' },
  addHint: { fontSize: 12, color: C.accent, fontWeight: 700, textAlign: 'center', marginTop: 8 },
  offerRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 9, marginBottom: 10 },
  offerBadge: { background: C.accent, color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '4px 10px', borderRadius: 999 },
  bogoBadge: { background: '#16140F', color: '#FFB400', fontSize: 12.5, fontWeight: 900, letterSpacing: '.02em', padding: '4px 10px', borderRadius: 999 },
  bogoHint: { fontSize: 12, color: C.inkDim, fontWeight: 600 },
  offerWas: { fontSize: 14, color: C.inkDim, textDecoration: 'line-through', fontWeight: 700 },
  offerOmni: { flexBasis: '100%', fontSize: 11, color: C.inkDim },
}
