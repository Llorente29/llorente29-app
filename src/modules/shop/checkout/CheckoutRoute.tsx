// src/modules/shop/checkout/CheckoutRoute.tsx
//
// Checkout de Folvy Shop — estilo B (moderno, una sola pagina, responsive).
// Secciones apiladas (Entrega · Hora · Quien recibe · Pago) en una pagina con
// scroll. Direccion con AUTOCOMPLETE (debounce, sin boton Buscar) reutilizando
// geocodeAddress (Mapbox) + validacion de zona (shop_check_delivery).
// Resumen sticky en escritorio; barra inferior fija desplegable en movil.
//
// Al confirmar: crea el pedido por la via canonica (place_shop_order →
// sale source='folvy_shop', order_status='new'). El precio se RECALCULA en
// servidor (el front no fija precio). Pago simulado en esta version; Stripe se
// enchufa por encima despues.

import { useEffect, useRef, useState } from 'react'
import { useShopCart } from '@/modules/shop/cart/ShopCartContext'
import {
  geocodeAddress, checkDelivery, getDeliverySlots, placeShopOrder,
  type GeocodeHit, type DeliveryCheck, type DeliverySlot, type ShopOrderPayload, type PlaceOrderResult,
} from '@/modules/shop/checkout/checkoutService'

const C = {
  page: '#F7F7F5', surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', accent: '#FF5436', accentBg: '#FFF4F1',
  green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4', greenMid: '#3E8A5F',
  amber: '#7A5A12', amberBg: '#FFF3D6', red: '#C23B22', redBg: '#FDE7E2', pill: '#EEEEEB',
}
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' \u20AC' }

type Mode = 'delivery' | 'pickup'

export default function CheckoutRoute({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { cart, totals, clear } = useShopCart()
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

  // Hora
  const [timeMode, setTimeMode] = useState<'asap' | 'scheduled'>('asap')
  const [slots, setSlots] = useState<DeliverySlot[]>([])
  const [slotTs, setSlotTs] = useState<string | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Contacto + envío del pedido
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [placing, setPlacing] = useState(false)
  const [placed, setPlaced] = useState<PlaceOrderResult | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)

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

  // Cargar franjas cuando se elige "Programar" (necesita local y eta de zona).
  useEffect(() => {
    if (timeMode !== 'scheduled' || !cart.locationId) return
    const eta = check?.ok ? (check.etaMin ?? 40) : 40
    setLoadingSlots(true)
    getDeliverySlots(slug, cart.locationId, eta, 30)
      .then((r) => setSlots(r))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false))
  }, [timeMode, cart.locationId, check, slug])

  const deliveryFee = mode === 'delivery' && check?.ok ? check.deliveryFee : 0
  const grandTotal = totals.subtotal - totals.discount + deliveryFee
  const minOrder = check?.ok ? check.minOrder : null
  const belowMin = mode === 'delivery' && minOrder != null && totals.subtotal < minOrder
  const missingForMin = belowMin && minOrder != null ? minOrder - totals.subtotal : 0
  const timeOk = timeMode === 'asap' || (timeMode === 'scheduled' && slotTs != null)
  const contactOk = name.trim().length > 1 && phone.replace(/\s+/g, '').length >= 7
  const canContinue = cart.lines.length > 0 && timeOk && contactOk && (
    mode === 'pickup' || (check?.ok === true && !belowMin && detail.trim().length > 0)
  )

  async function confirm() {
    if (!canContinue || placing || !cart.locationId) return
    setPlacing(true); setPlaceError(null)
    const payload: ShopOrderPayload = {
      locationId: cart.locationId,
      mode,
      customer: { name: name.trim(), phone: phone.trim() },
      delivery: {
        address: mode === 'delivery' ? (chosen?.label ?? '') : '',
        detail: mode === 'delivery' ? detail.trim() : '',
        lat: chosen?.lat ?? null,
        lng: chosen?.lng ?? null,
        zoneId: check?.ok ? check.zoneId : null,
        deliveryFee,
        note: notes.trim(),
      },
      expectedTime: timeMode === 'scheduled' ? slotTs : null,
      payment: { mode: 'simulated' },
      lines: cart.lines.map((l) => l.order),
    }
    try {
      const res = await placeShopOrder(slug, payload, false)
      if (!res.ok) { setPlaceError('No se pudo confirmar el pedido. Inténtalo de nuevo.'); return }
      setPlaced(res)
      clear()
    } catch {
      setPlaceError('No se pudo confirmar el pedido. Inténtalo de nuevo.')
    } finally {
      setPlacing(false)
    }
  }

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

  // Pantalla de confirmación (tras crear el pedido)
  if (placed) {
    return (
      <div style={s.page}>
        <div style={s.successWrap}>
          <div style={s.successCard}>
            <div style={s.successCheck}>{'\u2713'}</div>
            <h1 style={s.successTitle}>¡Pedido confirmado!</h1>
            <p style={s.successMsg}>
              {mode === 'pickup'
                ? 'Te avisaremos cuando esté listo para recoger.'
                : 'Lo estamos preparando y saldrá hacia tu dirección.'}
            </p>
            <div style={s.successCode}>
              <span style={s.successCodeLabel}>Código de pedido</span>
              <span style={s.successCodeNum}>{placed.code}</span>
            </div>
            {placed.total != null && <div style={s.successTotal}>Total {eur(placed.total)}</div>}
            <button style={s.successBtn} onClick={onBack}>Volver a la tienda</button>
          </div>
        </div>
      </div>
    )
  }

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

          <section style={s.card}>
            <h2 style={s.h2}>¿Cuándo?</h2>

            {/* Lo antes posible — tarjeta protagonista */}
            <button
              style={{ ...s.timeCard, ...(timeMode === 'asap' ? s.timeCardOn : {}) }}
              onClick={() => { setTimeMode('asap'); setSlotTs(null) }}
            >
              <span style={{ ...s.timeIcon, ...(timeMode === 'asap' ? s.timeIconOn : {}) }}>⚡</span>
              <span style={s.timeCardBody}>
                <span style={s.timeCardTitle}>Lo antes posible</span>
                <span style={s.timeCardSub}>
                  {mode === 'pickup'
                    ? 'Listo cuanto antes'
                    : check?.ok && check.etaMin != null
                      ? `Llega en unos ${check.etaMin} min`
                      : 'Te lo llevamos cuanto antes'}
                </span>
              </span>
              {timeMode === 'asap' && <span style={s.timeTick}>✓</span>}
            </button>

            {timeMode === 'asap' ? (
              <div style={s.schedLinkRow}>
                <button style={s.schedLink} onClick={() => setTimeMode('scheduled')}>Programar para más tarde</button>
              </div>
            ) : (
              <div style={{ ...s.timeCard, ...s.timeCardOn, display: 'block', marginTop: 10 }}>
                <div style={s.timeCardTitle}>Programar para más tarde</div>
                {loadingSlots ? (
                  <p style={{ ...s.muted, marginTop: 10 }}>Buscando horas disponibles…</p>
                ) : slots.length === 0 ? (
                  <p style={{ ...s.muted, marginTop: 10 }}>No quedan franjas hoy. Elige “Lo antes posible”.</p>
                ) : (
                  <select
                    style={s.select}
                    value={slotTs ?? ''}
                    onChange={(e) => setSlotTs(e.target.value || null)}
                  >
                    <option value="">Elige una hora…</option>
                    {slots.map((sl) => (
                      <option key={sl.ts} value={sl.ts}>Hoy · {sl.label}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </section>

          <section style={s.card}>
            <h2 style={s.h2}>¿Quién recibe?</h2>
            <div style={s.detailRow}>
              <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellidos" autoComplete="name" />
              <input style={s.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono de contacto" inputMode="tel" autoComplete="tel" />
            </div>
          </section>

          <section style={{ ...s.card, ...s.next }}>
            <h2 style={s.h2}>¿Cómo pagas?</h2>
            <p style={s.muted}>Tarjeta, Bizum y wallets — próximamente. En esta versión el pedido se registra al confirmar (pago simulado).</p>
          </section>
        </main>

        <aside className="ck-aside" style={s.side}>
          <div style={s.sideTitle}>Resumen</div>
          {minOrder != null && <div style={s.minNote}>Pedido mínimo {eur(minOrder)}</div>}
          {summaryLines}
          <div style={s.sumTotal}><span>Total</span><span>{eur(grandTotal)}</span></div>
          {belowMin && <div style={s.belowMin}>Te faltan <strong>{eur(missingForMin)}</strong> para el mínimo de {eur(minOrder!)}.</div>}
          <button
            style={{ ...s.cta, ...(canContinue && !placing ? {} : s.ctaOff) }}
            disabled={!canContinue || placing}
            onClick={confirm}
          >
            {placing ? 'Enviando…' : 'Confirmar pedido'}
          </button>
          {placeError && <div style={s.placeErr}>{placeError}</div>}
        </aside>
      </div>

      <div className="ck-mobilebar" style={s.mobileBar}>
        {expandSummary && (
          <div style={s.mobileSheet}>
            {summaryLines}
            {belowMin && <div style={s.belowMin}>Te faltan <strong>{eur(missingForMin)}</strong> para el mínimo.</div>}
          </div>
        )}
        {placeError && <div style={{ ...s.placeErr, marginBottom: 8 }}>{placeError}</div>}
        <div style={s.mobileBarRow}>
          <button style={s.mobileTotal} onClick={() => setExpandSummary((v) => !v)}>
            <span style={s.mobileTotalLabel}>Total {'\u00B7'} {totals.itemsCount} art. {expandSummary ? '\u2304' : '\u2303'}</span>
            <span style={s.mobileTotalNum}>{eur(grandTotal)}</span>
          </button>
          <button
            style={{ ...s.mobileCta, ...(canContinue && !placing ? {} : s.ctaOff) }}
            disabled={!canContinue || placing}
            onClick={confirm}
          >
            {placing ? '…' : 'Confirmar'}
          </button>
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

  slotGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8, marginTop: 4 },
  timeCard: { width: '100%', display: 'flex', alignItems: 'center', gap: 13, border: `1.5px solid ${C.lineInput}`, background: '#fff', borderRadius: 14, padding: 14, cursor: 'pointer', textAlign: 'left' },
  timeCardOn: { border: `2px solid ${C.ink}`, background: '#FAFAF8' },
  timeIcon: { width: 38, height: 38, borderRadius: 11, background: '#F1EFE8', color: '#888780', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 },
  timeIconOn: { background: C.ink, color: '#fff' },
  timeCardBody: { flex: 1 },
  timeCardTitle: { display: 'block', fontSize: 14.5, fontWeight: 900 },
  timeCardSub: { display: 'block', fontSize: 12.5, color: C.inkDim, marginTop: 2 },
  timeTick: { width: 22, height: 22, borderRadius: '50%', background: C.ink, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 },
  schedLinkRow: { textAlign: 'center', padding: '8px 0 2px' },
  schedLink: { background: 'none', border: 'none', fontSize: 13.5, fontWeight: 700, color: C.inkDim, borderBottom: `1.5px solid ${C.lineInput}`, paddingBottom: 1, cursor: 'pointer' },
  select: { width: '100%', marginTop: 10, border: `1.5px solid ${C.lineInput}`, borderRadius: 11, padding: '11px 14px', fontSize: 14, fontWeight: 700, color: C.ink, background: '#fff', boxSizing: 'border-box' },

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
  placeErr: { marginTop: 10, fontSize: 12.5, fontWeight: 700, color: C.red, background: C.redBg, borderRadius: 11, padding: '10px 12px', textAlign: 'center' },

  mobileBar: { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, padding: 12, display: 'none' },
  mobileSheet: { background: '#fff', border: `1px solid ${C.lineInput}`, borderRadius: 16, padding: '14px 16px', marginBottom: 8, boxShadow: '0 -4px 20px rgba(0,0,0,.1)' },
  mobileBarRow: { display: 'flex', gap: 10, alignItems: 'center', background: '#fff', border: `1px solid ${C.lineInput}`, borderRadius: 16, padding: '10px 12px', boxShadow: '0 4px 20px rgba(0,0,0,.12)' },
  mobileTotal: { flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
  mobileTotalLabel: { display: 'block', fontSize: 11, color: C.inkFaint },
  mobileTotalNum: { display: 'block', fontSize: 17, fontWeight: 900, letterSpacing: '-.02em', color: C.ink },
  mobileCta: { background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 20px', fontWeight: 800, fontSize: 14, cursor: 'pointer', flexShrink: 0 },

  // Confirmación
  successWrap: { maxWidth: 560, margin: '0 auto', padding: '48px 22px', display: 'flex', justifyContent: 'center' },
  successCard: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: '36px 28px', textAlign: 'center', width: '100%' },
  successCheck: { width: 64, height: 64, borderRadius: '50%', background: C.greenBg, color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 800, margin: '0 auto 16px' },
  successTitle: { fontSize: 24, fontWeight: 900, letterSpacing: '-.02em', margin: '0 0 8px' },
  successMsg: { fontSize: 14, color: C.inkDim, lineHeight: 1.5, margin: '0 0 20px' },
  successCode: { display: 'flex', flexDirection: 'column', gap: 4, background: '#FAFAF8', border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px', marginBottom: 14 },
  successCodeLabel: { fontSize: 11, color: C.inkFaint, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 },
  successCodeNum: { fontSize: 22, fontWeight: 900, letterSpacing: '-.01em', color: C.ink },
  successTotal: { fontSize: 16, fontWeight: 900, marginBottom: 20 },
  successBtn: { background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '13px 22px', fontWeight: 800, fontSize: 14.5, cursor: 'pointer' },
}
