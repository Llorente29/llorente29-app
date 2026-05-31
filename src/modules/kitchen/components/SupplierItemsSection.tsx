// src/modules/kitchen/components/SupplierItemsSection.tsx
//
// Zona "Artículos que le compras" de la ficha de un proveedor. Es la cara
// inversa de PurchaseSourcesSection (que vive en el ingrediente): aquí ves,
// desde el proveedor, qué ingredientes le compras, a qué formato y precio.
//
// REGLA DE DISEÑO (decidida): el ALTA del vínculo proveedor↔ingrediente vive
// SOLO en el ingrediente (Ingredientes → ficha → Compra/Proveedores). Desde
// aquí solo se GESTIONAN los existentes: editar precio, marcar principal
// (exclusivo por ingrediente) y quitar el vínculo. Por eso el estado vacío
// REEDUCA (dice dónde se crean) en vez de ofrecer un alta que no toca aquí.
//
// Coste: la sección resuelve los formatos con listFormatsByItem por cada
// ingrediente distinto del proveedor (N llamadas). Trivial para un proveedor
// con pocos artículos. Deuda menor declarada: fetch en lote si crece mucho.

import { useEffect, useMemo, useState } from 'react'
import { ShoppingBag, Star, Check, Pencil, Trash2, Loader2, Info } from 'lucide-react'
import {
  listLinksBySupplier,
  listFormatsByItem,
  setPreferredSupplier,
  unlinkSupplierFormat,
  updateArticleSupplier,
} from '@/modules/kitchen/services/purchaseFormatService'
import { listRecipeItems } from '@/modules/kitchen/services/recipeItemService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import { unitCostFromFormat } from '@/modules/kitchen/lib/unitConversion'
import type {
  Supplier,
  ArticleSupplier,
  PurchaseFormat,
  RecipeItem,
  KitchenUnit,
} from '@/types/kitchen'

function parseDecimal(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function fmtEur(v: number | null | undefined, maxDecimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  }).format(v)
}

function fmtNum(v: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(v)
}

// "Actualizado hace…" a partir de updated_at del vínculo (fecha del último precio).
function formatRelative(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const day = 86_400_000
  const days = Math.floor((Date.now() - then) / day)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`
  if (days < 30) {
    const w = Math.floor(days / 7)
    return `hace ${w} semana${w > 1 ? 's' : ''}`
  }
  const m = Math.floor(days / 30)
  return `hace ${m} mes${m > 1 ? 'es' : ''}`
}

interface SupplierItemsSectionProps {
  supplier: Supplier
  /** Se llama tras cualquier cambio (precio/principal/quitar) por si el padre refresca contadores. */
  onChanged?: () => void
}

export default function SupplierItemsSection({ supplier, onChanged }: SupplierItemsSectionProps) {
  const [links, setLinks] = useState<ArticleSupplier[]>([])
  const [items, setItems] = useState<RecipeItem[]>([])
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [formats, setFormats] = useState<PurchaseFormat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const [lnk, its, uts] = await Promise.all([
        listLinksBySupplier(supplier.id),
        listRecipeItems({ accountId: supplier.accountId, type: 'raw' }),
        listUnits(),
      ])
      // Formatos: por cada ingrediente distinto de los vínculos (N llamadas).
      const distinctItemIds = Array.from(new Set(lnk.map((l) => l.recipeItemId)))
      const fmtArrays = await Promise.all(distinctItemIds.map((id) => listFormatsByItem(id)))
      const allFormats = fmtArrays.flat()
      setLinks(lnk)
      setItems(its)
      setUnits(uts)
      setFormats(allFormats)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error cargando los artículos del proveedor.')
      setLinks([])
      setItems([])
      setUnits([])
      setFormats([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.id])

  const itemsById = useMemo(() => {
    const m = new Map<string, RecipeItem>()
    items.forEach((it) => m.set(it.id, it))
    return m
  }, [items])

  const unitsById = useMemo(() => {
    const m = new Map<string, KitchenUnit>()
    units.forEach((u) => m.set(u.id, u))
    return m
  }, [units])

  const formatsById = useMemo(() => {
    const m = new Map<string, PurchaseFormat>()
    formats.forEach((f) => m.set(f.id, f))
    return m
  }, [formats])

  async function afterChange() {
    await reload()
    if (onChanged) onChanged()
  }

  return (
    <div className="rounded-lg border border-border-default bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
        <ShoppingBag className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-medium text-text-primary">Artículos que le compras</h3>
        {!loading && !error && links.length > 0 && (
          <span className="text-xs text-text-secondary">({links.length})</span>
        )}
      </div>

      <div className="p-4 space-y-2">
        {loading && (
          <div className="text-sm text-text-secondary py-4 text-center">Cargando artículos…</div>
        )}

        {!loading && error && (
          <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
            {error}
          </div>
        )}

        {/* Estado vacío DIDÁCTICO: reeduca sobre dónde se crean los vínculos. */}
        {!loading && !error && links.length === 0 && (
          <div className="p-4 rounded-md bg-page border border-dashed border-border-default text-sm text-text-secondary flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-text-secondary" />
            <span>
              Aún no le compras ningún artículo a {supplier.name}. Los proveedores se asignan a cada
              ingrediente desde su ficha: <span className="text-text-primary">Ingredientes → el
              ingrediente → Compra / Proveedores</span>.
            </span>
          </div>
        )}

        {!loading && !error && links.length > 0 && (
          <div className="space-y-2">
            {links.map((link) => {
              const item = itemsById.get(link.recipeItemId) ?? null
              const baseUnit = item ? unitsById.get(item.baseUnitId) ?? null : null
              const baseAbbr = baseUnit?.abbreviation ?? ''
              const format = link.purchaseFormatId ? formatsById.get(link.purchaseFormatId) ?? null : null
              const unitCost =
                format && link.lastPrice !== null
                  ? unitCostFromFormat(link.lastPrice, format.qtyInBase)
                  : null
              const updated = formatRelative(link.updatedAt)
              return (
                <SupplierItemRow
                  key={link.id}
                  link={link}
                  itemName={item?.name ?? 'Ingrediente'}
                  baseAbbr={baseAbbr}
                  formatName={format?.name ?? null}
                  formatQtyInBase={format?.qtyInBase ?? null}
                  unitCost={unitCost}
                  updatedLabel={updated}
                  onAfterChange={afterChange}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface SupplierItemRowProps {
  link: ArticleSupplier
  itemName: string
  baseAbbr: string
  formatName: string | null
  formatQtyInBase: number | null
  unitCost: number | null
  updatedLabel: string | null
  onAfterChange: () => void | Promise<void>
}

function SupplierItemRow({
  link,
  itemName,
  baseAbbr,
  formatName,
  formatQtyInBase,
  unitCost,
  updatedLabel,
  onAfterChange,
}: SupplierItemRowProps) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(link.lastPrice !== null ? String(link.lastPrice) : '')
  const [busy, setBusy] = useState(false)

  async function savePrice() {
    const n = parseDecimal(val)
    if (n === null || n < 0) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      await updateArticleSupplier(link.id, { lastPrice: n })
      setEditing(false)
      await onAfterChange()
    } finally {
      setBusy(false)
    }
  }

  async function makePreferred() {
    if (link.isPreferred || busy) return
    setBusy(true)
    try {
      await setPreferredSupplier(link.id, link.recipeItemId)
      await onAfterChange()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = window.confirm(
      `¿Dejar de comprar "${itemName}" a este proveedor? El coste del ingrediente se recalculará con los proveedores que queden.`,
    )
    if (!ok) return
    setBusy(true)
    try {
      await unlinkSupplierFormat(link.id)
      await onAfterChange()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-border-default bg-page px-3 py-2">
      {/* Estrella principal (exclusivo por ingrediente) */}
      <button
        type="button"
        onClick={() => void makePreferred()}
        disabled={busy}
        aria-label={link.isPreferred ? 'Proveedor principal de este ingrediente' : 'Marcar como principal'}
        title={link.isPreferred ? 'Principal de este ingrediente' : 'Marcar como principal'}
        className={`flex-shrink-0 p-1 rounded-md transition-base disabled:opacity-50 ${
          link.isPreferred ? 'text-warning' : 'text-text-secondary hover:text-warning'
        }`}
      >
        <Star className={`w-4 h-4 ${link.isPreferred ? 'fill-current' : ''}`} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">{itemName}</div>
        <div className="text-xs text-text-secondary truncate">
          {formatName !== null && formatQtyInBase !== null
            ? `${formatName} · ${fmtNum(formatQtyInBase)} ${baseAbbr}`
            : 'Sin formato'}
          {unitCost !== null && (
            <>
              {' · '}
              <span className="font-mono">
                {fmtEur(unitCost, 5)} / {baseAbbr}
              </span>
            </>
          )}
          {updatedLabel && <span className="opacity-70"> · {updatedLabel}</span>}
        </div>
      </div>

      <div className="flex-shrink-0 flex items-center gap-1">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void savePrice()
                if (e.key === 'Escape') setEditing(false)
              }}
              disabled={busy}
              className="w-20 px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary text-right focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void savePrice()}
              disabled={busy}
              aria-label="Guardar precio"
              className="p-1 rounded-md text-success hover:bg-success-bg transition-base disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setVal(link.lastPrice !== null ? String(link.lastPrice) : '')
                setEditing(true)
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-sm font-mono text-text-primary hover:text-accent transition-base disabled:opacity-50"
            >
              {fmtEur(link.lastPrice, 2)}
              <Pencil className="w-3 h-3 text-text-secondary" />
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              aria-label="Quitar este artículo del proveedor"
              title="Dejar de comprarle este artículo"
              className="p-1 rounded-md text-text-secondary hover:text-danger transition-base disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
