// src/modules/shop/cart/CartPanel.tsx
//
// Botón flotante con contador + panel lateral "TU PEDIDO". Agrupa por marca,
// cada línea muestra su configuración elegida (summary), cantidad editable y
// precio. Total con hueco de descuento/envío (envío se fija en checkout).
// El botón "Ir a pagar" es el punto de enganche del checkout (pieza siguiente).

import { useState } from 'react'
import { useShopCart, type CartLine } from '@/modules/shop/cart/ShopCartContext'

const C = {
  bg: '#FBF7F0', surface: '#FFFFFF', ink: '#1A1714', inkDim: '#7A726A', line: '#ECE5DA',
  accent: '#FF5436', accentHover: '#E8472B', accentBg: '#FFE9E3', green: '#1FA85B',
  overlay: 'rgba(26,23,20,.45)',
}

function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

export default function CartPanel({ onCheckout }: { onCheckout?: () => void }) {
  const { cart, totals, setLineQty, removeLine } = useShopCart()
  const [open, setOpen] = useState(false)

  if (cart.lines.length === 0) return null

  // Agrupar líneas por marca
  const byBrand = new Map<string, { name: string; lines: CartLine[] }>()
  for (const l of cart.lines) {
    const g = byBrand.get(l.brandId) ?? { name: l.brandName, lines: [] }
    g.lines.push(l)
    byBrand.set(l.brandId, g)
  }

  return (
    <>
      {/* Botón flotante */}
      <button style={S.fab} onClick={() => setOpen(true)} aria-label="Ver el pedido">
        <span style={S.fabIcon}>🛒</span>
        <span style={S.fabCount}>{totals.itemsCount}</span>
        <span style={S.fabTotal}>{eur(totals.total)}</span>
      </button>

      {open && (
        <div style={S.overlay} onClick={() => setOpen(false)}>
          <aside style={S.panel} onClick={(e) => e.stopPropagation()}>
            <div style={S.head}>
              <h2 style={S.title}>Tu pedido</h2>
              <button style={S.closeX} onClick={() => setOpen(false)} aria-label="Cerrar">×</button>
            </div>

            <div style={S.body}>
              {[...byBrand.values()].map((grp, gi) => (
                <div key={gi} style={S.brandGroup}>
                  <div style={S.brandName}>{grp.name}</div>
                  {grp.lines.map((l) => (
                    <div key={l.lineId} style={S.line}>
                      <div style={S.lineTop}>
                        <span style={S.lineName}>{l.name}</span>
                        <span style={S.linePrice}>{eur(l.unitPrice * l.quantity)}</span>
                      </div>
                      {l.summary.length > 0 && (
                        <ul style={S.summary}>
                          {l.summary.map((s, i) => <li key={i} style={S.summaryItem}>{s}</li>)}
                        </ul>
                      )}
                      {l.allergens.length > 0 && (
                        <div style={S.allergens}>Alérgenos: {l.allergens.map((a) => a.nameEs).join(', ')}</div>
                      )}
                      <div style={S.lineFoot}>
                        <div style={S.qty}>
                          <button style={S.qtyBtn} onClick={() => setLineQty(l.lineId, l.quantity - 1)} disabled={l.quantity <= 1}>–</button>
                          <span style={S.qtyNum}>{l.quantity}</span>
                          <button style={S.qtyBtn} onClick={() => setLineQty(l.lineId, l.quantity + 1)}>+</button>
                        </div>
                        <button style={S.remove} onClick={() => removeLine(l.lineId)}>Quitar</button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div style={S.footer}>
              <div style={S.totalRow}>
                <span>Subtotal</span><span>{eur(totals.subtotal)}</span>
              </div>
              {totals.discount > 0 && (
                <div style={{ ...S.totalRow, color: C.green }}>
                  <span>Descuento</span><span>−{eur(totals.discount)}</span>
                </div>
              )}
              <div style={S.totalRowSmall}>
                <span>Gastos de envío</span><span>{totals.deliveryFee > 0 ? eur(totals.deliveryFee) : 'Se calcula al indicar la dirección'}</span>
              </div>
              <div style={S.totalRowBig}>
                <span>Total</span><span>{eur(totals.total)}</span>
              </div>
              <button
                style={S.payBtn}
                onClick={() => { setOpen(false); onCheckout?.() }}
              >
                Ir a pagar
              </button>
              <p style={S.note}>El envío y la disponibilidad se confirman con tu dirección.</p>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}

const S: Record<string, React.CSSProperties> = {
  fab: { position: 'fixed', right: 22, bottom: 22, zIndex: 900, display: 'flex', alignItems: 'center', gap: 10, background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '14px 20px', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 8px 24px rgba(255,84,54,.4)' },
  fabIcon: { fontSize: 18 },
  fabCount: { background: '#fff', color: C.accent, borderRadius: 999, minWidth: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, padding: '0 6px' },
  fabTotal: { fontWeight: 900 },

  overlay: { position: 'fixed', inset: 0, background: C.overlay, zIndex: 950, display: 'flex', justifyContent: 'flex-end' },
  panel: { width: 'min(440px, 96vw)', height: '100%', background: C.surface, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 40px rgba(0,0,0,.2)' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px', borderBottom: `1px solid ${C.line}` },
  title: { fontSize: 22, fontWeight: 900, letterSpacing: '-.02em' },
  closeX: { background: C.bg, border: `1px solid ${C.line}`, borderRadius: '50%', width: 34, height: 34, fontSize: 21, lineHeight: 1, cursor: 'pointer', color: C.ink },

  body: { flex: 1, overflowY: 'auto', padding: '16px 22px' },
  brandGroup: { marginBottom: 18 },
  brandName: { fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.03em', color: C.accent, marginBottom: 8 },
  line: { border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 13px', marginBottom: 10 },
  lineTop: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' },
  lineName: { fontWeight: 800, fontSize: 14.5, letterSpacing: '-.01em' },
  linePrice: { fontWeight: 900, fontSize: 14.5, whiteSpace: 'nowrap' },
  summary: { listStyle: 'none', margin: '6px 0 0', padding: 0 },
  summaryItem: { fontSize: 12.5, color: C.inkDim, lineHeight: 1.5, paddingLeft: 10, position: 'relative' },
  allergens: { fontSize: 11.5, color: '#7A5A12', marginTop: 6, fontWeight: 600 },
  lineFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  qty: { display: 'inline-flex', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 30, height: 30, borderRadius: '50%', border: `1px solid ${C.line}`, background: '#fff', cursor: 'pointer', fontSize: 17, lineHeight: 1, color: C.ink },
  qtyNum: { minWidth: 18, textAlign: 'center', fontWeight: 800 },
  remove: { background: 'none', border: 'none', color: C.inkDim, fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' },

  footer: { borderTop: `1px solid ${C.line}`, padding: '16px 22px 20px', background: C.bg },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 14, color: C.ink, marginBottom: 6 },
  totalRowSmall: { display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: C.inkDim, marginBottom: 10, gap: 16, textAlign: 'right' },
  totalRowBig: { display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 900, marginBottom: 14 },
  payBtn: { width: '100%', background: C.accent, color: '#fff', border: 'none', borderRadius: 14, padding: '15px', fontWeight: 900, fontSize: 16, cursor: 'pointer' },
  note: { fontSize: 11.5, color: C.inkDim, textAlign: 'center', marginTop: 10 },
}
