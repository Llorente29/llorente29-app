import { useEffect, useState } from 'react'
import { getShopHub, type ShopHub, type HubBrand } from '@/modules/shop/services/shopHubService'

function getSlugFromPath(): string | null {
  const m = window.location.pathname.match(/^\/t\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

// Iconos SVG inline (sin librería externa).
const Ic = {
  bike: 'M18.5 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5.5 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM15 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM12 17.5V14l-3-3 4-3 2 3h2',
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  package: 'M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7l8.7 5 8.7-5M12 22V12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  chevron: 'm6 9 6 6 6-6',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0',
  heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z',
  trending: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
  flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z',
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

// ── Datos de muestra (se conectarán a datos reales después) ──
const CATS = ['Burgers', 'Mexicano', 'Kebab & Pita', 'Pollo', 'Pizza', 'Sándwiches', 'Milanesas']
const POPULAR = [
  { name: 'Doble Smash con bacon', brand: 'Scandal Burgers', price: 9.90 },
  { name: 'Kebab mixto XL', brand: 'The Urban Kebab', price: 8.50 },
  { name: 'Alitas coreanas', brand: 'Koreans', price: 7.90 },
  { name: 'Burrito de birria', brand: 'Birria Burrito', price: 10.50 },
  { name: 'Pizza pepperoni', brand: 'Deep Pizza', price: 11.90 },
  { name: 'Milanesa napolitana', brand: 'Milanesa House', price: 12.50 },
]

function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

function shortName(name: string): string {
  return name.split(/[\s·-]/)[0].slice(0, 8).toUpperCase()
}

// Valoración de muestra estable por marca (4,4–4,9) cuando la real es null.
function sampleRating(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return 4.4 + (h % 6) / 10
}

// Categoría de muestra asignada por el nombre de la marca.
function categoryFor(name: string): string {
  const n = name.toLowerCase()
  if (/burger|smash/.test(n)) return 'Burgers · Smash'
  if (/kebab|pita|döner|doner/.test(n)) return 'Kebab · Pita'
  if (/pizza/.test(n)) return 'Pizza · Horno'
  if (/pollo|wings|alit|chicken|korean/.test(n)) return 'Pollo · Alitas'
  if (/taco|burrito|mex|birria/.test(n)) return 'Mexicano'
  if (/milanesa/.test(n)) return 'Milanesas'
  if (/s[áa]ndw|sandwich|bocata/.test(n)) return 'Sándwiches'
  return 'Cocina urbana'
}

export default function ShopHubRoute() {
  const [slug] = useState<string | null>(getSlugFromPath())
  const [hub, setHub] = useState<ShopHub | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) { setStatus('notfound'); return }
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
  }, [slug])

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

  const di = hub.deliveryInfo
  const tagline = hub.tagline || 'Mézclalo todo. Una sola entrega.'
  const dot = tagline.indexOf('.')
  const taglineA = dot > 0 ? tagline.slice(0, dot + 1) : tagline
  const taglineB = dot > 0 ? tagline.slice(dot + 1).trim() : ''

  const etaLabel = di.etaMin != null ? `${di.etaMin}-${di.etaMin + 10} min` : '25-35 min'
  const shipFee = di.deliveryFeeMin != null ? di.deliveryFeeMin : 3.99

  // Foto para las tarjetas mini de "lo más pedido": reusa hero de marcas o placeholder.
  const photoForPopular = (i: number): string | null =>
    hub.brands.length ? (hub.brands[i % hub.brands.length].heroUrl ?? null) : null

  return (
    <div style={S.page}>
      {/* 1 · TOP BAR */}
      <div style={S.topbar}>
        <div style={S.logo}><span style={S.logoDot} />{hub.accountName}</div>
        <div style={S.addr}>
          <span style={S.pill}><Icon d={Ic.bike} size={16} /> Entrega <Icon d={Ic.chevron} size={14} /></span>
          <span style={S.pill}><Icon d={Ic.pin} size={16} /> <b>Tu dirección</b> <Icon d={Ic.chevron} size={14} /></span>
        </div>
        <div style={S.navActions}>
          <span style={{ ...S.navBtn, color: C.inkDim }}><Icon d={Ic.search} size={16} /> Buscar</span>
          <span style={{ ...S.navBtn, background: C.ink, color: '#fff' }}>Entrar</span>
        </div>
      </div>

      {/* 2 · HERO */}
      <div style={{
        ...S.hero,
        background: hub.heroUrl
          ? `linear-gradient(90deg,rgba(20,14,10,.86) 0%,rgba(20,14,10,.6) 42%,rgba(20,14,10,.2) 100%), center/cover no-repeat url(${hub.heroUrl})`
          : C.accent,
      }}>
        <div style={S.heroCopy}>
          <span style={S.eyebrow}><Star size={13} /> {hub.brands.length} cocinas bajo un mismo techo</span>
          <h1 style={S.h1}>
            {taglineA}
            {taglineB && <><br /><span style={S.hl}>{taglineB}</span></>}
          </h1>
          <p style={S.heroP}>Pide de varias cocinas a la vez y te llega junto y calentito, en una sola entrega.</p>
        </div>
      </div>

      {/* 3 · TRUST STRIP */}
      <div style={S.strip}>
        <StripItem icon={Ic.bike} b={etaLabel} s="entrega media" />
        <StripItem icon={Ic.clock} b="4,7 / 5" s="+2.300 valoraciones" star />
        <StripItem icon={Ic.package} b="Carrito cruzado" s="mezcla marcas, un envío" />
        <StripItem icon={Ic.pin} b="Reparto en 4 km" s="Retiro y alrededores" />
      </div>

      {/* 4 · LAYOUT 2 columnas */}
      <div style={S.wrap}>
        {/* 5 · MAIN */}
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          {/* a) CHIPS de categoría */}
          <div style={S.chips}>
            <span style={{ ...S.chip, ...S.chipActive }}><Icon d={Ic.flame} size={15} fill="currentColor" /> Todo</span>
            {CATS.map(c => <span key={c} style={S.chip}>{c}</span>)}
          </div>

          {/* b) LO MÁS PEDIDO HOY */}
          <div style={{ ...S.secHead, marginTop: 26 }}>
            <h2 style={{ ...S.h2, display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ color: C.accent }}><Icon d={Ic.trending} size={22} /></span> Lo más pedido hoy
            </h2>
          </div>
          <div style={S.popRow}>
            {POPULAR.map((p, i) => {
              const photo = photoForPopular(i)
              return (
                <div key={p.name} style={S.miniCard}>
                  <div style={{ ...S.miniPh, background: photo ? `center/cover no-repeat url(${photo})` : C.accentBg }}>
                    <span style={S.miniPrice}>{eur(p.price)}</span>
                  </div>
                  <div style={{ padding: '10px 12px 12px' }}>
                    <div style={S.miniName}>{p.name}</div>
                    <div style={S.miniBrand}>{p.brand}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* c) TODAS LAS COCINAS */}
          <div style={{ ...S.secHead, marginTop: 30 }}>
            <h2 style={S.h2}>Todas las cocinas</h2>
            <span style={{ fontSize: 14, color: C.green, fontWeight: 700 }}>{hub.brands.length} abiertas ahora</span>
          </div>

          {hub.brands.length === 0 ? (
            <div style={S.emptyBrands}>Esta tienda aún no tiene cocinas disponibles.</div>
          ) : (
            <div style={S.grid}>
              {hub.brands.map((b, i) => <BrandCard key={b.brandId} b={b} i={i} slug={hub.slug} etaLabel={etaLabel} />)}
            </div>
          )}
        </div>

        {/* 6 · CART lateral */}
        <aside style={S.cart}>
          <div style={S.cartHead}>
            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-.02em' }}>Tu pedido</div>
            <div style={{ fontSize: 12.5, color: C.inkDim, marginTop: 2 }}>Pedido mínimo 15,00 €</div>
          </div>
          <div style={S.cartEmpty}>
            <span style={S.cartBag}><Icon d={Ic.bag} size={26} /></span>
            <p style={{ fontSize: 13.5, color: C.inkDim, lineHeight: 1.45, margin: 0 }}>
              Aún no has añadido nada.<br />Empieza por cualquier cocina.
            </p>
          </div>
          <div style={S.promoRow}>
            <input placeholder="Código promocional" style={S.promoInput} />
            <span style={S.promoBtn}>Aplicar</span>
          </div>
          <div style={S.totals}>
            <Row k="Subtotal" v={eur(0)} />
            <Row k="Envío" v={eur(shipFee)} />
            <div style={S.totalLine}>
              <span>Total</span><span>{eur(0)}</span>
            </div>
          </div>
          <span style={S.confirm}>Confirmar pedido <Icon d={Ic.arrow} size={17} /></span>
        </aside>
      </div>

      {/* 7 · FOOTER */}
      <footer style={S.footer}>
        Pedidos con <a href="https://folvy.app" style={{ color: C.accent, textDecoration: 'none', fontWeight: 700 }}>Folvy</a>
      </footer>
    </div>
  )
}

function BrandCard({ b, i, slug, etaLabel }: { b: HubBrand; i: number; slug: string; etaLabel: string }) {
  const rating = b.rating != null ? b.rating : sampleRating(b.name)
  const free = i % 3 === 0
  return (
    <a href={`/t/${slug}/${b.brandId}`} style={S.card}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 14px 30px rgba(26,23,20,.1)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}>
      <div style={{ ...S.cardPh, background: b.heroUrl ? `center/cover no-repeat url(${b.heroUrl})` : (b.accentColor || C.accentBg) }}>
        <div style={S.logoChip}>
          {b.logoUrl
            ? <img src={b.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : <span style={{ fontWeight: 900, fontSize: 13, letterSpacing: '-.03em', color: b.accentColor || C.ink }}>{shortName(b.name)}</span>}
        </div>
        <span style={S.fav}><Icon d={Ic.heart} size={16} /></span>
        <div style={S.badges}>
          <span style={S.badge}><Icon d={Ic.clock} size={13} /> {etaLabel.replace(' min', "'")}</span>
          {free && <span style={{ ...S.badge, ...S.badgeFree }}><Icon d={Ic.bike} size={13} /> Gratis</span>}
        </div>
      </div>
      <div style={{ padding: '15px 16px 17px' }}>
        <div style={S.cardName}>{b.name}</div>
        <div style={S.cardMeta}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.star, fontWeight: 800 }}>
            <Star size={14} /> {rating.toFixed(1)}
            {b.ratingCount != null && <span style={{ color: C.inkDim, fontWeight: 600 }}>({b.ratingCount})</span>}
          </span>
          <span style={{ color: C.inkDim }}>·</span>
          <span style={{ color: C.inkDim }}>{categoryFor(b.name)}</span>
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
          <span style={S.tag}>Popular</span>
          <span style={S.tag}>Top ventas</span>
        </div>
      </div>
    </a>
  )
}

function StripItem({ icon, b, s, star }: { icon: string; b: string; s: string; star?: boolean }) {
  return (
    <div style={S.stripItem}>
      <span style={S.stripIc}>{star ? <Star size={20} /> : <Icon d={icon} size={20} />}</span>
      <div><b style={{ display: 'block', fontSize: 15, fontWeight: 800 }}>{b}</b><span style={{ fontSize: 12.5, color: C.inkDim }}>{s}</span></div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: C.inkDim, padding: '4px 0' }}>
      <span>{k}</span><span style={{ color: C.ink, fontWeight: 600 }}>{v}</span>
    </div>
  )
}

const C = {
  bg: '#FBF7F0', surface: '#FFFFFF', ink: '#1A1714', inkDim: '#7A726A', line: '#ECE5DA',
  accent: '#FF5436', accent2: '#FFB400', accentBg: '#EDECE6', coralBg: '#FFE9E3',
  green: '#1FA85B', greenBg: '#E3F6EC', star: '#FF9F0A', tagBg: '#F3EFE8',
}
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: 'inherit' },
  topbar: { position: 'sticky', top: 0, zIndex: 50, background: 'rgba(251,247,240,.92)', backdropFilter: 'blur(10px)', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 20, padding: '13px 28px' },
  logo: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 900, fontSize: 20, letterSpacing: '-.03em' },
  logoDot: { width: 11, height: 11, borderRadius: '50%', background: C.accent },
  addr: { flex: 1, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', fontSize: 14, flexWrap: 'wrap' },
  pill: { display: 'inline-flex', alignItems: 'center', gap: 8, background: C.surface, border: `1.5px solid ${C.line}`, padding: '9px 15px', borderRadius: 30, cursor: 'pointer', fontWeight: 600 },
  navActions: { display: 'flex', alignItems: 'center', gap: 10 },
  navBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700, padding: '9px 16px', borderRadius: 30, cursor: 'pointer' },
  hero: { margin: '24px 28px 0', borderRadius: 26, overflow: 'hidden', position: 'relative', minHeight: 330, display: 'flex', alignItems: 'center' },
  heroCopy: { padding: '46px 52px', maxWidth: 600, zIndex: 2, color: '#fff' },
  eyebrow: { display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(4px)', alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 30, fontWeight: 800, fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 18 },
  h1: { fontSize: 46, lineHeight: 1.02, letterSpacing: '-.035em', fontWeight: 900, marginBottom: 14 },
  hl: { background: C.accent2, color: C.ink, padding: '0 10px', borderRadius: 8, display: 'inline-block', transform: 'rotate(-1.5deg)' },
  heroP: { fontSize: 17, maxWidth: 440, lineHeight: 1.5, opacity: .96 },
  strip: { display: 'flex', flexWrap: 'wrap', margin: '0 28px', background: C.surface, border: `1px solid ${C.line}`, borderTop: 'none', borderRadius: '0 0 18px 18px', overflow: 'hidden' },
  stripItem: { flex: '1 1 200px', padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 13, borderRight: `1px solid ${C.line}` },
  stripIc: { width: 38, height: 38, borderRadius: 11, background: C.coralBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: C.accent },
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
  cardPh: { position: 'relative', height: 168 },
  fav: { position: 'absolute', right: 12, top: 12, width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ink, boxShadow: '0 2px 8px rgba(0,0,0,.14)' },
  badges: { position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 8 },
  badge: { display: 'flex', alignItems: 'center', gap: 5, background: '#fff', color: C.ink, fontSize: 12, fontWeight: 800, padding: '6px 11px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,.12)' },
  badgeFree: { background: C.green, color: '#fff', boxShadow: '0 2px 8px rgba(31,168,91,.3)' },
  logoChip: { position: 'absolute', left: 12, top: 12, height: 46, width: 72, padding: '6px 10px', borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxSizing: 'border-box', boxShadow: '0 2px 8px rgba(0,0,0,.14)' },
  cardName: { fontSize: 18, fontWeight: 800, letterSpacing: '-.01em', marginBottom: 6 },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.inkDim, fontWeight: 600 },
  tag: { fontSize: 11.5, fontWeight: 700, color: C.inkDim, background: C.tagBg, padding: '4px 10px', borderRadius: 20 },
  emptyBrands: { border: `1px dashed ${C.line}`, borderRadius: 16, padding: 48, textAlign: 'center', color: C.inkDim },
  cart: { flex: '0 0 380px', width: 380, position: 'sticky', top: 86, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: 26, alignSelf: 'flex-start' },
  cartHead: { borderBottom: `1px solid ${C.line}`, paddingBottom: 14, marginBottom: 14 },
  cartEmpty: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, padding: '18px 0 22px' },
  cartBag: { width: 56, height: 56, borderRadius: '50%', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.inkDim },
  promoRow: { display: 'flex', gap: 8, marginBottom: 16 },
  promoInput: { flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.bg, fontSize: 13.5, boxSizing: 'border-box' },
  promoBtn: { display: 'inline-flex', alignItems: 'center', background: C.ink, color: '#fff', fontSize: 13.5, fontWeight: 700, padding: '0 16px', borderRadius: 10, cursor: 'pointer' },
  totals: { borderTop: `1px solid ${C.line}`, paddingTop: 12, marginBottom: 16 },
  totalLine: { display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 900, marginTop: 6 },
  confirm: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: C.accent, color: '#fff', fontSize: 15, fontWeight: 800, padding: '13px 0', borderRadius: 13, cursor: 'pointer' },
  footer: { maxWidth: 1080, margin: '0 auto', padding: '0 24px 32px', color: C.inkDim, fontSize: 12, textAlign: 'center' },
}
