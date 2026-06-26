// src/modules/shop/checkout/CheckoutRoute.tsx
//
// Checkout de Folvy Shop — estilo B (moderno, una sola pagina, responsive).
// Secciones apiladas (Entrega · Hora · Pago) en una pagina con scroll.
// Direccion con AUTOCOMPLETE (debounce, sin boton Buscar) reutilizando
// geocodeAddress (Mapbox) + validacion de zona (shop_check_delivery).
// Resumen sticky en escritorio; barra inferior fija desplegable en movil.
//
// Tramo actual: ENTREGA vivo (modo, autocomplete, validacion, minimo).
// Hora y Pago son secciones presentes, se rellenan en los siguientes tramos.

import { useEffect, useRef, useState } from 'react'
import { useShopCart } from '@/modules/shop/cart/ShopCartContext'
import { geocodeAddress, checkDelivery, type GeocodeHit, type DeliveryCheck } from '@/modules/shop/checkout/checkoutService'

const C = {
  page: '#F7F7F5', surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', accent: '#FF5436', accentBg: '#FFF4F1',
  green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4', greenMid: '#3E8A5F',
  amber: '#7A5A12', amberBg: '#FFF3D6', red: '#C23B22', redBg: '#FDE7E2', pill: '#EEEEEB',
}
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' \u20AC' }

type Mode = 'delivery' | 'pickup'

export default function CheckoutRoute({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { cart, totals } = useShopCart()
  const [mode, setMode] = useState<Mode>('delivery')

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<GeocodeHit[]>([])
  const [showHits, setShowHits] = useState(false)
  const [chosen, setChosen] = useState<GeocodeHit | null>(null)
  const [detail, setDetail] = useState('')
  const [notes, setNotes] = useState('')
  const [check, setCheck] = useState<DeliveryCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [expandSummary, setExpandSummary] = useState(false)

  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    if (chosen) return
    const q = query.trim()
    if (q.length < 4) { setHits([]); return }
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await geocodeAddress(q)
        setHits(r); setShowHits(true)
      } catch { setHits([]) }
    }, 350)
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [query, chosen])

  async function chooseHit(h: GeocodeHit) {
    setChosen(h); setHits([]); setShowHits(false); setQuery(h.label); setCheck(null)
    if (!cart.locationId) return
    setChecking(true)
    try { setCheck(await checkDelivery(slug, cart.locationId, h.lat, h.lng)) }
    catch { setCheck({ ok: false, reason: 'error' }) }
    finally { setChecking(false) }
  }

  const deliveryFee = mode === 'delivery' && check?.ok ? check.deliveryFee : 0
  const grandTotal = totals.subtotal - totals.discount + deliveryFee
  const minOrder = check?.ok ? check.minOrder : null
  const belowMin = mode === 'delivery' && minOrder != null && totals.subtotal < minOrder
  const missingForMin = belowMin && minOrder != null ? minOrder - totals.subtotal : 0
  const canContinue = cart.lines.length > 0 && (
    mode === 'pickup' || (check?.ok === true && !belowMin && detail.trim().length > 0)
  )

  const summaryLines = (
    <>
      <div style={s.sumLines}>
        {cart.lines.map((l) => (
          <div key={l.lineId} style={s.sumLine}>
            <span style={s.sumQty}>{l.quantity}x</span>
            <span style={s.sumName}>{l.name}</span>
            <span style={s.sumPrice}>{eur(l.unitPrice * l.quantity)}</span>
          </div>
        ))}
      </div>
      <div style={s.sumRow}><span>Subtotal</span><span>{eur(totals.subtotal)}</span></div>
      {totals.discount > 0 && <div style={{ ...s.sumRow, color: C.green }}><span>Descuento</span><span>-{eur(totals.discount)}</span></div>}
      <div style={s.sumRow}>
        <span>Gastos de envío</span>
        <span>{mode === 'pickup' ? '-' : (check?.ok ? eur(deliveryFee) : 'Indica tu dirección')}</span>
      </div>
    </>
  )

  return (
    <div style={s.page}>
      <header style={s.header}>
        <button style={s.back} onClick={onBack}>{'\u2190'} Seguir comprando</button>
      </header>

      <div className="ck-cols" style={s.cols}>
        <nav className="ck-timeline" style={s.timeline} aria-hidden>
          {['Entrega', 'Hora', 'Pago'].map((t, i) => (
            <div key={t} style={s.tStep}>
              <span style={s.tNum}>{i + 1}</span>
              <span style={s.tLabel}>{t}</span>
            </div>
          ))}
        </nav>

        <main style={s.main}>
          <section style={s.card}>
            <div style={s.modePill}>
              <button style={{ ...s.modeOpt, ...(mode === 'delivery' ? s.modeOptOn : {}) }} onClick={() => setMode('delivery')}>A domicilio</button>
              <button style={{ ...s.modeOpt, ...(mode === 'pickup' ? s.modeOptOn : {}) }} onClick={() => setMode('pickup')}>Para llevar</button>
            </div>

            {mode === 'delivery' ? (
              <>
                <h2 style={s.h2}>¿Dónde lo llevamos?</h2>
                <div style={{ position: 'relative' }}>
                  <input
                    style={s.input}
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setChosen(null); setCheck(null) }}
                    onFocus={() => hits.length > 0 && setShowHits(true)}
                    placeholder="Empieza a escribir tu dirección…"
                    autoComplete="off"
                  />
                  {showHits && hits.length > 0 && (
                    <ul style={s.hits}>
                      {hits.map((h, i) => (
                        <li key={i} style={s.hit} onClick={() => chooseHit(h)}>
                          <span style={s.hitDot}>{'\u25CF'}</span>{h.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {checking && <div style={s.checking}>Comprobando si llegamos…</div>}
                {check?.ok && (
                  <div style={s.okBox}>
                    <span style={s.okCheck}>{'\u2713'}</span>
                    <span>
                      <span style={s.okTitle}>Llegamos a tu puerta</span>
                      <span style={s.okSub}>Envío {eur(check.deliveryFee)}{check.etaMin != null && ` · unos ${check.etaMin} min`}</span>
                    </span>
                  </div>
                )}
                {check && !check.ok && (
                  <div style={s.noBox}>
                    {check.reason === 'out_of_zone'
                      ? 'Este local no reparte en esa dirección. Prueba “Para llevar” u otra dirección.'
                      : 'No se pudo comprobar la dirección. Inténtalo de nuevo.'}
                  </div>
                )}

                {chosen && check?.ok && (
                  <div style={s.detailRow}>
                    <input style={s.input} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Piso, puerta (3º derecha)" />
                    <input style={s.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Instrucciones (opcional)" />
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 style={s.h2}>Para llevar</h2>
                <p style={s.muted}>Recoges en el local. La dirección de recogida se mostrará al confirmar.</p>
              </>
            )}
          </section>

          <section style={{ ...s.card, ...s.next }}>
            <h2 style={s.h2}>¿Cuándo?</h2>
            <p style={s.muted}>Siguiente paso.</p>
          </section>

          <section style={{ ...s.card, ...s.next }}>
            <h2 style={s.h2}>¿Cómo pagas?</h2>
            <p style={s.muted}>Siguiente paso (tarjeta, Bizum y wallets).</p>
          </section>
        </main>

        <aside className="ck-aside" style={s.side}>
          <div style={s.sideTitle}>Resumen</div>
          {minOrder != null && <div style={s.minNote}>Pedido mínimo {eur(minOrder)}</div>}
          {summaryLines}
          <div style={s.sumTotal}><span>Total</span><span>{eur(grandTotal)}</span></div>
          {belowMin && <div style={s.belowMin}>Te faltan <strong>{eur(missingForMin)}</strong> para el mínimo de {eur(minOrder!)}.</div>}
          <button style={{ ...s.cta, ...(canContinue ? {} : s.ctaOff) }} disabled={!canContinue}>Confirmar pedido</button>
        </aside>
      </div>

      <div className="ck-mobilebar" style={s.mobileBar}>
        {expandSummary && (
          <div style={s.mobileSheet}>
            {summaryLines}
            {belowMin && <div style={s.belowMin}>Te faltan <strong>{eur(missingForMin)}</strong> para el mínimo.</div>}
          </div>
        )}
        <div style={s.mobileBarRow}>
          <button style={s.mobileTotal} onClick={() => setExpandSummary((v) => !v)}>
            <span style={s.mobileTotalLabel}>Total {'\u00B7'} {totals.itemsCount} art. {expandSummary ? '\u2304' : '\u2303'}</span>
            <span style={s.mobileTotalNum}>{eur(grandTotal)}</span>
          </button>
          <button style={{ ...s.mobileCta, ...(canContinue ? {} : s.ctaOff) }} disabled={!canContinue}>Confirmar</button>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .ck-timeline { display: none !important; }
          .ck-aside { display: none !important; }
          .ck-cols { flex-direction: column !important; padding-bottom: 96px !important; }
          .ck-mobilebar { display: block !important; }
        }
        @media (min-width: 861px) {
          .ck-mobilebar { display: none !important; }
        }
      `}</style>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: C.page },
  header: { maxWidth: 1080, margin: '0 auto', padding: '16px 22px' },
  back: { background: 'none', border: 'none', color: C.ink, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  cols: { maxWidth: 1080, margin: '0 auto', padding: '0 22px 48px', display: 'flex', gap: 18, alignItems: 'flex-start' },

  timeline: { flex: '0 0 110px', position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 16 },
  tStep: { display: 'flex', alignItems: 'center', gap: 9 },
  tNum: { width: 26, height: 26, borderRadius: '50%', background: C.ink, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 },
  tLabel: { fontSize: 13, fontWeight: 800 },

  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 },
  card: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: '18px 20px' },
  next: { opacity: .5 },
  h2: { fontSize: 18, fontWeight: 900, letterSpacing: '-.02em', margin: '0 0 12px' },
  muted: { fontSize: 13, color: C.inkDim, lineHeight: 1.5, margin: 0 },

  modePill: { display: 'inline-flex', background: C.pill, borderRadius: 999, padding: 4, marginBottom: 14 },
  modeOpt: { border: 'none', background: 'none', borderRadius: 999, padding: '6px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer', color: C.inkFaint },
  modeOptOn: { background: '#fff', color: C.ink, boxShadow: '0 1px 3px rgba(0,0,0,.08)' },

  input: { width: '100%', border: `1.5px solid ${C.lineInput}`, borderRadius: 12, padding: '11px 14px', fontSize: 14, color: C.ink, background: '#fff', boxSizing: 'border-box' },
  hits: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, listStyle: 'none', margin: '4px 0 0', padding: 0, border: `1px solid ${C.lineInput}`, borderRadius: 12, background: '#fff', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.12)' },
  hit: { padding: '11px 14px', fontSize: 13.5, cursor: 'pointer', borderBottom: `1px solid ${C.line}` },
  hitDot: { color: C.accent, marginRight: 8, fontSize: 10 },

  checking: { marginTop: 12, fontSize: 13, color: C.inkDim },
  okBox: { display: 'flex', alignItems: 'center', gap: 10, background: C.greenBg, borderRadius: 12, padding: '12px 14px', marginTop: 12 },
  okCheck: { width: 26, height: 26, borderRadius: '50%', background: C.green, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0 },
  okTitle: { display: 'block', fontSize: 13.5, fontWeight: 800, color: C.greenDeep },
  okSub: { display: 'block', fontSize: 12, color: C.greenMid },
  noBox: { marginTop: 12, fontSize: 13.5, fontWeight: 600, color: C.red, background: C.redBg, borderRadius: 12, padding: '12px 14px' },
  detailRow: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 },

  side: { flex: '0 0 250px', position: 'sticky', top: 16, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: '18px 20px' },
  sideTitle: { fontSize: 15, fontWeight: 900, marginBottom: 12 },
  minNote: { fontSize: 12, color: C.inkDim, marginBottom: 10 },
  sumLines: { borderBottom: `1px solid ${C.line}`, paddingBottom: 10, marginBottom: 10 },
  sumLine: { display: 'flex', gap: 7, fontSize: 12.5, marginBottom: 6, alignItems: 'baseline' },
  sumQty: { fontWeight: 800, color: C.inkDim },
  sumName: { flex: 1 },
  sumPrice: { fontWeight: 800, whiteSpace: 'nowrap' },
  sumRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.inkDim, marginBottom: 5 },
  sumTotal: { display: 'flex', justifyContent: 'space-between', fontSize: 19, fontWeight: 900, letterSpacing: '-.02em', margin: '8px 0 12px' },
  belowMin: { fontSize: 12.5, color: C.amber, background: C.amberBg, borderRadius: 11, padding: '10px 12px', marginBottom: 12 },
  cta: { width: '100%', background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '13px', fontWeight: 800, fontSize: 14.5, cursor: 'pointer' },
  ctaOff: { background: '#C9C5BD', cursor: 'not-allowed' },

  mobileBar: { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, padding: 12, display: 'none' },
  mobileSheet: { background: '#fff', border: `1px solid ${C.lineInput}`, borderRadius: 16, padding: '14px 16px', marginBottom: 8, boxShadow: '0 -4px 20px rgba(0,0,0,.1)' },
  mobileBarRow: { display: 'flex', gap: 10, alignItems: 'center', background: '#fff', border: `1px solid ${C.lineInput}`, borderRadius: 16, padding: '10px 12px', boxShadow: '0 4px 20px rgba(0,0,0,.12)' },
  mobileTotal: { flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
  mobileTotalLabel: { display: 'block', fontSize: 11, color: C.inkFaint },
  mobileTotalNum: { display: 'block', fontSize: 17, fontWeight: 900, letterSpacing: '-.02em', color: C.ink },
  mobileCta: { background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 20px', fontWeight: 800, fontSize: 14, cursor: 'pointer', flexShrink: 0 },
}
