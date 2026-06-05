// src/modules/kitchen/pages/CatalogProductDetailPage.tsx
//
// Vista DETALLE de un producto de la carta (menu_item product_type='item').
// Patrón LISTA + DETALLE por estado: recibe menuItemId + onBack, no usa
// react-router con params. La monta KitchenMenuPage.
//
// REDISEÑO EDITORIAL v2 (06/06): layout "refined editorial" con foto hero
// full-width, card elevada, barras de margen visuales por canal, lightbox de
// foto, tipografía Fraunces en títulos. Define el estándar visual de Folvy.
//
// Datos económicos E2: cascada de margen por canal con costes por pedido
// diluidos por ticket medio estimado. Convención IVA incl. en costes de canal.

import { useEffect, useState } from 'react'
import { ArrowLeft, Bike, Camera, Check, ChefHat, Link2, Loader2, Pencil, ShoppingBag, Store, X } from 'lucide-react'
import {
  getMenuItemById,
  updateMenuItem,
} from '@/modules/kitchen/services/menuItemService'
import {
  getProductModifierGroups,
  type CatalogModifierGroup,
} from '@/modules/kitchen/services/brandCatalogService'
import {
  listChannelRates,
  listSalesChannels,
  baseFromGross,
  type ChannelRate,
  type SalesChannel as SalesChannelType,
} from '@/modules/kitchen/services/channelRateService'
import { supabase } from '@/lib/supabase'
import type { MenuItem } from '@/types/kitchen'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtEur(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

const GROUP_TYPE_LABEL: Record<string, string> = {
  choice: 'Elección', extras: 'Extras', removal: 'Quitar',
  side: 'Acompañamiento', cross_sell: 'Sugerencia', info: 'Info',
}

const DEFAULT_ITEMS_PER_ORDER = 2

// ─── Sub-components ─────────────────────────────────────────────────────────

function PhotoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8 cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        className="max-w-full max-h-full rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/30 transition-colors"
      >
        <X size={20} />
      </button>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

interface CatalogProductDetailPageProps {
  menuItemId: string
  onBack: () => void
}

export default function CatalogProductDetailPage({ menuItemId, onBack }: CatalogProductDetailPageProps) {
  const [item, setItem] = useState<MenuItem | null>(null)
  const [groups, setGroups] = useState<CatalogModifierGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Datos económicos E2
  const [channelRates, setChannelRates] = useState<ChannelRate[]>([])
  const [salesChannels, setSalesChannels] = useState<SalesChannelType[]>([])
  const [recipeCost, setRecipeCost] = useState<number | null>(null)
  const [brandName, setBrandName] = useState<string>('')
  const [channelLogos, setChannelLogos] = useState<Record<string, string>>({})

  // Edición de datos
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Lightbox foto
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // ─── Data loading ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getMenuItemById(menuItemId)
      .then((mi) => {
        if (cancelled) return
        if (!mi) { setError('Este producto ya no existe.'); setItem(null) }
        else setItem(mi)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando el producto.')
        setItem(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [menuItemId])

  // Modifier groups
  useEffect(() => {
    if (!item) return
    let cancelled = false
    getProductModifierGroups(item.accountId, item.id)
      .then((mgs) => { if (!cancelled) setGroups(mgs) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [item?.id, item?.accountId])

  // Channel rates + recipe cost (E2)
  useEffect(() => {
    if (!item) return
    let cancelled = false
    Promise.all([
      listChannelRates(item.accountId),
      listSalesChannels(item.accountId),
    ]).then(([rates, chs]) => {
      if (cancelled) return
      setChannelRates(rates)
      setSalesChannels(chs)
    }).catch(() => {})
    if (item.recipeItemId && supabase) {
      supabase.from('recipe_item')
        .select('computed_cost')
        .eq('id', item.recipeItemId)
        .single()
        .then(({ data }) => {
          if (!cancelled && data) setRecipeCost(data.computed_cost as number | null)
        })
    } else {
      setRecipeCost(null)
    }
    if (item.brandId && supabase) {
      supabase.from('brand').select('name').eq('id', item.brandId).single()
        .then(({ data }) => { if (!cancelled && data) setBrandName(data.name as string) })
    }
    if (supabase) {
      supabase.from('connector').select('code, logo_url').not('logo_url', 'is', null)
        .then(({ data }) => {
          if (!cancelled && data) {
            const map: Record<string, string> = {}
            for (const row of data) map[String(row.code).toLowerCase()] = row.logo_url as string
            if (!cancelled) setChannelLogos(map)
          }
        })
    }
    return () => { cancelled = true }
  }, [item?.id, item?.accountId, item?.recipeItemId])

  // ─── Edit handlers ──────────────────────────────────────────────────────

  async function refreshItem() {
    try {
      const fresh = await getMenuItemById(menuItemId)
      if (fresh) setItem(fresh)
    } catch (err: unknown) {
      console.error('CatalogProductDetailPage: refresco falló', err)
    }
  }

  function openEdit() {
    if (!item) return
    setName(item.name)
    setDescription(item.description ?? '')
    setPrice(String(item.price ?? ''))
    setSaveError(null)
    setEditing(true)
  }

  async function save() {
    if (!item) return
    const trimmed = name.trim()
    if (trimmed === '') { setSaveError('El nombre es obligatorio.'); return }
    const priceNum = Number(price.replace(',', '.'))
    if (!Number.isFinite(priceNum) || priceNum < 0) { setSaveError('El precio no es válido.'); return }
    setSaving(true)
    setSaveError(null)
    try {
      await updateMenuItem(item.id, {
        name: trimmed,
        description: description.trim() === '' ? null : description.trim(),
        price: priceNum,
      })
      setEditing(false)
      await refreshItem()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  // ─── Loading / error states ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-secondary text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando producto…
      </div>
    )
  }
  if (error || !item) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft size={16} /> Menú
        </button>
        <div className="p-4 rounded-xl bg-danger-bg text-danger border border-danger/20 text-sm">
          {error ?? 'Producto no encontrado.'}
        </div>
      </div>
    )
  }

  // ─── Computed economics ─────────────────────────────────────────────────

  const pvpSinIva = item.price ?? 0
  const vatPct = item.vatRate ?? 0
  const pvpConIva = Math.round(pvpSinIva * (1 + vatPct / 100) * 100) / 100
  const hasCost = recipeCost != null && recipeCost > 0
  const foodCostPct = hasCost && pvpSinIva > 0 ? Math.round(recipeCost! / pvpSinIva * 10000) / 100 : null

  // Best margin across configured channels
  let bestMargin: number | null = null
  let bestChannel = ''
  let bestMarginPct: number | null = null
  for (const ch of salesChannels) {
    const rate = channelRates.find(r => r.salesChannelId === ch.id)
    if (!rate || rate.commissionPct == null) continue
    const commBase = rate.commissionBase === 'pvp_sin_iva' ? pvpSinIva : pvpConIva
    const commAmt = Math.round(commBase * rate.commissionPct / 100 * 100) / 100
    const commFixedBase = baseFromGross(rate.commissionFixed) ?? 0
    const courierBase = baseFromGross(rate.ownCourierCost) ?? 0
    const custFeeBase = baseFromGross(rate.ownCustomerFee, rate.ownCustomerFeeVatPct ?? 10) ?? 0
    const orderCost = rate.serviceType === 'own_delivery' ? (commFixedBase + courierBase - custFeeBase) / DEFAULT_ITEMS_PER_ORDER : 0
    const m = pvpSinIva - (hasCost ? recipeCost! : 0) - commAmt - orderCost
    if (bestMargin === null || m > bestMargin) {
      bestMargin = m
      bestChannel = ch.name
      bestMarginPct = pvpSinIva > 0 ? Math.round(m / pvpSinIva * 10000) / 100 : null
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const channelIcon = (slug: string | null) => {
    if (!slug) return null
    const s = slug.toLowerCase()
    if (s.includes('glovo') || s.includes('uber') || s.includes('justeat') || s.includes('just_eat')) return <Bike size={14} />
    if (s.includes('shop') || s.includes('takeaway')) return <ShoppingBag size={14} />
    return <Store size={14} />
  }

  const channelBadge = (ch: SalesChannelType) => {
    const logoUrl = ch.slug ? channelLogos[ch.slug.toLowerCase()] : null
    if (logoUrl) {
      return (
        <span className="h-11 px-3 rounded-xl bg-white border border-border-default flex items-center gap-2 flex-shrink-0">
          <img src={logoUrl} alt={ch.name} className="h-7 w-7 rounded object-contain" />
          <span className="text-base font-medium text-text-primary pr-1">{ch.name}</span>
        </span>
      )
    }
    return (
      <span className="h-11 px-4 rounded-xl flex items-center gap-2 text-white text-base font-medium flex-shrink-0" style={{ backgroundColor: ch.color || '#8B8178' }}>
        {channelIcon(ch.slug)}
        {ch.name}
      </span>
    )
  }

  return (
    <div className="w-full pb-8">
      {/* Lightbox */}
      {lightboxOpen && item.photoUrl && (
        <PhotoLightbox src={item.photoUrl} onClose={() => setLightboxOpen(false)} />
      )}

      {/* Breadcrumb */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 mb-4 text-sm text-text-secondary hover:text-accent transition-colors"
      >
        <ArrowLeft size={15} />
        <span>Menú</span>
      </button>

      {/* ── PHOTO HERO + INFO CARD ── */}
      <div className="mb-5">
      {/* ── PHOTO HERO ── */}
      <div className="relative w-full h-72 rounded-[14px] overflow-hidden -mb-16 z-0">
        {item.photoUrl ? (
          <img
            src={item.photoUrl}
            alt={item.name}
            className="w-full h-full object-cover cursor-zoom-in"
            onClick={() => setLightboxOpen(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#D4B896] via-[#B89B78] to-[#8B7355] flex items-center justify-center">
            <Camera size={48} className="text-white/25" />
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/35 to-transparent" />
        <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md px-4 py-2 rounded-xl shadow-md flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-[#D67442] flex items-center justify-center text-white text-[10px] font-bold">
            {(brandName || item.category || 'P').charAt(0)}
          </span>
          <span className="text-sm font-medium text-text-primary">{brandName || item.category || 'Producto'}</span>
        </div>
      </div>

      {/* ── INFO CARD (elevated over photo) ── */}
      <div className="relative z-[1] mx-6 bg-card rounded-[14px] shadow-lg p-7 sm:p-8">
        {!editing ? (
          <>
            <h1 className="font-display text-[26px] font-medium leading-tight mb-1.5">{item.name}</h1>
            <div className="flex items-center gap-2 text-sm text-text-secondary mb-5">
              {brandName && <span>{brandName}</span>}
              {brandName && item.category && <span className="w-1 h-1 rounded-full bg-text-secondary/40" />}
              {item.category && <span>{item.category}</span>}
            </div>
            <div className="flex items-baseline gap-3.5 mb-1">
              <span className="font-mono text-[34px] font-medium tracking-tight">{fmtEur(pvpSinIva)}</span>
              <span className="text-sm text-text-secondary">precio base sin IVA</span>
            </div>
            <div className="font-mono text-sm text-text-secondary/70 mb-5">
              PVP cliente {fmtEur(pvpConIva)} · IVA {vatPct}%
            </div>
            {item.description && (
              <p className="text-[15px] text-text-secondary leading-[1.75] mb-6">{item.description}</p>
            )}
            <div className="flex gap-2.5 flex-wrap">
              <button onClick={openEdit} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border border-border-default text-text-primary hover:border-text-secondary transition-colors">
                <Pencil size={15} /> Editar
              </button>
              {!item.photoUrl && (
                <button className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border border-border-default text-text-primary hover:border-text-secondary transition-colors">
                  <Camera size={15} /> Añadir foto
                </button>
              )}
              {!item.recipeItemId && (
                <button className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[#D67442] text-white hover:bg-[#C25F2E] transition-colors">
                  <Link2 size={15} /> Vincular escandallo
                </button>
              )}
            </div>
          </>
        ) : (
          /* ── Edit form ── */
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Nombre</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving}
                className="w-full px-3 py-2.5 text-sm border border-border-default rounded-lg bg-page text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Precio base (€ sin IVA)</label>
              <input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={saving}
                className="w-44 px-3 py-2.5 text-sm border border-border-default rounded-lg bg-page text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Descripción</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} rows={3}
                className="w-full px-3 py-2.5 text-sm border border-border-default rounded-lg bg-page text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent disabled:opacity-50" />
            </div>
            {saveError && (
              <div className="p-3 rounded-lg bg-danger-bg text-danger border border-danger/20 text-sm">{saveError}</div>
            )}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button onClick={() => setEditing(false)} disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg text-text-secondary hover:bg-page transition-colors disabled:opacity-50">
                <X size={15} /> Cancelar
              </button>
              <button onClick={save} disabled={saving}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={15} />}
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* ── ESCANDALLO INVITATION ── */}
      {!item.recipeItemId && (
        <div className="mb-5 flex items-center gap-4 bg-[#FAEFE6] rounded-[14px] px-6 py-5 border border-[#D67442]/12">
          <div className="w-11 h-11 rounded-[10px] bg-[#D67442] text-white flex items-center justify-center flex-shrink-0">
            <ChefHat size={22} />
          </div>
          <div className="text-sm text-[#7A4A22] leading-relaxed">
            <strong className="font-medium text-[#5C3415]">Sin receta vinculada.</strong>{' '}
            Conecta el escandallo para descubrir tu coste real y el margen exacto en cada canal.
          </div>
        </div>
      )}

      {/* ── METRIC CARDS ── */}
      <div className="mb-5 grid grid-cols-3 gap-2.5">
        <div className="bg-card rounded-[10px] shadow-sm px-5 py-4">
          <div className="text-[11px] font-medium text-text-secondary/70 tracking-widest uppercase mb-1.5">PVP cliente</div>
          <div className="font-mono text-xl font-medium">{fmtEur(pvpConIva)}</div>
          <div className="text-[11.5px] text-text-secondary/60 mt-0.5">IVA {vatPct}% incluido</div>
        </div>
        <div className="bg-card rounded-[10px] shadow-sm px-5 py-4">
          <div className="text-[11px] font-medium text-text-secondary/70 tracking-widest uppercase mb-1.5">Food cost</div>
          <div className={`font-mono text-xl font-medium ${hasCost ? 'text-[#BA7517]' : 'text-text-secondary/40'}`}>
            {hasCost ? fmtEur(recipeCost) : '—'}
          </div>
          <div className="text-[11.5px] text-text-secondary/60 mt-0.5">
            {hasCost ? `${foodCostPct}% del PVP` : 'Pendiente de escandallo'}
          </div>
        </div>
        <div className="bg-card rounded-[10px] shadow-sm px-5 py-4">
          <div className="text-[11px] font-medium text-text-secondary/70 tracking-widest uppercase mb-1.5">Mejor margen</div>
          <div className={`font-mono text-xl font-medium ${bestMargin != null ? 'text-[#4A7A35]' : 'text-text-secondary/40'}`}>
            {bestMargin != null ? fmtEur(bestMargin) : '—'}
          </div>
          <div className="text-[11.5px] text-text-secondary/60 mt-0.5">
            {bestChannel ? `${bestChannel} · ${bestMarginPct}%` : 'Configura un canal'}
          </div>
        </div>
      </div>

      {/* ── MARGIN BY CHANNEL ── */}
      {salesChannels.length > 0 && (
        <div className="mb-5 bg-card rounded-[14px] shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-1">
            <h2 className="font-display text-[17px] font-medium">Margen por canal</h2>
          </div>
          <div className="px-6 pb-6 pt-3 space-y-6">
            {salesChannels.map(ch => {
              const rate = channelRates.find(r => r.salesChannelId === ch.id)
              if (!rate) {
                return (
                  <div key={ch.id} className="flex items-center justify-between border border-dashed border-border-default rounded-[10px] px-5 py-4">
                    <div className="flex items-center gap-2.5 text-sm text-text-secondary/60">
                      {channelBadge(ch)}
                      · sin configurar
                    </div>
                    <span className="text-sm font-medium text-[#D67442] cursor-pointer hover:underline">Configurar en Ajustes</span>
                  </div>
                )
              }

              const commBase = rate.commissionBase === 'pvp_sin_iva' ? pvpSinIva : pvpConIva
              const commAmt = rate.commissionPct != null ? Math.round(commBase * rate.commissionPct / 100 * 100) / 100 : 0
              const commFixedBase = baseFromGross(rate.commissionFixed) ?? 0
              const courierBase = baseFromGross(rate.ownCourierCost) ?? 0
              const custFeeBase = baseFromGross(rate.ownCustomerFee, rate.ownCustomerFeeVatPct ?? 10) ?? 0
              const orderCostTotal = rate.serviceType === 'own_delivery' ? (commFixedBase + courierBase - custFeeBase) : 0
              const hasOrderCosts = rate.serviceType === 'own_delivery' && orderCostTotal !== 0
              const orderCostPerItem = hasOrderCosts ? Math.round(orderCostTotal / DEFAULT_ITEMS_PER_ORDER * 100) / 100 : 0
              const margin = pvpSinIva - (hasCost ? recipeCost! : 0) - commAmt - orderCostPerItem
              const marginPct = pvpSinIva > 0 ? Math.round(margin / pvpSinIva * 10000) / 100 : 0
              const costPct = hasCost && pvpSinIva > 0 ? Math.round(recipeCost! / pvpSinIva * 100) : 0
              const commPctBar = pvpSinIva > 0 ? Math.round(commAmt / pvpSinIva * 100) : 0
              const transPctBar = pvpSinIva > 0 ? Math.round(orderCostPerItem / pvpSinIva * 100) : 0
              const marginPctBar = Math.max(0, 100 - costPct - commPctBar - transPctBar)

              return (
                <div key={ch.id}>
                  {/* Channel header */}
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2.5">
                      {channelBadge(ch)}
                    </div>
                    <div className="text-right">
                      <span className={`font-mono text-xl font-medium ${margin >= 0 ? 'text-[#4A7A35]' : 'text-[#A32D2D]'}`}>
                        {fmtEur(margin)}
                      </span>
                      <div className="text-[12px] text-text-secondary/60">{marginPct}% del PVP{!hasCost ? ' · sin food cost' : ''}</div>
                    </div>
                  </div>

                  {/* Legend above bar */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12px] text-text-secondary">
                    {hasCost && (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm bg-[#A68B6B]" /> Food cost {fmtEur(recipeCost)}
                      </span>
                    )}
                    {rate.commissionPct != null && (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm bg-[#4A6A8A]" /> Comisión {rate.commissionPct}% ({fmtEur(commAmt)})
                      </span>
                    )}
                    {hasOrderCosts && (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm bg-[#8BADC4]" /> Canal ≈{fmtEur(orderCostPerItem)}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-[#7CB663]" /> Margen {fmtEur(margin)}
                    </span>
                  </div>

                  {/* Visual bar */}
                  <div className="h-7 rounded-lg overflow-hidden flex bg-[#ECEAE4]">
                    {hasCost && costPct > 0 && (
                      <div className="h-full bg-[#A68B6B] transition-all duration-500" style={{ width: `${costPct}%` }} />
                    )}
                    {commPctBar > 0 && (
                      <div className="h-full bg-[#4A6A8A] transition-all duration-500" style={{ width: `${commPctBar}%` }} />
                    )}
                    {transPctBar > 0 && (
                      <div className="h-full bg-[#8BADC4] transition-all duration-500" style={{ width: `${transPctBar}%` }} />
                    )}
                    <div className="h-full bg-[#7CB663] transition-all duration-500" style={{ width: `${marginPctBar}%` }} />
                  </div>
                </div>
              )
            })}

            {/* Estimation note */}
            {channelRates.some(r => r.serviceType === 'own_delivery') && (
              <p className="text-[12px] text-text-secondary/60 leading-relaxed pt-3 border-t border-border-default">
                Los costes de canal (fija, rider, envío) se reparten entre ~{DEFAULT_ITEMS_PER_ORDER} artículos
                por pedido. Folvy lo calculará con datos reales cuando haya más ventas.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── MODIFIERS ── */}
      {groups.length > 0 && (
        <div className="mb-5 bg-card rounded-[14px] shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-1">
            <h2 className="font-display text-[17px] font-medium">Modificadores</h2>
          </div>
          {groups.map((g) => (
            <div key={g.id} className="px-6 py-4 border-t border-border-default">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[15px] font-medium">{g.name}</span>
              </div>
              <div className="flex gap-1.5 mb-3">
                <span className="text-[11px] px-2.5 py-1 rounded bg-page text-text-secondary font-medium">
                  {GROUP_TYPE_LABEL[g.groupType] ?? g.groupType}
                </span>
                <span className="text-[11px] px-2.5 py-1 rounded bg-page text-text-secondary font-medium">
                  elige {g.minSelections === g.maxSelections ? g.minSelections : `${g.minSelections}–${g.maxSelections}`}
                </span>
              </div>
              <div className="space-y-0.5">
                {g.options.map((o) => (
                  <div key={o.id} className="flex items-center justify-between py-1.5">
                    <span className="text-[15px]">
                      {o.name}
                      {o.isDefault && <span className="ml-2 text-[11px] text-text-secondary">(por defecto)</span>}
                    </span>
                    <span className="font-mono text-sm text-text-secondary">
                      {o.priceImpact > 0 ? `+${fmtEur(o.priceImpact)}` : o.priceImpact === 0 ? 'incluido' : fmtEur(o.priceImpact)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── AVAILABILITY (placeholder) ── */}
      <div className="mb-5 bg-card rounded-[14px] shadow-sm overflow-hidden">
        <div className="px-6 pt-5 pb-1">
          <h2 className="font-display text-[17px] font-medium">Disponibilidad</h2>
        </div>
        <div className="px-6 pb-5 pt-3">
          <div className="text-sm text-text-primary">{item.isAvailable ? 'Disponible' : 'Agotado'}</div>
          <p className="text-[12px] text-text-secondary/60 mt-2 leading-relaxed">
            Activar o desactivar el producto por canal (Glovo, Uber, sala) se añadirá aquí próximamente.
          </p>
        </div>
      </div>
    </div>
  )
}
