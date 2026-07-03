// src/modules/shop/account/MyAccountRoute.tsx
//
// "Mi cuenta" del Folvy Shop (F4·T1, núcleo). Tres pestañas:
//   · Pedidos  — histórico con foto + marcas + "Repetir pedido" (reorder exacto)
//   · Mis bonos — placeholder ("muy pronto"), se llena en un tramo posterior
//   · Mis datos — nombre/teléfono editables, email fijo, direcciones y la baja
//                 discreta del consentimiento (RGPD art. 7.3).
//
// El reorder pide el payload STRIP al servidor, hace UN dry-run de place_shop_order
// (precios/86 de HOY), avisa si algún plato ya no está disponible, puebla el carrito
// (replaceCart) y navega al checkout normal (revalida zona/precio allí).
//
// Estilo: maqueta v2 + storefront real (fondo crema, tarjetas blancas radius 16 con
// sombra/hover, píldoras 999, UNA acción coral por tarjeta, chips de marca).

import { useEffect, useState } from 'react'
import { useShopCart, type ReorderCartItem } from '@/modules/shop/cart/ShopCartContext'
import { getSessionCustomer } from '@/modules/shop/checkout/customerAuthService'
import { placeShopOrder, type ShopOrderPayload } from '@/modules/shop/checkout/checkoutService'
import {
  getCustomerOrders, getReorderPayload, setAccountConsent, updateProfile,
  getAddresses, saveAddress, deleteAddress,
  type AccountOrder, type CustomerAddress,
} from '@/modules/shop/account/accountService'

const C = {
  page: '#F7F5F0', surface: '#FFFFFF', ink: '#1A1714', inkDim: '#7A726A', inkFaint: '#9A938A',
  line: '#ECE5DA', accent: '#FF5436', green: '#1FA85B', greenBg: '#E3F6EC', greenDeep: '#0E6B38',
  amber: '#7A5A12', amberBg: '#FFF3D6', amberLine: '#F2DCA0', red: '#C23B22', pill: '#EFEDE7',
}

function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

function shortName(name: string): string {
  return (name || '?').split(/[\s·-]/)[0].slice(0, 8).toUpperCase()
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '' }
}

// Etiqueta legible del estado del pedido (fallback = capitaliza el crudo).
const STATUS_LABEL: Record<string, string> = {
  new: 'Recibido', accepted: 'Aceptado', preparing: 'En preparación', cooking: 'En preparación',
  ready: 'Listo', in_delivery: 'En reparto', out_for_delivery: 'En reparto',
  delivered: 'Entregado', finished: 'Entregado', completed: 'Entregado',
  cancelled: 'Cancelado', canceled: 'Cancelado', rejected: 'Rechazado',
}
function statusLabel(s: string | null): string {
  if (!s) return ''
  return STATUS_LABEL[s] ?? (s.charAt(0).toUpperCase() + s.slice(1))
}

type Tab = 'orders' | 'bonos' | 'datos'

// Prompt de confirmación del reorder (platos no disponibles o vaciar el carrito).
interface ReorderPrompt {
  locationId: string
  itemsAll: ReorderCartItem[]
  itemsValid: ReorderCartItem[]
  invalidCount: number
  hadCart: boolean
}

export default function MyAccountRoute({ slug, onBack, onReorder }: {
  slug: string
  onBack: () => void
  onReorder: () => void   // navega al checkout tras poblar el carrito
}) {
  const { cart, replaceCart } = useShopCart()
  const [tab, setTab] = useState<Tab>('orders')

  // Pedidos
  const [orders, setOrders] = useState<AccountOrder[] | null>(null)
  const [reorderBusy, setReorderBusy] = useState<string | null>(null)   // saleId en curso
  const [reorderErr, setReorderErr] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<ReorderPrompt | null>(null)

  // Datos
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [profileMsg, setProfileMsg] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [addresses, setAddresses] = useState<CustomerAddress[]>([])

  useEffect(() => {
    let alive = true
    getCustomerOrders(slug).then((r) => { if (alive) setOrders(r) }).catch(() => { if (alive) setOrders([]) })
    getSessionCustomer(slug).then((c) => {
      if (!alive || !c) return
      setName(c.name ?? ''); setPhone(c.phone ?? ''); setEmail(c.email ?? ''); setConsent(c.consented)
    }).catch(() => {})
    getAddresses(slug).then((r) => { if (alive) setAddresses(r) }).catch(() => {})
    return () => { alive = false }
  }, [slug])

  // ── Reorder ────────────────────────────────────────────────────────────
  async function startReorder(saleId: string) {
    if (reorderBusy) return
    setReorderBusy(saleId); setReorderErr(null)
    try {
      const res = await getReorderPayload(slug, saleId)
      if (!res.ok || !res.payload || !res.payload.locationId) {
        setReorderErr('No se pudo repetir este pedido.'); return
      }
      const { locationId, mode, lines } = res.payload
      // Dry-run: precios/disponibilidad de HOY.
      const payload: ShopOrderPayload = {
        locationId, mode,
        customer: { name: '', phone: '' },
        delivery: { address: '', detail: '', lat: null, lng: null, zoneId: null, deliveryFee: 0, note: '' },
        expectedTime: null,
        payment: { mode: 'stripe' },
        lines,
      }
      const dry = await placeShopOrder(slug, payload, true)
      if (!dry.ok || !dry.lines) { setReorderErr('No se pudo repetir este pedido.'); return }

      const itemsAll: ReorderCartItem[] = lines.map((ol, i) => {
        const dl = dry.lines![i]
        return {
          order: ol,
          name: dl?.name ?? ol.name,
          quantity: dl?.quantity ?? ol.quantity,
          unitPrice: dl?.unitPrice ?? 0,
        }
      })
      const validFlags = lines.map((_, i) => dry.lines![i]?.valid !== false)
      const itemsValid = itemsAll.filter((_, i) => validFlags[i])
      const invalidCount = itemsAll.length - itemsValid.length
      const hadCart = cart.lines.length > 0

      // Sin conflicto: repetir directo.
      if (invalidCount === 0 && !hadCart) { commitReorder(locationId, itemsAll); return }
      // Con conflicto (platos caídos o carrito con contenido): confirmar.
      setPrompt({ locationId, itemsAll, itemsValid, invalidCount, hadCart })
    } catch {
      setReorderErr('No se pudo repetir este pedido.')
    } finally {
      setReorderBusy(null)
    }
  }

  function commitReorder(locationId: string, items: ReorderCartItem[]) {
    if (items.length === 0) { setPrompt(null); setReorderErr('Ninguno de estos platos está disponible ahora mismo.'); return }
    replaceCart(locationId, items)
    setPrompt(null)
    onReorder()
  }

  // ── Datos ──────────────────────────────────────────────────────────────
  async function onSaveProfile() {
    if (savingProfile) return
    setSavingProfile(true); setProfileMsg(null)
    const r = await updateProfile(slug, name.trim(), phone.trim())
    setSavingProfile(false)
    if (!r.ok) { setProfileMsg(r.reason === 'phone_taken' ? 'Ese teléfono ya está en uso.' : 'No se pudieron guardar los cambios.'); return }
    setProfileMsg('Datos guardados.')
    setTimeout(() => setProfileMsg(null), 2500)
  }

  async function onToggleConsent(next: boolean) {
    setConsent(next)   // optimista
    const r = await setAccountConsent(slug, next)
    if (!r.ok) setConsent(!next)   // revertir si falla
  }

  async function refreshAddresses() { setAddresses(await getAddresses(slug)) }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <button style={S.back} onClick={onBack}>{'←'} Volver a la tienda</button>
        <h1 style={S.title}>Mi cuenta</h1>
        <div style={{ width: 120 }} aria-hidden />
      </header>

      <div style={S.wrap}>
        {/* Pestañas píldora */}
        <div style={S.tabs}>
          {([['orders', 'Pedidos'], ['bonos', 'Mis bonos'], ['datos', 'Mis datos']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {reorderErr && <div style={S.errBanner}>{reorderErr}</div>}

        {/* ── PEDIDOS ── */}
        {tab === 'orders' && (
          orders === null ? (
            <div style={S.muted}>Cargando tus pedidos…</div>
          ) : orders.length === 0 ? (
            <div style={S.empty}>
              <div style={S.emptyTitle}>Aún no tienes pedidos</div>
              <div style={S.emptySub}>Cuando pidas, aquí podrás repetirlo con un toque.</div>
              <button style={S.emptyCta} onClick={onBack}>Ver la tienda</button>
            </div>
          ) : (
            <div style={S.grid}>
              {orders.map((o) => <OrderCard key={o.saleId} o={o} busy={reorderBusy === o.saleId} onReorder={() => startReorder(o.saleId)} />)}
            </div>
          )
        )}

        {/* ── MIS BONOS (placeholder T1) ── */}
        {tab === 'bonos' && (
          <div style={S.empty}>
            <div style={{ fontSize: 34, marginBottom: 8 }} aria-hidden>{'🎫'}</div>
            <div style={S.emptyTitle}>Tus bonos y recompensas, muy pronto</div>
            <div style={S.emptySub}>Estamos preparando tus bonos, sellos y ofertas del Club en un solo sitio.</div>
          </div>
        )}

        {/* ── MIS DATOS ── */}
        {tab === 'datos' && (
          <div style={S.datosCol}>
            <section style={S.card}>
              <div style={S.cardHead}>Tus datos</div>
              <label style={S.fieldLabel}>Nombre</label>
              <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" autoComplete="name" />
              <label style={S.fieldLabel}>Teléfono</label>
              <input style={S.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Tu teléfono" inputMode="tel" autoComplete="tel" />
              <label style={S.fieldLabel}>Email</label>
              <input style={{ ...S.input, ...S.inputRO }} value={email} readOnly disabled />
              <div style={S.emailNote}>Tu email identifica tu cuenta y no se puede cambiar aquí.</div>
              <div style={S.rowEnd}>
                {profileMsg && <span style={S.profileMsg}>{profileMsg}</span>}
                <button style={{ ...S.btnCoral, ...(savingProfile ? S.btnOff : {}) }} onClick={onSaveProfile} disabled={savingProfile}>
                  {savingProfile ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </section>

            <AddressesCard
              slug={slug}
              addresses={addresses}
              onChanged={refreshAddresses}
            />

            {/* Baja discreta del consentimiento (RGPD 7.3) */}
            <div style={S.consentRow}>
              <span style={S.consentText}>Ofertas del Club por email</span>
              <button
                role="switch"
                aria-checked={consent}
                onClick={() => onToggleConsent(!consent)}
                style={{ ...S.toggle, ...(consent ? S.toggleOn : {}) }}
              >
                <span style={{ ...S.toggleKnob, ...(consent ? S.toggleKnobOn : {}) }} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de confirmación del reorder */}
      {prompt && (
        <div style={S.modalWrap} onClick={() => setPrompt(null)}>
          <div style={S.modalCard} onClick={(e) => e.stopPropagation()}>
            {prompt.invalidCount > 0 ? (
              <>
                <div style={S.modalIconAmber} aria-hidden>{'⚠'}</div>
                <h2 style={S.modalTitle}>{prompt.invalidCount === 1 ? '1 plato ya no está disponible' : `${prompt.invalidCount} platos ya no están disponibles`}</h2>
                <p style={S.modalP}>Podemos repetir el resto de tu pedido con los precios de hoy.</p>
                <button style={S.btnCoral} onClick={() => commitReorder(prompt.locationId, prompt.itemsValid)}>Seguir sin ellos</button>
                <button style={S.btnGhost} onClick={() => setPrompt(null)}>Cancelar</button>
              </>
            ) : (
              <>
                <h2 style={S.modalTitle}>Vaciar tu carrito actual</h2>
                <p style={S.modalP}>Repetir este pedido reemplazará lo que ya tienes en el carrito.</p>
                <button style={S.btnCoral} onClick={() => commitReorder(prompt.locationId, prompt.itemsAll)}>Vaciar y repetir</button>
                <button style={S.btnGhost} onClick={() => setPrompt(null)}>Cancelar</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tarjeta de pedido ──────────────────────────────────────────────────────
function OrderCard({ o, busy, onReorder }: { o: AccountOrder; busy: boolean; onReorder: () => void }) {
  const cancelled = o.orderStatus === 'cancelled' || o.orderStatus === 'canceled'
  return (
    <div style={S.orderCard}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 14px 30px rgba(26,23,20,.1)' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(26,23,20,.05)' }}>
      <div style={S.orderTop}>
        {o.thumbnailUrl
          ? <img src={o.thumbnailUrl} alt="" style={S.thumb} />
          : <div style={S.thumbFallback}>{shortName(o.brands[0]?.name ?? '')}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.brandChips}>
            {o.brands.length > 0 ? o.brands.map((b, i) => (
              b.logoUrl
                ? <img key={i} src={b.logoUrl} alt={b.name} style={S.brandChipImg} />
                : <span key={i} style={{ ...S.brandChip, background: (b.color ? `${b.color}1A` : C.pill), color: b.color || C.ink }}>{shortName(b.name)}</span>
            )) : <span style={{ ...S.brandChip, background: C.pill, color: C.ink }}>Pedido</span>}
          </div>
          <div style={S.orderMeta}>{fmtDate(o.date)}{o.code ? ` · ${o.code}` : ''}</div>
        </div>
        {o.orderStatus && (
          <span style={{ ...S.statusPill, ...(cancelled ? S.statusPillOff : {}) }}>{statusLabel(o.orderStatus)}</span>
        )}
      </div>

      <ul style={S.orderLines}>
        {o.lines.slice(0, 3).map((l, i) => (
          <li key={i} style={S.orderLine}><span style={S.orderQty}>{l.qty}×</span> {l.name}</li>
        ))}
        {o.lines.length > 3 && <li style={S.orderMore}>y {o.lines.length - 3} más…</li>}
      </ul>

      <div style={S.orderFoot}>
        <div style={S.orderTotal}>
          {o.discount > 0 && <span style={S.orderDiscount}>−{eur(o.discount)}</span>}
          <span>{eur(o.total)}</span>
        </div>
        <button style={{ ...S.btnCoral, ...(busy ? S.btnOff : {}) }} onClick={onReorder} disabled={busy}>
          {busy ? 'Preparando…' : 'Repetir pedido'}
        </button>
      </div>
    </div>
  )
}

// ── Tarjeta de direcciones ──────────────────────────────────────────────────
function AddressesCard({ slug, addresses, onChanged }: { slug: string; addresses: CustomerAddress[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<CustomerAddress | 'new' | null>(null)
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [detail, setDetail] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function openNew() { setEditing('new'); setLabel(''); setAddress(''); setDetail(''); setIsDefault(addresses.length === 0); setErr(null) }
  function openEdit(a: CustomerAddress) { setEditing(a); setLabel(a.label ?? ''); setAddress(a.address); setDetail(a.detail ?? ''); setIsDefault(a.isDefault); setErr(null) }
  function close() { setEditing(null); setErr(null) }

  async function save() {
    if (busy) return
    if (!address.trim()) { setErr('Escribe la dirección.'); return }
    setBusy(true); setErr(null)
    const editingRow = editing !== 'new' && editing ? editing : null
    const r = await saveAddress(slug, {
      id: editingRow?.id ?? null,
      label: label.trim() || null,
      address: address.trim(),
      detail: detail.trim() || null,
      lat: editingRow?.lat ?? null,
      lng: editingRow?.lng ?? null,
      isDefault,
    })
    setBusy(false)
    if (!r.ok) { setErr('No se pudo guardar la dirección.'); return }
    close(); onChanged()
  }

  async function remove(a: CustomerAddress) {
    await deleteAddress(slug, a.id)
    onChanged()
  }

  async function makeDefault(a: CustomerAddress) {
    await saveAddress(slug, { id: a.id, label: a.label, address: a.address, detail: a.detail, lat: a.lat, lng: a.lng, isDefault: true })
    onChanged()
  }

  return (
    <section style={S.card}>
      <div style={S.cardHead}>Tus direcciones</div>
      {addresses.length === 0 && editing !== 'new' && (
        <div style={S.addrEmpty}>Aún no has guardado direcciones. Se guardan solas al pedir a domicilio.</div>
      )}
      {addresses.map((a) => (
        <div key={a.id} style={S.addrRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.addrTop}>
              {a.label && <span style={S.addrLabel}>{a.label}</span>}
              {a.isDefault && <span style={S.addrDefault}>Predeterminada</span>}
            </div>
            <div style={S.addrText}>{a.address}</div>
            {a.detail && <div style={S.addrDetail}>{a.detail}</div>}
          </div>
          <div style={S.addrActions}>
            {!a.isDefault && <button style={S.linkBtn} onClick={() => makeDefault(a)}>Predeterminada</button>}
            <button style={S.linkBtn} onClick={() => openEdit(a)}>Editar</button>
            <button style={{ ...S.linkBtn, color: C.red }} onClick={() => remove(a)}>Borrar</button>
          </div>
        </div>
      ))}

      {editing ? (
        <div style={S.addrForm}>
          <input style={S.input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Etiqueta (Casa, Trabajo…)" />
          <input style={S.input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Dirección" />
          <input style={S.input} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Piso, puerta (opcional)" />
          <label style={S.checkRow}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} style={S.checkBox} />
            <span style={S.checkText}>Usar como predeterminada</span>
          </label>
          {err && <div style={S.formErr}>{err}</div>}
          <div style={S.rowEnd}>
            <button style={S.btnGhost} onClick={close}>Cancelar</button>
            <button style={{ ...S.btnCoral, ...(busy ? S.btnOff : {}) }} onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      ) : (
        <button style={S.addrAdd} onClick={openNew}>+ Añadir dirección</button>
      )}
    </section>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: C.page, color: C.ink, fontFamily: 'inherit' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, maxWidth: 900, margin: '0 auto', padding: '18px 22px' },
  back: { background: 'none', border: 'none', color: C.ink, fontSize: 14, fontWeight: 700, cursor: 'pointer', width: 120, textAlign: 'left' },
  title: { fontSize: 20, fontWeight: 900, letterSpacing: '-.02em', margin: 0 },
  wrap: { maxWidth: 900, margin: '0 auto', padding: '0 22px 60px' },

  tabs: { display: 'inline-flex', background: C.pill, borderRadius: 999, padding: 4, marginBottom: 20, gap: 2 },
  tab: { border: 'none', background: 'none', borderRadius: 999, padding: '9px 18px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', color: C.inkDim },
  tabOn: { background: '#fff', color: C.ink, boxShadow: '0 1px 3px rgba(0,0,0,.1)' },

  errBanner: { background: '#FDE7E2', color: C.red, borderRadius: 12, padding: '11px 14px', fontSize: 13.5, fontWeight: 600, marginBottom: 16 },
  muted: { color: C.inkDim, fontSize: 14, padding: '40px 0', textAlign: 'center' },
  empty: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: '48px 28px', textAlign: 'center', boxShadow: '0 2px 10px rgba(26,23,20,.05)' },
  emptyTitle: { fontSize: 18, fontWeight: 900, letterSpacing: '-.01em', marginBottom: 6 },
  emptySub: { fontSize: 14, color: C.inkDim, lineHeight: 1.5, maxWidth: 380, margin: '0 auto' },
  emptyCta: { marginTop: 18, background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 22px', fontWeight: 800, fontSize: 14, cursor: 'pointer' },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 },
  orderCard: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, boxShadow: '0 2px 10px rgba(26,23,20,.05)', transition: 'transform .15s ease, box-shadow .15s ease', display: 'flex', flexDirection: 'column' },
  orderTop: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  thumb: { width: 46, height: 46, borderRadius: 14, objectFit: 'cover', flexShrink: 0, display: 'block' },
  thumbFallback: { width: 46, height: 46, borderRadius: 14, background: C.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: C.inkDim, flexShrink: 0 },
  brandChips: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  brandChip: { fontSize: 11, fontWeight: 800, letterSpacing: '.02em', padding: '3px 9px', borderRadius: 999 },
  brandChipImg: { height: 20, width: 'auto', maxWidth: 74, objectFit: 'contain', display: 'block' },
  orderMeta: { fontSize: 12.5, color: C.inkFaint, marginTop: 4, fontWeight: 600 },
  statusPill: { fontSize: 11.5, fontWeight: 800, color: C.greenDeep, background: C.greenBg, borderRadius: 999, padding: '4px 10px', flexShrink: 0, whiteSpace: 'nowrap' },
  statusPillOff: { color: C.inkDim, background: C.pill },
  orderLines: { listStyle: 'none', margin: '0 0 14px', padding: 0, flex: 1 },
  orderLine: { fontSize: 13.5, color: C.ink, lineHeight: 1.6 },
  orderQty: { fontWeight: 800, color: C.inkDim },
  orderMore: { fontSize: 12.5, color: C.inkFaint, marginTop: 2 },
  orderFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: `1px solid ${C.line}`, paddingTop: 12 },
  orderTotal: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 17, fontWeight: 900, letterSpacing: '-.01em' },
  orderDiscount: { fontSize: 12.5, fontWeight: 700, color: C.green },

  datosCol: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 },
  card: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, boxShadow: '0 2px 10px rgba(26,23,20,.05)' },
  cardHead: { fontSize: 16, fontWeight: 900, letterSpacing: '-.01em', marginBottom: 14 },
  fieldLabel: { display: 'block', fontSize: 12, fontWeight: 700, color: C.inkDim, margin: '10px 0 5px' },
  input: { width: '100%', border: `1.5px solid ${C.line}`, borderRadius: 12, padding: '11px 14px', fontSize: 14.5, color: C.ink, background: '#fff', boxSizing: 'border-box' },
  inputRO: { background: '#F5F3EF', color: C.inkDim },
  emailNote: { fontSize: 11.5, color: C.inkFaint, marginTop: 6 },
  rowEnd: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
  profileMsg: { fontSize: 13, fontWeight: 700, color: C.green },

  addrEmpty: { fontSize: 13, color: C.inkDim, lineHeight: 1.5, marginBottom: 12 },
  addrRow: { display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderTop: `1px solid ${C.line}` },
  addrTop: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 },
  addrLabel: { fontSize: 13.5, fontWeight: 800, color: C.ink },
  addrDefault: { fontSize: 10.5, fontWeight: 800, color: C.greenDeep, background: C.greenBg, borderRadius: 999, padding: '2px 8px' },
  addrText: { fontSize: 13.5, color: C.ink, lineHeight: 1.4 },
  addrDetail: { fontSize: 12.5, color: C.inkDim, marginTop: 2 },
  addrActions: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  linkBtn: { background: 'none', border: 'none', padding: 0, color: C.inkDim, fontSize: 12.5, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' },
  addrForm: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 14 },
  addrAdd: { marginTop: 14, background: 'none', border: `1.5px dashed ${C.line}`, borderRadius: 12, padding: '11px', width: '100%', fontSize: 13.5, fontWeight: 800, color: C.ink, cursor: 'pointer' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' },
  checkBox: { width: 17, height: 17, accentColor: C.accent, cursor: 'pointer' },
  checkText: { fontSize: 13, color: C.inkDim },
  formErr: { fontSize: 12.5, color: C.red, fontWeight: 600 },

  consentRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 4px' },
  consentText: { fontSize: 12, color: C.inkFaint },
  toggle: { width: 42, height: 24, borderRadius: 999, border: 'none', background: '#D6D2CA', cursor: 'pointer', padding: 3, display: 'inline-flex', alignItems: 'center', transition: 'background .15s ease' },
  toggleOn: { background: C.green },
  toggleKnob: { width: 18, height: 18, borderRadius: '50%', background: '#fff', display: 'block', transform: 'translateX(0)', transition: 'transform .15s ease', boxShadow: '0 1px 3px rgba(0,0,0,.2)' },
  toggleKnobOn: { transform: 'translateX(18px)' },

  btnCoral: { background: C.accent, color: '#fff', border: 'none', borderRadius: 999, padding: '10px 18px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', flexShrink: 0 },
  btnGhost: { background: 'none', border: `1.5px solid ${C.line}`, color: C.ink, borderRadius: 999, padding: '10px 18px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' },
  btnOff: { background: '#C9C5BD', cursor: 'default' },

  modalWrap: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(20,14,10,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { background: '#fff', borderRadius: 18, maxWidth: 380, width: '100%', padding: '26px 24px', boxShadow: '0 24px 60px rgba(0,0,0,.3)', textAlign: 'center' },
  modalIconAmber: { width: 52, height: 52, borderRadius: '50%', background: C.amberBg, border: `2px solid ${C.amberLine}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 12px' },
  modalTitle: { fontSize: 18, fontWeight: 900, letterSpacing: '-.02em', margin: '0 0 8px' },
  modalP: { fontSize: 13.5, color: C.inkDim, lineHeight: 1.5, margin: '0 0 18px' },
}
