import { useEffect, useMemo, useState } from 'react'
import { getShopHub, type ShopHub, type HubBrand, type TopDish } from '@/modules/shop/services/shopHubService'
import BrandMenuRoute from '@/modules/shop/BrandMenuRoute'
import { ShopCartProvider } from '@/modules/shop/cart/ShopCartContext'
import CartPanel from '@/modules/shop/cart/CartPanel'
import CheckoutRoute from '@/modules/shop/checkout/CheckoutRoute'

function getSlugFromPath(): string | null {
  const m = window.location.pathname.match(/^\/t\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function getBrandIdFromPath(): string | null {
  const m = window.location.pathname.match(/^\/t\/[^/]+\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : null
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

  // Botón atrás/adelante del navegador → re-leer el brandId de la URL
  useEffect(() => {
    const onPop = () => setBrandId(getBrandIdFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function openBrand(id: string) {
    window.history.pushState({}, '', `/t/${slug}/${id}`)
    setBrandId(id)
    window.scrollTo(0, 0)
  }
  function backToHub() {
    window.history.pushState({}, '', `/t/${slug}`)
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
        <span style={S.preTag}>Vista previa</span>
      </div>

      {/* 2 · BANNER PRE-LANZAMIENTO (honesto, visible) */}
      <div style={S.preBanner}>
        <span style={S.preIc}><Icon d={Ic.info} size={16} /></span>
        <span>Estás viendo una <b>vista previa</b> de la tienda. Aún no puedes hacer pedidos online.</span>
      </div>

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

        {/* 6 · PANEL lateral: pre-lanzamiento (sustituye al carrito, que no opera todavía) */}
        <aside style={S.side}>
          <div style={S.sideHead}>
            <span style={S.sideBag}><Icon d={Ic.bag} size={24} /></span>
            <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-.02em' }}>Pedidos online muy pronto</div>
          </div>
          <p style={S.sideP}>
            Estamos preparando la tienda. Pronto podrás pedir de varias cocinas a la vez
            y recibirlo todo en una sola entrega.
          </p>
          <div style={S.sideFeat}>
            <span style={S.sideFeatIc}><Icon d={Ic.package} size={18} /></span>
            <div>
              <b style={{ display: 'block', fontSize: 14, fontWeight: 800 }}>Carrito cruzado</b>
              <span style={{ fontSize: 12.5, color: C.inkDim }}>Mezcla marcas, un solo envío</span>
            </div>
          </div>
        </aside>
      </div>

      {/* 7 · FOOTER */}
      <footer style={S.footer}>
        Pedidos con <a href="https://folvy.app" style={{ color: C.accent, textDecoration: 'none', fontWeight: 700 }}>Folvy</a>
      </footer>
    </div>
  )
}

// Wrapper: lee el slug y envuelve el Shop con el carrito (persiste entre Hub y carta).
export default function ShopHubRoute() {
  const [slug] = useState<string | null>(getSlugFromPath())
  const [checkout, setCheckout] = useState(false)
  if (!slug) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: C.inkDim }}>Tienda no encontrada</div>
  }
  const goToCheckout = () => { window.scrollTo(0, 0); setCheckout(true) }
  return (
    <ShopCartProvider slug={slug}>
      {checkout
        ? <CheckoutRoute slug={slug} onBack={() => setCheckout(false)} />
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
