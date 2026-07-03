// src/modules/shop/checkout/CheckoutRoute.tsx
//
// Checkout de Folvy Shop — estilo B (moderno, una sola pagina, responsive).
// Secciones apiladas (Entrega · Hora · Quien recibe · Pago) en una pagina con
// scroll. Direccion con AUTOCOMPLETE (debounce, sin boton Buscar) reutilizando
// geocodeAddress (Mapbox) + validacion de zona (shop_check_delivery).
// Resumen sticky en escritorio; barra inferior fija desplegable en movil.
//
// Flujo: confirmar -> place_shop_order (crea el pedido 'new') -> crear
// PaymentIntent (direct charge sobre la cuenta del restaurante) -> Payment
// Element (tarjeta + Bizum) -> pago -> confirmacion VERAZ. El webhook confirma
// el pedido server-side; el front LEE ese estado real por token (shop_order_status)
// en vez de fiarse de senales del cliente. El precio SIEMPRE se recalcula en servidor.

import { useEffect, useMemo, useRef, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useShopCart } from '@/modules/shop/cart/ShopCartContext'
import {
  geocodeAddress, checkDelivery, getDeliverySlots, placeShopOrder, createShopPaymentIntent,
  getShopPaymentConfig, getShopLocations, getShopOrderStatus,
  type GeocodeHit, type DeliveryCheck, type DeliverySlot, type ShopOrderPayload, type ShopPaymentConfig, type ShopLocation, type CouponResult,
} from '@/modules/shop/checkout/checkoutService'
import { getShopHub, type ShopHub } from '@/modules/shop/services/shopHubService'
import { getSessionCustomer, registerShopConsent } from '@/modules/shop/checkout/customerAuthService'
import { getAddresses, type CustomerAddress } from '@/modules/shop/account/accountService'
import { promoValue, couponReasonMsg } from '@/modules/shop/checkout/couponText'

const C = {
  page: '#F7F7F5', surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', accent: '#FF5436', accentBg: '#FFF4F1',
  green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4', greenMid: '#3E8A5F',
  amber: '#7A5A12', amberBg: '#FFF3D6', red: '#C23B22', redBg: '#FDE7E2', pill: '#EEEEEB',
}
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' \u20AC' }

// Nota gris cuando la bienvenida existe pero no aplica por un motivo distinto a
// "falta contacto": ya usada (not_first/per_customer) o agotada (exhausted).
function welcomeNoteMsg(reason: string | null | undefined): string {
  if (reason === 'exhausted') return 'La oferta de bienvenida se ha agotado por ahora.'
  return 'Esta bienvenida es solo para el primer pedido, pero pronto tendremos más para ti.'
}
// promoValue + couponReasonMsg viven en couponText.ts (compartidos con Mi cuenta).

// Icono de ubicación (protagonista de la sección de entrega).
function Pin({ size = 24, color = '#FF5436' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <path d="M9 11a3 3 0 1 0 6 0 3 3 0 0 0-6 0" />
      <path d="M17.657 16.657 13.414 20.9a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z" />
    </svg>
  )
}

// Candado (sello de pago protegido).
function Lock({ size = 15, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

// Escudo con check (confianza).
function Shield({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

// Cabecera de sección con número de paso (jerarquía 1·2·3).
function StepHead({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={s.stepHead}>
      <span style={s.stepNum}>{n}</span>
      <span style={s.stepTitle}>{children}</span>
    </div>
  )
}

const PENDING_KEY = 'folvy-shop-pending'

type Mode = 'delivery' | 'pickup'

interface PayContext {
  clientSecret: string
  connectedAccountId: string
  saleId: string
  code: string
  total: number
  token: string
}

// Resultado del pedido, dirigido por el ESTADO REAL de la venta (no por señales
// del cliente). 'confirming' = esperando la verdad del webhook; 'confirmed' =
// pagado/aceptado; 'failed' = pago rechazado; 'slow' = tarda (el pedido existe,
// el webhook puede aterrizar) — honesto, nunca "confirmado" sin pago.
type ConfirmStatus = 'confirming' | 'confirmed' | 'failed' | 'slow'
interface OrderResult {
  status: ConfirmStatus
  payMethod: 'online' | 'cash'
  mode: Mode
  code?: string
  total?: number
  token?: string
}

export default function CheckoutRoute({ slug, onBack, onTrack }: { slug: string; onBack: () => void; onTrack?: (token: string) => void }) {
  const { cart, totals, clear, setLocation } = useShopCart()
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

  // Contacto + flujo de pago
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [alreadyConsented, setAlreadyConsented] = useState(false)   // ya en el Club (F2) -> ocultar casilla
  const consentTouchedRef = useRef(false)                           // el usuario tocó la casilla
  // Cupón: código manual + resultado del dry-run (fuente de verdad = servidor).
  const [couponCode, setCouponCode] = useState('')
  const [couponInput, setCouponInput] = useState('')       // lo que teclea antes de aplicar
  const [showCouponField, setShowCouponField] = useState(false)
  const [coupon, setCoupon] = useState<CouponResult | null>(null)
  const [couponBusy, setCouponBusy] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [placeError, setPlaceError] = useState<string | null>(null)
  const [stage, setStage] = useState<'form' | 'pay'>('form')
  const [pay, setPayCtx] = useState<PayContext | null>(null)
  const [result, setResult] = useState<OrderResult | null>(null)

  // Guarda de vida: cortamos cualquier polling en curso si el componente se va.
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  // Métodos de pago que ofrece esta tienda (configurable por cuenta).
  const [payConfig, setPayConfig] = useState<ShopPaymentConfig>({ online: true, cashPickup: false, cashDelivery: false })

  // Locales de la tienda (para el selector de recogida y para mostrar dónde recoge).
  const [locations, setLocations] = useState<ShopLocation[]>([])
  useEffect(() => {
    let alive = true
    getShopLocations(slug).then((r) => { if (alive) setLocations(r) }).catch(() => {})
    return () => { alive = false }
  }, [slug])
  const candidateLocs = cart.candidateLocationIds
    .map((id) => locations.find((l) => l.id === id))
    .filter(Boolean) as ShopLocation[]
  const chosenLoc = cart.locationId ? (locations.find((l) => l.id === cart.locationId) ?? null) : null

  useEffect(() => {
    let alive = true
    getShopPaymentConfig(slug).then((c) => { if (alive) setPayConfig(c) }).catch(() => {})
    return () => { alive = false }
  }, [slug])

  // Identidad de la tienda (nombre + logo) para la cabecera de la pantalla de
  // pago. El carrito es multimarca (varias cocinas, una entrega): mostramos la
  // TIENDA, no una marca suelta. Si falla, la cabecera degrada a algo neutro.
  const [hub, setHub] = useState<ShopHub | null>(null)
  useEffect(() => {
    let alive = true
    getShopHub(slug).then((h) => { if (alive) setHub(h) }).catch(() => {})
    return () => { alive = false }
  }, [slug])

  // Precarga F2: si el comensal entró con su cuenta, rellenamos sus datos. Así no
  // le pedimos el correo que ya tenemos (solo campos vacíos; nunca pisa lo tecleado).
  useEffect(() => {
    let alive = true
    getSessionCustomer(slug).then((c) => {
      if (!alive || !c) return
      if (c.name)  setName((v) => v.trim() ? v : c.name!)
      if (c.phone) setPhone((v) => v.trim() ? v : c.phone!)
      if (c.email) setEmail((v) => v.trim() ? v : c.email!)
      // Ya en el Club: no re-preguntamos (casilla oculta) y la bienvenida aplica sola.
      if (c.consented) { setAlreadyConsented(true); setMarketingConsent(true) }
    }).catch(() => {})
    return () => { alive = false }
  }, [slug])

  // F4·T1: direcciones guardadas del comensal (si hay sesión). Se muestran como
  // chips sobre el autocomplete; elegir una salta el geocode (ya trae lat/lng) pero
  // sigue pasando por checkDelivery (la zona manda). Solo las que tienen coordenadas.
  const [addresses, setAddresses] = useState<CustomerAddress[]>([])
  useEffect(() => {
    let alive = true
    getAddresses(slug).then((r) => { if (alive) setAddresses(r.filter((a) => a.lat != null && a.lng != null)) }).catch(() => {})
    return () => { alive = false }
  }, [slug])

  function pickSavedAddress(a: CustomerAddress) {
    if (a.lat == null || a.lng == null) return
    if (a.detail) setDetail(a.detail)
    chooseHit({ label: a.address, lat: a.lat, lng: a.lng, postcode: null })
  }

  // F4·T2: cupón precargado desde "Mis bonos" (Usar ahora con código). Al montar
  // el checkout lo aplicamos y limpiamos la clave; el dry-run existente hace el resto.
  useEffect(() => {
    try {
      const k = `folvy-shop-pending-coupon:${slug}`
      const code = sessionStorage.getItem(k)
      if (code) { setCouponCode(code); sessionStorage.removeItem(k) }
    } catch { /* ignore */ }
  }, [slug])

  // Captura ANTICIPADA de consentimiento: al marcar/desmarcar la casilla (con correo
  // válido) registramos el permiso YA, sin esperar al pago. Solo tras interacción
  // real del usuario y nunca para quien ya venía consentido de su cuenta (F2).
  useEffect(() => {
    if (!consentTouchedRef.current || alreadyConsented) return
    const em = email.trim()
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return
    const t = setTimeout(() => {
      registerShopConsent({
        slug, email: em,
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
        consent: marketingConsent,
      }).then((res) => {
        // Ya consintió aquí y ahora: ocultamos la casilla (no pinta nada ya en el Club).
        if (res.ok && res.consented) setAlreadyConsented(true)
      }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketingConsent, email, alreadyConsented, slug])

  const debounceRef = useRef<number | null>(null)

  // Confirmación VERAZ: leemos el estado real del pedido por token, con polling
  // corto, en vez de fiarnos de que confirmPayment no diera error o del
  // redirect_status de la URL (que en Bizum NO es la verdad del pago).
  async function startOnlineConfirmation(token: string | undefined, code?: string, total?: number, m: Mode = mode) {
    // Sin token no podemos confirmar contra BBDD: estado honesto de "procesando".
    if (!token) { setResult({ status: 'slow', payMethod: 'online', mode: m, code, total }); return }
    try { localStorage.removeItem(PENDING_KEY) } catch { /* ignore */ }
    setResult({ status: 'confirming', payMethod: 'online', mode: m, code, total, token })

    const started = Date.now()
    const timeoutMs = 30000
    const stepMs = 2000
    while (Date.now() - started < timeoutMs) {
      const st = await getShopOrderStatus(token)
      if (!aliveRef.current) return
      if (st.ok) {
        if (st.paymentStatus === 'paid') {
          setResult({ status: 'confirmed', payMethod: 'online', mode: m, code: st.code ?? code, total: st.total ?? total, token })
          clear()
          return
        }
        if (st.paymentStatus === 'failed') {
          setResult({ status: 'failed', payMethod: 'online', mode: m, code: st.code ?? code, total: st.total ?? total, token })
          return
        }
      }
      await new Promise((r) => setTimeout(r, stepMs))
      if (!aliveRef.current) return
    }
    // Se agotó la espera: el pedido existe y el webhook puede confirmar aún.
    setResult({ status: 'slow', payMethod: 'online', mode: m, code, total, token })
  }

  // Retorno de un pago con redirección (p.ej. Bizum): Stripe vuelve con
  // ?redirect_status=... La VERDAD del pago NO es ese parámetro: la leemos de la
  // BBDD por token (persistido antes de redirigir). El param solo nos dice que
  // hemos vuelto.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const rs = params.get('redirect_status')
    if (!rs) return
    // Limpiamos la query para que un refresh no re-dispare la confirmación.
    try { window.history.replaceState({}, '', window.location.pathname) } catch { /* ignore */ }

    let pending: any = null
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null') } catch { /* ignore */ }
    const token = pending?.token as string | undefined
    const m = (pending?.mode as Mode) || mode
    if (token) {
      startOnlineConfirmation(token, pending?.code, pending?.total, m)
    } else if (rs === 'failed') {
      setResult({ status: 'failed', payMethod: 'online', mode: m })
    } else {
      setResult({ status: 'slow', payMethod: 'online', mode: m })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const cands = cart.candidateLocationIds
    if (cands.length === 0) return
    setChecking(true)
    try {
      // Multi-local: probamos cada candidato y gana el que cubre la dirección
      // (el más cercano si varios). Ese local queda fijado para el pedido.
      let best: DeliveryCheck | null = null
      let bestLoc: string | null = null
      for (const locId of cands) {
        const r = await checkDelivery(slug, locId, h.lat, h.lng)
        if (r.ok && (best === null || best.ok !== true || r.distanceM < best.distanceM)) {
          best = r; bestLoc = locId
        }
      }
      if (best && best.ok && bestLoc) { setLocation(bestLoc); setCheck(best) }
      else setCheck({ ok: false, reason: 'out_of_zone' })
    } catch { setCheck({ ok: false, reason: 'error' }) }
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
  // Descuento efectivo = el que devuelve el servidor (cupón), o 0.
  const couponDiscount = coupon?.applied ? (coupon.discount ?? 0) : 0
  const grandTotal = totals.subtotal - totals.discount - couponDiscount + deliveryFee
  const minOrder = check?.ok ? check.minOrder : null
  const belowMin = mode === 'delivery' && minOrder != null && totals.subtotal < minOrder
  const missingForMin = belowMin && minOrder != null ? minOrder - totals.subtotal : 0
  const timeOk = timeMode === 'asap' || (timeMode === 'scheduled' && slotTs != null)
  const contactOk = name.trim().length > 1 && phone.replace(/\s+/g, '').length >= 7
  const canContinue = cart.lines.length > 0 && timeOk && contactOk && (
    mode === 'pickup'
      ? cart.locationId != null
      : (check?.ok === true && !belowMin && detail.trim().length > 0)
  )

  // ¿Qué métodos hay disponibles para el modo de entrega elegido?
  const cashAvailable = mode === 'pickup' ? payConfig.cashPickup : payConfig.cashDelivery
  const onlineAvailable = payConfig.online

  // ── Cupón: recalcular vía dry-run (el servidor es la fuente de verdad) ──
  // Se dispara cuando cambian las líneas, el modo, el email o el código.
  async function refreshCoupon(codeOverride?: string) {
    if (cart.lines.length === 0) { setCoupon(null); return }
    // El cupón se calcula sobre el subtotal (no necesita el local). Usamos el
    // local elegido, o el primero candidato/disponible como respaldo, solo para
    // que el payload sea válido — el descuento no depende de él.
    const locId = cart.locationId
      ?? cart.candidateLocationIds?.[0]
      ?? locations[0]?.id
      ?? null
    if (!locId) { setCoupon(null); return }
    const code = codeOverride !== undefined ? codeOverride : couponCode
    setCouponBusy(true)
    try {
      const payload: ShopOrderPayload = {
        locationId: locId,
        mode,
        customer: { name: name.trim(), phone: phone.trim(), email: email.trim() || undefined },
        // A2: la bienvenida solo aplica con email + consentimiento; el dry-run debe
        // enviarlos para que el banner verde se muestre en la previsualización.
        consent: { marketing: marketingConsent && email.trim().length > 0, termsVersion: 'shop-privacy-v1' },
        delivery: {
          address: '', detail: '', lat: null, lng: null, zoneId: null,
          deliveryFee, note: '',
        },
        expectedTime: null,
        payment: { mode: 'stripe' },
        lines: cart.lines.map((l) => l.order),
        coupon: code ? { code } : undefined,
      }
      const res = await placeShopOrder(slug, payload, true)   // dry-run
      setCoupon(res.coupon ?? null)
    } catch {
      setCoupon(null)
    } finally {
      setCouponBusy(false)
    }
  }

  // Recalcular el cupón cuando cambian las variables que le afectan.
  // (email con debounce ligero para no llamar en cada tecla.)
  useEffect(() => {
    const t = setTimeout(() => { refreshCoupon() }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, marketingConsent, mode, cart.lines.length, cart.locationId, couponCode, deliveryFee, locations.length])

  function applyCouponCode() {
    const code = couponInput.trim()
    if (!code || couponBusy) return
    setCouponCode(code)
    refreshCoupon(code)
  }
  function removeCoupon() {
    setCouponCode(''); setCouponInput(''); setShowCouponField(false)
    refreshCoupon('')
  }

  // Confirmar el formulario. method = 'online' (Stripe) | 'cash' (efectivo).
  async function goToPayment(method: 'online' | 'cash' = 'online') {
    if (!canContinue || placing || !cart.locationId) return
    setPlacing(true); setPlaceError(null)
    const payload: ShopOrderPayload = {
      locationId: cart.locationId,
      mode,
      customer: { name: name.trim(), phone: phone.trim(), email: email.trim() || undefined },
      consent: { marketing: marketingConsent && email.trim().length > 0, termsVersion: 'shop-privacy-v1' },
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
      payment: { mode: method === 'cash' ? 'cash' : 'stripe' },
      lines: cart.lines.map((l) => l.order),
      coupon: couponCode ? { code: couponCode } : undefined,
    }
    try {
      const res = await placeShopOrder(slug, payload, false)
      if (!res.ok || !res.saleId) { setPlaceError('No se pudo crear el pedido. Inténtalo de nuevo.'); return }

      // EFECTIVO: el pedido nace aceptado (entra en cocina). No hay pago online;
      // vamos directos a la confirmación (aceptado, no "pagado").
      if (method === 'cash') {
        setResult({ status: 'confirmed', payMethod: 'cash', mode, code: res.code, total: res.total ?? grandTotal, token: res.publicToken })
        clear()
        return
      }

      // ONLINE: crear el PaymentIntent y pasar a la etapa de pago.
      const pi = await createShopPaymentIntent(res.saleId)
      if (!pi.ok || !pi.clientSecret || !pi.connectedAccountId) {
        setPlaceError('No se pudo iniciar el pago. Inténtalo de nuevo.'); return
      }
      setPayCtx({
        clientSecret: pi.clientSecret,
        connectedAccountId: pi.connectedAccountId,
        saleId: res.saleId,
        code: res.code ?? '',
        total: res.total ?? grandTotal,
        token: res.publicToken ?? '',
      })
      setStage('pay')
    } catch {
      setPlaceError('No se pudo iniciar el pago. Inténtalo de nuevo.')
    } finally {
      setPlacing(false)
    }
  }

  // Métodos SIN redirección (tarjeta): confirmPayment volvió sin error, pero la
  // verdad la escribe el webhook -> arrancamos la confirmación veraz por token.
  function handlePaid() {
    const p = pay
    setStage('form')
    setPayCtx(null)
    startOnlineConfirmation(p?.token, p?.code, p?.total, mode)
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
      {couponDiscount > 0 && (
        <div style={{ ...s.sumRow, color: C.green }}>
          <span>{coupon?.isWelcome ? 'Bienvenida' : (coupon?.label ?? 'Descuento')}{coupon?.code ? ` (${coupon.code})` : ''}</span>
          <span>-{eur(couponDiscount)}</span>
        </div>
      )}
      <div style={s.sumRow}>
        <span>Gastos de envío</span>
        <span>{mode === 'pickup' ? '-' : (check?.ok ? eur(deliveryFee) : 'Indica tu dirección')}</span>
      </div>
    </>
  )

  // Pantalla de confirmación (dirigida por el ESTADO REAL del pedido)
  if (result) {
    // Confirmando: esperando la verdad del webhook.
    if (result.status === 'confirming') {
      return (
        <div style={s.page}>
          <div style={s.successWrap}>
            <div style={s.successCard}>
              <div style={s.spinner} aria-hidden />
              <h1 style={s.successTitle}>Confirmando tu pago…</h1>
              <p style={s.successMsg}>Estamos verificando el pago con el banco. Suele tardar solo unos segundos.</p>
            </div>
          </div>
          <style>{`@keyframes ck-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )
    }

    // Pago rechazado: nunca "confirmado". No hay cargo; se puede reintentar.
    if (result.status === 'failed') {
      return (
        <div style={s.page}>
          <div style={s.successWrap}>
            <div style={s.successCard}>
              <div style={s.failCheck}>{'\u2715'}</div>
              <h1 style={s.successTitle}>El pago no se ha completado</h1>
              <p style={s.successMsg}>No se ha realizado ningún cargo. Puedes intentarlo de nuevo.</p>
              {result.code ? (
                <div style={s.successCode}>
                  <span style={s.successCodeLabel}>Código de pedido</span>
                  <span style={s.successCodeNum}>{result.code}</span>
                </div>
              ) : null}
              <button style={s.successBtn} onClick={() => { setResult(null); setStage('form') }}>Reintentar el pago</button>
            </div>
          </div>
        </div>
      )
    }

    // Confirmado (pagado / efectivo aceptado) o procesando (slow).
    const confirmed = result.status === 'confirmed'
    const cash = result.payMethod === 'cash'
    return (
      <div style={s.page}>
        <div style={s.successWrap}>
          <div style={s.successCard}>
            <div style={confirmed ? s.successCheck : s.slowCheck}>{confirmed ? '\u2713' : '\u2026'}</div>
            <h1 style={s.successTitle}>{confirmed ? '¡Pedido confirmado!' : 'Estamos procesando tu pago'}</h1>
            <p style={s.successMsg}>
              {!confirmed
                ? 'Tu pago se está procesando. En cuanto se confirme, prepararemos tu pedido. Guarda tu código.'
                : cash
                  ? (result.mode === 'pickup'
                      ? 'Pagarás en efectivo al recoger. Te avisaremos cuando esté listo.'
                      : 'Pagarás en efectivo a la entrega. Lo estamos preparando.')
                  : (result.mode === 'pickup'
                      ? 'Te avisaremos cuando esté listo para recoger.'
                      : 'Lo estamos preparando y saldrá hacia tu dirección.')}
            </p>
            {result.code ? (
              <div style={s.successCode}>
                <span style={s.successCodeLabel}>Código de pedido</span>
                <span style={s.successCodeNum}>{result.code}</span>
              </div>
            ) : null}
            {result.total != null && <div style={s.successTotal}>Total {eur(result.total)}</div>}
            {result.token && onTrack ? (
              <>
                <button style={s.successBtn} onClick={() => onTrack(result.token!)}>Seguir mi pedido</button>
                <button style={s.successBtnGhost} onClick={onBack}>Volver a la tienda</button>
              </>
            ) : (
              <button style={s.successBtn} onClick={onBack}>Volver a la tienda</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Etapa de pago (Payment Element)
  if (stage === 'pay' && pay) {
    return (
      <div style={s.page}>
        <header style={s.header}>
          <button style={s.back} onClick={() => { setStage('form'); setPayCtx(null) }}>{'\u2190'} Volver al pedido</button>
        </header>
        <div style={s.payWrap}>
          <div style={s.payCard}>
            {/* Banda oscura de marca: el logo se ve igual que en el hero */}
            <div style={s.payBrandBand}>
              {hub?.accountLogoUrl
                ? <img src={hub.accountLogoUrl} alt={hub?.accountName || ''} style={s.payBrandLogo} />
                : <span style={s.payBrandName}>{hub?.accountName || 'Folvy'}</span>}
              <span style={s.trustChipDark}><Lock size={12} color="#fff" /> Pago protegido</span>
            </div>

            {/* Local + resumen de lo que pagas (contexto antes de la tarjeta) */}
            <div style={s.payRecap}>
              {chosenLoc?.name && (
                <div style={s.payLocRow}>
                  <Pin size={15} color={C.accent} />
                  <span>{mode === 'pickup' ? `Recoges en ${chosenLoc.name}` : 'Entrega a domicilio'}</span>
                </div>
              )}
              {cart.lines.map((l) => (
                <div key={l.lineId} style={s.payRecapLine}>
                  <span style={s.payRecapQty}>{l.quantity}x</span>
                  <span style={s.payRecapName}>{l.name}</span>
                  <span style={s.payRecapPrice}>{eur(l.unitPrice * l.quantity)}</span>
                </div>
              ))}
              <div style={s.payRecapTotal}>
                <span>Total a pagar</span>
                <span style={s.payTotalNum}>{eur(pay.total)}</span>
              </div>
            </div>

            <PaymentSection pay={pay} mode={mode} onPaid={handlePaid} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      {showPrivacy && (
        <div style={s.modalWrap} onClick={() => setShowPrivacy(false)}>
          <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
            <h2 style={s.modalTitle}>Política de privacidad</h2>
            <p style={s.modalP}>
              Responsable del tratamiento: <strong>{hub?.accountName || 'la tienda'}</strong>. Puedes consultar
              sus datos fiscales completos en el local o solicitarlos por los medios de contacto de la tienda.
            </p>
            <p style={s.modalH}>¿Qué datos tratamos?</p>
            <p style={s.modalP}>
              Los que nos facilitas al hacer un pedido: nombre, teléfono, dirección de entrega y, si lo aportas,
              email. También los datos de tus pedidos.
            </p>
            <p style={s.modalH}>¿Para qué?</p>
            <p style={s.modalP}>
              Para gestionar y entregar tu pedido. Si marcas la casilla de consentimiento, además usaremos tu
              email para enviarte ofertas y novedades de la tienda. Este consentimiento es voluntario y no
              condiciona la realización del pedido.
            </p>
            <p style={s.modalH}>Tus derechos</p>
            <p style={s.modalP}>
              Puedes acceder, rectificar o suprimir tus datos, oponerte a su tratamiento y retirar tu
              consentimiento en cualquier momento, así como darte de baja de las comunicaciones comerciales
              desde cualquier email que recibas. Para ejercer tus derechos, contacta con la tienda.
            </p>
            <p style={s.modalH}>Conservación</p>
            <p style={s.modalP}>
              Conservamos tus datos mientras exista la relación comercial o hasta que retires tu consentimiento,
              y después durante los plazos legalmente exigibles.
            </p>
            <button style={s.modalClose} onClick={() => setShowPrivacy(false)}>Entendido</button>
          </div>
        </div>
      )}
      <header style={s.header}>
        <button style={s.back} onClick={onBack}>{'\u2190'} Seguir comprando</button>
      </header>

      <div className="ck-cols" style={s.cols}>
        <nav className="ck-timeline" style={s.timeline} aria-hidden>
          {['Entrega', 'Hora', 'Datos', 'Pago'].map((t, i) => (
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
              <button style={{ ...s.modeOpt, ...(mode === 'pickup' ? s.modeOptOn : {}) }} onClick={() => setMode('pickup')}>Recoger en el local</button>
            </div>

            {mode === 'delivery' ? (
              <>
                <StepHead n={1}>¿Dónde lo llevamos?</StepHead>
                {addresses.length > 0 && (
                  <div style={s.savedAddrRow}>
                    {addresses.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        style={{ ...s.savedAddrChip, ...(chosen?.label === a.address ? s.savedAddrChipOn : {}) }}
                        onClick={() => pickSavedAddress(a)}
                      >
                        <Pin size={14} color={chosen?.label === a.address ? '#fff' : C.accent} />
                        <span style={s.savedAddrText}>{a.label || a.address}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ position: 'relative' }}>
                  <div style={s.addrWrap}>
                    <Pin size={24} />
                    <input
                      style={s.addrInput}
                      value={query}
                      onChange={(e) => { setQuery(e.target.value); setChosen(null); setCheck(null) }}
                      onFocus={() => hits.length > 0 && setShowHits(true)}
                      placeholder="Empieza a escribir tu dirección…"
                      autoComplete="off"
                    />
                  </div>
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
                      <span style={s.okTitle}>Llegamos a tu puerta · {eur(check.deliveryFee)}{check.etaMin != null && ` · ${check.etaMin} min`}</span>
                      {chosenLoc && <span style={s.okSub}>Preparado en {chosenLoc.name}</span>}
                    </span>
                  </div>
                )}
                {check && !check.ok && (
                  <div style={s.noBox}>
                    {check.reason === 'out_of_zone'
                      ? 'No repartimos en esa dirección desde ningún local. Prueba “Recoger” u otra dirección.'
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
                <StepHead n={1}>¿Dónde recoges?</StepHead>
                {candidateLocs.length > 1 ? (
                  <>
                    <p style={s.stepSub}>Elige el local donde pasarás a recoger.</p>
                    <div style={s.detailRow}>
                      {candidateLocs.map((l) => {
                        const on = cart.locationId === l.id
                        return (
                          <button
                            key={l.id}
                            style={{ ...s.locOpt, ...(on ? s.locOptOn : {}) }}
                            onClick={() => setLocation(l.id)}
                          >
                            <Pin size={22} color={on ? '#FF5436' : '#C9C5BD'} />
                            <span style={s.locBody}>
                              <span style={s.locName}>{l.name}</span>
                              {l.address && <span style={s.locAddr}>{l.address}</span>}
                            </span>
                            {on && <span style={s.locTick}>{'\u2713'}</span>}
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : chosenLoc ? (
                  <div style={s.okBox}>
                    <span style={s.okCheck}>{'\u2713'}</span>
                    <span>
                      <span style={s.okTitle}>Recoges en {chosenLoc.name}</span>
                      {chosenLoc.address && <span style={s.okSub}>{chosenLoc.address}</span>}
                    </span>
                  </div>
                ) : (
                  <p style={s.stepSub}>La dirección de recogida se mostrará al confirmar.</p>
                )}
              </>
            )}
          </section>

          <section style={s.card}>
            <StepHead n={2}>¿Cuándo?</StepHead>

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
            <StepHead n={3}>¿Quién recibe?</StepHead>
            <div style={s.detailRow}>
              <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellidos" autoComplete="name" />
              <input style={s.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono de contacto" inputMode="tel" autoComplete="tel" />
              <input style={s.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Tu correo" inputMode="email" autoComplete="email" />
            </div>
            {email.trim().length > 0 && !alreadyConsented && (
              <label style={s.consentRow}>
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => { consentTouchedRef.current = true; setMarketingConsent(e.target.checked) }}
                  style={s.consentBox}
                />
                <span style={s.consentText}>
                  Quiero unirme al club de {hub?.accountName || 'la tienda'} y recibir sus ofertas y novedades. Puedo darme de baja cuando quiera.{' '}
                  <button type="button" style={s.consentLink} onClick={() => setShowPrivacy(true)}>Política de privacidad</button>
                </span>
              </label>
            )}

            {/* Bienvenida APLICADA (correo + casilla del club marcada). */}
            {/* Bienvenida APLICADA (correo + casilla del Club marcada) — verde. */}
            {coupon?.isWelcome && coupon.applied && (
              <div style={s.welcomeCardGreen}>
                <span style={s.welcomeChipGreen} aria-hidden>{'\uD83C\uDF89'}</span>
                <div style={s.welcomeCol}>
                  <div style={s.welcomeLabelGreen}>¡Ya eres del Club!</div>
                  <div style={s.welcomeBig}>Un {promoValue(coupon)} aplicado</div>
                  <div style={s.welcomeSubGreen}>Que aproveche. Te esperan más ofertas.</div>
                </div>
              </div>
            )}
            {/* Falta el contacto — dorado (regalo esperándote). El premio manda; el correo
                no se nombra (vive en el campo), la casilla solo cuando es el paso que queda. */}
            {coupon?.isWelcome && !coupon.applied && coupon.reason === 'needs_contact' && (
              <div style={s.welcomeCardGold}>
                {!email.trim() ? (
                  <>
                    <span style={s.welcomeChipGold} aria-hidden>{'\uD83C\uDF81'}</span>
                    <div style={s.welcomeCol}>
                      <div style={s.welcomeLabelGold}>Club {hub?.accountName || 'Foodint'}</div>
                      <div style={s.welcomeBig}>Un {promoValue(coupon)} en tu primer pedido</div>
                      <div style={s.welcomeSub}>Únete y disfruta de ofertas increíbles.</div>
                    </div>
                  </>
                ) : (
                  <>
                    <span style={s.welcomeChipGold} aria-hidden>{'\u2728'}</span>
                    <div style={s.welcomeCol}>
                      <div style={s.welcomeLabelGold}>Ya casi es tuyo</div>
                      <div style={s.welcomeBig}>Un {promoValue(coupon)} en tu primer pedido</div>
                      <div style={s.welcomeSub}>Marca la casilla del Club y actívalo.</div>
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Bienvenida existe pero no aplica por estar ya usada o agotada: nota honesta,
                cálida. Cubre not_first + per_customer + exhausted (antes solo not_first
                → la tarjeta desaparecía en per_customer, hueco de pintado). */}
            {coupon?.isWelcome && !coupon.applied &&
              (coupon.reason === 'not_first' || coupon.reason === 'per_customer' || coupon.reason === 'exhausted') && (
              <div style={s.welcomeNote}>
                <span>{welcomeNoteMsg(coupon.reason)}</span>
              </div>
            )}

            {/* Cupón con código (manual) */}
            {couponDiscount > 0 && !coupon?.isWelcome ? (
              <div style={s.welcomeBanner}>
                <span>{'\u2713'} Cupón <strong>{coupon?.code}</strong> aplicado.</span>
                <button type="button" style={s.couponRemove} onClick={removeCoupon}>Quitar</button>
              </div>
            ) : !coupon?.isWelcome && (
              <div style={{ marginTop: 12 }}>
                {!showCouponField ? (
                  <button type="button" style={s.couponToggle} onClick={() => setShowCouponField(true)}>
                    ¿Tienes un cupón?
                  </button>
                ) : (
                  <div>
                    <div style={s.couponRow}>
                      <input
                        style={s.couponInput}
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => { if (e.key === 'Enter') applyCouponCode() }}
                        placeholder="Código de cupón"
                        autoCapitalize="characters"
                      />
                      <button
                        type="button"
                        style={{ ...s.couponApply, ...(couponInput.trim() && !couponBusy ? {} : { opacity: .5 }) }}
                        onClick={applyCouponCode}
                      >
                        {couponBusy ? '…' : 'Aplicar'}
                      </button>
                    </div>
                    {couponCode && coupon && !coupon.applied && coupon.reason && (
                      <div style={s.couponError}>{couponReasonMsg(coupon.reason)}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <section style={s.card}>
            <StepHead n={4}>¿Cómo pagas?</StepHead>
            {onlineAvailable && cashAvailable ? (
              <p style={s.muted}>Puedes pagar online (tarjeta o Bizum) de forma segura, o en efectivo {mode === 'pickup' ? 'al recoger' : 'a la entrega'}. Elige abajo.</p>
            ) : onlineAvailable ? (
              <p style={s.muted}>Pago seguro con tarjeta o Bizum. Al pulsar «Ir a pagar» completas el pedido en una pantalla protegida por Stripe.</p>
            ) : cashAvailable ? (
              <p style={s.muted}>Pago en efectivo {mode === 'pickup' ? 'al recoger el pedido' : 'a la entrega'}. Confirma y prepararemos tu pedido.</p>
            ) : (
              <p style={s.muted}>Esta tienda no tiene métodos de pago disponibles ahora mismo.</p>
            )}
          </section>
        </main>

        <aside className="ck-aside" style={s.side}>
          <div style={s.sideTitle}>Resumen</div>
          {minOrder != null && <div style={s.minNote}>Pedido mínimo {eur(minOrder)}</div>}
          {summaryLines}
          <div style={s.sumTotal}><span>Total</span><span>{eur(grandTotal)}</span></div>
          {belowMin && <div style={s.belowMin}>Te faltan <strong>{eur(missingForMin)}</strong> para el mínimo de {eur(minOrder!)}.</div>}
          {onlineAvailable && (
            <button
              style={{ ...s.cta, ...(canContinue && !placing ? {} : s.ctaOff) }}
              disabled={!canContinue || placing}
              onClick={() => goToPayment('online')}
            >
              {placing ? 'Un momento…' : 'Ir a pagar'}
            </button>
          )}
          {cashAvailable && (
            <button
              style={{ ...(onlineAvailable ? s.ctaCash : s.cta), ...(canContinue && !placing ? {} : s.ctaOff) }}
              disabled={!canContinue || placing}
              onClick={() => goToPayment('cash')}
            >
              {placing ? 'Un momento…' : (mode === 'pickup' ? 'Pagar en efectivo al recoger' : 'Pagar en efectivo a la entrega')}
            </button>
          )}
          {!onlineAvailable && !cashAvailable && (
            <div style={s.placeErr}>Esta tienda no tiene métodos de pago disponibles ahora mismo.</div>
          )}
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
          {onlineAvailable ? (
            <button
              style={{ ...s.mobileCta, ...(canContinue && !placing ? {} : s.ctaOff) }}
              disabled={!canContinue || placing}
              onClick={() => goToPayment('online')}
            >
              {placing ? '…' : 'Ir a pagar'}
            </button>
          ) : cashAvailable ? (
            <button
              style={{ ...s.mobileCta, ...(canContinue && !placing ? {} : s.ctaOff) }}
              disabled={!canContinue || placing}
              onClick={() => goToPayment('cash')}
            >
              {placing ? '…' : 'Efectivo'}
            </button>
          ) : null}
        </div>
        {onlineAvailable && cashAvailable && (
          <button
            style={{ ...s.mobileCashLink, ...(canContinue && !placing ? {} : s.ctaOff) }}
            disabled={!canContinue || placing}
            onClick={() => goToPayment('cash')}
          >
            {mode === 'pickup' ? 'Pagar en efectivo al recoger' : 'Pagar en efectivo a la entrega'}
          </button>
        )}
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

// ── Sección de pago (Payment Element de Stripe) ─────────────────────────
//
// Para direct charges, Stripe.js se inicializa con la cuenta CONECTADA
// (stripeAccount). La clave publicable es la de la PLATAFORMA.

function PaymentSection({ pay, mode, onPaid }: { pay: PayContext; mode: Mode; onPaid: () => void }) {
  const pk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined
  const stripePromise = useMemo(
    () => (pk ? loadStripe(pk, { stripeAccount: pay.connectedAccountId, locale: 'es' }) : null),
    [pk, pay.connectedAccountId],
  )

  if (!pk || !stripePromise) {
    return <div style={s.payErr}>Falta configurar la clave pública de Stripe (VITE_STRIPE_PUBLISHABLE_KEY).</div>
  }

  return (
    <div>
      <div style={s.payMethodLabel}>Método de pago</div>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: pay.clientSecret,
          locale: 'es',
          // Tematizado para que el bloque de Stripe combine con el resto (mismo
          // radio, borde, tipografía) en vez de parecer pegado de otra web. El
          // color primario va en VERDE, igual que el botón de pagar.
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: C.ink,
              colorText: C.ink,
              colorTextPlaceholder: '#B4B2A9',
              colorBackground: '#FFFFFF',
              colorDanger: C.red,
              fontFamily: 'inherit',
              fontSizeBase: '15px',
              borderRadius: '11px',
              spacingUnit: '3px',
            },
            rules: {
              '.Input': { border: `1.5px solid ${C.lineInput}`, boxShadow: 'none', padding: '11px 12px' },
              '.Input:focus': { border: `1.5px solid ${C.ink}`, boxShadow: `0 0 0 3px ${C.ink}18` },
              '.Label': { fontWeight: '600', color: C.inkDim, fontSize: '12.5px' },
              '.Tab, .AccordionItem': { border: `1.5px solid ${C.lineInput}`, boxShadow: 'none' },
              '.Tab:hover, .AccordionItem:hover': { border: `1.5px solid ${C.ink}` },
              '.Tab--selected, .AccordionItem--selected': { border: `1.5px solid ${C.ink}`, boxShadow: 'none' },
            },
          },
        }}
      >
        <PaymentForm pay={pay} mode={mode} onPaid={onPaid} />
      </Elements>
    </div>
  )
}

function PaymentForm({ pay, mode, onPaid }: { pay: PayContext; mode: Mode; onPaid: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [paying, setPaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function doPay() {
    if (!stripe || !elements || paying) return
    setPaying(true); setErr(null)
    // Persistimos el pedido pendiente (incluido el TOKEN) por si el método
    // redirige (Bizum): al volver, confirmamos el estado real por token.
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ code: pay.code, total: pay.total, mode, token: pay.token }))
    } catch { /* ignore */ }

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href.split('?')[0] },
      redirect: 'if_required',
    })

    if (error) {
      setErr(error.message ?? 'No se pudo completar el pago.')
      setPaying(false)
      try { localStorage.removeItem(PENDING_KEY) } catch { /* ignore */ }
      return
    }
    // Métodos sin redirección (tarjeta): confirmPayment volvió sin error, pero la
    // VERDAD del pago la escribe el webhook -> el padre confirma por token (poll).
    onPaid()
  }

  return (
    <div>
      <div style={s.payElementPad}>
        <PaymentElement
          onReady={() => setReady(true)}
          options={{ layout: { type: 'tabs', defaultCollapsed: false } }}
        />
      </div>
      {err && <div style={s.payErr}>{err}</div>}
      <button
        style={{ ...s.payBtn, ...(ready && !paying ? {} : s.ctaOff) }}
        disabled={!ready || paying}
        onClick={doPay}
      >
        {paying ? 'Procesando…' : <><Lock size={16} color="#fff" /> Pagar {eur(pay.total)}</>}
      </button>
      <div style={s.paySafeRow}><Shield size={14} color={C.green} /> Pago cifrado y procesado por Stripe</div>
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
  stepHead: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 },
  stepNum: { width: 24, height: 24, borderRadius: '50%', background: C.ink, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 },
  stepTitle: { fontSize: 17.5, fontWeight: 900, letterSpacing: '-.02em', color: C.ink },
  stepSub: { fontSize: 13, color: C.inkDim, lineHeight: 1.5, margin: '0 0 12px 33px' },
  savedAddrRow: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  savedAddrChip: { display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: '100%', border: `1.5px solid ${C.lineInput}`, background: '#fff', borderRadius: 999, padding: '7px 13px', fontSize: 13, fontWeight: 700, color: C.ink, cursor: 'pointer' },
  savedAddrChipOn: { background: C.ink, color: '#fff', border: `1.5px solid ${C.ink}` },
  savedAddrText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 },
  addrWrap: { display: 'flex', alignItems: 'center', gap: 11, border: `2px solid ${C.ink}`, borderRadius: 14, padding: '13px 15px', background: '#FAFAF8' },
  addrInput: { flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 16, fontWeight: 600, color: C.ink },
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
  consentRow: { display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 12, cursor: 'pointer' },
  consentBox: { width: 18, height: 18, marginTop: 1, flexShrink: 0, accentColor: C.green, cursor: 'pointer' },
  consentText: { fontSize: 12.5, color: C.inkDim, lineHeight: 1.5 },
  consentLink: { background: 'none', border: 'none', padding: 0, color: C.ink, fontWeight: 700, fontSize: 12.5, textDecoration: 'underline', cursor: 'pointer' },
  welcomeCardGold: { display: 'flex', alignItems: 'center', gap: 13, marginTop: 14, padding: '14px 15px', background: '#FFF6E2', border: '1px solid #E9A81C', borderRadius: 14 },
  welcomeCardGreen: { display: 'flex', alignItems: 'center', gap: 13, marginTop: 14, padding: '14px 15px', background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 14 },
  welcomeChipGold: { flexShrink: 0, width: 46, height: 46, borderRadius: '50%', background: '#FFFFFF', border: '2px solid #E9A81C', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, lineHeight: 1 },
  welcomeChipGreen: { flexShrink: 0, width: 46, height: 46, borderRadius: '50%', background: '#FFFFFF', border: `2px solid ${C.green}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, lineHeight: 1 },
  welcomeCol: { lineHeight: 1.35, minWidth: 0 },
  welcomeLabelGold: { fontSize: 12, fontWeight: 500, color: '#8A5B0A', letterSpacing: '.02em' },
  welcomeLabelGreen: { fontSize: 12, fontWeight: 500, color: C.greenDeep, letterSpacing: '.02em' },
  welcomeBig: { fontSize: 19, fontWeight: 500, color: C.ink, margin: '1px 0 3px' },
  welcomeSub: { fontSize: 13, color: C.inkDim },
  welcomeSubGreen: { fontSize: 13, color: C.greenDeep },
  welcomeBanner: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, padding: '11px 14px', background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 12, fontSize: 13.5, color: C.greenDeep, lineHeight: 1.4 },
  welcomeNote: { marginTop: 14, padding: '10px 14px', background: C.pill, border: `1px solid ${C.line}`, borderRadius: 12, fontSize: 12.5, color: C.inkDim, lineHeight: 1.4 },
  couponToggle: { background: 'none', border: 'none', padding: 0, color: C.ink, fontWeight: 700, fontSize: 13.5, textDecoration: 'underline', cursor: 'pointer' },
  couponRow: { display: 'flex', gap: 8, alignItems: 'stretch' },
  couponInput: { flex: 1, border: `1.5px solid ${C.lineInput}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: C.ink, background: '#fff', boxSizing: 'border-box' as const, textTransform: 'uppercase' as const },
  couponApply: { border: 'none', background: C.ink, color: '#fff', borderRadius: 10, padding: '0 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  couponRemove: { marginLeft: 'auto', background: 'none', border: 'none', color: C.greenDeep, fontSize: 12.5, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' },
  couponError: { fontSize: 12.5, color: C.red, marginTop: 8, fontWeight: 600 },
  modalWrap: { position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(20,14,10,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { background: '#fff', borderRadius: 18, maxWidth: 560, width: '100%', maxHeight: '82vh', overflowY: 'auto', padding: '24px 26px', boxShadow: '0 24px 60px rgba(0,0,0,.3)' },
  modalTitle: { fontSize: 19, fontWeight: 900, letterSpacing: '-.02em', color: C.ink, margin: '0 0 14px' },
  modalH: { fontSize: 14, fontWeight: 800, color: C.ink, margin: '16px 0 4px' },
  modalP: { fontSize: 13, color: C.inkDim, lineHeight: 1.6, margin: '0 0 8px' },
  modalClose: { marginTop: 18, width: '100%', border: 'none', background: C.ink, color: '#fff', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 800, cursor: 'pointer' },
  locOpt: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: `1.5px solid ${C.lineInput}`, background: '#fff', borderRadius: 14, padding: '12px 14px', cursor: 'pointer' },
  locOptOn: { border: `2px solid ${C.ink}`, background: '#FAFAF8' },
  locBody: { flex: 1, minWidth: 0 },
  locName: { display: 'block', fontSize: 14.5, fontWeight: 800, color: C.ink },
  locAddr: { display: 'block', fontSize: 12.5, color: C.inkDim, marginTop: 2 },
  locTick: { width: 22, height: 22, borderRadius: '50%', background: C.ink, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 },

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
  ctaCash: { width: '100%', background: '#fff', color: C.ink, border: `1.5px solid ${C.lineInput}`, borderRadius: 999, padding: '12px', fontWeight: 800, fontSize: 14, cursor: 'pointer', marginTop: 8 },
  ctaOff: { background: '#C9C5BD', cursor: 'not-allowed' },
  placeErr: { marginTop: 10, fontSize: 12.5, fontWeight: 700, color: C.red, background: C.redBg, borderRadius: 11, padding: '10px 12px', textAlign: 'center' },

  mobileBar: { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, padding: 12, display: 'none' },
  mobileSheet: { background: '#fff', border: `1px solid ${C.lineInput}`, borderRadius: 16, padding: '14px 16px', marginBottom: 8, boxShadow: '0 -4px 20px rgba(0,0,0,.1)' },
  mobileBarRow: { display: 'flex', gap: 10, alignItems: 'center', background: '#fff', border: `1px solid ${C.lineInput}`, borderRadius: 16, padding: '10px 12px', boxShadow: '0 4px 20px rgba(0,0,0,.12)' },
  mobileTotal: { flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
  mobileTotalLabel: { display: 'block', fontSize: 11, color: C.inkFaint },
  mobileTotalNum: { display: 'block', fontSize: 17, fontWeight: 900, letterSpacing: '-.02em', color: C.ink },
  mobileCta: { background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 20px', fontWeight: 800, fontSize: 14, cursor: 'pointer', flexShrink: 0 },
  mobileCashLink: { width: '100%', marginTop: 8, background: '#fff', color: C.ink, border: `1.5px solid ${C.lineInput}`, borderRadius: 999, padding: '11px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' },

  // Pago
  payWrap: { maxWidth: 480, margin: '0 auto', padding: '8px 22px 48px' },
  payCard: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, overflow: 'hidden' },
  payBrandBand: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', background: '#140E0A' },
  payBrandLogo: { height: 36, width: 'auto', maxWidth: 200, objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,.4))' },
  payBrandName: { fontSize: 18, fontWeight: 900, letterSpacing: '-.02em', color: '#fff' },
  trustChipDark: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 999, flexShrink: 0 },
  payRecap: { padding: '14px 18px', background: '#FBFAF8', borderBottom: `1px solid ${C.line}` },
  payLocRow: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: C.inkDim, paddingBottom: 10, marginBottom: 10, borderBottom: `1px solid ${C.line}` },
  payRecapLine: { display: 'flex', gap: 8, fontSize: 13, marginBottom: 6, alignItems: 'baseline' },
  payRecapQty: { color: C.inkFaint, fontWeight: 700 },
  payRecapName: { flex: 1, color: C.ink },
  payRecapPrice: { color: C.ink, whiteSpace: 'nowrap' },
  payRecapTotal: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: `1px solid ${C.line}`, paddingTop: 9, marginTop: 4 },
  payTotalNum: { fontSize: 22, fontWeight: 900, letterSpacing: '-.02em', color: C.ink },
  payMethodLabel: { fontSize: 12, color: C.inkFaint, letterSpacing: '.03em', textTransform: 'uppercase', fontWeight: 700, padding: '16px 18px 10px' },
  payBtn: { width: 'calc(100% - 36px)', margin: '14px 18px 0', background: C.green, color: '#fff', border: 'none', borderRadius: 13, padding: '15px', fontWeight: 800, fontSize: 15.5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  payErr: { margin: '14px 18px 0', fontSize: 13, fontWeight: 700, color: C.red, background: C.redBg, borderRadius: 11, padding: '11px 13px', textAlign: 'center' },
  paySafeRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11.5, color: C.inkFaint, padding: '12px 18px 18px' },
  payElementPad: { padding: '0 18px' },

  // Confirmación
  successWrap: { maxWidth: 560, margin: '0 auto', padding: '48px 22px', display: 'flex', justifyContent: 'center' },
  successCard: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: '36px 28px', textAlign: 'center', width: '100%' },
  successCheck: { width: 64, height: 64, borderRadius: '50%', background: C.greenBg, color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 800, margin: '0 auto 16px' },
  slowCheck: { width: 64, height: 64, borderRadius: '50%', background: C.amberBg, color: C.amber, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, margin: '0 auto 16px' },
  failCheck: { width: 64, height: 64, borderRadius: '50%', background: C.redBg, color: C.red, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, margin: '0 auto 16px' },
  spinner: { width: 48, height: 48, borderRadius: '50%', border: `4px solid ${C.line}`, borderTopColor: C.accent, margin: '0 auto 18px', animation: 'ck-spin 0.8s linear infinite' },
  successTitle: { fontSize: 24, fontWeight: 900, letterSpacing: '-.02em', margin: '0 0 8px' },
  successMsg: { fontSize: 14, color: C.inkDim, lineHeight: 1.5, margin: '0 0 20px' },
  successCode: { display: 'flex', flexDirection: 'column', gap: 4, background: '#FAFAF8', border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px', marginBottom: 14 },
  successCodeLabel: { fontSize: 11, color: C.inkFaint, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 },
  successCodeNum: { fontSize: 22, fontWeight: 900, letterSpacing: '-.01em', color: C.ink },
  successTotal: { fontSize: 16, fontWeight: 900, marginBottom: 20 },
  successBtn: { background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '13px 22px', fontWeight: 800, fontSize: 14.5, cursor: 'pointer' },
  successBtnGhost: { display: 'block', margin: '10px auto 0', background: 'none', border: 'none', color: C.inkDim, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' },
}
