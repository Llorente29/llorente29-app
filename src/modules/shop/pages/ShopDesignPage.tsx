// src/modules/shop/pages/ShopDesignPage.tsx
//
// Asistente de marca (capa de diseño de la Folvy Shop) — CHROME DE GESTIÓN.
// Rebrand 30/06/2026: reconstruido sobre los TOKENS de Folvy (tinta/verde/
// Space Grotesk), fuera estilos inline y fallbacks viejos (navy/#888). Fresco,
// moderno y navegable, coherente con el resto de la app.
//
// - Al entrar, SIEMBRA temas por defecto (ensureThemesForAccount) → tienda
//   presentable desde el minuto 0.
// - Lista cada marca con su piel y deja tocar los mandos núcleo (plantilla,
//   acento, tipografía, modo, portada) + publicar/despublicar.
// - La identidad (logo, color de marca) se LEE de brand, no se duplica.
// - El acento/fuente/modo que se eligen aquí son del STOREFRONT DEL CLIENTE
//   (su escaparate); este panel es Folvy, pero lo que configura es del cliente.

import { useEffect, useState, useCallback, useRef } from 'react'
import { Store, Image as ImageIcon, Check } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import StorefrontPreview from '@/modules/shop/components/StorefrontPreview'
import { uploadShopHero, deleteShopHero } from '@/modules/shop/services/shopHeroService'
import { getAccountLogo, uploadAccountLogo, deleteAccountLogo, getAccountShopText, setAccountShopText } from '@/modules/shop/services/shopAccountService'
import WelcomeOfferSettings from '@/modules/shop/admin/WelcomeOfferSettings'
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

// Paleta de ACENTO ofrecida al cliente para su escaparate (no es marca Folvy:
// son opciones de color que el dueño elige para SU tienda).
const PALETTE_PRESETS = ['#FF5436', '#E0492E', '#C2890F', '#1F9D6B', '#185FA5', '#8E2F5A']

// Acento por defecto si una marca no tiene color: el coral del hub Folvy.
const DEFAULT_ACCENT = '#FF5436'

export default function ShopDesignPage() {
  const { activeAccountId: accountId } = useActiveAccount()
  const [rows, setRows] = useState<BrandWithTheme[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [hubLogo, setHubLogo] = useState<string | null>(null)
  const [hubBusy, setHubBusy] = useState(false)
  const [slogan, setSlogan] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [savingText, setSavingText] = useState(false)
  const [textSaved, setTextSaved] = useState(false)
  const hubLogoInputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError(null)
    try {
      await ensureThemesForAccount(accountId)        // siembra idempotente
      setRows(await listBrandsWithTheme(accountId))
      try { setHubLogo(await getAccountLogo(accountId)) } catch { /* sin logo */ }
      try { const t = await getAccountShopText(accountId); setSlogan(t.tagline ?? ''); setSubtitle(t.subtitle ?? '') } catch { /* sin textos */ }
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

  const heroInputRef = useRef<HTMLInputElement | null>(null)
  const [heroForId, setHeroForId] = useState<string | null>(null)

  async function onPickHero(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    const r = rows.find(x => x.id === heroForId)
    if (!file || !r || !accountId || !r.brand_id) return
    setSavingId(r.id)
    try {
      await uploadShopHero(accountId, r.brand_id, r.id, file)
      await load()
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo subir la portada.')
    } finally {
      setSavingId(null)
    }
  }

  async function removeHero(r: BrandWithTheme) {
    setSavingId(r.id)
    try { await deleteShopHero(r.id); await load() }
    catch (err: any) { setError(err?.message ?? 'No se pudo quitar la portada.') }
    finally { setSavingId(null) }
  }

  async function onPickHubLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !accountId) return
    setHubBusy(true)
    try { setHubLogo(await uploadAccountLogo(accountId, file)) }
    catch (err: any) { setError(err?.message ?? 'No se pudo subir el logo.') }
    finally { setHubBusy(false) }
  }
  async function removeHubLogo() {
    if (!accountId) return
    setHubBusy(true)
    try { await deleteAccountLogo(accountId); setHubLogo(null) }
    catch (err: any) { setError(err?.message ?? 'No se pudo quitar el logo.') }
    finally { setHubBusy(false) }
  }
  async function saveHubText() {
    if (!accountId) return
    setSavingText(true); setTextSaved(false)
    try { await setAccountShopText(accountId, slogan, subtitle); setTextSaved(true); setTimeout(() => setTextSaved(false), 2500) }
    catch (err: any) { setError(err?.message ?? 'No se pudieron guardar los textos.') }
    finally { setSavingText(false) }
  }

  if (loading) {
    return <div className="p-6 text-text-secondary">Cargando la tienda…</div>
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-text-primary flex items-center gap-2">
          <Store size={22} className="text-text-secondary" />
          Diseño de la tienda
        </h1>
        <p className="text-sm text-text-secondary mt-1.5 max-w-2xl">
          Cada marca tiene su escaparate. Elige plantilla, acento, tipografía y modo; el logo y los
          platos salen de tu carta. Publica cuando esté lista.
        </p>
      </header>

      <input ref={heroInputRef} type="file" accept="image/*" onChange={onPickHero} className="hidden" />
      <input ref={hubLogoInputRef} type="file" accept="image/png,image/webp,image/svg+xml,image/*" onChange={onPickHubLogo} className="hidden" />

      {/* Identidad del hub: logo + slogans de la cuenta (cabecera del escaparate multimarca) */}
      <div className="rounded-2xl border border-default bg-card p-5 mb-4">
        <div className="font-semibold text-[15px] text-text-primary mb-1">Identidad del hub</div>
        <div className="text-[13px] text-text-secondary mb-4">
          Lo que ve el cliente en la portada de tu tienda multimarca: tu logo y tus frases.
        </div>

        {/* Logo */}
        <div className="flex items-center gap-4 flex-wrap pb-4 border-b border-default">
          <span className="h-16 min-w-[140px] px-3 rounded-xl border border-default grid place-items-center overflow-hidden shrink-0" style={{ background: '#2B211C' }}>
            {hubLogo
              ? <img src={hubLogo} alt="" className="max-h-12 w-auto object-contain" />
              : <Store size={26} className="text-white/40" />}
          </span>
          <div className="flex-1 min-w-[200px]">
            <div className="font-medium text-[14px] text-text-primary">Logo</div>
            <div className="text-[13px] text-text-secondary mt-0.5">
              PNG transparente pensado para fondo oscuro: se ve grande y directo sobre la portada.
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={() => hubLogoInputRef.current?.click()} disabled={hubBusy}
              className="inline-flex items-center gap-1.5 text-[13px] rounded-lg px-3 py-2 border border-default text-text-primary hover:bg-page disabled:opacity-50">
              <ImageIcon size={14} /> {hubLogo ? 'Cambiar logo' : 'Subir logo'}
            </button>
            {hubLogo && (
              <button onClick={removeHubLogo} disabled={hubBusy}
                className="text-xs rounded-lg px-2.5 py-2 border border-default text-text-secondary hover:text-text-primary disabled:opacity-50">
                Quitar
              </button>
            )}
          </div>
        </div>

        {/* Slogan + subtítulo */}
        <div className="pt-4 grid gap-3">
          <div>
            <label className="block text-[13px] font-medium text-text-primary mb-1">Slogan (titular)</label>
            <input
              type="text"
              value={slogan}
              onChange={e => setSlogan(e.target.value)}
              placeholder="Hazte un Multi. Pide de varias cocinas a la vez."
              className="w-full rounded-lg border border-default bg-page px-3 py-2 text-[14px] text-text-primary placeholder:text-text-secondary"
            />
            <div className="text-[12px] text-text-secondary mt-1">
              Lo que escribas tras el primer punto se resalta en amarillo. Ej: <span className="text-text-primary">Hazte un Multi.</span> <span className="bg-warning-bg text-warning px-1 rounded">Pide de varias cocinas.</span>
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-text-primary mb-1">Subtítulo</label>
            <input
              type="text"
              value={subtitle}
              onChange={e => setSubtitle(e.target.value)}
              placeholder="Pide de varias cocinas a la vez y te llega junto y calentito, en una sola entrega."
              className="w-full rounded-lg border border-default bg-page px-3 py-2 text-[14px] text-text-primary placeholder:text-text-secondary"
            />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveHubText} disabled={savingText}
              className="inline-flex items-center gap-1.5 text-[13px] rounded-lg px-4 py-2 bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
              {savingText ? 'Guardando…' : 'Guardar frases'}
            </button>
            {textSaved && <span className="text-[13px] text-success">Guardado</span>}
          </div>
        </div>
      </div>

      {/* Oferta de bienvenida del Club (F3 sub-paso 5): valor + impacto de margen real */}
      {accountId && (
        <div className="mb-4">
          <WelcomeOfferSettings accountId={accountId} />
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-danger-bg text-danger border border-danger/30 px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {rows.length === 0 && (
        <div className="rounded-2xl border border-default bg-card p-8 text-center text-text-secondary">
          No hay marcas activas en esta cuenta todavía.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {rows.map(r => {
          const accent = r.accent_color ?? r.brand?.color ?? DEFAULT_ACCENT
          const busy = savingId === r.id
          const usingBrandColor = (r.accent_color ?? r.brand?.color) == null
          return (
            <div key={r.id} className="flex gap-5 items-start flex-wrap">
              <div className={`flex-1 min-w-[420px] rounded-2xl border border-default bg-card p-5 transition-opacity ${busy ? 'opacity-60' : ''}`}>
                {/* Cabecera de marca */}
                <div className="flex items-center gap-3 mb-5">
                  <span
                    className="w-10 h-10 rounded-xl grid place-items-center overflow-hidden shrink-0 text-white font-display font-bold"
                    style={{ backgroundColor: accent }}
                  >
                    {r.brand?.logo_url
                      ? <img src={r.brand.logo_url} alt="" className="w-full h-full object-contain" />
                      : (r.brand?.name ?? '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[15px] text-text-primary truncate">{r.brand?.name ?? 'Marca'}</div>
                    <div className="text-xs text-text-secondary">
                      {r.is_published ? 'Publicada' : 'Borrador'}{r.brand?.slug ? ` · /${r.brand.slug}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => togglePublish(r)}
                    disabled={busy}
                    className={`rounded-lg px-3 py-2 text-[13px] font-bold border disabled:opacity-50 ${
                      r.is_published
                        ? 'bg-success-bg text-success border-success/30 hover:bg-success-bg/70'
                        : 'border-default text-text-secondary hover:text-text-primary hover:bg-page'
                    }`}
                  >
                    {r.is_published ? 'Despublicar' : 'Publicar'}
                  </button>
                </div>

                <Field label="Plantilla">
                  <Segmented options={TEMPLATES} value={r.template} onChange={v => patch(r.id, { template: v })} />
                </Field>

                <Field label="Acento">
                  <div className="flex gap-2 items-center flex-wrap">
                    {PALETTE_PRESETS.map(c => {
                      const selected = (r.accent_color ?? r.brand?.color) === c
                      return (
                        <button
                          key={c}
                          aria-label={c}
                          onClick={() => patch(r.id, { accent_color: c })}
                          className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${selected ? 'ring-2 ring-[#15171A] ring-offset-2 ring-offset-white' : 'ring-1 ring-black/10'}`}
                          style={{ backgroundColor: c }}
                        />
                      )
                    })}
                    <button
                      onClick={() => patch(r.id, { accent_color: null })}
                      className={`text-xs rounded-lg px-2.5 py-1.5 border ${usingBrandColor ? 'bg-accent text-text-on-accent border-transparent' : 'border-default text-text-secondary hover:text-text-primary'}`}
                    >
                      Color de marca
                    </button>
                  </div>
                </Field>

                <Field label="Tipografía">
                  <Segmented options={FONTS} value={r.font} onChange={v => patch(r.id, { font: v })} />
                </Field>

                <Field label="Modo">
                  <Segmented options={MODES} value={r.mode} onChange={v => patch(r.id, { mode: v })} />
                </Field>

                <Field label="Portada">
                  <div className="flex gap-2 items-center flex-wrap">
                    <button
                      onClick={() => { setHeroForId(r.id); heroInputRef.current?.click() }}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-[13px] rounded-lg px-3 py-1.5 border border-default text-text-primary hover:bg-page disabled:opacity-50"
                    >
                      <ImageIcon size={14} /> {r.hero_url ? 'Cambiar foto' : 'Subir foto'}
                    </button>
                    {r.hero_url && (
                      <button
                        onClick={() => removeHero(r)}
                        disabled={busy}
                        className="text-xs rounded-lg px-2.5 py-1.5 border border-default text-text-secondary hover:text-text-primary disabled:opacity-50"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </Field>
              </div>

              {accountId && (
                <StorefrontPreview
                  accountId={accountId}
                  brandId={r.brand_id as string}
                  brand={{ name: r.brand?.name ?? 'Marca', logo_url: r.brand?.logo_url ?? null }}
                  heroUrl={r.hero_url}
                  theme={{ template: r.template, accent, font: r.font, mode: r.mode }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2 flex-wrap">
      <span className="text-[13px] text-text-secondary w-24 shrink-0">{label}</span>
      {children}
    </div>
  )
}

function Segmented<T extends string>({ options, value, onChange }: {
  options: { v: T; label: string }[]; value: T; onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex gap-1.5 flex-wrap">
      {options.map(o => {
        const active = value === o.v
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg px-3 py-1.5 border transition-colors ${
              active
                ? 'bg-accent text-text-on-accent border-transparent'
                : 'bg-card text-text-secondary border-default hover:text-text-primary hover:bg-page'
            }`}
          >
            {active && <Check size={13} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
