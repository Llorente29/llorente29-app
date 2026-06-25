// src/modules/shop/components/StorefrontPreview.tsx
//
// Preview en vivo del escaparate de una marca, dentro del Asistente.
// Pinta la tienda REAL: portada/logo/acento de la marca + su carta real
// (listCategoriesWithProducts). Reacciona al vuelo a los mandos del tema.
//
// Cabecera (sin "pegote"):
//   - Si hay foto de portada (heroUrl) → foto a sangre + velo oscuro abajo con
//     logo + nombre, siempre legible.
//   - Si no hay → tinte SUAVE del color de marca (no banda sólida) + logo
//     centrado con aire. Limpio, nunca un bloque de color ajeno al logo.
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

// #rrggbb → rgba con alfa (para el tinte suave del fallback).
function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(214,116,66,${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function surface(mode: ShopMode) {
  const dark = mode === 'dark'
  return {
    bg: dark ? '#15171a' : '#ffffff',
    text: dark ? '#f2f1ee' : '#1a1a1a',
    muted: dark ? '#9a9a96' : '#888888',
    line: dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.08)',
    thumbBg: dark ? '#2a2d31' : '#f1efe8',
  }
}

export default function StorefrontPreview({ accountId, brandId, brand, heroUrl, theme }: {
  accountId: string
  brandId: string
  brand: BrandRef
  heroUrl: string | null
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
  const heroH = theme.template === 'escaparate' ? 168 : theme.template === 'minimal' ? 130 : 150

  return (
    <div style={{ position: 'sticky', top: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted,#888)', marginBottom: 8, textAlign: 'center' }}>
        Vista previa
      </div>
      <div style={{ width: 300, margin: '0 auto', border: '8px solid #111', borderRadius: 32, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,.18)', background: s.bg }}>
        <div style={{ height: 520, overflowY: 'auto', fontFamily: font, color: s.text, background: s.bg }}>

          {/* ── Cabecera ───────────────────────────────────────────────── */}
          {heroUrl ? (
            // Con foto de portada: foto a sangre + velo oscuro con logo+nombre
            <div style={{ position: 'relative', height: heroH, background: '#000' }}>
              <img src={heroUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 72, background: 'rgba(0,0,0,.42)', display: 'flex', alignItems: 'center', gap: 11, padding: '0 14px' }}>
                {brand.logo_url && (
                  <div style={{ width: 46, height: 46, borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flex: '0 0 auto' }}>
                    <img src={brand.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: 18, lineHeight: 1.1 }}>{brand.name}</div>
                  <div style={{ color: 'rgba(255,255,255,.85)', fontSize: 12, marginTop: 2 }}>Abierto · entrega 25-35 min</div>
                </div>
              </div>
            </div>
          ) : (
            // Sin foto: tinte SUAVE del color de marca + logo centrado con aire
            <div style={{ height: heroH, background: tint(theme.accent, theme.mode === 'dark' ? 0.22 : 0.12), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              {brand.logo_url
                ? <div style={{ width: 70, height: 70, borderRadius: 16, background: theme.mode === 'dark' ? '#1e2125' : '#fff', border: `0.5px solid ${s.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <img src={brand.logo_url} alt="" style={{ width: '78%', height: '78%', objectFit: 'contain' }} />
                  </div>
                : <div style={{ width: 70, height: 70, borderRadius: 16, background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, fontWeight: 600 }}>{brand.name.charAt(0)}</div>}
              <div style={{ color: theme.accent, fontWeight: 600, fontSize: 18 }}>{brand.name}</div>
            </div>
          )}

          {/* ── Carta ──────────────────────────────────────────────────── */}
          <div style={{ padding: '12px 14px' }}>
            {heroUrl ? null : (
              <div style={{ fontSize: 12, color: s.muted, marginBottom: 14 }}>Abierto · entrega 25-35 min</div>
            )}
            {heroUrl && <div style={{ height: 6 }} />}

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
                      <div style={{ width: 52, height: 52, borderRadius: radius, background: s.thumbBg, overflow: 'hidden', flex: '0 0 auto' }}>
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
