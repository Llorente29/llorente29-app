// src/modules/kitchen/pages/KitchenItemDetailPage.tsx
//
// Vista DETALLE de un ingrediente (recipe_item type='raw'), estándar visual v2:
// HERO PARTIDO (foto + barra de acciones · cuadro de mando) + secciones
// colapsables. Patrón LISTA + DETALLE por estado: recibe { itemId, onBack }
// (contrato INTACTO → KitchenItemsPage no se toca). Tokens de la app.
//
// T2.1: la ficha contiene TODO en colapsables (vale de fábrica para toda la
// hostelería). Campos: identidad+clasificación (nombre comercial, familia,
// código, origen), coste+uso (con merma), conservación+temporada (con vida
// útil). Edición unificada: un único formulario con todos los campos.
//
// Foto: recipe_item.kitchen_photo_url guarda el STORAGE PATH (bucket privado
// recipe-uploads); URL firmada al vuelo con getDishPhotoUrl.
//
// Secciones honesto-vacías (deuda con disparador): Alérgenos (servicio
// pendiente), Nutrición, Cortes y merma, Stock, Histórico.

import { useEffect, useMemo, useState, type ReactNode, type ChangeEvent } from 'react'
import {
  ArrowLeft, Archive, Check, Loader2, Pencil, X, ChevronDown, ImagePlus, Trash2,
  ChefHat, AlertTriangle, Activity, Scissors, Boxes, Clock, Snowflake, Settings2,
  TrendingUp, Tag,
} from 'lucide-react'
import { useApp } from '@/context/AppContext'
import {
  getRecipeItemById,
  updateRecipeItem,
  archiveRecipeItem,
  getRawUsageCounts,
} from '@/modules/kitchen/services/recipeItemService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import { listSuppliers, listSuppliersByItem } from '@/modules/kitchen/services/purchaseFormatService'
import {
  listIngredientFamilies,
  type IngredientFamily,
} from '@/modules/kitchen/services/ingredientFamilyService'
import { uploadDishPhoto, getDishPhotoUrl, deleteDishPhoto } from '@/modules/kitchen/services/recipePhotoService'
import PurchaseSourcesSection from '@/modules/kitchen/components/PurchaseSourcesSection'
import ItemVatSelector from '@/modules/kitchen/components/ItemVatSelector'
import IngredientAiAssistButton from '@/modules/kitchen/components/IngredientAiAssistButton'
import type { RecipeItem, KitchenUnit, Supplier, ArticleSupplier, RecipeItemUpdate, ConservationType } from '@/types/kitchen'

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatEur(value: number | null | undefined, maxDecimals = 5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: maxDecimals,
  }).format(value)
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) }
  catch { return '—' }
}

function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

// "1 jun – 30 sep" a partir de dos fechas; ambas opcionales.
function formatSeason(start: string | null, end: string | null): string {
  if (!start && !end) return '—'
  return `${formatDateShort(start)} – ${formatDateShort(end)}`
}

function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function dateInputValue(iso: string | null): string {
  if (!iso) return ''
  return iso.length >= 10 ? iso.slice(0, 10) : iso
}

// Coste EFECTIVO: COALESCE(computed_cost, fixed_cost), igual que el motor en BBDD.
function effectiveCost(item: RecipeItem): number | null {
  if (item.computedCost !== null && item.computedCost !== undefined) return item.computedCost
  if (item.fixedCost !== null && item.fixedCost !== undefined) return item.fixedCost
  return null
}

const DIM_LABEL: Record<string, string> = { weight: 'Peso', volume: 'Volumen', unit: 'Unidades' }

const CONSERVATION_LABEL: Record<string, string> = {
  fridge: 'Refrigeración', freezer: 'Congelación', dry: 'Seco / ambiente', hot: 'Caliente',
}
const CONSERVATION_OPTIONS: { value: ConservationType; label: string }[] = [
  { value: 'fridge', label: 'Refrigeración' },
  { value: 'freezer', label: 'Congelación' },
  { value: 'dry', label: 'Seco / ambiente' },
  { value: 'hot', label: 'Caliente' },
]

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function CollapsibleSection({
  icon, title, badge, badgeTone, defaultOpen, children,
}: {
  icon: ReactNode; title: string; badge?: string;
  badgeTone?: 'ok' | 'warn' | 'neutral'; defaultOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const badgeCls =
    badgeTone === 'ok' ? 'bg-success-bg text-success'
      : badgeTone === 'warn' ? 'bg-warning-bg text-warning'
        : 'bg-page text-text-secondary'
  return (
    <div className="border-t border-border-default first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center w-full gap-2 px-4 py-3 text-left hover:bg-page transition-base"
      >
        <span className="text-text-secondary flex-shrink-0">{icon}</span>
        <span className="text-sm font-medium text-text-primary flex-1">{title}</span>
        {badge && <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${badgeCls}`}>{badge}</span>}
        <ChevronDown size={14} className={`text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// Celda de dato (label arriba, valor abajo) reutilizable en las secciones.
function DataCell({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="bg-page rounded-md px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-text-secondary mb-0.5">{label}</div>
      <div className={`text-sm text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

// Campo de formulario (label + control).
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-secondary mt-1">{hint}</p>}
    </div>
  )
}

const INPUT_CLS =
  'w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50'

interface KitchenItemDetailPageProps {
  itemId: string
  onBack: () => void
}

export default function KitchenItemDetailPage({ itemId, onBack }: KitchenItemDetailPageProps) {
  const { userProfile, authUserId } = useApp()

  const [item, setItem] = useState<RecipeItem | null>(null)
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [families, setFamilies] = useState<IngredientFamily[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Cuadro de mando: uso + proveedores
  const [usageCount, setUsageCount] = useState<number | null>(null)
  const [links, setLinks] = useState<ArticleSupplier[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  // Foto
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoDeleting, setPhotoDeleting] = useState(false)
  const [photoConfirmDelete, setPhotoConfirmDelete] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  // Edición unificada
  const [editing, setEditing] = useState(false)
  const [fName, setFName] = useState('')
  const [fAltName, setFAltName] = useState('')
  const [fCode, setFCode] = useState('')
  const [fFamilyId, setFFamilyId] = useState('')
  const [fBaseUnitId, setFBaseUnitId] = useState('')
  const [fOrigin, setFOrigin] = useState('')
  const [fConservation, setFConservation] = useState('')
  const [fServiceTemp, setFServiceTemp] = useState('')
  const [fWastePct, setFWastePct] = useState('')
  const [fShelfLife, setFShelfLife] = useState('')
  const [fSeasonStart, setFSeasonStart] = useState('')
  const [fSeasonEnd, setFSeasonEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  // Disparador de recarga del item (tras aplicar el copiloto IA, etc.)
  const [reloadTick, setReloadTick] = useState(0)

  const actorId = authUserId ?? null
  const actorName = userProfile?.displayName ?? null

  // ── Carga principal: item + unidades ──
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getRecipeItemById(itemId), listUnits()])
      .then(([it, allUnits]) => {
        if (cancelled) return
        if (!it) { setError('Este ingrediente ya no existe.'); setItem(null) }
        else setItem(it)
        setUnits(allUnits)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando el ingrediente.')
        setItem(null); setUnits([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [itemId, reloadTick])

  // ── Familias de la cuenta (para mostrar nombre + selector) ──
  useEffect(() => {
    if (!item) return
    let cancelled = false
    listIngredientFamilies(item.accountId)
      .then((fs) => { if (!cancelled) setFamilies(fs) })
      .catch(() => { if (!cancelled) setFamilies([]) })
    return () => { cancelled = true }
  }, [item?.accountId])

  // ── Uso en platos (RPC) ──
  useEffect(() => {
    if (!item) return
    let cancelled = false
    getRawUsageCounts(item.accountId)
      .then((counts) => { if (!cancelled) setUsageCount(counts[item.id] ?? 0) })
      .catch(() => { if (!cancelled) setUsageCount(null) })
    return () => { cancelled = true }
  }, [item?.id, item?.accountId])

  // ── Proveedores del ingrediente (cuadro + semáforo) ──
  useEffect(() => {
    if (!item) return
    let cancelled = false
    Promise.all([listSuppliers(item.accountId), listSuppliersByItem(item.id)])
      .then(([sup, lnk]) => { if (!cancelled) { setSuppliers(sup); setLinks(lnk) } })
      .catch(() => { if (!cancelled) { setSuppliers([]); setLinks([]) } })
    return () => { cancelled = true }
  }, [item?.id, item?.accountId])

  // ── URL firmada de la foto ──
  useEffect(() => {
    if (!item) { setPhotoUrl(null); return }
    let cancelled = false
    getDishPhotoUrl(item.kitchenPhotoUrl)
      .then((url) => { if (!cancelled) setPhotoUrl(url) })
      .catch(() => { if (!cancelled) setPhotoUrl(null) })
    return () => { cancelled = true }
  }, [item?.id, item?.kitchenPhotoUrl])

  // ── Refrescos ──
  async function refreshItem() {
    try {
      const fresh = await getRecipeItemById(itemId)
      if (fresh) setItem(fresh)
    } catch (err: unknown) {
      console.error('KitchenItemDetailPage: refresco del item falló', err)
    }
  }
  async function refreshSuppliers() {
    if (!item) return
    try { setLinks(await listSuppliersByItem(item.id)) } catch { /* no crítico */ }
  }

  // ── Derivados ──
  const baseUnit = useMemo(
    () => (item ? units.find((u) => u.id === item.baseUnitId) ?? null : null),
    [units, item],
  )
  const unitsGrouped = useMemo(() => {
    const groups = new Map<string, KitchenUnit[]>()
    units.forEach((u) => {
      const list = groups.get(u.dimension) ?? []
      list.push(u); groups.set(u.dimension, list)
    })
    return groups
  }, [units])
  const familyName = useMemo(
    () => (item?.familyId ? families.find((f) => f.id === item.familyId)?.name ?? null : null),
    [families, item?.familyId],
  )
  const preferredSupplierName = useMemo(() => {
    const pref = links.find((l) => l.isPreferred) ?? links[0] ?? null
    if (!pref) return null
    return suppliers.find((s) => s.id === pref.supplierId)?.name ?? null
  }, [links, suppliers])

  // ── Edición ──
  function openEdit() {
    if (!item) return
    setFName(item.name)
    setFAltName(item.altName ?? '')
    setFCode(item.code ?? '')
    setFFamilyId(item.familyId ?? '')
    setFBaseUnitId(item.baseUnitId)
    setFOrigin(item.origin ?? '')
    setFConservation(item.conservationType ?? '')
    setFServiceTemp(item.serviceTempC != null ? String(item.serviceTempC) : '')
    setFWastePct(item.defaultWastePct != null ? String(item.defaultWastePct) : '')
    setFShelfLife(item.shelfLifeDays != null ? String(item.shelfLifeDays) : '')
    setFSeasonStart(dateInputValue(item.seasonStart))
    setFSeasonEnd(dateInputValue(item.seasonEnd))
    setFormError(null)
    setEditing(true)
  }

  async function saveEdit() {
    if (!item) return
    const name = fName.trim()
    if (name === '') { setFormError('El nombre es obligatorio.'); return }
    if (!fBaseUnitId) { setFormError('Elige una unidad base.'); return }

    const shelf = parseNum(fShelfLife)
    const patch: RecipeItemUpdate = {
      name,
      altName: fAltName.trim() || null,
      code: fCode.trim() || null,
      familyId: fFamilyId || null,
      baseUnitId: fBaseUnitId,
      origin: fOrigin.trim() || null,
      conservationType: (fConservation || null) as ConservationType | null,
      serviceTempC: parseNum(fServiceTemp),
      defaultWastePct: parseNum(fWastePct),
      shelfLifeDays: shelf === null ? null : Math.round(shelf),
      seasonStart: fSeasonStart || null,
      seasonEnd: fSeasonEnd || null,
    }
    setSaving(true)
    setFormError(null)
    try {
      await updateRecipeItem(item.id, patch)
      setEditing(false)
      await refreshItem()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!item) return
    const ok = window.confirm(`¿Archivar "${item.name}"? Dejará de aparecer en el catálogo.`)
    if (!ok) return
    setArchiving(true)
    try {
      await archiveRecipeItem(item.id)
      onBack()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'No se pudo archivar.')
      setArchiving(false)
    }
  }

  // ── Foto ──
  async function onPhotoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !item) return
    setPhotoUploading(true); setPhotoError(null)
    const prevPath = item.kitchenPhotoUrl
    try {
      const path = await uploadDishPhoto(item.accountId, item.id, file)
      await updateRecipeItem(item.id, { kitchenPhotoUrl: path })
      if (prevPath && prevPath !== path) { try { await deleteDishPhoto(prevPath) } catch { /* best-effort */ } }
      await refreshItem()
    } catch (err: unknown) {
      console.error('KitchenItemDetailPage: subida de foto falló', err)
      setPhotoError(err instanceof Error ? err.message : 'No se pudo subir la foto.')
    } finally {
      setPhotoUploading(false); e.target.value = ''
    }
  }
  async function onPhotoDelete() {
    if (!item || !item.kitchenPhotoUrl) return
    setPhotoDeleting(true); setPhotoError(null)
    const path = item.kitchenPhotoUrl
    try {
      await updateRecipeItem(item.id, { kitchenPhotoUrl: null })
      try { await deleteDishPhoto(path) } catch { /* best-effort */ }
      await refreshItem()
    } catch (err: unknown) {
      console.error('KitchenItemDetailPage: borrado de foto falló', err)
      setPhotoError(err instanceof Error ? err.message : 'No se pudo eliminar la foto.')
    } finally {
      setPhotoDeleting(false); setPhotoConfirmDelete(false)
    }
  }

  // ── Carga / error ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando ingrediente…
      </div>
    )
  }
  if (error || !item) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base">
          <ArrowLeft size={16} /> Ingredientes
        </button>
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error ?? 'Ingrediente no encontrado.'}
        </div>
      </div>
    )
  }

  // ── Semáforo "Utilizable" (honesto) ──
  const cost = effectiveCost(item)
  const okPrecio = cost !== null
  const okUnidad = !!item.baseUnitId
  const okProveedor = links.length > 0
  const usable = okPrecio && okUnidad && okProveedor
  const checks: { label: string; ok: boolean }[] = [
    { label: 'Precio', ok: okPrecio },
    { label: 'Unidad', ok: okUnidad },
    { label: 'Proveedor', ok: okProveedor },
  ]
  const costOrigin = item.costStrategy === 'fixed' ? 'Tecleado a mano' : 'Desde la compra'

  return (
    <div className="max-w-6xl pb-8">
      <input id="ingredient-photo-input" type="file" accept="image/*" className="hidden" onChange={onPhotoSelected} />

      {/* TOP BAR */}
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base">
          <ArrowLeft size={16} /> Ingredientes
        </button>
      </div>

      {photoError && (
        <div className="mb-3 p-2.5 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs flex items-center justify-between gap-3">
          <span>{photoError}</span>
          <button type="button" onClick={() => setPhotoError(null)} className="text-danger hover:opacity-70 flex-shrink-0" aria-label="Cerrar aviso"><X size={14} /></button>
        </div>
      )}

      {editing ? (
        /* ───────── MODO EDICIÓN (formulario unificado) ───────── */
        <div className="rounded-lg border border-border-default bg-card">
          <div className="px-4 py-3 border-b border-border-default">
            <h2 className="text-base font-display font-medium text-text-primary">Editar ingrediente</h2>
          </div>
          <div className="p-4 space-y-5">
            {/* Identidad y clasificación */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Identidad y clasificación</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Nombre"><input type="text" value={fName} onChange={(e) => setFName(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <Field label="Nombre comercial / alternativo" hint="Cómo lo llama el proveedor, la factura o el TPV."><input type="text" value={fAltName} onChange={(e) => setFAltName(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <Field label="Familia">
                  <select value={fFamilyId} onChange={(e) => setFFamilyId(e.target.value)} disabled={saving} className={`${INPUT_CLS} cursor-pointer`}>
                    <option value="">— Sin clasificar —</option>
                    {families.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                  </select>
                </Field>
                <Field label="Código interno"><input type="text" value={fCode} onChange={(e) => setFCode(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <Field label="Origen / procedencia" hint="Trazabilidad de origen (opcional)."><input type="text" value={fOrigin} onChange={(e) => setFOrigin(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <Field label="Unidad base" hint="Afecta a cómo se interpretan compra y receta. Cámbiala solo si estaba mal.">
                  <select value={fBaseUnitId} onChange={(e) => setFBaseUnitId(e.target.value)} disabled={saving || units.length === 0} className={`${INPUT_CLS} cursor-pointer`}>
                    {Array.from(unitsGrouped.entries()).map(([dim, list]) => (
                      <optgroup key={dim} label={DIM_LABEL[dim] ?? dim}>
                        {list.map((u) => (<option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            {/* Coste */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Coste</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Merma por defecto (%)" hint="Parte que se pierde al preparar. El coste real usa cantidad bruta.">
                  <input type="text" inputMode="decimal" value={fWastePct} onChange={(e) => setFWastePct(e.target.value)} disabled={saving} placeholder="Ej: 8" className={INPUT_CLS} />
                </Field>
              </div>
            </div>

            {/* Conservación y temporada */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Conservación y temporada</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Conservación">
                  <select value={fConservation} onChange={(e) => setFConservation(e.target.value)} disabled={saving} className={`${INPUT_CLS} cursor-pointer`}>
                    <option value="">—</option>
                    {CONSERVATION_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </Field>
                <Field label="Temp. de servicio (°C)"><input type="text" inputMode="decimal" value={fServiceTemp} onChange={(e) => setFServiceTemp(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <Field label="Vida útil (días)" hint="Caducidad típica; habilitará alertas FIFO."><input type="text" inputMode="numeric" value={fShelfLife} onChange={(e) => setFShelfLife(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Temporada desde"><input type="date" value={fSeasonStart} onChange={(e) => setFSeasonStart(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                  <Field label="hasta"><input type="date" value={fSeasonEnd} onChange={(e) => setFSeasonEnd(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                </div>
              </div>
            </div>

            {formError && (<div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{formError}</div>)}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditing(false)} disabled={saving} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">
                <X size={14} /> Cancelar
              </button>
              <button type="button" onClick={saveEdit} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ───────── MODO VISTA ───────── */
        <>
          {/* HERO PARTIDO */}
          <div className="flex flex-col md:flex-row gap-4 items-stretch">
            {/* foto + acciones */}
            <div className="w-full md:w-[38%] md:min-w-[230px] flex flex-col rounded-lg overflow-hidden border border-border-default flex-shrink-0">
              <div className="relative flex-1 min-h-[150px] bg-accent-bg flex items-center justify-center">
                {photoUrl ? (
                  <img src={photoUrl} alt={item.name} className="w-full h-full object-cover absolute inset-0" />
                ) : (
                  <ChefHat size={46} className="text-accent/35" />
                )}
              </div>
              <div className="flex gap-2 p-2.5 bg-card border-t border-border-default">
                {!photoConfirmDelete ? (
                  <>
                    <button type="button" onClick={() => document.getElementById('ingredient-photo-input')?.click()} disabled={photoUploading || photoDeleting}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium border border-border-default bg-card text-text-primary hover:bg-page transition-base disabled:opacity-50">
                      {photoUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                      {photoUploading ? 'Subiendo…' : item.kitchenPhotoUrl ? 'Cambiar foto' : 'Añadir foto'}
                    </button>
                    {item.kitchenPhotoUrl && (
                      <button type="button" onClick={() => setPhotoConfirmDelete(true)} disabled={photoUploading || photoDeleting} aria-label="Eliminar foto"
                        className="w-10 inline-flex items-center justify-center rounded-md border border-border-default bg-card text-text-secondary hover:text-danger transition-base disabled:opacity-50">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-between gap-2">
                    <span className="text-sm text-text-secondary">¿Eliminar foto?</span>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={onPhotoDelete} disabled={photoDeleting} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-danger text-white hover:opacity-90 disabled:opacity-50 transition-base">
                        {photoDeleting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Sí
                      </button>
                      <button type="button" onClick={() => setPhotoConfirmDelete(false)} disabled={photoDeleting} className="px-2.5 py-1 rounded-md text-xs font-medium text-text-secondary hover:bg-page disabled:opacity-50 transition-base">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* cuadro de mando */}
            <div className="flex-1 min-w-0 flex flex-col rounded-lg border border-border-default bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl font-display font-medium text-text-primary leading-tight truncate">{item.name}</h1>
                  <div className="text-sm text-text-secondary mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {familyName && <span className="inline-flex items-center gap-1"><Tag size={12} /> {familyName}</span>}
                    {familyName && <span className="text-border-default">·</span>}
                    <span>{item.conservationType ? CONSERVATION_LABEL[item.conservationType] ?? item.conservationType : 'Ingrediente'}</span>
                    {baseUnit && <><span className="text-border-default">·</span><span>base {baseUnit.abbreviation}</span></>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full font-medium ${usable ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'}`}>
                    {usable ? <Check size={12} /> : <AlertTriangle size={12} />}
                    {usable ? 'Utilizable' : 'Incompleto'}
                  </span>
                  <IngredientAiAssistButton
                    itemId={item.id}
                    accountId={item.accountId}
                    onApplied={() => setReloadTick(t => t + 1)}
                  />
                  <button type="button" onClick={openEdit} aria-label="Editar" className="p-1.5 rounded-md text-text-secondary hover:text-accent hover:bg-page transition-base"><Pencil size={15} /></button>
                </div>
              </div>

              <div className="flex items-baseline gap-3 mt-3">
                <span className="font-mono text-3xl font-medium text-text-primary">{formatEur(cost)}</span>
                <span className="text-sm text-text-secondary">
                  {baseUnit ? `/ ${baseUnit.abbreviation}` : ''} · {costOrigin}
                  {item.costUpdatedAt ? ` · act. ${formatDateShort(item.costUpdatedAt)}` : ''}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5 mt-4">
                <div className="bg-page rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-secondary mb-0.5">Stock aquí</div>
                  <div className="font-mono text-sm text-text-tertiary">— <span className="font-sans text-xs">sin inventario</span></div>
                </div>
                <div className="bg-page rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-secondary mb-0.5">Usado en</div>
                  <div className="font-mono text-sm text-text-primary">{usageCount === null ? '—' : usageCount} <span className="font-sans text-xs text-text-secondary">platos</span></div>
                </div>
                <div className="bg-page rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-secondary mb-0.5">Proveedor</div>
                  <div className="text-sm text-text-primary truncate">{preferredSupplierName ?? '—'}</div>
                </div>
              </div>

              <div className="flex items-center gap-4 mt-auto pt-4">
                {checks.map((c) => (
                  <span key={c.label} className={`inline-flex items-center gap-1.5 text-xs ${c.ok ? 'text-success' : 'text-text-tertiary'}`}>
                    <span className={`w-2 h-2 rounded-full ${c.ok ? 'bg-success' : 'bg-border-default'}`} />{c.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* SECCIONES */}
          <div className="mt-4 rounded-lg border border-border-default bg-card overflow-hidden">
            <CollapsibleSection icon={<Tag size={16} />} title="Identidad y clasificación" defaultOpen>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <DataCell label="Nombre comercial" value={item.altName ?? '—'} />
                <DataCell label="Familia" value={familyName ?? 'Sin clasificar'} />
                <DataCell label="Código" value={item.code ?? '—'} mono />
                <DataCell label="Origen" value={item.origin ?? '—'} />
              </div>
            </CollapsibleSection>

            <CollapsibleSection icon={<TrendingUp size={16} />} title="Coste y uso" defaultOpen>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <DataCell label={`Coste / ${baseUnit?.abbreviation ?? 'base'}`} value={formatEur(cost)} mono />
                <DataCell label="Origen del coste" value={costOrigin} />
                <DataCell label="Merma por defecto" value={item.defaultWastePct != null ? `${item.defaultWastePct} %` : '—'} mono />
                <DataCell label="Usado en" value={usageCount === null ? '—' : `${usageCount} platos`} mono />
              </div>
              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <DataCell label="Actualizado" value={formatDateShort(item.costUpdatedAt)} />
              </div>
            </CollapsibleSection>

            <CollapsibleSection icon={<AlertTriangle size={16} />} title="Alérgenos" badge="Próximamente" badgeTone="neutral">
              <p className="text-sm text-text-secondary">Declaración por los 14 del Reglamento UE 1169 (contiene / trazas / no contiene). Disponible cuando se active el servicio de alérgenos.</p>
            </CollapsibleSection>

            <CollapsibleSection icon={<Activity size={16} />} title="Nutrición" badge="Próximamente" badgeTone="neutral">
              <p className="text-sm text-text-secondary">Información nutricional por 100 g. Pendiente de editor.</p>
            </CollapsibleSection>

            <CollapsibleSection icon={<Scissors size={16} />} title="Cortes y merma" badge="Próximamente" badgeTone="neutral">
              <p className="text-sm text-text-secondary">Cortes con su rendimiento y coste resultante.</p>
            </CollapsibleSection>

            <CollapsibleSection icon={<Boxes size={16} />} title="Stock por almacén" badge="—" badgeTone="neutral">
              <p className="text-sm text-text-secondary">Sin inventario todavía. Se llena con la primera recepción o conteo.</p>
            </CollapsibleSection>

            <CollapsibleSection icon={<Clock size={16} />} title="Histórico de compras" badge="—" badgeTone="neutral">
              <p className="text-sm text-text-secondary">Últimas recepciones y total por año. Se construye desde recepción / factura.</p>
            </CollapsibleSection>

            <CollapsibleSection icon={<Snowflake size={16} />} title="Conservación y temporada">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <DataCell label="Conservación" value={item.conservationType ? CONSERVATION_LABEL[item.conservationType] ?? item.conservationType : '—'} />
                <DataCell label="Temp. de servicio" value={item.serviceTempC != null ? `${item.serviceTempC} °C` : '—'} />
                <DataCell label="Vida útil" value={item.shelfLifeDays != null ? `${item.shelfLifeDays} días` : '—'} mono />
                <DataCell label="Temporada" value={formatSeason(item.seasonStart, item.seasonEnd)} />
              </div>
            </CollapsibleSection>

            <CollapsibleSection icon={<Settings2 size={16} />} title="Avanzado">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <div><div className="text-[11px] text-text-secondary">Código</div><div className="font-mono text-text-primary">{item.code ?? item.id.slice(0, 8)}</div></div>
                <div><div className="text-[11px] text-text-secondary">Unidad base</div><div className="text-text-primary">{baseUnit ? `${baseUnit.name} (${baseUnit.abbreviation})` : '—'}</div></div>
                <div><div className="text-[11px] text-text-secondary">Origen del dato</div><div className="text-text-primary">{item.source === 'manual' ? 'Manual' : item.source === 'ocr_invoice' ? 'OCR factura' : item.source === 'ai_recipe' ? 'IA' : 'Importado'}</div></div>
                <div className="sm:col-span-3 pt-2 border-t border-border-default text-[11px] text-text-secondary flex flex-wrap gap-x-6 gap-y-1">
                  <span>Creado: {formatDateLong(item.createdAt)}</span>
                  <span>Actualizado: {formatDateLong(item.updatedAt)}</span>
                  {item.createdByName ? <span>Por: {item.createdByName}</span> : null}
                </div>
              </div>
            </CollapsibleSection>
          </div>

          {/* PROVEEDORES Y COMPRA */}
          <div className="mt-4">
            <PurchaseSourcesSection item={item} units={units} actorId={actorId} actorName={actorName} onChanged={() => { void refreshItem(); void refreshSuppliers() }} />
          </div>

          {/* IVA */}
          <div className="mt-4">
            <ItemVatSelector item={item} onChanged={refreshItem} />
          </div>

          {/* Archivar */}
          <div className="pt-4">
            <button type="button" onClick={handleArchive} disabled={archiving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-danger hover:bg-danger-bg transition-base disabled:opacity-50">
              <Archive size={14} />
              {archiving ? 'Archivando…' : 'Archivar ingrediente'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
