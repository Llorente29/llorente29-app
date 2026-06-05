// src/modules/kitchen/pages/CatalogProductDetailPage.tsx
//
// Vista DETALLE de un producto de la carta (menu_item product_type='item').
// Patrón LISTA + DETALLE por estado: recibe menuItemId + onBack. La monta
// KitchenMenuPage.
//
// FICHA v2 (06/06): hero con foto + thumbnails, identity card editable, y 11
// secciones colapsables (CollapsibleSection). Preserva la lógica E2 (economía
// por canal con barras de margen) y los modificadores read-only. Estándar
// visual de fichas de detalle de Folvy.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowLeft, BarChart3, Bike, Camera, Check, ChefHat, ChevronDown,
  Download, Link2, Loader2, MapPin, MoreHorizontal, Package, Pencil, Settings2,
  SlidersHorizontal, ShoppingBag, Sparkles, StickyNote, Store, Tag, TrendingUp, X,
} from 'lucide-react'
import { getMenuItemById, updateMenuItem } from '@/modules/kitchen/services/menuItemService'
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
import { uploadMenuPhoto } from '@/modules/kitchen/services/menuPhotoService'
import { supabase } from '@/lib/supabase'
import type { MenuItem, MenuItemUpdate } from '@/types/kitchen'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtEur(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

const GROUP_TYPE_LABEL: Record<string, string> = {
  choice: 'Elección', extras: 'Extras', removal: 'Quitar',
  side: 'Acompañamiento', cross_sell: 'Sugerencia', info: 'Info',
}

const DEFAULT_ITEMS_PER_ORDER = 2

// Estilos de los tags conocidos (resto → neutro).
const TAG_STYLES: Record<string, string> = {
  'best-seller': 'bg-green-50 text-green-800',
  'nuevo': 'bg-blue-50 text-blue-800',
  'temporada': 'bg-amber-50 text-amber-800',
  'promocional': 'bg-purple-50 text-purple-800',
}

// 14 alérgenos de declaración obligatoria (UE) — placeholder hasta tener escandallo.
const EU_ALLERGENS = [
  'Gluten', 'Crustáceos', 'Huevos', 'Pescado', 'Cacahuetes', 'Soja', 'Lácteos',
  'Frutos de cáscara', 'Apio', 'Mostaza', 'Sésamo', 'Sulfitos', 'Altramuces', 'Moluscos',
]

// Iconos por nombre para CollapsibleSection (evita un import dinámico).
const ICONS: Record<string, typeof Store> = {
  'chef-hat': ChefHat, 'trending-up': TrendingUp, 'tag': Tag, 'sliders': SlidersHorizontal,
  'allergen': AlertTriangle, 'truck': MapPin, 'bar-chart': BarChart3, 'note': StickyNote,
  'package': Package, 'map-pin': MapPin, 'settings': Settings2,
}
function Icon({ name, size, className }: { name: string; size?: number; className?: string }) {
  const Cmp = ICONS[name] ?? Store
  return <Cmp size={size} className={className} />
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PhotoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8 cursor-zoom-out"
      onClick={onClose}
    >
      <img src={src} alt="" className="max-w-full max-h-full rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/30 transition-colors">
        <X size={20} />
      </button>
    </div>
  )
}

function CollapsibleSection({ id, icon, title, badge, badgeColor, defaultOpen, children }: {
  id: string; icon: string; title: string; badge?: string;
  badgeColor?: 'ok' | 'warn' | 'neutral'; defaultOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div id={id} className="border-t border-stone-200">
      <button onClick={() => setOpen(!open)} className="flex items-center w-full px-5 py-3 gap-2 hover:bg-stone-50 text-left">
        <Icon name={icon} size={16} className="text-stone-400 shrink-0" />
        <span className="text-sm font-medium flex-1">{title}</span>
        {badge && <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${badgeColor === 'ok' ? 'bg-green-50 text-green-800' : badgeColor === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-stone-100 text-stone-500'}`}>{badge}</span>}
        <ChevronDown size={14} className={`text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  )
}

function AiButton({ label }: { label: string }) {
  return (
    <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors">
      <Sparkles size={13} /> {label}
    </button>
  )
}

function EmptyState({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="text-sm text-stone-500 py-2">
      <p className="mb-3">{text}</p>
      {children && <div className="flex gap-2 flex-wrap">{children}</div>}
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
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([])

  // Edición de identidad
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Foto
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // Edición inline (notas, packaging, avanzado)
  const [notesVal, setNotesVal] = useState('')
  const [packDesc, setPackDesc] = useState('')
  const [packCost, setPackCost] = useState('')
  const [kitchenNameVal, setKitchenNameVal] = useState('')
  const [shortNameVal, setShortNameVal] = useState('')
  const [fieldSaving, setFieldSaving] = useState<string | null>(null)

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

  // Channel rates + recipe cost + brand + logos + locations
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
      supabase.from('recipe_item').select('computed_cost').eq('id', item.recipeItemId).single()
        .then(({ data }) => { if (!cancelled && data) setRecipeCost(data.computed_cost as number | null) })
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
      supabase.from('locations').select('id, name').eq('account_id', item.accountId)
        .then(({ data }) => { if (!cancelled && data) setLocations(data as { id: string; name: string }[]) })
    }
    return () => { cancelled = true }
  }, [item?.id, item?.accountId, item?.recipeItemId, item?.brandId])

  // Init de los campos de edición inline cuando llega/cambia el item.
  useEffect(() => {
    if (!item) return
    setNotesVal(item.notesInternal ?? '')
    setPackDesc(item.packagingDescription ?? '')
    setPackCost(item.packagingCost != null ? String(item.packagingCost) : '')
    setKitchenNameVal(item.kitchenName ?? '')
    setShortNameVal(item.shortName ?? '')
  }, [item?.id, item?.notesInternal, item?.packagingDescription, item?.packagingCost, item?.kitchenName, item?.shortName])

  // ─── Handlers ─────────────────────────────────────────────────────────────

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

  async function saveField(key: string, patch: MenuItemUpdate) {
    if (!item) return
    setFieldSaving(key)
    try {
      await updateMenuItem(item.id, patch)
      await refreshItem()
    } catch (err: unknown) {
      console.error('CatalogProductDetailPage: guardado de campo falló', err)
    } finally {
      setFieldSaving(null)
    }
  }

  async function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !item) return
    setPhotoUploading(true)
    try {
      const url = await uploadMenuPhoto(item.accountId, item.id, file)
      await updateMenuItem(item.id, { photoUrl: url })
      await refreshItem()
    } catch (err: unknown) {
      console.error('CatalogProductDetailPage: subida de foto falló', err)
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ─── Loading / error states ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-stone-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando producto…
      </div>
    )
  }
  if (error || !item) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800">
          <ArrowLeft size={16} /> Menú
        </button>
        <div className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-200 text-sm">
          {error ?? 'Producto no encontrado.'}
        </div>
      </div>
    )
  }

  // ─── Computed economics (PRESERVADO de v1) ───────────────────────────────

  const pvpSinIva = item.price ?? 0
  const vatPct = item.vatRate ?? 0
  const pvpConIva = Math.round(pvpSinIva * (1 + vatPct / 100) * 100) / 100
  const hasCost = recipeCost != null && recipeCost > 0
  const foodCostPct = hasCost && pvpSinIva > 0 ? Math.round(recipeCost! / pvpSinIva * 10000) / 100 : null

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
        <span className="h-11 px-3 rounded-xl bg-white border border-stone-200 flex items-center gap-2 flex-shrink-0">
          <img src={logoUrl} alt={ch.name} className="h-7 w-7 rounded object-contain" />
          <span className="text-base font-medium text-stone-800 pr-1">{ch.name}</span>
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

  const hasRecipe = !!item.recipeItemId
  const locationNames = locations.length > 0 ? locations.map(l => l.name) : ['Alcalá', 'Carabanchel', 'Pza Castilla']

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="w-full pb-8">
      {lightboxOpen && item.photoUrl && (
        <PhotoLightbox src={item.photoUrl} onClose={() => setLightboxOpen(false)} />
      )}

      {/* hidden file input para la foto */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPhotoSelected} />

      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors">
          <ArrowLeft size={15} /> Menú {brandName && <span className="text-stone-400">· {brandName}</span>}
        </button>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors">
            <Download size={14} /> Exportar
          </button>
          <button className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-500 border border-stone-200 hover:bg-stone-50 transition-colors">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* ── HERO + IDENTITY CARD ── */}
      <div className="mb-2.5">
        <div className="flex gap-2.5 -mb-16 relative z-0">
          {/* Foto principal */}
          <div className="relative flex-1 h-72 rounded-[14px] overflow-hidden">
            {item.photoUrl ? (
              <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightboxOpen(true)} />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#D4B896] via-[#B89B78] to-[#8B7355] flex items-center justify-center">
                <Camera size={48} className="text-white/25" />
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/35 to-transparent pointer-events-none" />
            <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md px-4 py-2 rounded-xl shadow-md flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-[#D67442] flex items-center justify-center text-white text-[10px] font-bold">
                {(brandName || item.category || 'P').charAt(0)}
              </span>
              <span className="text-sm font-medium text-stone-800">{brandName || item.category || 'Producto'}</span>
            </div>
          </div>
          {/* Columna de thumbnails (80px) */}
          <div className="w-20 flex flex-col gap-2.5 h-72">
            <div className="flex-1 rounded-[10px] bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-300">
              <Camera size={18} />
            </div>
            <div className="flex-1 rounded-[10px] bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-300">
              <Camera size={18} />
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={photoUploading}
              className="flex-1 rounded-[10px] border-2 border-dashed border-stone-300 flex items-center justify-center text-stone-400 hover:border-[#D67442] hover:text-[#D67442] transition-colors disabled:opacity-50"
            >
              {photoUploading ? <Loader2 size={18} className="animate-spin" /> : <span className="text-2xl leading-none">+</span>}
            </button>
          </div>
        </div>

        {/* Identity card */}
        <div className="relative z-[1] mx-6 bg-white rounded-[14px] shadow-lg p-7 sm:p-8 border border-stone-100">
          {!editing ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <h1 className="font-display text-[26px] font-medium leading-tight mb-1.5">{item.name}</h1>
                <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium shrink-0 ${hasRecipe ? 'bg-green-50 text-green-800' : 'bg-stone-100 text-stone-500'}`}>
                  {hasRecipe ? 'Escandallo OK' : 'Sin escandallo'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-500 mb-3">
                {brandName && <span>{brandName}</span>}
                {brandName && item.category && <span className="w-1 h-1 rounded-full bg-stone-300" />}
                {item.category && <span>{item.category}</span>}
              </div>
              {item.tags && item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {item.tags.map((t) => (
                    <span key={t} className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${TAG_STYLES[t] ?? 'bg-stone-100 text-stone-600'}`}>{t}</span>
                  ))}
                </div>
              )}
              <div className="flex items-baseline gap-3.5 mb-1">
                <span className="font-mono text-[34px] font-medium tracking-tight">{fmtEur(pvpSinIva)}</span>
                <span className="text-sm text-stone-500">precio base sin IVA</span>
              </div>
              <div className="font-mono text-sm text-stone-400 mb-5">
                PVP cliente {fmtEur(pvpConIva)} · IVA {vatPct}%
              </div>
              {item.description && (
                <p className="text-[15px] text-stone-600 leading-[1.75] mb-6">{item.description}</p>
              )}
              <div className="flex gap-2.5 flex-wrap">
                <button onClick={openEdit} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border border-stone-200 text-stone-800 hover:border-stone-400 transition-colors">
                  <Pencil size={15} /> Editar
                </button>
                <AiButton label="Mejorar descripción con IA" />
                {!hasRecipe && (
                  <button className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[#D67442] text-white hover:bg-[#C25F2E] transition-colors">
                    <Link2 size={15} /> Vincular escandallo
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Nombre</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving}
                  className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442] disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Precio base (€ sin IVA)</label>
                <input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={saving}
                  className="w-44 px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442] disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Descripción</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} rows={3}
                  className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442] disabled:opacity-50" />
              </div>
              {saveError && <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm">{saveError}</div>}
              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button onClick={() => setEditing(false)} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg text-stone-500 hover:bg-stone-50 transition-colors disabled:opacity-50">
                  <X size={15} /> Cancelar
                </button>
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm rounded-lg font-medium bg-[#1E3A5F] text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={15} />} {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── SECCIONES COLAPSABLES ── */}
      <div className="bg-white border border-stone-200 rounded-xl mt-2.5 overflow-hidden">

        {/* S1 — Escandallo y elaboración */}
        <CollapsibleSection id="s-escandallo" icon="chef-hat" title="Escandallo y elaboración"
          badge={hasRecipe ? 'OK' : 'Sin escandallo'} badgeColor={hasRecipe ? 'ok' : 'warn'} defaultOpen={hasRecipe}>
          {!hasRecipe ? (
            <EmptyState text="Sin escandallo vinculado. Conecta una receta para ver costes, alérgenos y elaboración.">
              <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#D67442] text-white hover:bg-[#C25F2E] transition-colors">
                <Link2 size={13} /> Vincular escandallo
              </button>
              <AiButton label="Crear escandallo con IA" />
            </EmptyState>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mb-3">
                {[
                  { k: 'Coste', v: fmtEur(recipeCost) },
                  { k: 'FC %', v: foodCostPct != null ? `${foodCostPct}%` : '—' },
                  { k: 'Ingredientes', v: '—' },
                  { k: 'Pasos', v: '—' },
                  { k: 'Tiempo', v: '—' },
                ].map((m) => (
                  <div key={m.k} className="bg-stone-50 rounded-lg px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-0.5">{m.k}</div>
                    <div className="font-mono text-sm font-medium">{m.v}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-stone-500 mb-3">Merma estimada incluida en el coste del escandallo.</p>
              <button className="text-sm font-medium text-[#D67442] hover:underline">Ver escandallo completo →</button>
            </>
          )}
        </CollapsibleSection>

        {/* S2 — Economía por canal (PRESERVADO) */}
        <CollapsibleSection id="s-economia" icon="trending-up" title="Economía por canal"
          badge={bestChannel ? `Mejor ${bestMarginPct}%` : undefined} badgeColor="ok" defaultOpen>
          {/* Metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
            <div className="bg-stone-50 rounded-lg px-4 py-3">
              <div className="text-[10px] font-medium text-stone-400 tracking-widest uppercase mb-1">PVP cliente</div>
              <div className="font-mono text-lg font-medium">{fmtEur(pvpConIva)}</div>
              <div className="text-[11px] text-stone-400">IVA {vatPct}% incluido</div>
            </div>
            <div className="bg-stone-50 rounded-lg px-4 py-3">
              <div className="text-[10px] font-medium text-stone-400 tracking-widest uppercase mb-1">Food cost</div>
              <div className={`font-mono text-lg font-medium ${hasCost ? 'text-[#BA7517]' : 'text-stone-300'}`}>{hasCost ? fmtEur(recipeCost) : '—'}</div>
              <div className="text-[11px] text-stone-400">{hasCost ? `${foodCostPct}% del PVP` : 'Pendiente de escandallo'}</div>
            </div>
            <div className="bg-stone-50 rounded-lg px-4 py-3">
              <div className="text-[10px] font-medium text-stone-400 tracking-widest uppercase mb-1">Mejor margen</div>
              <div className={`font-mono text-lg font-medium ${bestMargin != null ? 'text-[#4A7A35]' : 'text-stone-300'}`}>{bestMargin != null ? fmtEur(bestMargin) : '—'}</div>
              <div className="text-[11px] text-stone-400">{bestChannel ? `${bestChannel} · ${bestMarginPct}%` : 'Configura un canal'}</div>
            </div>
            <div className="bg-stone-50 rounded-lg px-4 py-3">
              <div className="text-[10px] font-medium text-stone-400 tracking-widest uppercase mb-1">Stock para</div>
              <div className="font-mono text-lg font-medium text-stone-300">—</div>
              <div className="text-[11px] text-stone-400">Pendiente de inventario</div>
            </div>
          </div>

          {/* Barras de margen por canal */}
          {salesChannels.length > 0 ? (
            <div className="space-y-6">
              {salesChannels.map(ch => {
                const rate = channelRates.find(r => r.salesChannelId === ch.id)
                if (!rate) {
                  return (
                    <div key={ch.id} className="flex items-center justify-between border border-dashed border-stone-200 rounded-[10px] px-5 py-4">
                      <div className="flex items-center gap-2.5 text-sm text-stone-400">
                        {channelBadge(ch)} · sin configurar
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
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2.5">{channelBadge(ch)}</div>
                      <div className="text-right">
                        <span className={`font-mono text-xl font-medium ${margin >= 0 ? 'text-[#4A7A35]' : 'text-[#A32D2D]'}`}>{fmtEur(margin)}</span>
                        <div className="text-[12px] text-stone-400">{marginPct}% del PVP{!hasCost ? ' · sin food cost' : ''}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12px] text-stone-500">
                      {hasCost && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#A68B6B]" /> Food cost {fmtEur(recipeCost)}</span>}
                      {rate.commissionPct != null && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#4A6A8A]" /> Comisión {rate.commissionPct}% ({fmtEur(commAmt)})</span>}
                      {hasOrderCosts && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#8BADC4]" /> Canal ≈{fmtEur(orderCostPerItem)}</span>}
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#7CB663]" /> Margen {fmtEur(margin)}</span>
                    </div>
                    <div className="h-7 rounded-lg overflow-hidden flex bg-[#ECEAE4]">
                      {hasCost && costPct > 0 && <div className="h-full bg-[#A68B6B] transition-all duration-500" style={{ width: `${costPct}%` }} />}
                      {commPctBar > 0 && <div className="h-full bg-[#4A6A8A] transition-all duration-500" style={{ width: `${commPctBar}%` }} />}
                      {transPctBar > 0 && <div className="h-full bg-[#8BADC4] transition-all duration-500" style={{ width: `${transPctBar}%` }} />}
                      <div className="h-full bg-[#7CB663] transition-all duration-500" style={{ width: `${marginPctBar}%` }} />
                    </div>
                  </div>
                )
              })}
              {channelRates.some(r => r.serviceType === 'own_delivery') && (
                <p className="text-[12px] text-stone-400 leading-relaxed pt-3 border-t border-stone-200">
                  Los costes de canal (fija, rider, envío) se reparten entre ~{DEFAULT_ITEMS_PER_ORDER} artículos por pedido. Folvy lo calculará con datos reales cuando haya más ventas.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-stone-500">No hay canales configurados.</p>
          )}

          {/* Target food cost */}
          <p className="text-[12px] text-stone-500 mt-4 pt-3 border-t border-stone-200">
            {item.targetFoodCostPct != null
              ? `Target FC: ${item.targetFoodCostPct}% · ${foodCostPct != null ? (foodCostPct <= item.targetFoodCostPct ? 'Dentro del objetivo' : 'Fuera del objetivo') : 'sin food cost para comparar'}`
              : 'Sin target de food cost configurado.'}
          </p>
        </CollapsibleSection>

        {/* S3 — Precios y disponibilidad */}
        <CollapsibleSection id="s-precios" icon="tag" title="Precios y disponibilidad">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-stone-400 border-b border-stone-200">
                  <th className="py-2 pr-3 font-medium">Canal</th>
                  <th className="py-2 pr-3 font-medium">Ubicación</th>
                  <th className="py-2 pr-3 font-medium text-right">Precio</th>
                  <th className="py-2 pr-3 font-medium text-right">PVP</th>
                  <th className="py-2 pr-3 font-medium text-right">Margen neto</th>
                  <th className="py-2 font-medium text-right">Activo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-stone-100">
                  <td className="py-2.5 pr-3 font-medium">Base marca</td>
                  <td className="py-2.5 pr-3 text-stone-500">Todas</td>
                  <td className="py-2.5 pr-3 text-right font-mono">{fmtEur(pvpSinIva)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono">{fmtEur(pvpConIva)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono">{bestMargin != null ? fmtEur(bestMargin) : '—'}</td>
                  <td className="py-2.5 text-right">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${item.isAvailable ? 'bg-green-500' : 'bg-stone-300'}`} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <button className="mt-3 text-sm font-medium text-[#D67442] hover:underline">+ Añadir override</button>
        </CollapsibleSection>

        {/* S4 — Modificadores (PRESERVADO) */}
        <CollapsibleSection id="s-modificadores" icon="sliders" title="Modificadores"
          badge={groups.length > 0 ? String(groups.length) : undefined} badgeColor="neutral" defaultOpen={groups.length > 0}>
          {groups.length === 0 ? (
            <p className="text-sm text-stone-500">Este producto no tiene modificadores.</p>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.id} className="border border-stone-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[15px] font-medium">{g.name}</span>
                  </div>
                  <div className="flex gap-1.5 mb-3">
                    <span className="text-[11px] px-2.5 py-1 rounded bg-stone-100 text-stone-500 font-medium">{GROUP_TYPE_LABEL[g.groupType] ?? g.groupType}</span>
                    <span className="text-[11px] px-2.5 py-1 rounded bg-stone-100 text-stone-500 font-medium">
                      elige {g.minSelections === g.maxSelections ? g.minSelections : `${g.minSelections}–${g.maxSelections}`}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {g.options.map((o) => (
                      <div key={o.id} className="flex items-center justify-between py-1.5">
                        <span className="text-[15px]">
                          {o.name}
                          {o.isDefault && <span className="ml-2 text-[11px] text-stone-400">(por defecto)</span>}
                        </span>
                        <span className="font-mono text-sm text-stone-500">
                          {o.priceImpact > 0 ? `+${fmtEur(o.priceImpact)}` : o.priceImpact === 0 ? 'incluido' : fmtEur(o.priceImpact)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* S5 — Alérgenos y nutrición */}
        <CollapsibleSection id="s-alergenos" icon="allergen" title="Alérgenos y nutrición">
          {!hasRecipe ? (
            <EmptyState text="Necesita escandallo para calcular alérgenos automáticamente." />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {EU_ALLERGENS.map((a) => (
                  <span key={a} className="text-[11px] px-2.5 py-1 rounded-full bg-stone-100 text-stone-400">{a}: no</span>
                ))}
              </div>
              <AiButton label="Verificar alérgenos" />
            </>
          )}
        </CollapsibleSection>

        {/* S6 — Proveedores */}
        <CollapsibleSection id="s-proveedores" icon="truck" title="Proveedores">
          {!hasRecipe ? (
            <EmptyState text="Conecta un escandallo para ver qué proveedores suministran este plato." />
          ) : (
            <p className="text-sm text-stone-500">Resumen de impacto por proveedor (próximamente).</p>
          )}
        </CollapsibleSection>

        {/* S7 — Ventas */}
        <CollapsibleSection id="s-ventas" icon="bar-chart" title="Ventas" badge="0" badgeColor="neutral">
          <p className="text-sm text-stone-500">Sin ventas registradas para este producto.</p>
        </CollapsibleSection>

        {/* S8 — Notas internas */}
        <CollapsibleSection id="s-notas" icon="note" title="Notas internas" defaultOpen={!!item.notesInternal}>
          <textarea value={notesVal} onChange={(e) => setNotesVal(e.target.value)} rows={3}
            placeholder="Notas del equipo (no visibles al cliente)…"
            className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]" />
          {notesVal !== (item.notesInternal ?? '') && (
            <button onClick={() => saveField('notes', { notesInternal: notesVal.trim() === '' ? null : notesVal })}
              disabled={fieldSaving === 'notes'}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1E3A5F] text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
              {fieldSaving === 'notes' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Guardar nota
            </button>
          )}
          <p className="text-[11px] text-stone-400 mt-2">
            {item.createdByName ? `Creado por ${item.createdByName} · ` : ''}Actualizado {fmtDate(item.updatedAt)}
          </p>
        </CollapsibleSection>

        {/* S9 — Packaging delivery */}
        <CollapsibleSection id="s-packaging" icon="package" title="Packaging delivery"
          defaultOpen={!!(item.packagingDescription || item.packagingCost)}>
          {!item.packagingDescription && item.packagingCost == null && (
            <p className="text-sm text-stone-500 mb-3">Sin información de packaging.</p>
          )}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Descripción del envase</label>
              <textarea value={packDesc} onChange={(e) => setPackDesc(e.target.value)} rows={2}
                placeholder="Envase, bolsa, tapa…"
                className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Coste packaging (€/unidad)</label>
              <input type="text" inputMode="decimal" value={packCost} onChange={(e) => setPackCost(e.target.value)}
                className="w-40 px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]" />
            </div>
            {(packDesc !== (item.packagingDescription ?? '') || packCost !== (item.packagingCost != null ? String(item.packagingCost) : '')) && (
              <button onClick={() => saveField('pack', {
                packagingDescription: packDesc.trim() === '' ? null : packDesc,
                packagingCost: packCost.trim() === '' ? null : Number(packCost.replace(',', '.')),
              })} disabled={fieldSaving === 'pack'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1E3A5F] text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                {fieldSaving === 'pack' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Guardar packaging
              </button>
            )}
          </div>
        </CollapsibleSection>

        {/* S10 — Marcas y ubicaciones */}
        <CollapsibleSection id="s-marcas" icon="map-pin" title="Marcas y ubicaciones">
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1.5">Marca</div>
            <span className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-stone-100">
              <span className="w-5 h-5 rounded bg-[#D67442] flex items-center justify-center text-white text-[10px] font-bold">
                {(brandName || 'P').charAt(0)}
              </span>
              {brandName || '—'}
            </span>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1.5">Ubicaciones</div>
            <div className="flex flex-wrap gap-1.5">
              {locationNames.map((n) => (
                <span key={n} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-stone-100 text-stone-600">
                  <MapPin size={13} className="text-stone-400" /> {n}
                </span>
              ))}
            </div>
          </div>
        </CollapsibleSection>

        {/* S11 — Avanzado */}
        <CollapsibleSection id="s-avanzado" icon="settings" title="Avanzado">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Nombre de cocina (kitchen name)</label>
              <input type="text" value={kitchenNameVal} onChange={(e) => setKitchenNameVal(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]" />
              {kitchenNameVal !== (item.kitchenName ?? '') && (
                <button onClick={() => saveField('kn', { kitchenName: kitchenNameVal.trim() === '' ? null : kitchenNameVal })}
                  disabled={fieldSaving === 'kn'}
                  className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-[#1E3A5F] text-white hover:opacity-90 disabled:opacity-50">
                  {fieldSaving === 'kn' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Guardar
                </button>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Nombre corto (short name)</label>
              <input type="text" value={shortNameVal} onChange={(e) => setShortNameVal(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]" />
              {shortNameVal !== (item.shortName ?? '') && (
                <button onClick={() => saveField('sn', { shortName: shortNameVal.trim() === '' ? null : shortNameVal })}
                  disabled={fieldSaving === 'sn'}
                  className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-[#1E3A5F] text-white hover:opacity-90 disabled:opacity-50">
                  {fieldSaving === 'sn' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Guardar
                </button>
              )}
            </div>
            <div>
              <div className="text-xs font-medium text-stone-500 mb-1.5">Código interno</div>
              <div className="font-mono text-sm text-stone-600">{item.id.slice(0, 8)}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-stone-500 mb-1.5">External ID (Last.app)</div>
              <div className="font-mono text-sm text-stone-400">—</div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-stone-200 text-[11px] text-stone-400 flex flex-wrap gap-x-6 gap-y-1">
            <span>Creado: {fmtDate(item.createdAt)}</span>
            <span>Actualizado: {fmtDate(item.updatedAt)}</span>
          </div>
        </CollapsibleSection>
      </div>

      {/* ── GUIDE BOX IA ── */}
      <div className="mt-4 rounded-xl bg-purple-50 border border-purple-100 p-5 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
          <Sparkles size={18} />
        </div>
        <div>
          <div className="text-sm font-medium text-purple-900 mb-0.5">Folvy te ayuda a completar la ficha</div>
          <p className="text-[13px] text-purple-700/80 mb-2">Escandallo, alérgenos, descripción comercial y más, con un par de clics.</p>
          <button className="text-sm font-medium text-purple-700 hover:underline">Empezar con IA →</button>
        </div>
      </div>
    </div>
  )
}
