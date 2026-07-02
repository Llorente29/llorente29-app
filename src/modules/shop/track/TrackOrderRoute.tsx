// src/modules/shop/track/TrackOrderRoute.tsx
//
// Página de seguimiento del pedido para el cliente (canal público del Shop).
// Es la cara del restaurante: se pinta con la marca (logo + color) y muestra el
// ESTADO REAL del pedido leído por token (shop_order_status), con detalle,
// dirección y — cuando Catcher lo entregue — repartidor + ETA.
//
// Verdad del estado: la escribe el backend (webhook de pago + webhook de
// Catcher). El front NUNCA inventa; refresca por polling (~12s) y degrada con
// honestidad cuando falta un dato (p.ej. repartidor aún sin asignar).
//
// Llave = public_token del pedido (no adivinable). Ruta: /t/:slug/seguir?t=<token>.

import { useEffect, useRef, useState } from 'react'
import { getShopOrderStatus, type ShopOrderStatus } from '@/modules/shop/checkout/checkoutService'

const FALLBACK = '#FF5436'
const C = {
  page: '#F7F7F5', surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', green: '#16A05B', greenBg: '#F0FAF4', amber: '#7A5A12', amberBg: '#FFF3D6',
  red: '#C23B22', redBg: '#FDE7E2',
}
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' \u20AC' }
function hhmm(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

// Iconos SVG inline (sin librería externa).
function I({ d, size = 18, fill = 'none', color = 'currentColor' }: { d: string; size?: number; fill?: string; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      {d.split('|').map((seg, i) => <path key={i} d={seg} />)}
    </svg>
  )
}
const IC = {
  check: 'M20 6 9 17l-5-5',
  moped: 'M19 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z|M6 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z|M6 15h7l3-6h2l2 4M4 7h4l2 8|M14 9V7h3',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z',
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z|M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  user: 'M20 21a8 8 0 1 0-16 0|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z|M4 22v-7',
  bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z|M3 6h18|M16 10a4 4 0 0 1-8 0',
}

type StepState = 'done' | 'current' | 'pending'
interface Step { key: string; label: string; sub?: string; icon: string; state: StepState }

// Deriva el paso actual del ESTADO REAL. Conservador y honesto: nunca marca un
// paso que no esté respaldado por un dato (pago, order_status, delivery_state).
function buildSteps(st: ShopOrderStatus): { steps: Step[]; rider: 'none' | 'searching' | 'assigned' } {
  const mode = st.mode ?? 'delivery'
  const os = (st.orderStatus ?? '').toLowerCase()
  const ds = (st.deliveryState ?? '').toLowerCase()
  const paidOrCash = st.paymentStatus === 'paid' || st.payMethod === 'cash'
  const doneSet = ['completed', 'delivered', 'done', 'picked_up', 'finished']

  // Nivel alcanzado (0..3).
  let lvl = paidOrCash ? 0 : 0
  if (os === 'accepted' || os === 'in_preparation' || os === 'preparing') lvl = 1
  if (mode === 'delivery') {
    if (ds === 'in_delivery' || ds === 'picking' || ds === 'in_picking_location') lvl = 2
    if (ds === 'finish' || doneSet.includes(os)) lvl = 3
  } else {
    if (os === 'ready' || os === 'ready_for_pickup') lvl = 2
    if (doneSet.includes(os)) lvl = 3
  }

  const etaTxt = hhmm(st.etaAt)
  const labels = mode === 'delivery'
    ? [
        { key: 'confirmed', label: 'Confirmado', icon: IC.check },
        { key: 'prep', label: 'En preparación', icon: IC.bag },
        { key: 'route', label: 'En camino', icon: IC.moped, sub: etaTxt ? `Llega alrededor de las ${etaTxt}` : undefined },
        { key: 'done', label: 'Entregado', icon: IC.flag },
      ]
    : [
        { key: 'confirmed', label: 'Confirmado', icon: IC.check },
        { key: 'prep', label: 'En preparación', icon: IC.bag },
        { key: 'ready', label: 'Listo para recoger', icon: IC.check, sub: etaTxt ? `Listo alrededor de las ${etaTxt}` : undefined },
        { key: 'done', label: 'Recogido', icon: IC.flag },
      ]

  const steps: Step[] = labels.map((l, i) => ({
    ...l,
    state: i < lvl ? 'done' : i === lvl ? 'current' : 'pending',
  }))
  // Si el nivel es el último y está respaldado por terminal real, todo done.
  if (lvl === 3) steps[3].state = 'done'

  // Repartidor (solo domicilio): asignado si tenemos nombre; buscando si ya está
  // aceptado y aún no llegó el dato de Catcher.
  let rider: 'none' | 'searching' | 'assigned' = 'none'
  if (mode === 'delivery') {
    if (st.riderName) rider = 'assigned'
    else if (lvl >= 1) rider = 'searching'
  }
  return { steps, rider }
}

export default function TrackOrderRoute({ slug, token, onBack }: { slug: string; token: string | null; onBack: () => void }) {
  const [st, setSt] = useState<ShopOrderStatus | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'notfound'>('loading')
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    if (!token) { setPhase('notfound'); return }

    let timer: number | null = null
    const isTerminal = (s: ShopOrderStatus) =>
      s.paymentStatus === 'failed' ||
      ['cancelled', 'canceled', 'rejected', 'completed', 'delivered', 'done', 'picked_up', 'finished'].includes((s.orderStatus ?? '').toLowerCase()) ||
      (s.deliveryState ?? '').toLowerCase() === 'finish' ||
      (s.deliveryState ?? '').toLowerCase() === 'canceled'

    const tick = async () => {
      const r = await getShopOrderStatus(token)
      if (!aliveRef.current) return
      if (!r.ok) { setPhase('notfound'); return }
      setSt(r); setPhase('ready')
      if (isTerminal(r) && timer) { window.clearInterval(timer); timer = null }
    }

    tick()
    timer = window.setInterval(tick, 12000)
    return () => { aliveRef.current = false; if (timer) window.clearInterval(timer) }
  }, [token, slug])

  const accent = st?.brand?.accentColor || FALLBACK
  const brandName = st?.brand?.name || 'Tu pedido'
  const brandLogo = st?.brand?.logoUrl || null

  // ── Estados de carga / no encontrado ──────────────────────────────────
  if (phase === 'loading') {
    return (
      <div style={s.page}>
        <div style={s.wrap}><div style={s.card}>
          <div style={s.spinner} aria-hidden />
          <p style={{ ...s.msg, textAlign: 'center' }}>Cargando tu pedido…</p>
        </div></div>
        <style>{`@keyframes tk-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }
  if (phase === 'notfound' || !st) {
    return (
      <div style={s.page}>
        <div style={s.wrap}><div style={s.card}>
          <h1 style={s.title}>No encontramos tu pedido</h1>
          <p style={s.msg}>Puede que el enlace no sea correcto o que el pedido ya no esté disponible.</p>
          <button style={{ ...s.btn, background: FALLBACK }} onClick={onBack}>Ir a la tienda</button>
        </div></div>
      </div>
    )
  }

  const mode = st.mode ?? 'delivery'

  // ── Terminales negativos ──────────────────────────────────────────────
  const os = (st.orderStatus ?? '').toLowerCase()
  if (st.paymentStatus === 'failed') {
    return <Shell accent={accent} brandName={brandName} brandLogo={brandLogo} code={st.code} onBack={onBack}>
      <Banner tone="red" title="El pago no se ha completado" msg="No se ha realizado ningún cargo por este pedido." />
    </Shell>
  }
  if (['cancelled', 'canceled', 'rejected'].includes(os)) {
    return <Shell accent={accent} brandName={brandName} brandLogo={brandLogo} code={st.code} onBack={onBack}>
      <Banner tone="red" title="Pedido cancelado" msg="Este pedido se ha cancelado. Si crees que es un error, contacta con el restaurante." />
    </Shell>
  }
  if ((st.deliveryState ?? '').toLowerCase() === 'canceled') {
    return <Shell accent={accent} brandName={brandName} brandLogo={brandLogo} code={st.code} onBack={onBack}>
      <Banner tone="amber" title="Problema con la entrega" msg="Hubo una incidencia con el reparto. El restaurante se pondrá en contacto contigo." />
    </Shell>
  }

  const { steps, rider } = buildSteps(st)
  const current = steps.find(x => x.state === 'current') ?? steps[steps.length - 1]
  const allDone = steps[steps.length - 1].state === 'done'
  const headline = allDone
    ? (mode === 'pickup' ? 'Pedido recogido' : 'Pedido entregado')
    : current.label

  return (
    <Shell accent={accent} brandName={brandName} brandLogo={brandLogo} code={st.code} onBack={onBack}>
      {/* Estado grande + subtítulo */}
      <div style={{ padding: '18px 18px 4px' }}>
        <div style={s.kicker}>Tu pedido va</div>
        <div style={{ ...s.headline, color: allDone ? C.green : C.ink }}>{headline}</div>
        {current.sub && !allDone && <div style={s.sub}>{current.sub}</div>}
      </div>

      {/* Stepper vertical */}
      <div style={{ padding: '14px 18px 6px' }}>
        {steps.map((step, i) => {
          const last = i === steps.length - 1
          const dotBg = step.state === 'done' ? C.green : step.state === 'current' ? accent : '#fff'
          const dotColor = step.state === 'pending' ? '#B4B2A9' : '#fff'
          const dotBorder = step.state === 'pending' ? `2px solid ${C.line}` : 'none'
          const ring = step.state === 'current' ? `0 0 0 4px ${accent}22` : 'none'
          return (
            <div key={step.key} style={{ display: 'flex', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: dotBg, color: dotColor, border: dotBorder, boxShadow: ring, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I d={step.state === 'done' ? IC.check : step.icon} size={14} color={dotColor} />
                </div>
                {!last && <div style={{ width: 2, flex: 1, minHeight: 22, background: step.state === 'done' ? C.green : (step.state === 'current' ? accent : C.line) }} />}
              </div>
              <div style={{ paddingBottom: last ? 0 : 14 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: step.state === 'pending' ? '#B4B2A9' : (step.state === 'current' ? accent : C.ink) }}>{step.label}</div>
                {step.sub && step.state !== 'pending' && <div style={{ fontSize: 12, color: C.inkDim }}>{step.sub}</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Repartidor (solo domicilio) */}
      {mode === 'delivery' && rider !== 'none' && (
        <div style={s.riderRow}>
          <div style={{ ...s.riderAv, background: `${accent}18`, color: accent }}>
            <I d={rider === 'assigned' ? IC.user : IC.moped} size={20} color={accent} />
          </div>
          {rider === 'assigned' ? (
            <>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{st.riderName}</div>
                <div style={{ fontSize: 12, color: C.inkFaint }}>Tu repartidor</div>
              </div>
            </>
          ) : (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Buscando repartidor…</div>
              <div style={{ fontSize: 12, color: C.inkFaint }}>Te avisaremos cuando salga hacia ti</div>
            </div>
          )}
        </div>
      )}

      {/* Dirección */}
      {st.address && (
        <div style={s.addrRow}>
          <I d={IC.pin} size={18} color={FALLBACK} />
          <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
            {mode === 'pickup' && <div style={{ fontWeight: 800, marginBottom: 1 }}>Recoges en {st.locationName || 'el local'}</div>}
            {st.address}
          </div>
        </div>
      )}

      {/* Detalle del pedido */}
      <div style={{ padding: '16px 18px 20px' }}>
        <div style={s.kicker}>Tu pedido{st.code ? ` · ${st.code}` : ''}</div>
        <div style={{ marginTop: 10 }}>
          {(st.lines ?? []).map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13.5, marginBottom: 8 }}>
              <span style={{ color: C.inkFaint, fontWeight: 700 }}>{l.quantity}x</span>
              <span style={{ flex: 1, color: C.ink }}>{l.name}</span>
              {l.lineTotal != null && <span style={{ fontWeight: 700, color: C.ink }}>{eur(l.lineTotal)}</span>}
            </div>
          ))}
        </div>
        {(st.total != null) && (
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, marginTop: 2 }}>
            {st.deliveryFee != null && st.deliveryFee > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.inkDim, marginBottom: 6 }}>
                <span>Gastos de envío</span><span>{eur(st.deliveryFee)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800, color: C.ink, letterSpacing: '-.02em' }}>
              <span>Total</span><span>{eur(st.total)}</span>
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}

// ── Marco con cabecera de marca ─────────────────────────────────────────
function Shell({ accent, brandName, brandLogo, code, onBack, children }: {
  accent: string; brandName: string; brandLogo: string | null; code?: string; onBack: () => void; children: React.ReactNode
}) {
  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <div style={s.card}>
          <div style={{ ...s.header, background: accent }}>
            <div style={s.logoBox}>
              {brandLogo
                ? <img src={brandLogo} alt={brandName} style={s.logoImg} />
                : <span style={{ fontSize: 18, fontWeight: 900, color: accent }}>{brandName.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.2, color: '#fff' }}>{brandName}</div>
              {code && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.85)', marginTop: 2 }}>Pedido {code}</div>}
            </div>
            <span style={s.livePill}><span style={s.liveDot} />en vivo</span>
          </div>
          {children}
          <div style={{ padding: '4px 18px 18px' }}>
            <button style={s.backLink} onClick={onBack}>Volver a la tienda</button>
          </div>
        </div>
      </div>
      <style>{`@keyframes tk-spin { to { transform: rotate(360deg); } } @keyframes tk-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>
    </div>
  )
}

function Banner({ tone, title, msg }: { tone: 'red' | 'amber'; title: string; msg: string }) {
  const bg = tone === 'red' ? C.redBg : C.amberBg
  const fg = tone === 'red' ? C.red : C.amber
  return (
    <div style={{ padding: '20px 18px' }}>
      <div style={{ background: bg, borderRadius: 14, padding: '16px 16px' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: fg, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: fg, lineHeight: 1.45, opacity: .92 }}>{msg}</div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: C.page },
  wrap: { maxWidth: 460, margin: '0 auto', padding: '20px 16px 40px' },
  card: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, overflow: 'hidden' },
  header: { padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 11 },
  logoBox: { width: 40, height: 40, borderRadius: 11, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' },
  logoImg: { width: '100%', height: '100%', objectFit: 'contain' },
  livePill: { marginLeft: 'auto', fontSize: 11, color: '#fff', background: 'rgba(255,255,255,.18)', padding: '4px 9px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  liveDot: { width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'tk-pulse 1.6s ease-in-out infinite' },
  kicker: { fontSize: 12, color: C.inkFaint, letterSpacing: '.03em', textTransform: 'uppercase', fontWeight: 700 },
  headline: { fontSize: 23, fontWeight: 900, letterSpacing: '-.02em', margin: '3px 0 2px' },
  sub: { fontSize: 13.5, color: C.inkDim },
  riderRow: { margin: '0 18px', padding: '12px 0', borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 12 },
  riderAv: { width: 42, height: 42, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  addrRow: { margin: '0 18px', padding: '12px 0', borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 20, fontWeight: 900, letterSpacing: '-.02em', margin: '0 0 8px', textAlign: 'center' },
  msg: { fontSize: 14, color: C.inkDim, lineHeight: 1.5, margin: '0 0 18px' },
  btn: { display: 'block', width: '100%', color: '#fff', border: 'none', borderRadius: 999, padding: '13px', fontWeight: 800, fontSize: 14.5, cursor: 'pointer' },
  backLink: { display: 'block', margin: '4px auto 0', background: 'none', border: 'none', color: C.inkDim, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' },
  spinner: { width: 44, height: 44, borderRadius: '50%', border: `4px solid ${C.line}`, borderTopColor: FALLBACK, margin: '8px auto 14px', animation: 'tk-spin 0.8s linear infinite' },
}
