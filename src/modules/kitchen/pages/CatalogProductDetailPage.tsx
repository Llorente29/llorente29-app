// src/modules/kitchen/pages/CatalogProductDetailPage.tsx
//
// Vista DETALLE de un producto de la carta (menu_item product_type='item').
// Patrón LISTA + DETALLE por estado: recibe menuItemId + onBack. La monta
// KitchenMenuPage.
//
// FICHA v2 (06/06): hero con foto + identity card editable, y 11 secciones
// colapsables (CollapsibleSection). Preserva la lógica E2 (economía por canal
// con barras de margen) y los modificadores read-only. Estándar visual de
// fichas de detalle de Folvy.
//
// FOTO v2.1 (07/06): UNA sola foto (menu_item.photo_url). Eliminados los dos
// thumbnails decorativos muertos. Acciones cómodas sobre el hero: Añadir /
// Cambiar / Eliminar (con confirmación inline). Cambiar foto limpia la
// anterior del bucket para no dejar huérfanas.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowLeft, BarChart3, Bike, Camera, Check, ChefHat, ChevronDown,
  Download, ImagePlus, Link2, Loader2, MapPin, MoreHorizontal, Package, Pencil,
  Settings2, SlidersHorizontal, ShoppingBag, Sparkles, StickyNote, Store, Tag,
  Trash2, TrendingUp, X, Plus,
} from 'lucide-react'
import { getMenuItemById, updateMenuItem } from '@/modules/kitchen/services/menuItemService'
import { listRecipeItems } from '@/modules/kitchen/services/recipeItemService'
import {
  getProductModifierGroups,
  type CatalogModifierGroup,
} from '@/modules/kitchen/services/brandCatalogService'
import {
  listSalesChannels,
  type SalesChannel as SalesChannelType,
} from '@/modules/kitchen/services/channelRateService'
import {
  getMenuItemChannelEconomics,
  setProductAvailability,
  type ChannelEconomics,
  type ProductAvailabilityResult,
} from '@/modules/kitchen/services/menuOverrideService'
import { uploadMenuPhoto, deleteMenuPhoto } from '@/modules/kitchen/services/menuPhotoService'
import {
  getComboContext,
  createSlot, updateSlot, deleteSlot,
  addOption, updateOption, deleteOption,
  searchOptionCandidates,
  type ComboSlotDetail, type OptionCandidate,
} from '@/modules/kitchen/services/comboEditService'
import ProductPlacementSection from '@/modules/kitchen/components/ProductPlacementSection'
import EditPricesModal from '@/modules/kitchen/components/EditPricesModal'
import { supabase } from '@/lib/supabase'
import type { MenuItem, MenuItemUpdate, RecipeItem } from '@/types/kitchen'

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

// ─── Editor de combo: grupos (slots) y opciones ─────────────────────────────

function ComboEditorSection({
  accountId, brandId, comboItemId, initialSlots, onChanged,
}: {
  accountId: string; brandId: string | null; comboItemId: string
  initialSlots: ComboSlotDetail[]; onChanged: () => void
}) {
  const [slots, setSlots] = useState<ComboSlotDetail[]>(initialSlots)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // edición inline de nombre de slot
  const [editingSlot, setEditingSlot] = useState<string | null>(null)
  const [slotNameDraft, setSlotNameDraft] = useState('')
  // añadir opción: slot abierto + buscador
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<OptionCandidate[]>([])
  const [searching, setSearching] = useState(false)

  async function reload() {
    const ctx = await getComboContext(accountId, comboItemId)
    setSlots(ctx.slots)
    onChanged()
  }

  function wrap(fn: () => Promise<void>) {
    setBusy(true); setErr(null)
    fn().then(reload).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false))
  }

  // ── Slots ──
  function startRename(s: ComboSlotDetail) { setEditingSlot(s.id); setSlotNameDraft(s.name) }
  function saveRename(slotId: string) {
    const name = slotNameDraft.trim()
    setEditingSlot(null)
    if (!name) return
    wrap(() => updateSlot(accountId, slotId, { name }))
  }
  function setRequired(s: ComboSlotDetail, required: boolean) {
    // obligatorio = min 1; opcional = min 0. max no baja de 1.
    wrap(() => updateSlot(accountId, s.id, { minSelections: required ? Math.max(1, s.minSelections) : 0 }))
  }
  function setMax(s: ComboSlotDetail, max: number) {
    const m = Math.max(1, max)
    wrap(() => updateSlot(accountId, s.id, { maxSelections: m, minSelections: Math.min(s.minSelections, m) }))
  }
  function addSlot() { wrap(() => createSlot(accountId, comboItemId, 'Nuevo grupo', 1, 1).then(() => {})) }
  function removeSlot(slotId: string) { wrap(() => deleteSlot(accountId, slotId)) }

  // ── Opciones ──
  function openAdd(slotId: string) {
    setAddingTo(slotId); setSearch(''); setCandidates([]); setErr(null)
    if (brandId) runSearch('')
  }
  function runSearch(q: string) {
    if (!brandId) return
    setSearching(true)
    searchOptionCandidates(accountId, brandId, q)
      .then(setCandidates)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setSearching(false))
  }
  function pickOption(slotId: string, c: OptionCandidate) {
    setAddingTo(null)
    wrap(() => addOption(accountId, slotId, c.id, 0, false).then(() => {}))
  }
  function removeOption(optionId: string) { wrap(() => deleteOption(accountId, optionId)) }
  function toggleDefault(o: { id: string; isDefault: boolean }) {
    wrap(() => updateOption(accountId, o.id, { isDefault: !o.isDefault }))
  }
  function setPriceImpact(optionId: string, raw: string) {
    const v = raw.trim() === '' ? 0 : Number(raw.replace(',', '.'))
    if (Number.isNaN(v)) return
    wrap(() => updateOption(accountId, optionId, { priceImpact: v }))
  }

  return (
    <div className="space-y-3">
      {err && <div className="p-2 rounded-lg bg-red-50 text-red-700 text-xs">{err}</div>}

      {slots.length === 0 && (
        <p className="text-sm text-stone-500">
          Este combo no tiene grupos todavía. Añade el primero (por ejemplo «Elige tu bebida»).
        </p>
      )}

      {slots.map((s) => {
        const required = s.minSelections >= 1
        return (
          <div key={s.id} className="border border-stone-200 rounded-lg overflow-hidden">
            {/* Cabecera del slot */}
            <div className="flex items-center gap-2 px-3 py-2 bg-stone-50">
              {editingSlot === s.id ? (
                <input
                  autoFocus
                  value={slotNameDraft}
                  onChange={(e) => setSlotNameDraft(e.target.value)}
                  onBlur={() => saveRename(s.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(s.id); if (e.key === 'Escape') setEditingSlot(null) }}
                  className="flex-1 text-sm font-medium px-2 py-1 border border-stone-300 rounded"
                />
              ) : (
                <button onClick={() => startRename(s)} className="flex-1 text-left text-sm font-medium hover:text-[#D67442]" title="Renombrar grupo">
                  {s.name}
                </button>
              )}

              {/* Obligatorio / opcional */}
              <label className="flex items-center gap-1 text-[11px] text-stone-600 cursor-pointer">
                <input type="checkbox" checked={required} disabled={busy} onChange={(e) => setRequired(s, e.target.checked)} />
                Obligatorio
              </label>

              {/* Máximo a elegir */}
              <label className="flex items-center gap-1 text-[11px] text-stone-600">
                Elige hasta
                <input
                  type="number" min={1} value={s.maxSelections} disabled={busy}
                  onChange={(e) => setMax(s, Number(e.target.value))}
                  className="w-12 px-1 py-0.5 border border-stone-300 rounded text-center"
                />
              </label>

              <button onClick={() => removeSlot(s.id)} disabled={busy} className="text-stone-400 hover:text-red-600 p-1" title="Quitar grupo">
                <Trash2 size={14} />
              </button>
            </div>

            {/* Opciones del slot */}
            <div className="px-3 py-2 space-y-1.5">
              {s.options.length === 0 && (
                <p className="text-xs text-stone-400">Sin opciones. Añade productos elegibles.</p>
              )}
              {s.options.map((o) => (
                <div key={o.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{o.optionName}</span>
                  <label className="flex items-center gap-1 text-[11px] text-stone-500" title="Opción por defecto">
                    <input type="checkbox" checked={o.isDefault} disabled={busy} onChange={() => toggleDefault(o)} />
                    Defecto
                  </label>
                  <div className="flex items-center gap-0.5 text-[11px] text-stone-500" title="Suplemento de precio (€)">
                    <span>+€</span>
                    <input
                      type="text" defaultValue={o.priceImpact ? String(o.priceImpact) : ''}
                      placeholder="0" disabled={busy}
                      onBlur={(e) => setPriceImpact(o.id, e.target.value)}
                      className="w-14 px-1 py-0.5 border border-stone-200 rounded text-right"
                    />
                  </div>
                  <button onClick={() => removeOption(o.id)} disabled={busy} className="text-stone-300 hover:text-red-600 p-0.5" title="Quitar opción">
                    <X size={13} />
                  </button>
                </div>
              ))}

              {/* Añadir opción */}
              {addingTo === s.id ? (
                <div className="mt-2 p-2 rounded-lg bg-stone-50 border border-stone-200">
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); runSearch(e.target.value) }}
                    placeholder="Buscar producto de la marca…"
                    className="w-full text-sm px-2 py-1 border border-stone-300 rounded mb-1.5"
                  />
                  {searching ? (
                    <p className="text-xs text-stone-400 px-1">Buscando…</p>
                  ) : candidates.length === 0 ? (
                    <p className="text-xs text-stone-400 px-1">{brandId ? 'Sin resultados.' : 'Combo sin marca; no se puede buscar.'}</p>
                  ) : (
                    <div className="max-h-44 overflow-y-auto divide-y divide-stone-100">
                      {candidates.map((c) => (
                        <button key={c.id} onClick={() => pickOption(s.id, c)} disabled={busy}
                          className="flex items-center justify-between w-full px-2 py-1.5 text-sm hover:bg-white text-left">
                          <span className="truncate">{c.name}</span>
                          <span className="text-xs text-stone-400 ml-2 shrink-0">{fmtEur(c.price)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setAddingTo(null)} className="text-xs text-stone-500 underline mt-1.5">Cerrar</button>
                </div>
              ) : (
                <button onClick={() => openAdd(s.id)} disabled={busy}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#D67442] hover:underline mt-1">
                  <Plus size={12} /> Añadir opción
                </button>
              )}
            </div>
          </div>
        )
      })}

      <button onClick={addSlot} disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#D67442] text-white hover:bg-[#C25F2E] transition-colors disabled:opacity-50">
        <Plus size={13} /> Añadir grupo
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
  const [comboSlots, setComboSlots] = useState<ComboSlotDetail[] | null>(null) // null=no combo / sin cargar
  const [comboBrandId, setComboBrandId] = useState<string | null>(null)
  const [isCombo, setIsCombo] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Datos económicos — del motor menu_item_channel_economics (fuente única de verdad)
  const [econ, setEcon] = useState<ChannelEconomics[]>([])
  const [econReload, setEconReload] = useState(0)
  const [salesChannels, setSalesChannels] = useState<SalesChannelType[]>([])
  const [brandName, setBrandName] = useState<string>('')
  const [channelLogos, setChannelLogos] = useState<Record<string, string>>({})

  // Edición de identidad
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Foto (una sola: menu_item.photo_url)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoDeleting, setPhotoDeleting] = useState(false)
  const [photoConfirmDelete, setPhotoConfirmDelete] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // Edición inline (notas, packaging, avanzado)
  const [notesVal, setNotesVal] = useState('')
  const [showPrices, setShowPrices] = useState(false)
  const [availSaving, setAvailSaving] = useState(false)
  const [availConfirm, setAvailConfirm] = useState(false)
  const [availResult, setAvailResult] = useState<ProductAvailabilityResult | null>(null)
  const [availError, setAvailError] = useState<string | null>(null)
  const [packDesc, setPackDesc] = useState('')
  const [packCost, setPackCost] = useState('')
  const [kitchenNameVal, setKitchenNameVal] = useState('')
  const [shortNameVal, setShortNameVal] = useState('')
  const [fieldSaving, setFieldSaving] = useState<string | null>(null)

  // ── Vincular escandallo (picker) ──
  const [recipePickerOpen, setRecipePickerOpen] = useState(false)
  const [recipeOptions, setRecipeOptions] = useState<RecipeItem[]>([])
  const [recipeSearch, setRecipeSearch] = useState('')
  const [recipeLoading, setRecipeLoading] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

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

  // Contexto de combo (si el producto es combo, sus grupos/slots editables)
  useEffect(() => {
    if (!item) return
    let cancelled = false
    getComboContext(item.accountId, item.id)
      .then((ctx) => {
        if (cancelled) return
        setIsCombo(ctx.isCombo)
        setComboBrandId(ctx.brandId)
        setComboSlots(ctx.isCombo ? ctx.slots : null)
      })
      .catch(() => { if (!cancelled) { setIsCombo(false); setComboSlots(null) } })
    return () => { cancelled = true }
  }, [item?.id, item?.accountId])

  function reloadCombo() {
    if (!item) return
    getComboContext(item.accountId, item.id)
      .then((ctx) => { setComboSlots(ctx.isCombo ? ctx.slots : null) })
      .catch(() => {})
  }

  // Channel rates + recipe cost + brand + logos + locations
  useEffect(() => {
    if (!item) return
    let cancelled = false
    Promise.all([
      listSalesChannels(item.accountId),
      getMenuItemChannelEconomics(item.id),
    ]).then(([chs, rows]) => {
      if (cancelled) return
      setSalesChannels(chs)
      setEcon(rows)
    }).catch(() => {})
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
  }, [item?.id, item?.accountId, item?.recipeItemId, item?.brandId, econReload])

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

  // 86: marcar disponible/agotado (cascada cross-brand + empuje a canales en el servidor)
  async function handleToggleAvailability(next: boolean) {
    if (!item) return
    setAvailError(null)
    setAvailSaving(true)
    try {
      const res = await setProductAvailability(item.id, next, 'manual')
      setAvailResult(next ? null : res)   // mostramos el alcance solo al agotar
      setAvailConfirm(false)
      await refreshItem()
    } catch (err: unknown) {
      setAvailError(err instanceof Error ? err.message : 'Error cambiando disponibilidad')
    } finally {
      setAvailSaving(false)
    }
  }

  function openRecipePicker() {
    if (!item) return
    setRecipePickerOpen(true)
    setRecipeSearch('')
    setLinkError(null)
    setRecipeLoading(true)
    listRecipeItems({ accountId: item.accountId, type: 'dish', includeInactive: false })
      .then((rows) => setRecipeOptions(rows))
      .catch((err: unknown) => {
        setLinkError(err instanceof Error ? err.message : 'No se pudieron cargar los escandallos.')
        setRecipeOptions([])
      })
      .finally(() => setRecipeLoading(false))
  }

  async function linkRecipe(recipeItemId: string) {
    if (!item) return
    setLinking(true)
    setLinkError(null)
    try {
      await updateMenuItem(item.id, { recipeItemId })
      setRecipePickerOpen(false)
      await refreshItem()
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'No se pudo vincular el escandallo.')
    } finally {
      setLinking(false)
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
    setPhotoError(null)
    const prevUrl = item.photoUrl
    try {
      const url = await uploadMenuPhoto(item.accountId, item.id, file)
      await updateMenuItem(item.id, { photoUrl: url })
      // Limpia la foto anterior del bucket para no dejar huérfanas (best-effort).
      if (prevUrl && prevUrl !== url) {
        try { await deleteMenuPhoto(prevUrl) } catch { /* no bloquea el cambio */ }
      }
      await refreshItem()
    } catch (err: unknown) {
      console.error('CatalogProductDetailPage: subida de foto falló', err)
      setPhotoError(err instanceof Error ? err.message : 'No se pudo subir la foto.')
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function onPhotoDelete() {
    if (!item || !item.photoUrl) return
    setPhotoDeleting(true)
    setPhotoError(null)
    const url = item.photoUrl
    try {
      await updateMenuItem(item.id, { photoUrl: null })
      // Borra el objeto del bucket (best-effort: si falla, el item ya no lo referencia).
      try { await deleteMenuPhoto(url) } catch { /* no bloquea */ }
      await refreshItem()
    } catch (err: unknown) {
      console.error('CatalogProductDetailPage: borrado de foto falló', err)
      setPhotoError(err instanceof Error ? err.message : 'No se pudo eliminar la foto.')
    } finally {
      setPhotoDeleting(false)
      setPhotoConfirmDelete(false)
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

  // ─── Economía: derivada del motor (econ), una sola verdad ─────────────────

  const pvpSinIva = item.price ?? 0
  const vatPct = item.vatRate ?? 0
  const pvpConIva = Math.round(pvpSinIva * (1 + vatPct / 100) * 100) / 100
  const recipeCost = econ.find(e => e.costAvailable)?.cost ?? null
  const hasCost = recipeCost != null && recipeCost > 0
  const foodCostPct = hasCost && pvpSinIva > 0 ? Math.round(recipeCost! / pvpSinIva * 10000) / 100 : null

  let bestMargin: number | null = null
  let bestChannel = ''
  let bestMarginPct: number | null = null
  for (const e of econ) {
    if (e.netMargin == null) continue
    if (bestMargin === null || e.netMargin > bestMargin) {
      bestMargin = e.netMargin
      bestChannel = e.channelName
      bestMarginPct = e.netMarginPct
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

      {/* Aviso de error de foto (subida/borrado) */}
      {photoError && (
        <div className="mb-3 p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs flex items-center justify-between gap-3">
          <span>{photoError}</span>
          <button onClick={() => setPhotoError(null)} className="text-red-500 hover:text-red-700 shrink-0" aria-label="Cerrar aviso">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── HERO + IDENTITY CARD ── */}
      <div className="mb-2.5">
        <div className="-mb-16 relative z-0">
          {/* Foto principal (única) */}
          <div className="relative h-72 rounded-[14px] overflow-hidden">
            {item.photoUrl ? (
              <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightboxOpen(true)} />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#D4B896] via-[#B89B78] to-[#8B7355] flex flex-col items-center justify-center gap-3">
                <Camera size={44} className="text-white/30" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoUploading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-white/90 text-stone-800 hover:bg-white shadow-md transition-colors disabled:opacity-50"
                >
                  {photoUploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
                  {photoUploading ? 'Subiendo…' : 'Añadir foto'}
                </button>
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/35 to-transparent pointer-events-none" />

            {/* Badge de marca (arriba izquierda) */}
            <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md px-4 py-2 rounded-xl shadow-md flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-[#D67442] flex items-center justify-center text-white text-[10px] font-bold">
                {(brandName || item.category || 'P').charAt(0)}
              </span>
              <span className="text-sm font-medium text-stone-800">{brandName || item.category || 'Producto'}</span>
            </div>

            {/* Acciones de foto (arriba derecha) — solo cuando hay foto */}
            {item.photoUrl && (
              <div className="absolute top-4 right-4 flex items-center gap-2">
                {!photoConfirmDelete ? (
                  <>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={photoUploading || photoDeleting}
                      className="inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-md px-3 py-2 rounded-xl shadow-md text-sm font-medium text-stone-700 hover:bg-white transition-colors disabled:opacity-50"
                    >
                      {photoUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                      {photoUploading ? 'Subiendo…' : 'Cambiar'}
                    </button>
                    <button
                      onClick={() => setPhotoConfirmDelete(true)}
                      disabled={photoUploading || photoDeleting}
                      aria-label="Eliminar foto"
                      className="inline-flex items-center justify-center w-9 h-9 bg-white/95 backdrop-blur-md rounded-xl shadow-md text-stone-600 hover:bg-white hover:text-[#A32D2D] transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 bg-white/95 backdrop-blur-md px-3 py-2 rounded-xl shadow-md">
                    <span className="text-sm font-medium text-stone-700">¿Eliminar foto?</span>
                    <button
                      onClick={onPhotoDelete}
                      disabled={photoDeleting}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#A32D2D] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {photoDeleting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Sí
                    </button>
                    <button
                      onClick={() => setPhotoConfirmDelete(false)}
                      disabled={photoDeleting}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium text-stone-500 hover:bg-stone-100 disabled:opacity-50 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            )}
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
                  <button onClick={openRecipePicker} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[#D67442] text-white hover:bg-[#C25F2E] transition-colors">
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

        {/* S0 — Grupos del combo (solo si product_type='combo') */}
        {isCombo && (
          <CollapsibleSection
            id="s-combo"
            icon="sliders"
            title="Grupos del combo"
            badge={comboSlots ? `${comboSlots.length} grupo${comboSlots.length !== 1 ? 's' : ''}` : undefined}
            badgeColor="neutral"
            defaultOpen
          >
            {comboSlots === null ? (
              <p className="text-sm text-stone-400">Cargando grupos…</p>
            ) : (
              <ComboEditorSection
                accountId={item.accountId}
                brandId={comboBrandId}
                comboItemId={item.id}
                initialSlots={comboSlots}
                onChanged={reloadCombo}
              />
            )}
          </CollapsibleSection>
        )}

        {/* S1 — Escandallo y elaboración */}
        <CollapsibleSection id="s-escandallo" icon="chef-hat" title="Escandallo y elaboración"
          badge={hasRecipe ? 'OK' : 'Sin escandallo'} badgeColor={hasRecipe ? 'ok' : 'warn'} defaultOpen={hasRecipe}>
          {!hasRecipe ? (
            <EmptyState text="Sin escandallo vinculado. Conecta una receta para ver costes, alérgenos y elaboración.">
              <button onClick={openRecipePicker} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#D67442] text-white hover:bg-[#C25F2E] transition-colors">
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

          {/* Barras de margen por canal — del motor menu_item_channel_economics */}
          {econ.length > 0 ? (
            <div className="space-y-6">
              {econ.map(e => {
                const ch = salesChannels.find(s => s.id === e.channelId)
                const badge = ch
                  ? channelBadge(ch)
                  : <span className="h-11 px-4 rounded-xl flex items-center text-stone-800 text-base font-medium bg-stone-100 flex-shrink-0">{e.channelName}</span>
                const noRate = e.serviceType == null && e.commissionPct == null
                if (noRate) {
                  return (
                    <div key={e.channelId} className="flex items-center justify-between border border-dashed border-stone-200 rounded-[10px] px-5 py-4">
                      <div className="flex items-center gap-2.5 text-sm text-stone-400">
                        {badge} · sin configurar
                      </div>
                      <span className="text-sm font-medium text-[#D67442] cursor-pointer hover:underline">Configurar en Ajustes</span>
                    </div>
                  )
                }
                const price = e.price
                const cost = e.costAvailable ? (e.cost ?? 0) : 0
                const commAmt = e.commissionAmount ?? 0
                const orderCost = e.orderCostsPerItem ?? 0
                const margin = e.netMargin ?? 0
                const marginPct = e.netMarginPct ?? 0
                const hasOrderCosts = e.serviceType === 'own_delivery' && orderCost > 0
                const costPct = e.costAvailable && price > 0 ? Math.round(cost / price * 100) : 0
                const commPctBar = price > 0 ? Math.round(commAmt / price * 100) : 0
                const transPctBar = price > 0 ? Math.round(orderCost / price * 100) : 0
                const marginPctBar = Math.max(0, 100 - costPct - commPctBar - transPctBar)

                return (
                  <div key={e.channelId}>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2.5">{badge}</div>
                      <div className="text-right">
                        <span className={`font-mono text-xl font-medium ${margin >= 0 ? 'text-[#4A7A35]' : 'text-[#A32D2D]'}`}>{fmtEur(margin)}</span>
                        <div className="text-[12px] text-stone-400">{marginPct}% del PVP{!e.costAvailable ? ' · sin food cost' : ''}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12px] text-stone-500">
                      {e.costAvailable && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#A68B6B]" /> Food cost {fmtEur(e.cost)}</span>}
                      {e.commissionPct != null && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#4A6A8A]" /> Comisión {e.commissionPct}% ({fmtEur(commAmt)})</span>}
                      {hasOrderCosts && (
                        <span className="flex items-center gap-1.5 cursor-help"
                          title={`Coste de reparto propio por pedido: coste del rider${e.ownCourierCost != null ? ` (${fmtEur(e.ownCourierCost)})` : ''} + comisión fija${e.commissionFixed != null ? ` (${fmtEur(e.commissionFixed)})` : ''} − envío que paga el cliente${e.ownCustomerFee != null ? ` (${fmtEur(e.ownCustomerFee)})` : ''}, sin IVA, repartido entre ~2 platos por pedido. Es una estimación hasta tener ventas reales.`}>
                          <span className="w-2 h-2 rounded-sm bg-[#8BADC4]" /> Canal ≈{fmtEur(orderCost)} <span className="text-stone-300">ⓘ</span>
                        </span>
                      )}
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#7CB663]" /> Margen {fmtEur(margin)}</span>
                    </div>
                    <div className="h-7 rounded-lg overflow-hidden flex bg-[#ECEAE4]">
                      {e.costAvailable && costPct > 0 && <div className="h-full bg-[#A68B6B] transition-all duration-500" style={{ width: `${costPct}%` }} />}
                      {commPctBar > 0 && <div className="h-full bg-[#4A6A8A] transition-all duration-500" style={{ width: `${commPctBar}%` }} />}
                      {transPctBar > 0 && <div className="h-full bg-[#8BADC4] transition-all duration-500" style={{ width: `${transPctBar}%` }} />}
                      <div className="h-full bg-[#7CB663] transition-all duration-500" style={{ width: `${marginPctBar}%` }} />
                    </div>
                  </div>
                )
              })}
              {econ.some(e => e.serviceType === 'own_delivery') && (
                <p className="text-[12px] text-stone-400 leading-relaxed pt-3 border-t border-stone-200">
                  En los canales de reparto propio, el coste de canal = comisión fija + coste del rider − envío que paga el cliente (sin IVA), por pedido, repartido entre ~2 platos. Es una estimación; Folvy la afinará con el número real de platos por pedido cuando haya más ventas. El margen mostrado ya lo descuenta.
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
                    {item.isAvailable ? (
                      <button
                        onClick={() => { setAvailError(null); setAvailConfirm(true) }}
                        disabled={availSaving}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-green-700 hover:text-green-800 disabled:opacity-50"
                      >
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
                        Disponible
                      </button>
                    ) : (
                      <button
                        onClick={() => handleToggleAvailability(true)}
                        disabled={availSaving}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-stone-500 hover:text-green-700 disabled:opacity-50"
                      >
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-stone-300" />
                        {availSaving ? 'Reactivando…' : 'Agotado · reactivar'}
                      </button>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {availConfirm && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900">¿Marcar como agotado?</p>
              <p className="text-amber-800 mt-0.5">
                Se agotará en <strong>todas las marcas</strong> que comparten este producto y se retirará de las plataformas (Glovo, Uber, JustEat) donde esté publicado. Podrás reactivarlo cuando quieras.
              </p>
              <div className="flex gap-2 mt-2.5">
                <button
                  onClick={() => handleToggleAvailability(false)}
                  disabled={availSaving}
                  className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-[13px] font-medium hover:bg-amber-700 disabled:opacity-50"
                >
                  {availSaving ? 'Agotando…' : 'Sí, agotar'}
                </button>
                <button
                  onClick={() => setAvailConfirm(false)}
                  disabled={availSaving}
                  className="px-3 py-1.5 rounded-md border border-stone-300 text-[13px] font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {availResult && !item.isAvailable && (
            <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-[13px] text-stone-600">
              Agotado en <strong>{availResult.brands}</strong> marca{availResult.brands === 1 ? '' : 's'}
              {' · '}<strong>{availResult.channels}</strong> canal{availResult.channels === 1 ? '' : 'es'}
              {' '}({availResult.affectedItems} ficha{availResult.affectedItems === 1 ? '' : 's'}).
            </div>
          )}
          {availError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{availError}</div>
          )}
          <button onClick={() => setShowPrices(true)} className="mt-3 text-sm font-medium text-[#D67442] hover:underline">Editar precios</button>
        </CollapsibleSection>

        {showPrices && item && (
          <EditPricesModal
            menuItemId={item.id}
            productName={item.name}
            basePrice={item.price ?? 0}
            vatRate={item.vatRate ?? 0}
            onClose={() => setShowPrices(false)}
            onSaved={async () => { setShowPrices(false); setEconReload(v => v + 1); await refreshItem() }}
          />
        )}

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

        {/* S10 — Marcas, categoría y disponibilidad (interactivo) */}
        <CollapsibleSection id="s-marcas" icon="map-pin" title="Marcas y categoría" defaultOpen>
          <ProductPlacementSection
            accountId={item.accountId}
            menuItemId={item.id}
            recipeItemId={item.recipeItemId}
            currentBrandId={item.brandId}
            productName={item.name}
            basePrice={item.price}
            onChanged={refreshItem}
          />
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

      {recipePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !linking && setRecipePickerOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200">
              <div className="flex items-center gap-2 text-stone-800">
                <Link2 size={16} className="text-[#D67442]" />
                <span className="text-sm font-medium">Vincular escandallo a «{item?.name}»</span>
              </div>
              <button onClick={() => !linking && setRecipePickerOpen(false)} className="text-stone-400 hover:text-stone-700 disabled:opacity-50" disabled={linking}>
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-stone-100">
              <input
                type="text"
                autoFocus
                value={recipeSearch}
                onChange={(e) => setRecipeSearch(e.target.value)}
                placeholder="Buscar escandallo por nombre…"
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]"
              />
            </div>
            {linkError && (
              <div className="mx-5 mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{linkError}</div>
            )}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {recipeLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Cargando escandallos…
                </div>
              ) : (() => {
                const q = recipeSearch.trim().toLowerCase()
                const filtered = q === '' ? recipeOptions : recipeOptions.filter((r) => r.name.toLowerCase().includes(q))
                if (filtered.length === 0) {
                  return <div className="py-10 text-center text-sm text-stone-400">No hay escandallos que coincidan.</div>
                }
                return (
                  <ul className="space-y-0.5">
                    {filtered.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => linkRecipe(r.id)}
                          disabled={linking}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[#D67442]/5 disabled:opacity-50 transition-colors group"
                        >
                          <div className="min-w-0">
                            <div className="text-sm text-stone-800 truncate">{r.name}</div>
                            {r.code && <div className="text-[11px] text-stone-400">{r.code}</div>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs tabular-nums text-stone-500">{fmtEur(r.computedCost)}</span>
                            <Link2 size={14} className="text-stone-300 group-hover:text-[#D67442]" />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </div>
            <div className="px-5 py-3 border-t border-stone-100 flex items-center justify-between">
              <span className="text-[11px] text-stone-400">
                {linking ? 'Vinculando…' : 'Elige el escandallo que corresponde a este producto.'}
              </span>
              <button onClick={() => !linking && setRecipePickerOpen(false)} disabled={linking} className="px-3 py-1.5 text-sm rounded-lg text-stone-500 hover:bg-stone-50 disabled:opacity-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
