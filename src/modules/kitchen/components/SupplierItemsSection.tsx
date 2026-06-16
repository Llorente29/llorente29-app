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
import { unitPriceFromBase, unitPriceToBase, formatPriceFromUnitCost } from '@/modules/kitchen/lib/unitConversion'
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
              // Unidades válidas para teclear el precio: las de la misma dimensión
              // que la base (kg/g, L/ml, ud). Mismo criterio que PurchaseSourcesSection.
              const priceUnits = baseUnit
                ? units.filter((u) => u.dimension === baseUnit.dimension && (u.isActive || u.id === baseUnit.id))
                : []
              const format = link.purchaseFormatId ? formatsById.get(link.purchaseFormatId) ?? null : null
              const updated = formatRelative(link.updatedAt)
              return (
                <SupplierItemRow
                  key={link.id}
                  link={link}
                  itemName={item?.name ?? 'Ingrediente'}
                  baseUnit={baseUnit}
                  priceUnits={priceUnits}
                  formatName={format?.name ?? null}
                  formatQtyInBase={format?.qtyInBase ?? null}
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

// La unidad "humana" para mostrar/teclear el precio: la de MAYOR factor de la
// dimensión (kg sobre g, L sobre ml). Cae a la base si no hay candidatas.
// (Misma lógica que PurchaseSourcesSection → las dos secciones guardan idéntico.)
function pickDisplayUnit(priceUnits: KitchenUnit[], baseUnit: KitchenUnit | null): KitchenUnit | null {
  if (priceUnits.length === 0) return baseUnit
  return priceUnits.reduce((best, u) => (u.factorToBase > best.factorToBase ? u : best), priceUnits[0])
}

// Redondeo limpio para pre-rellenar el input (evita 8,9900000001).
function toInputStr(n: number): string {
  return String(Math.round(n * 10000) / 10000)
}

interface SupplierItemRowProps {
  link: ArticleSupplier
  itemName: string
  baseUnit: KitchenUnit | null
  priceUnits: KitchenUnit[]   // unidades de la misma dimensión que la base (kg/g, L/ml, ud)
  formatName: string | null
  formatQtyInBase: number | null
  updatedLabel: string | null
  onAfterChange: () => void | Promise<void>
}

// BASE-FIRST (alineado con SourceRow de PurchaseSourcesSection): el €/base es
// link.lastPrice DIRECTO; se MUESTRA en la unidad humana (€/kg) y al GUARDAR se
// convierte con unitPriceToBase. Antes mostraba €/base pero guardaba el número
// crudo tecleado (bug que originó Delicias). Ahora las dos secciones guardan igual.
function SupplierItemRow({
  link,
  itemName,
  baseUnit,
  priceUnits,
  formatName,
  formatQtyInBase,
  updatedLabel,
  onAfterChange,
}: SupplierItemRowProps) {
  const baseAbbr = baseUnit?.abbreviation ?? ''
  const displayUnit = pickDisplayUnit(priceUnits, baseUnit)
  const displayAbbr = displayUnit?.abbreviation ?? baseAbbr

  // €/base actual = link.lastPrice directo. Su expresión humana (€/kg) y el €/caja
  // informativo derivado (solo si hay formato).
  const unitCost = link.lastPrice
  const priceInDisplay =
    unitCost !== null && displayUnit && baseUnit
      ? unitPriceFromBase(unitCost, displayUnit, baseUnit)
      : null
  const formatPrice =
    unitCost !== null && formatQtyInBase !== null
      ? formatPriceFromUnitCost(unitCost, formatQtyInBase)
      : null

  const [editing, setEditing] = useState(false)
  const [priceUnitId, setPriceUnitId] = useState<string>(displayUnit?.id ?? '')
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)

  function openEdit() {
    setPriceUnitId(displayUnit?.id ?? '')
    setVal(priceInDisplay !== null ? toInputStr(priceInDisplay) : '')
    setEditing(true)
  }

  // Derivación en vivo idéntica a lo que se guardará (€/base) + €/caja informativo.
  const selectedUnit = priceUnits.find((u) => u.id === priceUnitId) ?? baseUnit
  const typed = parseDecimal(val)
  const previewPerBase =
    typed !== null && selectedUnit && baseUnit
      ? unitPriceToBase(typed, selectedUnit, baseUnit)
      : null
  const previewFormatPrice =
    previewPerBase !== null && formatQtyInBase !== null
      ? formatPriceFromUnitCost(previewPerBase, formatQtyInBase)
      : null

  async function savePrice() {
    const t = parseDecimal(val)
    if (t === null || t < 0) {
      setEditing(false)
      return
    }
    // Base-first: lo tecleado es €/unidad → €/base directo en last_price (idéntico
    // a SourceRow). El precio es editable con o sin formato.
    let newLastPrice: number | null = null
    if (baseUnit && selectedUnit) {
      newLastPrice = unitPriceToBase(t, selectedUnit, baseUnit)
    } else {
      newLastPrice = t
    }
    if (newLastPrice === null) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      await updateArticleSupplier(link.id, { lastPrice: newLastPrice })
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
          {formatPrice !== null && formatName !== null && (
            <>
              {' · '}
              <span className="font-mono">{fmtEur(formatPrice, 2)} / {formatName.toLowerCase()}</span>
            </>
          )}
          {updatedLabel && <span className="opacity-70"> · {updatedLabel}</span>}
        </div>
      </div>

      <div className="flex-shrink-0 flex items-center gap-1">
        {editing ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              {/* Input de PRECIO en unidad humana: número + €/unidad */}
              <div className="flex items-center rounded-md border border-border-default bg-card overflow-hidden focus-within:ring-1 focus-within:ring-accent">
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
                  placeholder="0,00"
                  className="w-20 px-2 py-1 text-sm bg-transparent text-text-primary text-right focus:outline-none disabled:opacity-50"
                />
                <span className="pl-1 text-xs text-text-secondary">€/</span>
                {priceUnits.length > 1 ? (
                  <select
                    value={priceUnitId}
                    onChange={(e) => setPriceUnitId(e.target.value)}
                    disabled={busy}
                    aria-label="Unidad del precio"
                    className="py-1 pr-1.5 text-xs bg-transparent text-text-primary cursor-pointer focus:outline-none disabled:opacity-50"
                  >
                    {priceUnits.map((u) => (
                      <option key={u.id} value={u.id}>{u.abbreviation}</option>
                    ))}
                  </select>
                ) : (
                  <span className="pr-2 text-xs text-text-secondary">{displayAbbr}</span>
                )}
              </div>
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
            {/* Derivación en vivo: exactamente lo que se guarda (€/base) + €/caja */}
            {previewPerBase !== null && (
              <div className="text-[11px] text-text-secondary font-mono">
                = {fmtEur(previewPerBase, 5)} / {baseAbbr}
                {previewFormatPrice !== null && formatName !== null && (
                  <> · {fmtEur(previewFormatPrice, 2)} / {formatName.toLowerCase()}</>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={openEdit}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-sm font-mono text-text-primary hover:text-accent transition-base disabled:opacity-50"
              title="Editar precio (en tu unidad: €/kg, €/g…)"
            >
              {priceInDisplay !== null
                ? `${fmtEur(priceInDisplay, priceInDisplay < 1 ? 4 : 2)} / ${displayAbbr}`
                : fmtEur(link.lastPrice, 2)}
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
