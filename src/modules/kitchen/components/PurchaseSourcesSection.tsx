// src/modules/kitchen/components/PurchaseSourcesSection.tsx
//
// Sección "Compra / Proveedores" de un ingrediente (recipe_item type='raw').
// Vive dentro de KitchenItemDetailPage. Aquí el coste DEJA de teclearse a mano
// y pasa a FLUIR desde la compra: das proveedor + formato + precio y el motor
// calcula el coste base y lo propaga a los platos (cascada en el service).
//
// PRECEDENCIA DE COSTE (verificado contra kitchen_recompute_raw_cost):
// el coste solo fluye desde la compra si el ingrediente está en 'last_purchase'.
// En 'fixed' la compra NO pisa el coste. El FLIP fixed→last_purchase lo hace el
// SERVICE (setupSimplePurchase), no esta UI: aquí solo le pasamos la estrategia
// actual (priorCostStrategy) y él decide. Así el flip vive en un único sitio y
// lo heredan foto→IA/import. El fixed_cost queda como respaldo.
//
// Goleada vs Apicbase/gstock:
//  · Tres unidades didácticas (compra → base → uso) enseñando mientras captura.
//  · Conversión que NO se inventa (convertToBase): si la dimensión no cuadra,
//    explica y pide el total en base; nunca un 1:1 silencioso.
//  · Preview de coste en vivo IDÉNTICO al que guardará el motor (unitCostFromFormat).
//  · Editar el precio recostea los platos al instante (sin esperar a una recepción).
//  · Confirmación con el recuento REAL de platos recalculados (no inventado).
//
// Deuda declarada (no se construye hoy):
//  · setupSimplePurchase no es transaccional a nivel BBDD, pero compensa el
//    formato huérfano si falla el enlace (archivándolo). Endurecer cuando toque.
//  · Alternar "principal" entre varios proveedores (updateArticleSupplier no
//    cascadea al cambiar is_preferred). Hoy isPreferred solo se fija en el alta.
//  · Árbol de formatos anidado y foto→IA del albarán: fases siguientes.

import { useEffect, useMemo, useState } from 'react'
import { Plus, Truck, Star, Check, AlertTriangle, Loader2, Pencil, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import {
  listSuppliers,
  createSupplier,
  listSuppliersByItem,
  listFormatsByItem,
  setupSimplePurchase,
  updateArticleSupplier,
} from '@/modules/kitchen/services/purchaseFormatService'
import type { RecomputedAncestor } from '@/modules/kitchen/services/costCascadeService'
import { convertToBase, unitCostFromFormat } from '@/modules/kitchen/lib/unitConversion'
import type {
  RecipeItem,
  KitchenUnit,
  Supplier,
  ArticleSupplier,
  PurchaseFormat,
} from '@/types/kitchen'

const DIM_LABEL: Record<string, string> = {
  weight: 'peso',
  volume: 'volumen',
  unit: 'unidades',
}

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

interface PurchaseSourcesSectionProps {
  item: RecipeItem
  units: KitchenUnit[]
  actorId: string | null
  actorName: string | null
  /** Lo llama tras cualquier cambio que altere el coste, para que el detalle refresque el item. */
  onChanged?: () => void
}

export default function PurchaseSourcesSection({
  item,
  units,
  actorId,
  actorName,
  onChanged,
}: PurchaseSourcesSectionProps) {
  const baseUnit = useMemo(
    () => units.find((u) => u.id === item.baseUnitId) ?? null,
    [units, item.baseUnitId],
  )

  // Unidades elegibles para "¿cuánto trae?": las de la misma dimensión que la base.
  const qtyUnits = useMemo(() => {
    if (!baseUnit) return []
    return units.filter(
      (u) => u.dimension === baseUnit.dimension && (u.isActive || u.id === baseUnit.id),
    )
  }, [units, baseUnit])

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [links, setLinks] = useState<ArticleSupplier[]>([])
  const [formats, setFormats] = useState<PurchaseFormat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successNote, setSuccessNote] = useState<string | null>(null)
  // Platos recalculados tras el último cambio de coste (para mostrar CUÁLES, no
  // solo cuántos). Se rellena en handleAdd desde el resultado de la cascada.
  const [recalculatedDishes, setRecalculatedDishes] = useState<RecomputedAncestor[]>([])
  const [dishesOpen, setDishesOpen] = useState(false)

  // Formulario de alta.
  const [addOpen, setAddOpen] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [newSupplierName, setNewSupplierName] = useState('')
  const [formatName, setFormatName] = useState('')
  const [qty, setQty] = useState('')
  const [qtyUnitId, setQtyUnitId] = useState('')
  const [directBase, setDirectBase] = useState('')
  const [price, setPrice] = useState('')
  const [isPreferred, setIsPreferred] = useState(false)
  const [supplierCode, setSupplierCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // ¿El ingrediente cobra hoy su coste de un valor tecleado a mano (fixed)?
  // Si es así, al añadir la primera fuente el SERVICE lo pasará a last_purchase
  // (se lo indicamos vía priorCostStrategy). Aquí solo lo usamos para reeducar.
  const willFlipToPurchase = item.costStrategy === 'fixed'

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const [sup, lnk, fmt] = await Promise.all([
        listSuppliers(item.accountId),
        listSuppliersByItem(item.id),
        listFormatsByItem(item.id),
      ])
      setSuppliers(sup)
      setLinks(lnk)
      setFormats(fmt)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error cargando proveedores.')
      setSuppliers([])
      setLinks([])
      setFormats([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // Por defecto, la unidad de "¿cuánto trae?" es la unidad base del ingrediente.
  useEffect(() => {
    if (baseUnit && qtyUnitId === '') setQtyUnitId(baseUnit.id)
  }, [baseUnit, qtyUnitId])

  const formatsById = useMemo(() => {
    const m = new Map<string, PurchaseFormat>()
    formats.forEach((f) => m.set(f.id, f))
    return m
  }, [formats])

  const suppliersById = useMemo(() => {
    const m = new Map<string, Supplier>()
    suppliers.forEach((s) => m.set(s.id, s))
    return m
  }, [suppliers])

  // ── Conversión en vivo para el preview ──
  const qtyNum = parseDecimal(qty)
  const selectedUnit = units.find((u) => u.id === qtyUnitId) ?? null
  const conversion =
    qtyNum !== null && selectedUnit && baseUnit
      ? convertToBase(qtyNum, selectedUnit, baseUnit)
      : null
  const isMismatch =
    conversion !== null && conversion.ok === false && conversion.reason === 'dimension_mismatch'

  // qtyInBase resuelto: por conversión automática, o por el campo "total en base"
  // (fallback honesto cuando la dimensión no cuadra; el cocinero lo dice, no lo inventamos).
  let resolvedQtyInBase: number | null = null
  if (conversion && conversion.ok) {
    resolvedQtyInBase = conversion.qtyInBase
  } else if (isMismatch) {
    const d = parseDecimal(directBase)
    if (d !== null && d > 0) resolvedQtyInBase = d
  }

  const priceNum = parseDecimal(price)
  const previewUnitCost =
    resolvedQtyInBase !== null && priceNum !== null
      ? unitCostFromFormat(priceNum, resolvedQtyInBase)
      : null

  function resetForm() {
    setSupplierId('')
    setNewSupplierName('')
    setFormatName('')
    setQty('')
    setQtyUnitId(baseUnit?.id ?? '')
    setDirectBase('')
    setPrice('')
    setIsPreferred(false)
    setSupplierCode('')
    setFormError(null)
  }

  function openAddForm() {
    resetForm()
    setSuccessNote(null)
    setAddOpen(true)
  }

  async function handleAdd() {
    setFormError(null)
    if (!baseUnit) {
      setFormError('Este ingrediente no tiene unidad base; defínela antes de añadir un proveedor.')
      return
    }
    const fName = formatName.trim()
    if (fName === '') {
      setFormError('Dale un nombre al formato (Caja, Saco, Garrafa…).')
      return
    }
    if (resolvedQtyInBase === null || !(resolvedQtyInBase > 0)) {
      setFormError('Indica cuánto trae ese formato.')
      return
    }
    if (priceNum === null || priceNum < 0) {
      setFormError('Pon un precio válido en €.')
      return
    }
    if (supplierId === '') {
      setFormError('Elige un proveedor o crea uno nuevo.')
      return
    }

    setSubmitting(true)
    try {
      let supId = supplierId
      if (supId === '__new__') {
        const name = newSupplierName.trim()
        if (name === '') {
          setFormError('Escribe el nombre del nuevo proveedor.')
          setSubmitting(false)
          return
        }
        const created = await createSupplier({
          accountId: item.accountId,
          name,
          createdBy: actorId,
          createdByName: actorName,
        })
        supId = created.id
      }

      // El FLIP fixed→last_purchase lo decide el service: le pasamos la estrategia
      // actual del ingrediente. Si es 'fixed', el service la cambia antes del alta.
      const result = await setupSimplePurchase({
        accountId: item.accountId,
        itemId: item.id,
        formatName: fName,
        qtyInBase: resolvedQtyInBase,
        supplierId: supId,
        lastPrice: priceNum,
        supplierCode: supplierCode.trim() || null,
        isPreferred,
        priorCostStrategy: item.costStrategy,
        createdBy: actorId,
        createdByName: actorName,
      })

      resetForm()
      setAddOpen(false)
      setRecalculatedDishes(result.recalculatedDishes ?? [])
      setDishesOpen(false)
      setSuccessNote(
        result.ancestorsRecomputed > 0
          ? `Coste actualizado. ${result.ancestorsRecomputed} plato${
              result.ancestorsRecomputed === 1 ? '' : 's'
            } recalculado${result.ancestorsRecomputed === 1 ? '' : 's'}.`
          : 'Coste actualizado desde la compra.',
      )
      await reload()
      if (onChanged) onChanged()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar la compra.')
    } finally {
      setSubmitting(false)
    }
  }

  const baseAbbr = baseUnit?.abbreviation ?? ''

  return (
    <div className="rounded-lg border border-border-default bg-card">
      {/* Cabecera de la sección + coste actual del ingrediente */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-default">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-text-primary">Compra / Proveedores</h3>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-text-secondary leading-none">Coste actual</div>
          <div className="text-sm font-mono font-medium text-text-primary">
            {item.computedCost !== null && item.computedCost !== undefined
              ? `${fmtEur(item.computedCost, 5)} / ${baseAbbr}`
              : '—'}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {loading && (
          <div className="text-sm text-text-secondary py-4 text-center">Cargando proveedores…</div>
        )}

        {!loading && error && (
          <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && links.length === 0 && (
          <div className="p-4 rounded-md bg-page border border-dashed border-border-default text-sm text-text-secondary">
            Aún no le has dicho a Folvy de quién compras este ingrediente. Añade tu proveedor y su
            precio: el coste se calcula solo y baja a los platos que lo usan.
          </div>
        )}

        {!loading && !error && links.length > 0 && (
          <div className="space-y-2">
            {links.map((link) => (
              <SourceRow
                key={link.id}
                link={link}
                supplierName={
                  link.supplierId && suppliersById.get(link.supplierId)
                    ? suppliersById.get(link.supplierId)!.name
                    : 'Proveedor'
                }
                format={link.purchaseFormatId ? formatsById.get(link.purchaseFormatId) ?? null : null}
                baseAbbr={baseAbbr}
                onSaved={async () => {
                  setSuccessNote('Coste actualizado desde la compra.')
                  await reload()
                  if (onChanged) onChanged()
                }}
              />
            ))}
          </div>
        )}

        {/* Confirmación veraz tras un cambio de coste (recuento real) + qué platos */}
        {!addOpen && successNote && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-success">
              <Check className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{successNote}</span>
              {recalculatedDishes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDishesOpen((v) => !v)}
                  className="inline-flex items-center gap-0.5 text-text-secondary hover:text-text-primary transition-base"
                >
                  {dishesOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                  {dishesOpen ? 'ocultar' : 'ver platos'}
                </button>
              )}
            </div>
            {dishesOpen && recalculatedDishes.length > 0 && (
              <ul className="ml-5 flex flex-wrap gap-1.5">
                {recalculatedDishes.map((d) => (
                  <li
                    key={d.id}
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-page border border-border-default text-xs text-text-secondary truncate max-w-[16rem]"
                    title={d.name}
                  >
                    {d.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Alta */}
        {!addOpen ? (
          <button
            type="button"
            onClick={openAddForm}
            disabled={loading || !baseUnit}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            <Plus size={16} />
            Añadir proveedor
          </button>
        ) : (
          <div className="rounded-md border border-border-default bg-page p-3 space-y-3">
            {/* Proveedor */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Proveedor</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                disabled={submitting}
                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              >
                <option value="">— Elige proveedor —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="__new__">+ Nuevo proveedor…</option>
              </select>
              {supplierId === '__new__' && (
                <input
                  type="text"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  disabled={submitting}
                  placeholder="Nombre del nuevo proveedor"
                  className="mt-2 w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
              )}
            </div>

            {/* Formato */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                ¿Cómo viene?
              </label>
              <input
                type="text"
                value={formatName}
                onChange={(e) => setFormatName(e.target.value)}
                disabled={submitting}
                placeholder="Ej: Caja, Saco, Garrafa…"
                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
            </div>

            {/* ¿Cuánto trae? */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                ¿Cuánto trae?
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  disabled={submitting}
                  placeholder="Ej: 5"
                  className="flex-1 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
                <select
                  value={qtyUnitId}
                  onChange={(e) => setQtyUnitId(e.target.value)}
                  disabled={submitting || qtyUnits.length === 0}
                  className="w-28 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                >
                  {qtyUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.abbreviation}
                    </option>
                  ))}
                </select>
              </div>

              {/* Preview / reeducación en vivo */}
              {conversion && conversion.ok && baseUnit && (
                <p className="mt-1.5 text-[11px] text-success">
                  → {fmtNum(conversion.qtyInBase)} {baseUnit.abbreviation} de {item.name}
                </p>
              )}
              {isMismatch && baseUnit && selectedUnit && (
                <div className="mt-1.5 space-y-1.5">
                  <p className="text-[11px] text-warning flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>
                      Lo mides en {DIM_LABEL[selectedUnit.dimension] ?? selectedUnit.dimension} pero{' '}
                      {item.name} se cuenta en {DIM_LABEL[baseUnit.dimension] ?? baseUnit.dimension}.
                      Dime el total en {baseUnit.abbreviation} para no inventarme la conversión.
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-secondary">Total:</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={directBase}
                      onChange={(e) => setDirectBase(e.target.value)}
                      disabled={submitting}
                      placeholder={`en ${baseUnit.abbreviation}`}
                      className="w-32 px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                    <span className="text-[11px] text-text-secondary">{baseUnit.abbreviation}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Precio */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                ¿Cuánto te cuesta ese formato? (€)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={submitting}
                placeholder="Ej: 30"
                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
            </div>

            {/* Código del proveedor (opcional, ayuda al casado de OCR de factura) */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Código del proveedor <span className="text-text-tertiary font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={supplierCode}
                onChange={(e) => setSupplierCode(e.target.value)}
                disabled={submitting}
                placeholder="La referencia con la que este proveedor llama al artículo"
                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
              <p className="text-[11px] text-text-secondary mt-1">
                Facilita casar las líneas cuando llegue su factura o albarán.
              </p>
            </div>

            {/* Remate didáctico: coste por unidad base, idéntico al motor */}
            {previewUnitCost !== null && baseUnit && (
              <div className="rounded-md bg-accent-bg border border-accent/20 px-3 py-2 text-sm text-text-primary">
                <span className="font-mono">
                  {fmtEur(priceNum, 2)} ÷ {fmtNum(resolvedQtyInBase!)} {baseUnit.abbreviation}
                </span>{' '}
                ={' '}
                <span className="font-mono font-medium">
                  {fmtEur(previewUnitCost, 5)} / {baseUnit.abbreviation}
                </span>
              </div>
            )}

            {/* Reeducación: aviso del cambio de estrategia al añadir el primer proveedor */}
            {willFlipToPurchase && (
              <p className="text-[11px] text-text-secondary flex items-start gap-1">
                <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0 text-accent" />
                <span>
                  A partir de ahora el coste de {item.name} se calculará desde el precio de tu
                  proveedor. El coste que tenías escrito a mano queda como respaldo.
                </span>
              </p>
            )}

            {/* Principal */}
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={isPreferred}
                onChange={(e) => setIsPreferred(e.target.checked)}
                disabled={submitting}
                className="rounded border-border-default"
              />
              <span className="inline-flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-warning" />
                Marcar como proveedor principal
              </span>
            </label>

            {formError && (
              <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  resetForm()
                  setAddOpen(false)
                }}
                disabled={submitting}
                className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-card transition-base disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {submitting ? 'Guardando…' : 'Guardar compra'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Fila de una fuente de compra existente, con edición de precio inline ──
// Editar el precio dispara updateArticleSupplier, que recostea los platos
// (cascada en el service). onSaved refresca la lista y avisa al detalle.
interface SourceRowProps {
  link: ArticleSupplier
  supplierName: string
  format: PurchaseFormat | null
  baseAbbr: string
  onSaved: () => void | Promise<void>
}

function SourceRow({ link, supplierName, format, baseAbbr, onSaved }: SourceRowProps) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(link.lastPrice !== null ? String(link.lastPrice) : '')
  const [codeVal, setCodeVal] = useState(link.supplierCode ?? '')
  const [saving, setSaving] = useState(false)

  const unitCost =
    format && link.lastPrice !== null
      ? unitCostFromFormat(link.lastPrice, format.qtyInBase)
      : null

  async function save() {
    const n = parseDecimal(val)
    if (n === null || n < 0) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await updateArticleSupplier(link.id, { lastPrice: n, supplierCode: codeVal.trim() || null })
      setEditing(false)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-border-default bg-page px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{supplierName}</span>
          {link.isPreferred && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-warning-bg text-warning flex-shrink-0">
              <Star className="w-3 h-3" />
              principal
            </span>
          )}
        </div>
        <div className="text-xs text-text-secondary truncate">
          {format ? `${format.name} · ${fmtNum(format.qtyInBase)} ${baseAbbr}` : 'Sin formato'}
          {unitCost !== null && (
            <>
              {' · '}
              <span className="font-mono">
                {fmtEur(unitCost, 5)} / {baseAbbr}
              </span>
            </>
          )}
          {link.supplierCode && (
            <>
              {' · '}
              <span>cód. {link.supplierCode}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
                if (e.key === 'Escape') setEditing(false)
              }}
              disabled={saving}
              className="w-20 px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary text-right focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <input
              type="text"
              value={codeVal}
              onChange={(e) => setCodeVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
                if (e.key === 'Escape') setEditing(false)
              }}
              disabled={saving}
              placeholder="cód."
              title="Código del proveedor"
              className="w-24 px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              aria-label="Guardar precio y código"
              className="p-1 rounded-md text-success hover:bg-success-bg transition-base disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setVal(link.lastPrice !== null ? String(link.lastPrice) : '')
              setCodeVal(link.supplierCode ?? '')
              setEditing(true)
            }}
            className="inline-flex items-center gap-1.5 text-sm font-mono text-text-primary hover:text-accent transition-base"
          >
            {fmtEur(link.lastPrice, 2)}
            <Pencil className="w-3 h-3 text-text-secondary" />
          </button>
        )}
      </div>
    </div>
  )
}
