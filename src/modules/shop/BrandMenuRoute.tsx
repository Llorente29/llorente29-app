import { useEffect, useState } from 'react'
import { getBrandMenu, type BrandMenu } from '@/modules/shop/services/brandMenuService'

const C = {
  bg: '#FBF7F0', surface: '#FFFFFF', ink: '#1A1714', inkDim: '#7A726A', line: '#ECE5DA',
  accent: '#FF5436', accent2: '#FFB400', accentBg: '#EDECE6', coralBg: '#FFE9E3',
  green: '#1FA85B', greenBg: '#E3F6EC', star: '#FF9F0A', tagBg: '#F3EFE8',
  amber: '#7A5A12', amberBg: '#FFF3D6', amberLine: '#F2DCA0',
}

function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

function Star({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
      <path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z" />
    </svg>
  )
}

export default function BrandMenuRoute({ slug, brandId, onBack }: { slug: string; brandId: string; onBack: () => void }) {
  const [menu, setMenu] = useState<BrandMenu | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setStatus('loading')
    getBrandMenu(slug, brandId)
      .then(res => {
        if (!alive) return
        if (!res) { setStatus('notfound'); return }
        setMenu(res); setStatus('ready')
      })
      .catch(e => { if (alive) { setError(e instanceof Error ? e.message : 'Error'); setStatus('error') } })
    return () => { alive = false }
  }, [slug, brandId])

  if (status === 'loading') {
    return <div style={S.page}><div style={S.center}>Cargando carta…</div></div>
  }
  if (status === 'notfound') {
    return (
      <div style={S.page}>
        <div style={S.center}>
          <p style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Carta no disponible</p>
          <button style={S.backBtn} onClick={onBack}>← Volver a la tienda</button>
        </div>
      </div>
    )
  }
  if (status === 'error' || !menu) {
    return (
      <div style={S.page}>
        <div style={S.center}>
          <p style={{ color: C.accent, marginBottom: 8 }}>{error ?? 'Error cargando la carta'}</p>
          <button style={S.backBtn} onClick={onBack}>← Volver a la tienda</button>
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      {/* Topbar */}
      <div style={S.topbar}>
        <button style={S.backLink} onClick={onBack}>← Tienda</button>
        <div style={S.preTag}>Vista previa</div>
      </div>

      {/* Banner pre-lanzamiento */}
      <div style={S.preBanner}>
        Estás viendo una vista previa de la carta. Aún no puedes hacer pedidos online.
      </div>

      {/* Banner: marca cerrada ahora (por horario) */}
      {!menu.isOpen && (
        <div style={S.closedBanner}>
          🌙 <strong>Cerrado ahora.</strong> Esta marca no está operando en este momento. Puedes ver la carta, pero no aceptará pedidos hasta que vuelva a abrir.
        </div>
      )}

      {/* Cabecera de marca */}
      <div style={S.brandHead}>
        {menu.logoUrl
          ? <img src={menu.logoUrl} alt={menu.name} style={S.brandLogo} />
          : <div style={{ ...S.brandLogo, ...S.brandLogoText }}>{menu.name.slice(0, 2).toUpperCase()}</div>}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={S.brandName}>{menu.name}</h1>
            <span style={menu.isOpen ? S.openPill : S.closedPill}>
              {menu.isOpen ? 'Abierto ahora' : 'Cerrado ahora'}
            </span>
          </div>
          {menu.rating != null && (
            <div style={S.brandMeta}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.star, fontWeight: 800 }}>
                <Star size={15} /> {menu.rating.toFixed(1)}
                {menu.ratingCount != null && <span style={{ color: C.inkDim, fontWeight: 600 }}>({menu.ratingCount})</span>}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Categorías */}
      <div style={S.menuWrap}>
        {menu.categories.length === 0 && (
          <div style={S.center}>Esta marca aún no tiene platos disponibles.</div>
        )}
        {menu.categories.map(cat => (
          <section key={cat.id} style={{ marginBottom: 30 }}>
            <h2 style={S.catTitle}>{cat.emoji ? `${cat.emoji} ` : ''}{cat.name}</h2>
            <div style={S.dishGrid}>
              {cat.products.map(d => (
                <div key={d.id} style={S.dish}>
                  {d.photoUrl
                    ? <div style={{ ...S.dishPhoto, background: `center/cover no-repeat url(${d.photoUrl})` }} />
                    : <div style={{ ...S.dishPhoto, background: C.accentBg }} />}
                  <div style={S.dishBody}>
                    <div style={S.dishTop}>
                      <span style={S.dishName}>{d.name}</span>
                      {d.productType === 'combo' && <span style={S.comboChip}>combo</span>}
                    </div>
                    {d.description && <p style={S.dishDesc}>{d.description}</p>}
                    <div style={S.dishFoot}>
                      <span style={S.dishPrice}>{eur(d.price)}</span>
                      <button style={S.addBtn} disabled title="Aún no puedes pedir">Añadir</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div style={S.footer}>Pedidos con <strong style={{ color: C.accent }}>Folvy</strong></div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: 'inherit' },
  center: { padding: '80px 28px', textAlign: 'center', color: C.inkDim, fontSize: 15 },
  topbar: { position: 'sticky', top: 0, zIndex: 50, background: 'rgba(251,247,240,.92)', backdropFilter: 'blur(10px)', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: '13px 28px' },
  backLink: { background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 15, color: C.ink, padding: 0 },
  preTag: { fontSize: 12, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: C.amber, background: C.amberBg, border: `1px solid ${C.amberLine}`, padding: '6px 12px', borderRadius: 30 },
  preBanner: { margin: '14px 28px 0', padding: '11px 16px', background: C.amberBg, border: `1px solid ${C.amberLine}`, borderRadius: 12, fontSize: 13.5, color: C.amber, fontWeight: 600 },
  closedBanner: { margin: '10px 28px 0', padding: '11px 16px', background: '#EFEDEA', border: `1px solid ${C.line}`, borderRadius: 12, fontSize: 13.5, color: C.ink, fontWeight: 600 },
  openPill: { fontSize: 12.5, fontWeight: 800, color: C.green, background: C.greenBg, padding: '4px 11px', borderRadius: 999 },
  closedPill: { fontSize: 12.5, fontWeight: 800, color: '#fff', background: '#6B6661', padding: '4px 11px', borderRadius: 999 },
  brandHead: { display: 'flex', alignItems: 'center', gap: 18, margin: '22px 28px 0' },
  brandLogo: { height: 72, width: 'auto', maxWidth: 160, objectFit: 'contain', display: 'block', borderRadius: 16, background: '#fff', boxShadow: '0 3px 12px rgba(0,0,0,.12)', padding: 6, boxSizing: 'border-box' },
  brandLogoText: { width: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 24, color: C.ink },
  brandName: { fontSize: 32, fontWeight: 900, letterSpacing: '-.03em', marginBottom: 4 },
  brandMeta: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 },
  menuWrap: { maxWidth: 1180, margin: '0 auto', padding: '28px' },
  catTitle: { fontSize: 22, fontWeight: 900, letterSpacing: '-.02em', marginBottom: 14 },
  dishGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  dish: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  dishPhoto: { height: 150, width: '100%' },
  dishBody: { padding: '13px 15px 15px', display: 'flex', flexDirection: 'column', flex: 1 },
  dishTop: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 },
  dishName: { fontWeight: 800, fontSize: 16, letterSpacing: '-.01em' },
  comboChip: { fontSize: 11, fontWeight: 800, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberLine}`, padding: '2px 8px', borderRadius: 20 },
  dishDesc: { fontSize: 13, color: C.inkDim, lineHeight: 1.4, marginBottom: 12, flex: 1 },
  dishFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' },
  dishPrice: { fontWeight: 900, fontSize: 16 },
  addBtn: { background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontWeight: 800, fontSize: 14, cursor: 'not-allowed', opacity: .45 },
  footer: { textAlign: 'center', padding: '26px', fontSize: 13, color: C.inkDim },
  backBtn: { background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer' },
}
