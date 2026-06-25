// src/modules/shop/components/StorefrontPreview.tsx
//
// Preview en vivo del escaparate de una marca, dentro del Asistente.
// Pinta la tienda REAL: logo + acento de la marca (brand) y su carta real
// (menu_category + menu_item con fotos) leída con el MISMO service que la
// Carta de Kitchen (listCategoriesWithProducts). Reacciona al vuelo a los
// mandos del tema (plantilla, acento, tipografía, modo) sin guardar nada:
// recibe el tema por props (estado optimista de la página).
//
// No es el storefront público final (eso es un canal aparte); es una maqueta
// fiel "tamaño móvil" para que el dueño vea su tienda mientras la diseña.
import { useEffect, useState } from 'react'
import { listCategoriesWithProducts, type CatalogCategory } from '@/modules/kitchen/services/brandCatalogService'
import type { ShopTemplate, ShopFont, ShopMode } from '@/modules/shop/services/shopThemeService'

type PreviewTheme = {
  template: ShopTemplate
  accent: string            // ya resuelto (accent_color ?? brand.color ?? fallback)
  font: ShopFont
  mode: ShopMode
}
type BrandRef = { name: string; logo_url: string | null }

const FONT_STACK: Record<ShopFont, string> = {
  fraunces: '"Fraunces", Georgia, serif',
  grotesk: '"Space Grotesk", system-ui, sans-serif',
  editorial: '"Playfair Display", Georgia, serif',
}

function eur(v: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}

// Paleta del lienzo según modo (auto = claro en esta maqueta).
function surface(mode: ShopMode) {
  const dark = mode === 'dark'
  return {
    bg: dark ? '#15171a' : '#ffffff',
    card: dark ? '#1e2125' : '#ffffff',
    text: dark ? '#f2f1ee' : '#1a1a1a',
    muted: dark ? '#9a9a96' : '#888888',
    line: dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.08)',
  }
}

export default function StorefrontPreview({ accountId, brandId, brand, theme }: {
  accountId: string
  brandId: string
  brand: BrandRef
  theme: PreviewTheme
}) {
  const [cats, setCats] = useState<CatalogCategory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listCategoriesWithProducts(accountId, brandId)
      .then(c => { if (!cancelled) setCats(c) })
      .catch(() => { if (!cancelled) setCats([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, brandId])

  const s = surface(theme.mode)
  const font = FONT_STACK[theme.font]
  const radius = theme.template === 'minimal' ? 4 : theme.template === 'escaparate' ? 16 : 10
  const heroH = theme.template === 'escaparate' ? 116 : theme.template === 'minimal' ? 64 : 92

  return (
    <div style={{ position: 'sticky', top: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted,#888)', marginBottom: 8, textAlign: 'center' }}>
        Vista previa
      </div>
      {/* Marco de móvil */}
      <div style={{ width: 300, margin: '0 auto', border: '8px solid #111', borderRadius: 32, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,.18)', background: s.bg }}>
        <div style={{ height: 520, overflowY: 'auto', fontFamily: font, color: s.text, background: s.bg }}>
          {/* Hero */}
          <div style={{ background: theme.accent, height: heroH, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {brand.logo_url
              ? <img src={brand.logo_url} alt="" style={{ maxHeight: heroH - 36, maxWidth: '70%', objectFit: 'contain' }} />
              : <span style={{ color: '#fff', fontSize: 22, fontWeight: 600 }}>{brand.name}</span>}
          </div>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: theme.template === 'minimal' ? 16 : 19, fontWeight: 600, marginBottom: 2 }}>{brand.name}</div>
            <div style={{ fontSize: 12, color: s.muted, marginBottom: 14 }}>Abierto · entrega 25-35 min</div>

            {loading && <div style={{ fontSize: 13, color: s.muted, padding: '20px 0' }}>Cargando la carta…</div>}

            {!loading && cats.length === 0 && (
              <div style={{ fontSize: 13, color: s.muted, padding: '20px 0' }}>Esta marca aún no tiene carta.</div>
            )}

            {cats.map(cat => (
              <div key={cat.id} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, paddingBottom: 4, borderBottom: `0.5px solid ${s.line}` }}>
                  {cat.emoji ? `${cat.emoji} ` : ''}{cat.name}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {cat.products.slice(0, 6).map(p => (
                    <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', opacity: p.isAvailable ? 1 : 0.45 }}>
                      <div style={{ width: 52, height: 52, borderRadius: radius, background: theme.mode === 'dark' ? '#2a2d31' : '#f1efe8', overflow: 'hidden', flex: '0 0 auto' }}>
                        {p.photoUrl && <img src={p.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2 }}>{p.name}</div>
                        {p.description && (
                          <div style={{ fontSize: 11, color: s.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{p.description}</div>
                        )}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: theme.accent, flex: '0 0 auto' }}>{eur(p.price)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Botón ficticio de pedido, con el acento */}
            {!loading && cats.length > 0 && (
              <button style={{ width: '100%', marginTop: 4, background: theme.accent, color: '#fff', border: 'none', borderRadius: radius, padding: '11px 0', fontSize: 14, fontWeight: 600, fontFamily: font }}>
                Ver carrito
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
