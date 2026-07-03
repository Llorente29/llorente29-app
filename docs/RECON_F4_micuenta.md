# RECON F4 · "Mi cuenta" (solo lectura)

> Generado en modo recon. No se ha modificado ningún fichero de código.

---

## 1. Árbol de `src/modules/shop/` (2 niveles)

```
src/modules/shop/
├── admin/
│   ├── couponAdminService.ts
│   └── WelcomeOfferSettings.tsx
├── cart/
│   ├── AddedToCartSheet.tsx
│   ├── CartPanel.tsx
│   └── ShopCartContext.tsx
├── checkout/
│   ├── CheckoutRoute.tsx
│   ├── checkoutService.ts
│   ├── customerAuthService.ts
│   └── CustomerLoginModal.tsx
├── components/
│   ├── DeliveryMap.tsx
│   ├── DishConfigModal.tsx
│   ├── StorefrontPreview.tsx
│   └── ZoneEditor.tsx
├── pages/
│   ├── ShopDeliveryPage.tsx
│   └── ShopDesignPage.tsx
├── services/
│   ├── brandMenuService.ts
│   ├── deliveryZoneService.ts
│   ├── dishConfigService.ts
│   ├── shopAccountService.ts
│   ├── shopHeroService.ts
│   ├── shopHubService.ts
│   └── shopThemeService.ts
├── track/
│   └── TrackOrderRoute.tsx
├── BrandMenuRoute.tsx
├── module.tsx
├── shopHost.ts
└── ShopHubRoute.tsx
```

---

## 2. Contenido completo de ficheros clave

### `src/modules/shop/checkout/customerAuthService.ts`

```ts
// src/modules/shop/checkout/customerAuthService.ts
//
// Login del comensal en su tienda (código mágico OTP + sesión persistente).
// El comensal NO es auth.users: su sesión es un token propio (customer_session)
// guardado en el dispositivo. Tras el primer acceso, entra directo sin re-pedir
// código hasta logout/caducidad/dispositivo nuevo.
//
// Flujo:
//   requestLoginCode(slug, email)         -> Edge shop-customer-auth (envía OTP)
//   verifyLoginCode(slug, email, code)    -> Edge (valida, crea sesión) -> token
//   getSessionCustomer(slug)              -> RPC customer_session_me por token
//   logoutCustomer(slug)                  -> RPC customer_logout + limpia local

import { supabase } from '@/lib/supabase'

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

// El token de sesión se guarda por tienda (slug), porque el cliente es por cuenta.
function sessionKey(slug: string): string { return `folvy_shop_session_${slug}` }

export function getStoredSessionToken(slug: string): string | null {
  try { return localStorage.getItem(sessionKey(slug)) } catch { return null }
}
function storeSessionToken(slug: string, token: string) {
  try { localStorage.setItem(sessionKey(slug), token) } catch { /* modo privado: sesión no persiste */ }
}
function clearSessionToken(slug: string) {
  try { localStorage.removeItem(sessionKey(slug)) } catch { /* noop */ }
}

export interface SessionCustomer {
  customerId: string
  name: string | null
  email: string | null
  phone: string | null
  consented: boolean
}

/** Paso 1: pedir el código de acceso (se envía por email). */
export async function requestLoginCode(slug: string, email: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data, error } = await db().functions.invoke('shop-customer-auth', {
      body: { action: 'request', slug, email },
    })
    if (error) return { ok: false, reason: 'network' }
    return { ok: data?.ok === true, reason: data?.reason }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

/** Paso 2: verificar el código; si es correcto, guarda la sesión persistente. */
export async function verifyLoginCode(slug: string, email: string, code: string): Promise<{ ok: boolean; reason?: string; name?: string | null }> {
  try {
    const { data, error } = await db().functions.invoke('shop-customer-auth', {
      body: { action: 'verify', slug, email, code },
    })
    if (error) return { ok: false, reason: 'network' }
    if (data?.ok !== true || !data?.sessionToken) return { ok: false, reason: data?.reason ?? 'bad_code' }
    storeSessionToken(slug, data.sessionToken)
    return { ok: true, name: data.name ?? null }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

/** Devuelve el cliente logueado en esta tienda, o null si no hay sesión válida. */
export async function getSessionCustomer(slug: string): Promise<SessionCustomer | null> {
  const token = getStoredSessionToken(slug)
  if (!token) return null
  try {
    const { data, error } = await db().rpc('customer_session_me', { p_token: token })
    if (error || !data || data.ok !== true) {
      // Sesión inválida/caducada: limpiamos para no reintentar en bucle.
      if (data && data.ok === false) clearSessionToken(slug)
      return null
    }
    return {
      customerId: data.customerId,
      name: data.name ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      consented: data.consented === true,
    }
  } catch {
    return null
  }
}

/** Cierra la sesión del comensal en esta tienda. */
export async function logoutCustomer(slug: string): Promise<void> {
  const token = getStoredSessionToken(slug)
  clearSessionToken(slug)
  if (!token) return
  try { await db().rpc('customer_logout', { p_token: token }) } catch { /* noop */ }
}

/**
 * Registra (o retira) el consentimiento de marketing EN EL MOMENTO en que el
 * comensal marca/desmarca la casilla del Club, sin esperar al pago. Pública por
 * slug (el comensal no está autenticado). El servidor aplica las reglas legales:
 * sin email válido no hace nada; desmarcar sin cliente previo no crea nada; solo
 * marcar (acción afirmativa) crea el contacto; loguea solo los cambios.
 */
export async function registerShopConsent(args: {
  slug: string
  email: string
  name?: string
  phone?: string
  consent: boolean
}): Promise<{ ok: boolean; consented?: boolean; reason?: string }> {
  try {
    const { data, error } = await db().rpc('register_shop_consent', {
      p_slug: args.slug,
      p_email: args.email,
      p_name: args.name ?? null,
      p_phone: args.phone ?? null,
      p_consent: args.consent,
      p_terms_version: 'shop-privacy-v1',
    })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true, consented: data.consented === true }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}
```

### `src/modules/shop/checkout/CheckoutRoute.tsx`

```tsx
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

const C = {
  page: '#F7F7F5', surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', accent: '#FF5436', accentBg: '#FFF4F1',
  green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4', greenMid: '#3E8A5F',
  amber: '#7A5A12', amberBg: '#FFF3D6', red: '#C23B22', redBg: '#FDE7E2', pill: '#EEEEEB',
}
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

// Valor escueto de la promo ("10%" / "4 €"), para el titular grande de la tarjeta.
// Cae a "10%" solo si faltara el tipo/valor (no debería con la migración T2100).
function promoValue(c: CouponResult | null | undefined): string {
  if (c?.discountType === 'percent' && c.discountValue != null) return `${String(c.discountValue).replace('.', ',')}%`
  if (c?.discountType === 'fixed' && c.discountValue != null) return eur(c.discountValue)
  return '10%'
}

// Nota gris cuando la bienvenida existe pero no aplica por un motivo distinto a
// "falta contacto": ya usada (not_first/per_customer) o agotada (exhausted).
function welcomeNoteMsg(reason: string | null | undefined): string {
  if (reason === 'exhausted') return 'La oferta de bienvenida se ha agotado por ahora.'
  return 'Esta bienvenida es solo para el primer pedido, pero pronto tendremos más para ti.'
}

// Mensaje amable por el que un cupón no se aplicó (no expone el motivo de margen).
function couponReasonMsg(reason: string): string {
  switch (reason) {
    case 'min':          return 'Tu pedido no llega al mínimo para este cupón.'
    case 'not_first':    return 'Este cupón es solo para el primer pedido.'
    case 'exhausted':    return 'Este cupón ya no está disponible.'
    case 'per_customer': return 'Ya has usado este cupón.'
    case 'needs_contact': return 'Deja tu email y únete al club para usar este cupón.'
    default:             return 'Cupón no válido.'
  }
}

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
              <div style={s.failCheck}>{'✕'}</div>
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
            <div style={confirmed ? s.successCheck : s.slowCheck}>{confirmed ? '✓' : '…'}</div>
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
          <button style={s.back} onClick={() => { setStage('form'); setPayCtx(null) }}>{'←'} Volver al pedido</button>
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
        <button style={s.back} onClick={onBack}>{'←'} Seguir comprando</button>
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
                          <span style={s.hitDot}>{'●'}</span>{h.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {checking && <div style={s.checking}>Comprobando si llegamos…</div>}
                {check?.ok && (
                  <div style={s.okBox}>
                    <span style={s.okCheck}>{'✓'}</span>
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
                            {on && <span style={s.locTick}>{'✓'}</span>}
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : chosenLoc ? (
                  <div style={s.okBox}>
                    <span style={s.okCheck}>{'✓'}</span>
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
                <span style={s.welcomeChipGreen} aria-hidden>{'🎉'}</span>
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
                    <span style={s.welcomeChipGold} aria-hidden>{'🎁'}</span>
                    <div style={s.welcomeCol}>
                      <div style={s.welcomeLabelGold}>Club {hub?.accountName || 'Foodint'}</div>
                      <div style={s.welcomeBig}>Un {promoValue(coupon)} en tu primer pedido</div>
                      <div style={s.welcomeSub}>Únete y disfruta de ofertas increíbles.</div>
                    </div>
                  </>
                ) : (
                  <>
                    <span style={s.welcomeChipGold} aria-hidden>{'✨'}</span>
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
                <span>{'✓'} Cupón <strong>{coupon?.code}</strong> aplicado.</span>
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
            <span style={s.mobileTotalLabel}>Total {'·'} {totals.itemsCount} art. {expandSummary ? '⌄' : '⌃'}</span>
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
```

### `src/modules/shop/checkout/checkoutService.ts`

```ts
// src/modules/shop/checkout/checkoutService.ts
//
// Servicio del checkout de Folvy Shop. Reutiliza el MISMO sistema de
// geocodificación que el editor de zonas (Mapbox, geocodeAddress) y valida la
// dirección del cliente contra las zonas de reparto del local (shop_check_delivery).
//
// Flujo de cobro:
//   1) placeShopOrder  → crea el pedido canónico (sale source='folvy_shop','new').
//   2) createShopPaymentIntent → la Edge Function shop-payment-intent crea el
//      PaymentIntent como DIRECT CHARGE sobre la cuenta conectada del restaurante
//      y devuelve el client_secret + la cuenta conectada (para el Payment Element).
//   3) El comensal paga con tarjeta/Bizum; el webhook confirma el pedido.
//   4) getShopOrderStatus(token) → el front LEE el estado real del pedido (la
//      verdad la escribe el webhook), por un token no adivinable propio del
//      pedido. Es la base de la confirmación veraz Y del seguimiento del cliente
//      (marca, estado, detalle, dirección, repartidor/ETA).
// El precio SIEMPRE se recalcula en servidor; el front nunca lo fija.

import { supabase } from '@/lib/supabase'
import type { OrderLine } from '@/modules/shop/services/dishConfigService'
export { geocodeAddress, type GeocodeHit } from '@/modules/shop/services/deliveryZoneService'

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

export type DeliverySlot = { ts: string; label: string }

/** Franjas de hoy en las que el local entrega (respeta horario comercial). */
export async function getDeliverySlots(slug: string, locationId: string, etaMin: number, stepMin = 30): Promise<DeliverySlot[]> {
  const { data, error } = await db().rpc('shop_delivery_slots', {
    p_slug: slug, p_location_id: locationId, p_eta_min: etaMin, p_step_min: stepMin,
  })
  if (error || !data || data.ok !== true) return []
  return (data.slots ?? []) as DeliverySlot[]
}

export type DeliveryCheck =
  | { ok: true; zoneId: string; zoneName: string; deliveryFee: number; minOrder: number | null; etaMin: number | null; distanceM: number }
  | { ok: false; reason: 'out_of_zone' | 'account' | 'error' }

/** Valida una dirección (lat/lng) contra las zonas de reparto del local. */
export async function checkDelivery(slug: string, locationId: string, lat: number, lng: number): Promise<DeliveryCheck> {
  const { data, error } = await db().rpc('shop_check_delivery', {
    p_slug: slug, p_location_id: locationId, p_lat: lat, p_lng: lng,
  })
  if (error) return { ok: false, reason: 'error' }
  if (!data || data.ok !== true) {
    return { ok: false, reason: (data?.reason ?? 'error') as 'out_of_zone' | 'account' | 'error' }
  }
  return {
    ok: true,
    zoneId: data.zone_id,
    zoneName: data.zone_name,
    deliveryFee: Number(data.delivery_fee),
    minOrder: data.min_order != null ? Number(data.min_order) : null,
    etaMin: data.eta_min != null ? Number(data.eta_min) : null,
    distanceM: Number(data.distance_m),
  }
}

// ── Crear el pedido (ingesta canónica) ──────────────────────────────────

export interface ShopOrderPayload {
  locationId: string
  mode: 'delivery' | 'pickup'
  customer: { name: string; phone: string; email?: string }
  consent?: { marketing: boolean; termsVersion: string }
  delivery: {
    address: string
    detail: string
    lat: number | null
    lng: number | null
    zoneId: string | null
    deliveryFee: number
    note: string
  }
  expectedTime: string | null            // ISO; null = lo antes posible
  payment: { mode: 'simulated' | 'stripe' | 'cash' }
  lines: OrderLine[]
  coupon?: { code?: string }             // código manual; el auto_apply no necesita código
}

// Desglose del cupón que devuelve place_shop_order (dry-run y real).
export interface CouponResult {
  applied: boolean
  code?: string | null
  label?: string | null
  discount?: number
  reason?: string | null        // null | min | needs_contact | not_first | exhausted | per_customer | margin
  marginWarning?: boolean
  isWelcome?: boolean
  discountType?: 'percent' | 'fixed' | null   // para nombrar la promo en el gancho ("10%" / "4 €")
  discountValue?: number | null
}

export interface PlaceOrderResult {
  ok: boolean
  reason?: string
  dryRun?: boolean
  saleId?: string
  code?: string
  publicToken?: string
  subtotal?: number
  deliveryFee?: number
  discount?: number
  total?: number
  lines?: { name: string; quantity: number; unitPrice: number; lineTotal: number; valid: boolean }[]
  coupon?: CouponResult
}

/**
 * Crea el pedido del Shop por la vía canónica. Con dryRun=true sólo reprecia y
 * valida (no inserta nada): útil para previsualizar el total real sin escribir.
 */
export async function placeShopOrder(slug: string, payload: ShopOrderPayload, dryRun = false): Promise<PlaceOrderResult> {
  const { data, error } = await db().rpc('place_shop_order', {
    p_slug: slug, p_payload: payload, p_dry_run: dryRun,
  })
  if (error) return { ok: false, reason: error.message }
  if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
  return {
    ok: true,
    dryRun: data.dryRun === true,
    saleId: data.saleId ?? undefined,
    code: data.code ?? undefined,
    publicToken: data.publicToken ?? undefined,
    subtotal: data.subtotal != null ? Number(data.subtotal) : undefined,
    deliveryFee: data.deliveryFee != null ? Number(data.deliveryFee) : undefined,
    discount: data.discount != null ? Number(data.discount) : undefined,
    total: data.total != null ? Number(data.total) : undefined,
    lines: data.lines ?? undefined,
    coupon: data.coupon ?? undefined,
  }
}

// ── Iniciar el cobro (Stripe Connect, direct charge) ────────────────────

export interface PaymentIntentResult {
  ok: boolean
  reason?: string
  clientSecret?: string
  connectedAccountId?: string
  amount?: number
  paymentIntentId?: string
}

/**
 * Pide a la Edge Function shop-payment-intent que cree el PaymentIntent del
 * pedido (direct charge sobre la cuenta conectada del restaurante). Devuelve el
 * client_secret y la cuenta conectada, que el Payment Element necesita.
 */
export async function createShopPaymentIntent(saleId: string): Promise<PaymentIntentResult> {
  const { data, error } = await db().functions.invoke('shop-payment-intent', { body: { saleId } })
  if (error) return { ok: false, reason: error.message }
  if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
  return {
    ok: true,
    clientSecret: data.clientSecret,
    connectedAccountId: data.connectedAccountId,
    amount: data.amount != null ? Number(data.amount) : undefined,
    paymentIntentId: data.paymentIntentId,
  }
}

// ── Estado del pedido para el cliente (lectura anónima veraz) ────────────

export interface ShopOrderStatusLine {
  name: string
  quantity: number
  lineTotal: number | null
}

export interface ShopOrderStatusBrand {
  name?: string | null
  logoUrl?: string | null
  accentColor?: string | null
}

export interface ShopOrderStatus {
  ok: boolean
  reason?: string
  code?: string
  orderStatus?: string
  /** 'pending' | 'paid' | 'failed' | 'refunded' — la verdad la escribe el webhook. */
  paymentStatus?: string
  /** 'stripe' | 'cash' | … */
  payMethod?: string
  mode?: 'pickup' | 'delivery'
  total?: number
  deliveryFee?: number
  paidAt?: string | null
  /** Estado del reparto (Catcher): matching→…→in_delivery→finish→canceled. */
  deliveryState?: string | null
  etaAt?: string | null
  riderName?: string | null
  /** Identidad de la marca para pintar la página con su cara. */
  brand?: ShopOrderStatusBrand
  /** Dirección a mostrar: la de entrega (domicilio) o la del local (recogida). */
  address?: string | null
  /** Nombre del local (solo recogida). */
  locationName?: string | null
  /** Líneas de producto del pedido (sin modificadores ni hijos de combo). */
  lines?: ShopOrderStatusLine[]
}

/**
 * Lee el estado real de un pedido del Shop por su TOKEN (no adivinable). Canal
 * anónimo, solo-lectura: estado + total + marca + líneas + dirección, nada de
 * PII de más. Fuente de verdad de la confirmación veraz y del seguimiento.
 */
export async function getShopOrderStatus(token: string): Promise<ShopOrderStatus> {
  try {
    const { data, error } = await db().rpc('shop_order_status', { p_token: token })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'not_found' }
    const b = data.brand ?? null
    const rawLines = Array.isArray(data.lines) ? data.lines : []
    return {
      ok: true,
      code: data.code ?? undefined,
      orderStatus: data.orderStatus ?? undefined,
      paymentStatus: data.paymentStatus ?? undefined,
      payMethod: data.payMethod ?? undefined,
      mode: (data.mode ?? undefined) as 'pickup' | 'delivery' | undefined,
      total: data.total != null ? Number(data.total) : undefined,
      deliveryFee: data.deliveryFee != null ? Number(data.deliveryFee) : undefined,
      paidAt: data.paidAt ?? null,
      deliveryState: data.deliveryState ?? null,
      etaAt: data.etaAt ?? null,
      riderName: data.riderName ?? null,
      brand: b ? { name: b.name ?? null, logoUrl: b.logoUrl ?? null, accentColor: b.accentColor ?? null } : undefined,
      address: data.address ?? null,
      locationName: data.locationName ?? null,
      lines: rawLines.map((l: any) => ({
        name: l.name ?? '',
        quantity: Number(l.quantity ?? 1),
        lineTotal: l.lineTotal != null ? Number(l.lineTotal) : null,
      })),
    }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

// ── Locales de la tienda (para el selector de recogida, multi-local) ─────

export interface ShopLocation { id: string; name: string; address: string | null }

/** Locales activos de la cuenta dueña del slug (RPC pública shop_locations_by_slug). */
export async function getShopLocations(slug: string): Promise<ShopLocation[]> {
  const { data, error } = await db().rpc('shop_locations_by_slug', { p_slug: slug })
  if (error || !Array.isArray(data)) return []
  return (data as any[]).map((l) => ({ id: l.id, name: l.name ?? '', address: l.address ?? null }))
}

// ── Config de métodos de pago del Shop (tienda pública, por slug) ────────

export interface ShopPaymentConfig {
  online: boolean
  cashPickup: boolean
  cashDelivery: boolean
}

/**
 * Lee qué métodos de pago acepta la tienda (rpc pública shop_payment_config).
 * Si falla, devuelve un fallback seguro: solo online (nunca abre efectivo por error).
 */
export async function getShopPaymentConfig(slug: string): Promise<ShopPaymentConfig> {
  try {
    const { data, error } = await db().rpc('shop_payment_config', { p_slug: slug })
    if (error || !data || data.ok !== true) return { online: true, cashPickup: false, cashDelivery: false }
    return {
      online: data.online !== false,
      cashPickup: data.cashPickup === true,
      cashDelivery: data.cashDelivery === true,
    }
  } catch {
    return { online: true, cashPickup: false, cashDelivery: false }
  }
}
```

### `src/modules/shop/ShopHubRoute.tsx`

```tsx
import { useEffect, useMemo, useState } from 'react'
import { getShopHub, type ShopHub, type HubBrand, type TopDish } from '@/modules/shop/services/shopHubService'
import BrandMenuRoute from '@/modules/shop/BrandMenuRoute'
import { ShopCartProvider } from '@/modules/shop/cart/ShopCartContext'
import CartPanel from '@/modules/shop/cart/CartPanel'
import CheckoutRoute from '@/modules/shop/checkout/CheckoutRoute'
import TrackOrderRoute from '@/modules/shop/track/TrackOrderRoute'
import { isShopHost, shopSlugFromHost } from '@/modules/shop/shopHost'
import CustomerLoginModal from '@/modules/shop/checkout/CustomerLoginModal'
import { getSessionCustomer, logoutCustomer } from '@/modules/shop/checkout/customerAuthService'

// El Shop resuelve por HOSTNAME primero (<slug>.folvy.app) y por PATH como
// fallback (/t/:slug). Retrocompatible: los enlaces app.folvy.app/t/foodint
// siguen funcionando. En modo host la tienda vive en la raíz (base ''); en modo
// path la base es `/t/${slug}`. La navegación interna usa esa base para no
// duplicar el slug (foodint.folvy.app/brandX, no foodint.folvy.app/t/foodint/brandX).

function resolveShopSlug(): string | null {
  const fromHost = shopSlugFromHost()
  if (fromHost) return fromHost
  const m = window.location.pathname.match(/^\/t\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

/** Base de rutas del Shop según el modo (host vs path). */
function shopBase(slug: string): string {
  return isShopHost() ? '' : `/t/${slug}`
}

function getBrandIdFromPath(): string | null {
  if (isShopHost()) {
    // Modo host: la marca es el 1er segmento (/brandX). 'seguir' está reservado.
    const m = window.location.pathname.match(/^\/([^/]+)/)
    const seg = m ? decodeURIComponent(m[1]) : null
    return seg && seg !== 'seguir' ? seg : null
  }
  const m = window.location.pathname.match(/^\/t\/[^/]+\/([^/]+)/)
  const seg = m ? decodeURIComponent(m[1]) : null
  return seg && seg !== 'seguir' ? seg : null
}

// Ruta de seguimiento del pedido: /seguir (modo host) o /t/:slug/seguir (modo
// path). Se detecta ANTES que el brandId (el segmento "seguir" colisionaría con
// el parseo de marca).
function getIsTrackPath(): boolean {
  if (isShopHost()) return /^\/seguir\/?$/.test(window.location.pathname)
  return /^\/t\/[^/]+\/seguir\/?$/.test(window.location.pathname)
}
function getTrackTokenFromQuery(): string | null {
  return new URLSearchParams(window.location.search).get('t')
}

// Iconos SVG inline (sin librería externa).
const Ic = {
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0',
  trending: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
  flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
  package: 'M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7l8.7 5 8.7-5M12 22V12',
}
function Icon({ d, size = 16, fill = 'none' }: { d: string; size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      {d.split('M').filter(Boolean).map((seg, i) => <path key={i} d={'M' + seg} />)}
    </svg>
  )
}
function Star({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
      <path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z" />
    </svg>
  )
}

function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

function shortName(name: string): string {
  return name.split(/[\s·-]/)[0].slice(0, 8).toUpperCase()
}

// Cocina única (code/label/emoji) presente entre las marcas, para los chips de filtro.
interface Cuisine { code: string; label: string; emoji: string | null }

function ShopHubInner({ slug, onCheckout }: { slug: string; onCheckout: () => void }) {
  const [brandId, setBrandId] = useState<string | null>(getBrandIdFromPath())
  const [hub, setHub] = useState<ShopHub | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [activeCuisine, setActiveCuisine] = useState<string | null>(null) // null = "Todo"
  // Sesión del comensal (login por código mágico, persistente por dispositivo).
  const [customerName, setCustomerName] = useState<string | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const [showLogin, setShowLogin] = useState(false)

  useEffect(() => {
    let alive = true
    getSessionCustomer(slug).then((c) => {
      if (!alive) return
      if (c) { setLoggedIn(true); setCustomerName(c.name) }
    })
    return () => { alive = false }
  }, [slug])

  async function doLogout() {
    await logoutCustomer(slug)
    setLoggedIn(false); setCustomerName(null)
  }

  // Botón atrás/adelante del navegador → re-leer el brandId de la URL
  useEffect(() => {
    const onPop = () => setBrandId(getBrandIdFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function openBrand(id: string) {
    window.history.pushState({}, '', `${shopBase(slug)}/${id}`)
    setBrandId(id)
    window.scrollTo(0, 0)
  }
  function backToHub() {
    window.history.pushState({}, '', shopBase(slug) || '/')
    setBrandId(null)
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    if (brandId) return // mientras se ve una carta no recargamos el hub
    let alive = true
    setStatus('loading')
    getShopHub(slug)
      .then(res => {
        if (!alive) return
        if (!res) { setStatus('notfound'); return }
        setHub(res); setStatus('ready')
      })
      .catch(e => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Error cargando la tienda')
        setStatus('error')
      })
    return () => { alive = false }
  }, [slug, brandId])

  // Cocinas distintas presentes entre las marcas (orden estable por aparición).
  const cuisines: Cuisine[] = useMemo(() => {
    if (!hub) return []
    const seen = new Map<string, Cuisine>()
    for (const b of hub.brands) {
      if (b.cuisineCode && b.cuisineLabel && !seen.has(b.cuisineCode)) {
        seen.set(b.cuisineCode, { code: b.cuisineCode, label: b.cuisineLabel, emoji: b.cuisineEmoji })
      }
    }
    return Array.from(seen.values())
  }, [hub])

  // Todos los hooks han corrido ya. Si la URL trae brandId, mostramos la carta.
  if (slug && brandId) {
    return <BrandMenuRoute slug={slug} brandId={brandId} onBack={backToHub} onCheckout={onCheckout} />
  }

  if (status === 'loading') {
    return <div style={S.page}><div style={{ padding: 60, textAlign: 'center', color: C.inkDim }}>Cargando la tienda…</div></div>
  }
  if (status === 'notfound') {
    return <div style={S.page}><div style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center', padding: 24 }}>
      <h1 style={{ fontSize: 22, color: C.ink, marginBottom: 8 }}>Esta tienda no existe</h1>
      <p style={{ color: C.inkDim, fontSize: 14 }}>Comprueba el enlace.</p>
    </div></div>
  }
  if (status === 'error') {
    return <div style={S.page}><div style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center', padding: 24 }}>
      <h1 style={{ fontSize: 20, color: C.ink, marginBottom: 8 }}>No se pudo cargar la tienda</h1>
      <p style={{ color: C.inkDim, fontSize: 14 }}>{error}</p>
    </div></div>
  }
  if (!hub) return null

  const tagline = hub.tagline || 'Mézclalo todo. Una sola entrega.'
  const dot = tagline.indexOf('.')
  const taglineA = dot > 0 ? tagline.slice(0, dot + 1) : tagline
  const taglineB = dot > 0 ? tagline.slice(dot + 1).trim() : ''
  const subtitle = hub.subtitle || 'Pide de varias cocinas a la vez y te llega junto y calentito, en una sola entrega.'

  // Filtro de marcas por cocina activa (null = todas).
  const visibleBrands = activeCuisine
    ? hub.brands.filter(b => b.cuisineCode === activeCuisine)
    : hub.brands

  return (
    <div style={S.page}>
      {/* 1 · TOP BAR · la identidad de marca vive en el héroe (Opción C) */}
      <div style={S.topbar}>
        <span aria-hidden="true" />
        {loggedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>
              {customerName ? `Hola, ${customerName.split(' ')[0]}` : 'Mi cuenta'}
            </span>
            <button
              onClick={doLogout}
              style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 700, color: C.inkDim, cursor: 'pointer' }}
            >
              Salir
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowLogin(true)}
            style={{ background: C.ink, border: 'none', borderRadius: 999, padding: '8px 18px', fontSize: 14, fontWeight: 800, color: '#fff', cursor: 'pointer' }}
          >
            Entrar
          </button>
        )}
      </div>

      {showLogin && (
        <CustomerLoginModal
          slug={slug}
          onClose={() => setShowLogin(false)}
          onLoggedIn={(name) => { setLoggedIn(true); setCustomerName(name); setShowLogin(false) }}
        />
      )}

      {/* 3 · HERO */}
      <div style={{
        ...S.hero,
        background: hub.heroUrl
          ? `linear-gradient(90deg,rgba(20,14,10,.86) 0%,rgba(20,14,10,.6) 42%,rgba(20,14,10,.2) 100%), center/cover no-repeat url(${hub.heroUrl})`
          : C.accent,
      }}>
        <div style={S.heroCopy}>
          <div style={S.heroBrand}>
            {hub.accountLogoUrl
              ? <span style={S.heroLogoBox}><img src={hub.accountLogoUrl} alt={hub.accountName} style={S.heroLogoImg} /></span>
              : <div style={S.heroBrandName}>{hub.accountName}</div>}
            <div style={S.heroBrandSub}><Star size={13} /> {hub.brands.length} cocinas bajo un mismo techo</div>
          </div>
          <h1 style={S.h1}>
            {taglineA}
            {taglineB && <><br /><span style={S.hl}>{taglineB}</span></>}
          </h1>
          <p style={S.heroP}>{subtitle}</p>
        </div>
      </div>

      {/* 4 · LAYOUT 2 columnas */}
      <div style={S.wrap}>
        {/* 5 · MAIN */}
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          {/* a) CHIPS de cocina (reales; filtran). Solo si hay cocinas declaradas. */}
          {cuisines.length > 0 && (
            <div style={S.chips}>
              <span
                onClick={() => setActiveCuisine(null)}
                style={{ ...S.chip, ...(activeCuisine === null ? S.chipActive : {}) }}>
                <Icon d={Ic.flame} size={15} fill="currentColor" /> Todo
              </span>
              {cuisines.map(c => (
                <span
                  key={c.code}
                  onClick={() => setActiveCuisine(c.code)}
                  style={{ ...S.chip, ...(activeCuisine === c.code ? S.chipActive : {}) }}>
                  {c.emoji ? <span style={{ fontSize: 15 }}>{c.emoji}</span> : null} {c.label}
                </span>
              ))}
            </div>
          )}

          {/* b) LO MÁS PEDIDO (real, de ventas). Solo si hay datos. */}
          {hub.topDishes.length > 0 && (
            <>
              <div style={{ ...S.secHead, marginTop: cuisines.length > 0 ? 26 : 4 }}>
                <h2 style={{ ...S.h2, display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ color: C.accent }}><Icon d={Ic.trending} size={22} /></span> Lo más pedido
                </h2>
              </div>
              <div style={S.popRow}>
                {hub.topDishes.map((p: TopDish) => (
                  <div key={p.menuItemId} style={S.miniCard}>
                    <div style={{ ...S.miniPh, background: p.photoUrl ? `center/cover no-repeat url(${p.photoUrl})` : C.accentBg }}>
                      <span style={S.miniPrice}>{eur(p.price)}</span>
                    </div>
                    <div style={{ padding: '10px 12px 12px' }}>
                      <div style={S.miniName}>{p.name}</div>
                      <div style={S.miniBrand}>{p.brandName}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* c) TODAS LAS COCINAS */}
          <div style={{ ...S.secHead, marginTop: 30 }}>
            <h2 style={S.h2}>Todas las cocinas</h2>
            <span style={{ fontSize: 14, color: C.inkDim, fontWeight: 700 }}>{visibleBrands.length} cocinas</span>
          </div>

          {visibleBrands.length === 0 ? (
            <div style={S.emptyBrands}>
              {hub.brands.length === 0
                ? 'Esta tienda aún no tiene cocinas disponibles.'
                : 'No hay cocinas de este tipo.'}
            </div>
          ) : (
            <div style={S.grid}>
              {visibleBrands.map(b => <BrandCard key={b.brandId} b={b} onOpen={() => openBrand(b.brandId)} />)}
            </div>
          )}
        </div>
      </div>

      {/* 7 · FOOTER */}
      <footer style={S.footer}>
        Pedidos con <a href="https://folvy.app" style={{ color: C.accent, textDecoration: 'none', fontWeight: 700 }}>Folvy</a>
      </footer>
    </div>
  )
}

// Wrapper: lee el slug y envuelve el Shop con el carrito (persiste entre Hub y carta).
// Rutea entre 3 vistas: seguimiento (/seguir, URL-driven, sobrevive a refresh y
// al retorno de redirección de Bizum), checkout (estado interno) y hub/carta.
export default function ShopHubRoute() {
  const [slug] = useState<string | null>(resolveShopSlug())
  const [checkout, setCheckout] = useState(false)
  const [isTrack, setIsTrack] = useState(getIsTrackPath())
  const [trackToken, setTrackToken] = useState<string | null>(getTrackTokenFromQuery())

  // La ruta de seguimiento vive en la URL: atrás/adelante y refresh la respetan.
  useEffect(() => {
    const onPop = () => { setIsTrack(getIsTrackPath()); setTrackToken(getTrackTokenFromQuery()) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (!slug) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: C.inkDim }}>Tienda no encontrada</div>
  }

  const goToCheckout = () => { window.scrollTo(0, 0); setCheckout(true) }
  const goToTrack = (token: string) => {
    window.history.pushState({}, '', `${shopBase(slug)}/seguir?t=${encodeURIComponent(token)}`)
    setCheckout(false); setTrackToken(token); setIsTrack(true); window.scrollTo(0, 0)
  }
  const backFromTrack = () => {
    window.history.pushState({}, '', shopBase(slug) || '/')
    setIsTrack(false); setTrackToken(null); window.scrollTo(0, 0)
  }

  return (
    <ShopCartProvider slug={slug}>
      {isTrack
        ? <TrackOrderRoute slug={slug} token={trackToken} onBack={backFromTrack} />
        : checkout
          ? <CheckoutRoute slug={slug} onBack={() => setCheckout(false)} onTrack={goToTrack} />
          : <>
              <ShopHubInner slug={slug} onCheckout={goToCheckout} />
              <CartPanel onCheckout={goToCheckout} />
            </>}
    </ShopCartProvider>
  )
}

function BrandCard({ b, onOpen }: { b: HubBrand; onOpen: () => void }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      style={{ ...S.card, cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 14px 30px rgba(26,23,20,.1)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}>
      {/* Foto del plato a toda la tarjeta, con el logo en pastilla limpia encima */}
      <div style={{ ...S.cardPhoto, position: 'relative', background: b.heroUrl ? `center/cover no-repeat url(${b.heroUrl})` : (b.accentColor ? `${b.accentColor}22` : C.accentBg), filter: b.isOpen ? 'none' : 'grayscale(0.85)', opacity: b.isOpen ? 1 : 0.82 }}>
        {b.logoUrl
          ? <img src={b.logoUrl} alt={b.name} style={S.logoPill} />
          : <span style={{ ...S.logoPill, fontWeight: 900, fontSize: 16, letterSpacing: '-.03em', color: b.accentColor || C.ink, padding: '8px 14px' }}>{shortName(b.name)}</span>}
        {!b.isOpen && (
          <span style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(26,23,20,.82)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: 999, letterSpacing: '-.01em' }}>
            Cerrado ahora
          </span>
        )}
      </div>
      <div style={{ padding: '15px 16px 17px' }}>
        <div style={S.cardName}>{b.name}</div>
        {(b.rating != null || b.cuisineLabel) && (
          <div style={S.cardMeta}>
            {b.rating != null && (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.star, fontWeight: 800 }}>
                  <Star size={14} /> {b.rating.toFixed(1)}
                  {b.ratingCount != null && <span style={{ color: C.inkDim, fontWeight: 600 }}>({b.ratingCount})</span>}
                </span>
                {b.cuisineLabel && <span style={{ color: C.inkDim }}>·</span>}
              </>
            )}
            {b.cuisineLabel && (
              <span style={{ color: C.inkDim }}>
                {b.cuisineEmoji ? `${b.cuisineEmoji} ` : ''}{b.cuisineLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const C = {
  bg: '#FBF7F0', surface: '#FFFFFF', ink: '#1A1714', inkDim: '#7A726A', line: '#ECE5DA',
  accent: '#FF5436', accent2: '#FFB400', accentBg: '#EDECE6', coralBg: '#FFE9E3',
  green: '#1FA85B', greenBg: '#E3F6EC', star: '#FF9F0A', tagBg: '#F3EFE8',
  amber: '#7A5A12', amberBg: '#FFF3D6', amberLine: '#F2DCA0',
}
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: 'inherit' },
  topbar: { position: 'sticky', top: 0, zIndex: 50, background: '#FBF7F0', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: '11px 28px' },
  logo: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 900, fontSize: 20, letterSpacing: '-.03em' },
  logoDot: { width: 11, height: 11, borderRadius: '50%', background: C.accent },
  logoImg: { height: 50, width: 'auto', maxWidth: 260, objectFit: 'contain', display: 'block' },
  preTag: { fontSize: 12, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: C.amber, background: C.amberBg, border: `1px solid ${C.amberLine}`, padding: '6px 12px', borderRadius: 30 },
  preBanner: { display: 'flex', alignItems: 'center', gap: 10, margin: '14px 28px 0', padding: '11px 16px', background: C.amberBg, border: `1px solid ${C.amberLine}`, borderRadius: 12, fontSize: 13.5, color: C.amber, fontWeight: 600 },
  preIc: { display: 'flex', color: C.amber, flexShrink: 0 },
  hero: { margin: '16px 28px 0', borderRadius: 26, overflow: 'hidden', position: 'relative', minHeight: 330, display: 'flex', alignItems: 'center' },
  heroCopy: { padding: '46px 52px', maxWidth: 640, zIndex: 2, color: '#fff' },
  heroBrand: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 13, marginBottom: 22 },
  heroLogoBox: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  heroLogoImg: { height: 90, width: 'auto', maxWidth: 460, objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 4px 16px rgba(0,0,0,.5))' },
  heroBrandText: { display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.05 },
  heroBrandName: { fontWeight: 900, fontSize: 32, letterSpacing: '-.035em', color: '#fff' },
  heroBrandSub: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,.92)' },
  eyebrow: { display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(4px)', alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 30, fontWeight: 800, fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 18 },
  h1: { fontSize: 46, lineHeight: 1.02, letterSpacing: '-.035em', fontWeight: 900, marginBottom: 14 },
  hl: { background: C.accent2, color: C.ink, padding: '0 10px', borderRadius: 8, display: 'inline-block', transform: 'rotate(-1.5deg)' },
  heroP: { fontSize: 17, maxWidth: 440, lineHeight: 1.5, opacity: .96 },
  wrap: { display: 'flex', flexWrap: 'wrap', gap: 30, padding: '30px 28px 40px', alignItems: 'flex-start' },
  chips: { display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', background: C.surface, border: `1.5px solid ${C.line}`, color: C.ink, fontSize: 14, fontWeight: 700, padding: '10px 17px', borderRadius: 30, cursor: 'pointer' },
  chipActive: { background: C.ink, color: '#fff', border: `1.5px solid ${C.ink}` },
  secHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 },
  h2: { fontSize: 22, fontWeight: 900, letterSpacing: '-.02em' },
  popRow: { display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 6 },
  miniCard: { flex: '0 0 190px', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, overflow: 'hidden' },
  miniPh: { position: 'relative', height: 120 },
  miniPrice: { position: 'absolute', right: 10, bottom: 10, background: '#fff', color: C.ink, fontSize: 13, fontWeight: 800, padding: '5px 10px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,.12)' },
  miniName: { fontSize: 14, fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1.2 },
  miniBrand: { fontSize: 12.5, color: C.inkDim, marginTop: 3 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 22 },
  card: { display: 'block', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, overflow: 'hidden', cursor: 'pointer', textDecoration: 'none', color: 'inherit', transition: 'transform .15s ease, box-shadow .15s ease' },
  cardPhoto: { position: 'relative', height: 168, width: '100%', display: 'flex', alignItems: 'flex-end' },
  logoPill: { height: 52, width: 'auto', maxWidth: 150, margin: '0 0 12px 12px', objectFit: 'contain', display: 'block', borderRadius: 12, background: '#fff', boxShadow: '0 3px 10px rgba(0,0,0,.18)' },
  cardName: { fontSize: 18, fontWeight: 800, letterSpacing: '-.01em', marginBottom: 6 },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.inkDim, fontWeight: 600 },
  emptyBrands: { border: `1px dashed ${C.line}`, borderRadius: 16, padding: 48, textAlign: 'center', color: C.inkDim },
  side: { flex: '0 0 380px', width: 380, position: 'sticky', top: 86, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: 26, alignSelf: 'flex-start' },
  sideHead: { display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${C.line}`, paddingBottom: 14, marginBottom: 14 },
  sideBag: { width: 46, height: 46, borderRadius: 13, background: C.coralBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, flexShrink: 0 },
  sideP: { fontSize: 13.5, color: C.inkDim, lineHeight: 1.5, margin: '0 0 16px' },
  sideFeat: { display: 'flex', alignItems: 'center', gap: 12, background: C.bg, borderRadius: 13, padding: '13px 15px' },
  sideFeatIc: { width: 38, height: 38, borderRadius: 11, background: C.surface, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ink, flexShrink: 0 },
  footer: { maxWidth: 1080, margin: '0 auto', padding: '0 24px 32px', color: C.inkDim, fontSize: 12, textAlign: 'center' },
}
```

### `src/modules/shop/shopHost.ts`

```ts
// src/modules/shop/shopHost.ts
//
// Resolución del Shop por HOSTNAME (subdominio por tienda: <slug>.folvy.app).
// Capa 1 del frente "dominio de la tienda": cada tienda tiene su subdominio
// limpio en folvy.app, resuelto en el arranque del front (SPA pura, sin
// servidor). El backend NO se toca: el slug derivado del host se sigue pasando
// como p_slug a las mismas RPC del Shop.
//
// Reglas (conservadoras, para no capturar por error dominios que NO son tienda):
//   - Solo subdominios de un único nivel de `folvy.app`  →  <slug>.folvy.app
//   - Se EXCLUYEN: el apex (folvy.app), `app.folvy.app`, `www.folvy.app`,
//     los previews de Vercel (*.vercel.app), localhost e IPs.
//   - Multi-nivel (a.b.folvy.app) NO se soporta (no es un slug válido).
//
// Capa 2 (dominio 100% propio del cliente, p.ej. pedidos.llorente29.com) NO se
// resuelve aquí: ese hostname no contiene el slug y necesitará un mapeo
// host→slug en servidor. Este módulo se diseña para ampliarse sin reescribir:
// isShopHost() seguirá valiendo para *.folvy.app y la Capa 2 añadirá su rama.

const ROOT = 'folvy.app'
const RESERVED = new Set(['app', 'www'])

/** true si el hostname actual es un subdominio de tienda `<slug>.folvy.app`. */
export function isShopHost(): boolean {
  const host = window.location.hostname.toLowerCase()
  if (!host.endsWith('.' + ROOT)) return false          // apex o dominio ajeno → no
  const sub = host.slice(0, -('.' + ROOT).length)
  if (!sub || sub.includes('.')) return false            // vacío o multi-nivel → no
  if (RESERVED.has(sub)) return false                    // app / www → no (app de gestión)
  return true
}

/** El slug de la tienda derivado del subdominio, o null si no es host de tienda. */
export function shopSlugFromHost(): string | null {
  if (!isShopHost()) return null
  const host = window.location.hostname.toLowerCase()
  return host.slice(0, -('.' + ROOT).length)
}
```

---

## 3. `git grep -n "customer_session_me\|registerShopConsent\|getSessionCustomer\|CustomerLoginModal" -- src/`

```
src/modules/shop/ShopHubRoute.tsx:9:import CustomerLoginModal from '@/modules/shop/checkout/CustomerLoginModal'
src/modules/shop/ShopHubRoute.tsx:10:import { getSessionCustomer, logoutCustomer } from '@/modules/shop/checkout/customerAuthService'
src/modules/shop/ShopHubRoute.tsx:100:    getSessionCustomer(slug).then((c) => {
src/modules/shop/ShopHubRoute.tsx:221:        <CustomerLoginModal
src/modules/shop/checkout/CheckoutRoute.tsx:25:import { getSessionCustomer, registerShopConsent } from '@/modules/shop/checkout/customerAuthService'
src/modules/shop/checkout/CheckoutRoute.tsx:208:    getSessionCustomer(slug).then((c) => {
src/modules/shop/checkout/CheckoutRoute.tsx:227:      registerShopConsent({
src/modules/shop/checkout/CustomerLoginModal.tsx:1:// src/modules/shop/checkout/CustomerLoginModal.tsx
src/modules/shop/checkout/CustomerLoginModal.tsx:34:export default function CustomerLoginModal({ slug, onClose, onLoggedIn }: {
src/modules/shop/checkout/customerAuthService.ts:11://   getSessionCustomer(slug)              -> RPC customer_session_me por token
src/modules/shop/checkout/customerAuthService.ts:71:export async function getSessionCustomer(slug: string): Promise<SessionCustomer | null> {
src/modules/shop/checkout/customerAuthService.ts:75:    const { data, error } = await db().rpc('customer_session_me', { p_token: token })
src/modules/shop/checkout/customerAuthService.ts:108:export async function registerShopConsent(args: {
```

---

## 4. `git grep -rni "mi cuenta\|micuenta\|/cuenta\|account" -- src/modules/shop/`

```
src/modules/shop/ShopHubRoute.tsx:201:              {customerName ? `Hola, ${customerName.split(' ')[0]}` : 'Mi cuenta'}
src/modules/shop/ShopHubRoute.tsx:237:            {hub.accountLogoUrl
src/modules/shop/ShopHubRoute.tsx:238:              ? <span style={S.heroLogoBox}><img src={hub.accountLogoUrl} alt={hub.accountName} style={S.heroLogoImg} /></span>
src/modules/shop/ShopHubRoute.tsx:239:              : <div style={S.heroBrandName}>{hub.accountName}</div>}
src/modules/shop/admin/WelcomeOfferSettings.tsx:8:// Autocontenida (estilos inline): se monta con <WelcomeOfferSettings accountId={…} />.
src/modules/shop/admin/WelcomeOfferSettings.tsx:34:export default function WelcomeOfferSettings({ accountId }: { accountId: string }) {
src/modules/shop/admin/WelcomeOfferSettings.tsx:51:      const off = await getWelcomeOffer(accountId)
src/modules/shop/admin/WelcomeOfferSettings.tsx:54:      const imp = await previewCouponImpact(accountId, off.discountType, off.value)
src/modules/shop/admin/WelcomeOfferSettings.tsx:59:  }, [accountId])
src/modules/shop/admin/WelcomeOfferSettings.tsx:67:      const imp = await previewCouponImpact(accountId, discountType, value)
src/modules/shop/admin/WelcomeOfferSettings.tsx:72:  }, [discountType, value, accountId])
src/modules/shop/admin/WelcomeOfferSettings.tsx:80:    const res = await saveWelcomeOffer({ accountId, active, discountType, value, floorPct })
src/modules/shop/admin/couponAdminService.ts:26:export async function getWelcomeOffer(accountId: string): Promise<WelcomeOffer> {
src/modules/shop/admin/couponAdminService.ts:31:      .eq('account_id', accountId)
src/modules/shop/admin/couponAdminService.ts:63:  accountId: string, discountType: DiscountType, value: number,
src/modules/shop/admin/couponAdminService.ts:66:    p_account: accountId, p_discount_type: discountType, p_value: value,
src/modules/shop/admin/couponAdminService.ts:88:  accountId: string
src/modules/shop/admin/couponAdminService.ts:95:    p_account: args.accountId,
src/modules/shop/checkout/CheckoutRoute.tsx:108:  connectedAccountId: string
src/modules/shop/checkout/CheckoutRoute.tsx:463:      if (!pi.ok || !pi.clientSecret || !pi.connectedAccountId) {
src/modules/shop/checkout/CheckoutRoute.tsx:468:        connectedAccountId: pi.connectedAccountId,
src/modules/shop/checkout/CheckoutRoute.tsx:609:              {hub?.accountLogoUrl
src/modules/shop/checkout/CheckoutRoute.tsx:610:                ? <img src={hub.accountLogoUrl} alt={hub?.accountName || ''} style={s.payBrandLogo} />
src/modules/shop/checkout/CheckoutRoute.tsx:611:                : <span style={s.payBrandName}>{hub?.accountName || 'Folvy'}</span>}
src/modules/shop/checkout/CheckoutRoute.tsx:650:              Responsable del tratamiento: <strong>{hub?.accountName || 'la tienda'}</strong>. Puedes consultar
src/modules/shop/checkout/CheckoutRoute.tsx:857:                  Quiero unirme al club de {hub?.accountName || 'la tienda'} y recibir sus ofertas y novedades. Puedo darme de baja cuando quiera.{' '}
src/modules/shop/checkout/CheckoutRoute.tsx:883:                      <div style={s.welcomeLabelGold}>Club {hub?.accountName || 'Foodint'}</div>
src/modules/shop/checkout/CheckoutRoute.tsx:1055:// (stripeAccount). La clave publicable es la de la PLATAFORMA.
src/modules/shop/checkout/CheckoutRoute.tsx:1060:    () => (pk ? loadStripe(pk, { stripeAccount: pay.connectedAccountId, locale: 'es' }) : null),
src/modules/shop/checkout/CheckoutRoute.tsx:1061:    [pk, pay.connectedAccountId],
src/modules/shop/checkout/checkoutService.ts:41:  | { ok: false; reason: 'out_of_zone' | 'account' | 'error' }
src/modules/shop/checkout/checkoutService.ts:50:    return { ok: false, reason: (data?.reason ?? 'error') as 'out_of_zone' | 'account' | 'error' }
src/modules/shop/checkout/checkoutService.ts:144:  connectedAccountId?: string
src/modules/shop/checkout/checkoutService.ts:161:    connectedAccountId: data.connectedAccountId,
src/modules/shop/components/StorefrontPreview.tsx:53:export default function StorefrontPreview({ accountId, brandId, brand, heroUrl, theme }: {
src/modules/shop/components/StorefrontPreview.tsx:54:  accountId: string
src/modules/shop/components/StorefrontPreview.tsx:66:    listCategoriesWithProducts(accountId, brandId)
src/modules/shop/components/StorefrontPreview.tsx:71:  }, [accountId, brandId])
src/modules/shop/pages/ShopDesignPage.tsx:8:// - Al entrar, SIEMBRA temas por defecto (ensureThemesForAccount) → tienda
src/modules/shop/pages/ShopDesignPage.tsx:18:import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
src/modules/shop/pages/ShopDesignPage.tsx:21:import { getAccountLogo, uploadAccountLogo, deleteAccountLogo, getAccountShopText, setAccountShopText } from '@/modules/shop/services/shopAccountService'
src/modules/shop/pages/ShopDesignPage.tsx:24:  ensureThemesForAccount,
src/modules/shop/pages/ShopDesignPage.tsx:58:  const { activeAccountId: accountId } = useActiveAccount()
src/modules/shop/pages/ShopDesignPage.tsx:72:    if (!accountId) return
src/modules/shop/pages/ShopDesignPage.tsx:76:      await ensureThemesForAccount(accountId)        // siembra idempotente
src/modules/shop/pages/ShopDesignPage.tsx:77:      setRows(await listBrandsWithTheme(accountId))
src/modules/shop/pages/ShopDesignPage.tsx:78:      try { setHubLogo(await getAccountLogo(accountId)) } catch { /* sin logo */ }
src/modules/shop/pages/ShopDesignPage.tsx:79:      try { const t = await getAccountShopText(accountId); setSlogan(t.tagline ?? ''); setSubtitle(t.subtitle ?? '') } catch { /* sin textos */ }
src/modules/shop/pages/ShopDesignPage.tsx:85:  }, [accountId])
src/modules/shop/pages/ShopDesignPage.tsx:123:    if (!file || !r || !accountId || !r.brand_id) return
src/modules/shop/pages/ShopDesignPage.tsx:126:      await uploadShopHero(accountId, r.brand_id, r.id, file)
src/modules/shop/pages/ShopDesignPage.tsx:145:    if (!file || !accountId) return
src/modules/shop/pages/ShopDesignPage.tsx:147:    try { setHubLogo(await uploadAccountLogo(accountId, file)) }
src/modules/shop/pages/ShopDesignPage.tsx:152:    if (!accountId) return
src/modules/shop/pages/ShopDesignPage.tsx:154:    try { await deleteAccountLogo(accountId); setHubLogo(null) }
src/modules/shop/pages/ShopDesignPage.tsx:159:    if (!accountId) return
src/modules/shop/pages/ShopDesignPage.tsx:161:    try { await setAccountShopText(accountId, slogan, subtitle); setTextSaved(true); setTimeout(() => setTextSaved(false), 2500) }
src/modules/shop/pages/ShopDesignPage.tsx:256:      {accountId && (
src/modules/shop/pages/ShopDesignPage.tsx:258:          <WelcomeOfferSettings accountId={accountId} />
src/modules/shop/pages/ShopDesignPage.tsx:368:              {accountId && (
src/modules/shop/pages/ShopDesignPage.tsx:370:                  accountId={accountId}
src/modules/shop/services/shopAccountService.ts:1:// src/modules/shop/services/shopAccountService.ts
src/modules/shop/services/shopAccountService.ts:4:// en la cabecera del hub multimarca. Vive en accounts.shop_logo_url y el fichero
src/modules/shop/services/shopAccountService.ts:6:// cuenta ya vale) bajo {accountId}/hub-logo-*.
src/modules/shop/services/shopAccountService.ts:31:export async function getAccountLogo(accountId: string): Promise<string | null> {
src/modules/shop/services/shopAccountService.ts:34:    .from('accounts').select('shop_logo_url').eq('id', accountId).single()
src/modules/shop/services/shopAccountService.ts:39:export interface AccountShopText { tagline: string | null; subtitle: string | null }
src/modules/shop/services/shopAccountService.ts:42:export async function getAccountShopText(accountId: string): Promise<AccountShopText> {
src/modules/shop/services/shopAccountService.ts:45:    .from('accounts').select('shop_tagline, shop_subtitle').eq('id', accountId).single()
src/modules/shop/services/shopAccountService.ts:53:/** Guarda titular + subtítulo (RPC acotada que esquiva la RLS de accounts). */
src/modules/shop/services/shopAccountService.ts:54:export async function setAccountShopText(accountId: string, tagline: string, subtitle: string): Promise<void> {
src/modules/shop/services/shopAccountService.ts:57:    .rpc('set_account_shop_text', { p_account_id: accountId, p_tagline: tagline, p_subtitle: subtitle })
src/modules/shop/services/shopAccountService.ts:62: *  accounts.shop_logo_url y borra el anterior. Devuelve la URL pública. */
src/modules/shop/services/shopAccountService.ts:63:export async function uploadAccountLogo(accountId: string, file: File): Promise<string> {
src/modules/shop/services/shopAccountService.ts:67:  try { previousUrl = await getAccountLogo(accountId) } catch { /* sigue */ }
src/modules/shop/services/shopAccountService.ts:69:  const path = `${accountId}/hub-logo-${Date.now()}.${extFromFile(file)}`
src/modules/shop/services/shopAccountService.ts:78:    .rpc('set_account_shop_logo', { p_account_id: accountId, p_url: publicUrl })
src/modules/shop/services/shopAccountService.ts:91:/** Quita el logo del hub: limpia accounts.shop_logo_url y borra el fichero. */
src/modules/shop/services/shopAccountService.ts:92:export async function deleteAccountLogo(accountId: string): Promise<void> {
src/modules/shop/services/shopAccountService.ts:95:  try { current = await getAccountLogo(accountId) } catch { /* sigue */ }
src/modules/shop/services/shopAccountService.ts:98:    .rpc('set_account_shop_logo', { p_account_id: accountId, p_url: null })
src/modules/shop/services/shopHeroService.ts:7:// ruta {accountId}/{brandId}/hero-*.jpg, y su URL se guarda en shop_theme.hero_url.
src/modules/shop/services/shopHeroService.ts:52:  accountId: string, brandId: string, themeId: string, file: File,
src/modules/shop/services/shopHeroService.ts:63:  const path = `${accountId}/${brandId}/hero-${Date.now()}.jpg`
src/modules/shop/services/shopHubService.ts:30:  accountName: string
src/modules/shop/services/shopHubService.ts:31:  accountLogoUrl: string | null
src/modules/shop/services/shopHubService.ts:47:    accountName: data.account_name ?? '',
src/modules/shop/services/shopHubService.ts:48:    accountLogoUrl: data.account_logo_url ?? null,
src/modules/shop/services/shopThemeService.ts:10:// Filosofía "bonito desde el minuto 0": ensureThemesForAccount SIEMBRA por
src/modules/shop/services/shopThemeService.ts:24:  account_id: string
src/modules/shop/services/shopThemeService.ts:70:export async function ensureThemesForAccount(accountId: string): Promise<ShopTheme[]> {
src/modules/shop/services/shopThemeService.ts:76:    .eq('account_id', accountId)
src/modules/shop/services/shopThemeService.ts:85:    .eq('account_id', accountId)
src/modules/shop/services/shopThemeService.ts:95:    toInsert.push({ account_id: accountId, brand_id: null, hub_position: 0, ...THEME_DEFAULTS })
src/modules/shop/services/shopThemeService.ts:100:    toInsert.push({ account_id: accountId, brand_id: b.id, hub_position: maxPos, ...THEME_DEFAULTS })
src/modules/shop/services/shopThemeService.ts:112:  return listThemes(accountId)
src/modules/shop/services/shopThemeService.ts:116:export async function listThemes(accountId: string): Promise<ShopTheme[]> {
src/modules/shop/services/shopThemeService.ts:120:    .eq('account_id', accountId)
src/modules/shop/services/shopThemeService.ts:128:export async function listBrandsWithTheme(accountId: string): Promise<BrandWithTheme[]> {
src/modules/shop/services/shopThemeService.ts:132:    .eq('account_id', accountId)
src/modules/shop/services/shopThemeService.ts:140:export async function getHubTheme(accountId: string): Promise<ShopTheme | null> {
src/modules/shop/services/shopThemeService.ts:144:    .eq('account_id', accountId)
src/modules/shop/services/shopThemeService.ts:160:/** Actualiza un tema (whitelist de campos; nunca toca account_id/brand_id). */
```

---

## 5. Migración más reciente de `place_shop_order`

### `supabase/migrations/20260702T2100_place_shop_order_welcome_needs_contact.sql`

```sql
-- 20260702T2100_place_shop_order_welcome_needs_contact.sql
-- Aplicada: (pendiente)
--
-- A2 — La oferta de BIENVENIDA solo se aplica cuando el comensal deja su email Y
-- marca el consentimiento de marketing. El descuento COMPRA el contacto con permiso
-- (su propósito real como imán de captación). Sin email o sin consentimiento la
-- bienvenida NO aplica (reason 'needs_contact', discount 0), cerrando la fuga de
-- margen que la hacía descontar a cualquiera de forma incontrolada.
--
-- Cambios respecto a la versión anterior (surgicales, resto idéntico):
--   1) v_consent se calcula ANTES del bloque de cupón (antes vivía en el bloque de
--      cliente, tras el return del dry-run; el cupón no lo tenía a mano).
--   2) Nueva validación en la cascada, DESPUÉS de 'min':
--         if v_is_welcome and (v_email is null or not v_consent) -> reason 'needs_contact'
--      (min primero: no se pide email en un carrito que ni llega al mínimo).
--   3) Se elimina el recálculo redundante de v_consent en el bloque de cliente.
--   4) v_coupon_json añade discountType + discountValue, para que el checkout
--      pueda nombrar la promo concreta en el gancho ("un 10% de descuento" /
--      "4 € de descuento") — nombrar el premio convierte más que decir "oferta".
--
-- La puerta usa la definición ya existente de v_is_welcome (first_order_only OR
-- auto_apply): cualquier cupón automático/primer-pedido exige contacto. Los cupones
-- de código NO-bienvenida no se ven afectados.
--
-- SECURITY DEFINER sin auth.uid(): crear es seguro en SQL Editor; verificar el
-- comportamiento DESDE LA APP (dry-run del checkout), no en SQL Editor.

CREATE OR REPLACE FUNCTION public.place_shop_order(p_slug text, p_payload jsonb, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_acc        uuid;
  v_channel    uuid;
  v_location   uuid;
  v_mode       text;
  v_service    text;
  v_pay_mode   text;
  v_line       jsonb;
  v_repr       jsonb;
  v_subtotal   numeric := 0;
  v_delivery   numeric := 0;
  v_total      numeric := 0;
  v_preview    jsonb := '[]'::jsonb;
  v_sale_id    uuid;
  v_code       text;
  v_token      text;
  v_brand_arr  uuid[];
  v_expected   timestamptz;
  v_addr       text;
  v_is_cash    boolean;
  v_email      text;
  v_phone      text;
  v_name       text;
  v_consent    boolean;
  v_terms      text;
  v_customer   uuid;
  -- F3: coste/margen
  v_line_cost    numeric;
  v_line_qty     numeric;
  v_cost_known   numeric := 0;      -- suma de costes de líneas con coste conocido
  v_cost_has_null boolean := false; -- alguna línea sin computed_cost
  -- F3: cupón
  v_coupon_code  text;
  v_coupon       coupon%rowtype;
  v_cust_existing uuid;
  v_discount     numeric := 0;
  v_reason       text := null;      -- por qué NO se aplicó (o null si aplicó)
  v_neto         numeric;
  v_margin_eur   numeric;
  v_margin_pct   numeric;
  v_margin_warn  boolean := false;
  v_floor        numeric;
  v_is_welcome   boolean;
  v_coupon_json  jsonb := jsonb_build_object('applied', false);
begin
  select id into v_acc from accounts where slug = p_slug;
  if v_acc is null then
    return jsonb_build_object('ok', false, 'reason', 'account');
  end if;

  if jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  v_location := nullif(p_payload->>'locationId','')::uuid;
  v_mode     := coalesce(p_payload->>'mode', 'delivery');
  v_service  := case when v_mode = 'pickup' then 'pickup' else 'own_delivery' end;
  v_delivery := case when v_mode = 'pickup' then 0
                     else coalesce((p_payload#>>'{delivery,deliveryFee}')::numeric, 0) end;
  v_expected := nullif(p_payload->>'expectedTime','')::timestamptz;
  v_pay_mode := coalesce(p_payload#>>'{payment,mode}','simulated');
  v_is_cash  := (v_pay_mode = 'cash');

  select id into v_channel
  from sales_channel
  where account_id = v_acc and slug = 'shop' and is_active and archived_at is null
  limit 1;

  -- ── Reprecio + acumulación de coste por línea (F3 sub-paso 2) ──────────
  for v_line in select * from jsonb_array_elements(p_payload->'lines')
  loop
    v_repr := public._shop_reprice_line(v_acc, v_line);
    v_subtotal := v_subtotal + coalesce((v_repr->>'lineTotal')::numeric, 0);
    v_preview := v_preview || jsonb_build_array(jsonb_build_object(
      'name', v_repr->>'name',
      'quantity', (v_repr->>'quantity')::numeric,
      'unitPrice', (v_repr->>'unitPrice')::numeric,
      'lineTotal', (v_repr->>'lineTotal')::numeric,
      'valid', (v_repr->>'valid')::boolean
    ));

    -- Coste de la línea: menu_item(payload) -> recipe_item.computed_cost * qty.
    -- Si el plato no tiene escandallo (computed_cost NULL) -> marca has_null y
    -- NO se suma (no se puede afirmar margen sin coste).
    v_line_qty := coalesce((v_repr->>'quantity')::numeric, 0);
    select ri.computed_cost into v_line_cost
    from menu_item mi
    left join recipe_item ri on ri.id = mi.recipe_item_id
    where mi.id = nullif(v_line->>'menuItemId','')::uuid
      and mi.account_id = v_acc
    limit 1;

    if v_line_cost is null then
      v_cost_has_null := true;
    else
      v_cost_known := v_cost_known + (v_line_cost * v_line_qty);
    end if;
  end loop;
  v_total := v_subtotal + v_delivery;

  -- ── Cupón: resolución + validación + guardarraíl (F3 sub-paso 3) ───────
  v_coupon_code := nullif(p_payload#>>'{coupon,code}','');
  v_email := lower(nullif(btrim(p_payload#>>'{customer,email}'), ''));
  v_phone := nullif(btrim(p_payload#>>'{customer,phone}'), '');
  -- A2: el consentimiento se necesita YA aquí para decidir si la bienvenida aplica.
  v_consent := coalesce((p_payload#>>'{consent,marketing}')::boolean, false);

  -- Resolver: por código, o el auto_apply activo si no viene código.
  select * into v_coupon
  from coupon
  where account_id = v_acc and active
    and (
      (v_coupon_code is not null and lower(code) = lower(v_coupon_code))
      or (v_coupon_code is null and auto_apply)
    )
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  order by (v_coupon_code is not null) desc   -- prioriza el de código si lo hay
  limit 1;

  if v_coupon.id is not null then
    v_is_welcome := v_coupon.first_order_only or v_coupon.auto_apply;

    -- Cliente existente (para primer-pedido y topes por cliente).
    if v_email is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_cust_existing is null and v_phone is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and phone = v_phone limit 1;
    end if;

    -- Validaciones (primera que falla fija el motivo).
    if v_coupon.min_subtotal is not null and v_subtotal < v_coupon.min_subtotal then
      v_reason := 'min';
    elsif v_is_welcome and (v_email is null or not v_consent) then
      -- A2: la bienvenida COMPRA el contacto con permiso; sin email+consentimiento
      -- no aplica (cierra la fuga de margen a comensales anónimos).
      v_reason := 'needs_contact';
    elsif v_coupon.first_order_only and v_cust_existing is not null and exists (
            select 1 from sale
            where customer_id = v_cust_existing
              and coalesce(status,'') <> 'cancelled'
          ) then
      v_reason := 'not_first';
    elsif v_coupon.max_redemptions is not null and (
            select count(*) from coupon_redemption where coupon_id = v_coupon.id
          ) >= v_coupon.max_redemptions then
      v_reason := 'exhausted';
    elsif v_cust_existing is not null and (
            select count(*) from coupon_redemption
            where coupon_id = v_coupon.id and customer_id = v_cust_existing
          ) >= v_coupon.max_per_customer then
      v_reason := 'per_customer';
    end if;

    -- Si pasó las validaciones, calcular descuento sobre SUBTOTAL.
    if v_reason is null then
      v_discount := case v_coupon.discount_type
        when 'percent' then round(v_subtotal * v_coupon.value / 100, 2)
        else least(v_coupon.value, v_subtotal) end;
      if v_discount < 0 then v_discount := 0; end if;

      if v_cost_has_null then
        -- Coste incompleto: no se puede afirmar margen -> NO se veta el cupón,
        -- pero se avisa que el margen no es verificable.
        v_margin_warn := true;
      else
        -- Coste completo: guardarraíl de margen.
        v_neto       := v_subtotal - v_discount;         -- el cupón no toca envío
        v_margin_eur := v_neto - v_cost_known;
        v_margin_pct := case when v_neto > 0 then v_margin_eur / v_neto * 100 else null end;
        v_floor      := (select shop_coupon_margin_floor_pct from accounts where id = v_acc);

        if v_floor is not null and v_margin_pct is not null and v_margin_pct < v_floor then
          if v_is_welcome then
            v_margin_warn := true;                        -- bienvenida: avisa pero permite
          else
            v_reason := 'margin';                         -- resto: suelo duro
            v_discount := 0;
          end if;
        end if;
      end if;
    end if;

    v_coupon_json := jsonb_build_object(
      'applied', (v_discount > 0),
      'code', v_coupon.code,
      'label', v_coupon.name,
      'discount', round(v_discount,2),
      'discountType', v_coupon.discount_type,
      'discountValue', v_coupon.value,
      'reason', v_reason,
      'marginWarning', v_margin_warn,
      'isWelcome', v_is_welcome
    );
  end if;

  -- Ajustar total con el descuento (nunca sobre envío).
  v_total := v_subtotal - v_discount + v_delivery;

  -- ── Dry-run: previsualización (no persiste) ───────────────────────────
  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dryRun', true,
      'subtotal', round(v_subtotal,2),
      'deliveryFee', round(v_delivery,2),
      'discount', round(v_discount,2),
      'total', round(v_total,2),
      'lines', v_preview,
      'coupon', v_coupon_json
    );
  end if;

  v_addr := nullif(btrim(
              coalesce(p_payload#>>'{delivery,address}','') || ' · ' ||
              coalesce(p_payload#>>'{delivery,detail}',''),
              ' ·'), '');

  v_sale_id := gen_random_uuid();
  v_code    := 'FS' || upper(left(replace(v_sale_id::text,'-',''), 5));
  v_token   := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  insert into sale (id, account_id, channel_id, location_id, source,
                    sold_at, total, delivery_cost, discount_amount, service_type,
                    status, order_status, platform_order_code, public_token,
                    customer_name, customer_phone, delivery_address, customer_note,
                    expected_time, payment_method, payment_status, dispatch_mode, raw_tab, created_by_name)
  values (v_sale_id, v_acc, v_channel, v_location, 'folvy_shop',
          now(), round(v_total,2), round(v_delivery,2), round(v_discount,2), v_service,
          'open', 'new', v_code, v_token,
          nullif(p_payload#>>'{customer,name}',''),
          nullif(p_payload#>>'{customer,phone}',''),
          v_addr,
          nullif(p_payload#>>'{delivery,note}',''),
          v_expected,
          v_pay_mode,
          case when v_is_cash then 'pending' else 'pending' end,
          'auto',
          p_payload::text,
          'Folvy Shop');

  perform public.adapt_folvy_shop_order(v_sale_id);

  perform public.compute_sale_line_cost(sl.id)
  from sale_line sl
  where sl.sale_id = v_sale_id and coalesce(sl.line_type,'product') = 'product';

  select array_agg(distinct mi.brand_id)
  into v_brand_arr
  from sale_line sl
  join menu_item mi on mi.id = sl.menu_item_id
  where sl.sale_id = v_sale_id and sl.line_type = 'product' and mi.brand_id is not null;

  update sale
  set brand_id = case when coalesce(array_length(v_brand_arr,1),0) = 1 then v_brand_arr[1] else null end
  where id = v_sale_id;

  -- ── Customer + consentimiento (Pata 2) ────────────────────────────────
  -- v_consent ya se calculó arriba (A2). Aquí solo el nombre y la versión de términos.
  v_name    := nullif(btrim(p_payload#>>'{customer,name}'), '');
  v_terms   := nullif(p_payload#>>'{consent,termsVersion}', '');

  if v_email is not null or v_phone is not null then
    if v_email is not null then
      select id into v_customer from customer
      where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_customer is null and v_phone is not null then
      select id into v_customer from customer
      where account_id = v_acc and phone = v_phone limit 1;
    end if;

    if v_customer is null then
      insert into customer (account_id, phone, email, name, first_brand_id, first_location_id)
      values (v_acc, v_phone, v_email, v_name,
              case when coalesce(array_length(v_brand_arr,1),0) = 1 then v_brand_arr[1] else null end,
              v_location)
      returning id into v_customer;
    else
      update customer set
        email      = coalesce(email, v_email),
        phone      = coalesce(phone, v_phone),
        name       = coalesce(name, v_name),
        last_seen_at = now(),
        updated_at   = now()
      where id = v_customer;
    end if;

    update sale set customer_id = v_customer where id = v_sale_id;

    if v_consent and v_email is not null then
      insert into customer_consent (customer_id, account_id, marketing_email, updated_at)
      values (v_customer, v_acc, true, now())
      on conflict (customer_id) do update set marketing_email = true, updated_at = now();

      insert into customer_consent_log (customer_id, account_id, action, channel, source, terms_version)
      values (v_customer, v_acc, 'granted', 'email', 'shop', v_terms);
    end if;
  end if;

  -- ── Canje del cupón (F3 sub-paso 4) ───────────────────────────────────
  -- Solo si se aplicó descuento. El índice único (coupon_id, customer_id) cierra
  -- la carrera de la bienvenida: si ya existe canje de este cliente, el INSERT
  -- falla; lo capturamos y degradamos el pedido a SIN descuento (revierte total
  -- y discount_amount), nunca abortamos la venta.
  if v_coupon.id is not null and v_discount > 0 then
    begin
      insert into coupon_redemption (
        coupon_id, account_id, sale_id, customer_id, customer_email, customer_phone,
        discount_amount, reference_subtotal, margin_after)
      values (
        v_coupon.id, v_acc, v_sale_id, v_customer, v_email, v_phone,
        round(v_discount,2), round(v_subtotal,2),
        case when v_cost_has_null then null else round(v_subtotal - v_discount - v_cost_known, 2) end);
    exception when unique_violation then
      -- Ya canjeó este cupón: revertir el descuento en la venta.
      update sale set discount_amount = 0, total = round(v_subtotal + v_delivery, 2)
      where id = v_sale_id;
      v_discount := 0;
      v_total := v_subtotal + v_delivery;
      v_coupon_json := jsonb_build_object('applied', false, 'reason', 'per_customer');
    end;
  end if;

  if v_is_cash then
    update sale set order_status = 'accepted' where id = v_sale_id and order_status = 'new';
  end if;

  return jsonb_build_object(
    'ok', true, 'dryRun', false,
    'saleId', v_sale_id,
    'code', v_code,
    'publicToken', v_token,
    'accepted', v_is_cash,
    'subtotal', round(v_subtotal,2),
    'deliveryFee', round(v_delivery,2),
    'discount', round(v_discount,2),
    'total', round(v_total,2),
    'coupon', v_coupon_json
  );
end;
$function$;
```

---

## 6. Bloque de routing del Shop en `App.tsx`

> Solo el bloque relevante del Shop (imports + ramas de routing). App.tsx **NO** se ha modificado.

```tsx
// (imports, cabecera del fichero)
import ShopHubRoute from './modules/shop/ShopHubRoute'
import { isShopHost } from './modules/shop/shopHost'

// … dentro del componente de routing raíz:

  // Folvy Shop por SUBDOMINIO de tienda (<slug>.folvy.app). Un subdominio de
  // tienda SIEMPRE sirve la tienda, con independencia del path (la tienda vive
  // en la raíz de su host). Va lo primero: en app.folvy.app / localhost /
  // previews isShopHost() es false y esto es un no-op (todo sigue igual).
  if (isShopHost()) {
    return <ShopHubRoute />
  }

  // … (rutas públicas de auth, /acceso, /cocina-tv, /estacion) …

  // Hub público de Folvy Shop (tienda multi-marca, sin sesión). Ruta /t/:slug,
  // hermana de /cocina-tv y /estacion. Va antes de los gates de sesión.
  if (location.pathname.startsWith('/t/')) {
    return <ShopHubRoute />
  }
```
