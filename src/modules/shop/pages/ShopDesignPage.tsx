// src/modules/shop/pages/ShopDesignPage.tsx
//
// Asistente de marca (capa de diseño de la Folvy Shop).
// - Al entrar, SIEMBRA temas por defecto (ensureThemesForAccount) → tienda
//   presentable desde el minuto 0.
// - Lista cada marca con su piel y deja tocar los 4 mandos núcleo
//   (plantilla, acento, tipografía, modo) + publicar/despublicar.
// - La identidad (logo, color de marca) se LEE de brand, no se duplica.
// El preview en vivo del storefront es el siguiente tramo; aquí va el panel
// de configuración, que es lo que escribe en BD.
import { useEffect, useState, useCallback } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  ensureThemesForAccount,
  listBrandsWithTheme,
  updateTheme,
  setPublished,
  type BrandWithTheme,
  type ShopTemplate,
  type ShopFont,
  type ShopMode,
} from '@/modules/shop/services/shopThemeService'

const TEMPLATES: { v: ShopTemplate; label: string }[] = [
  { v: 'clasica', label: 'Clásica' },
  { v: 'escaparate', label: 'Escaparate' },
  { v: 'minimal', label: 'Minimal' },
]
const FONTS: { v: ShopFont; label: string }[] = [
  { v: 'fraunces', label: 'Fraunces' },
  { v: 'grotesk', label: 'Grotesk' },
  { v: 'editorial', label: 'Editorial' },
]
const MODES: { v: ShopMode; label: string }[] = [
  { v: 'auto', label: 'Auto' },
  { v: 'light', label: 'Claro' },
  { v: 'dark', label: 'Oscuro' },
]
const PALETTE_PRESETS = ['#D67442', '#0e1820', '#2e7d4f', '#8e2f5a', '#e0a032', '#b5482e']

export default function ShopDesignPage() {
  const { activeAccountId: accountId } = useActiveAccount()
  const [rows, setRows] = useState<BrandWithTheme[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError(null)
    try {
      await ensureThemesForAccount(accountId)        // siembra idempotente
      setRows(await listBrandsWithTheme(accountId))
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo cargar la tienda.')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const patch = useCallback(async (id: string, p: Partial<BrandWithTheme>) => {
    setSavingId(id)
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...p } : r)))   // optimista
    try {
      await updateTheme(id, p as any)
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar.')
      await load()   // revierte desde la verdad (BD)
    } finally {
      setSavingId(null)
    }
  }, [load])

  const togglePublish = useCallback(async (r: BrandWithTheme) => {
    setSavingId(r.id)
    const next = !r.is_published
    setRows(prev => prev.map(x => (x.id === r.id ? { ...x, is_published: next } : x)))
    try {
      await setPublished(r.id, next)
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo publicar.')
      await load()
    } finally {
      setSavingId(null)
    }
  }, [load])

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted, #888)' }}>Cargando la tienda…</div>

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: '0 auto' }}>
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Diseño de la tienda</h1>
        <p style={{ color: 'var(--text-muted, #888)', fontSize: 14, marginTop: 4 }}>
          Cada marca tiene su escaparate. Elige plantilla, acento, tipografía y modo; el logo y los
          platos salen de tu carta. Publica cuando esté lista.
        </p>
      </header>

      {error && (
        <div style={{ background: '#fcebeb', color: '#a32d2d', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '12px 0' }}>
          {error}
        </div>
      )}

      {rows.length === 0 && (
        <div style={{ color: 'var(--text-muted, #888)', padding: 24 }}>
          No hay marcas activas en esta cuenta todavía.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
        {rows.map(r => {
          const accent = r.accent_color ?? r.brand?.color ?? '#D67442'
          const busy = savingId === r.id
          return (
            <div key={r.id} style={{ border: '0.5px solid rgba(0,0,0,.14)', borderRadius: 12, padding: 16, opacity: busy ? 0.7 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flex: '0 0 auto' }}>
                  {r.brand?.logo_url
                    ? <img src={r.brand.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : <span style={{ color: '#fff', fontWeight: 600 }}>{(r.brand?.name ?? '?').charAt(0)}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{r.brand?.name ?? 'Marca'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>
                    {r.is_published ? 'Publicada' : 'Borrador'}{r.brand?.slug ? ` · /${r.brand.slug}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => togglePublish(r)}
                  disabled={busy}
                  style={{ border: '0.5px solid rgba(0,0,0,.2)', background: r.is_published ? '#e1f5ee' : 'transparent', color: r.is_published ? '#0f6e56' : 'inherit', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' }}>
                  {r.is_published ? 'Despublicar' : 'Publicar'}
                </button>
              </div>

              <Field label="Plantilla">
                <Segmented options={TEMPLATES} value={r.template} onChange={v => patch(r.id, { template: v })} />
              </Field>
              <Field label="Acento">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {PALETTE_PRESETS.map(c => (
                    <button key={c} aria-label={c} onClick={() => patch(r.id, { accent_color: c })}
                      style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: (r.accent_color ?? r.brand?.color) === c ? '2px solid var(--text, #111)' : '0.5px solid rgba(0,0,0,.2)', cursor: 'pointer', padding: 0 }} />
                  ))}
                  <button onClick={() => patch(r.id, { accent_color: null })}
                    style={{ fontSize: 12, color: 'var(--text-muted, #888)', border: '0.5px solid rgba(0,0,0,.2)', borderRadius: 8, padding: '6px 10px', background: 'transparent', cursor: 'pointer' }}>
                    Usar color de marca
                  </button>
                </div>
              </Field>
              <Field label="Tipografía">
                <Segmented options={FONTS} value={r.font} onChange={v => patch(r.id, { font: v })} />
              </Field>
              <Field label="Modo">
                <Segmented options={MODES} value={r.mode} onChange={v => patch(r.id, { mode: v })} />
              </Field>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted, #888)', width: 92, flex: '0 0 auto' }}>{label}</span>
      {children}
    </div>
  )
}

function Segmented<T extends string>({ options, value, onChange }: {
  options: { v: T; label: string }[]; value: T; onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          style={{ fontSize: 13, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
            border: value === o.v ? '2px solid var(--accent, #185fa5)' : '0.5px solid rgba(0,0,0,.2)',
            background: value === o.v ? 'rgba(24,95,165,.08)' : 'transparent', color: 'inherit' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
