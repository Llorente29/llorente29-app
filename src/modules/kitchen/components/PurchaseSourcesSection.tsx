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

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Truck, Star, Check, AlertTriangle, Loader2, Pencil, Sparkles, ChevronDown, ChevronRight, Archive, RotateCcw, ArrowRightLeft, Trash2, Handshake, X, History, CalendarDays, Info } from 'lucide-react'
import IngredientSubstituteModal from '@/modules/kitchen/components/IngredientSubstituteModal'
import IngredientAddModal from '@/modules/kitchen/components/IngredientAddModal'
import IngredientRemoveModal from '@/modules/kitchen/components/IngredientRemoveModal'
import {
  listSuppliers,
  createSupplier,
  listSuppliersByItem,
  listFormatsByItem,
  setupSimplePurchase,
  ensurePackTree,
  updateArticleSupplier,
  createPurchaseFormat,
  updatePurchaseFormat,
  purchaseFormatHasStockMovements,
  archiveAndReplacePurchaseFormat,
  setPreferredSupplier,
  unlinkSupplierFormat,
  reactivateSupplierLink,
  previewRemoveIngredient,
} from '@/modules/kitchen/services/purchaseFormatService'
import { updateRecipeItem } from '@/modules/kitchen/services/recipeItemService'
import { setUseInCount } from '@/modules/supply/services/countFormatService'
import {
  historiaDelFormato,
  ultimoAlbaranPorProveedor,
  type HistoriaDelFormato,
} from '@/modules/kitchen/services/estadoDeFormatosService'
import {
  cuentaDelFormato,
  comoSeCuenta,
  loQueVaACambiar,
  num,
  plural,
  type FormatoParaRegla,
} from '@/modules/kitchen/lib/formatosDeCompra'
import type { RecomputedAncestor } from '@/modules/kitchen/services/costCascadeService'
import {
  convertToBase,
  unitCostFromFormat,
  formatPriceFromUnitCost,
  unitPriceToBase,
  unitPriceFromBase,
  pickDisplayUnit,
} from '@/modules/kitchen/lib/unitConversion'
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

// Los miles, con UNA sola vara en toda la sección. Antes había dos: la tarjeta
// decía «5.790 g» y la línea verde del editor «5790 g», porque una pasaba por
// `num()` (que fuerza el separador) y la otra por un Intl propio. En es-ES el
// separador se omite por defecto en los números de cuatro cifras, así que las
// dos eran «correctas» y por eso no cantaba: cantaba verlas juntas.
const fmtNum = num

// Fecha corta en castellano a partir de un `date` de la base (YYYY-MM-DD).
// Se parte la cadena a mano en vez de pasarla por `new Date(...)`: un `date`
// sin hora lo interpreta el navegador como UTC medianoche y en Madrid retrocede
// un día. Es la misma trampa de la regla 4, un piso más abajo.
function fmtFecha(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

// El formato como lo necesitan las reglas puras (lib/formatosDeCompra).
// El PADRE es la PIEZA y el HIJO es la CAJA: `parent_format_id` de la Caja
// apunta al Bote y `qty_per_parent` dice cuántos botes trae. Se lee al revés
// de lo que sugiere el nombre, y así lleva funcionando desde ensurePackTree.
function comoRegla(f: PurchaseFormat, padre: PurchaseFormat | null): FormatoParaRegla {
  return {
    nombre: f.name,
    qtyInBase: f.qtyInBase,
    qtyPerParent: f.qtyPerParent,
    innerQtyInBase: padre ? padre.qtyInBase : null,
    innerNombre: padre ? padre.name : null,
  }
}

interface PurchaseSourcesSectionProps {
  item: RecipeItem
  units: KitchenUnit[]
  actorId: string | null
  actorName: string | null
  /** Lo llama tras cualquier cambio que altere el coste, para que el detalle refresque el item. */
  onChanged?: () => void
  /**
   * E4 — «Terminarlo» desde la lista: en vez de abrir la ficha entera y que
   * el administrativo busque, la sección se trae a la vista y, si el artículo
   * no tiene ni un proveedor, el formulario se abre solo. Es el paso que
   * falta, no la ficha.
   */
  enfocar?: boolean
  /**
   * A1 — la sección va dentro del ALTA del artículo, como su segundo paso.
   * Es la MISMA sección, no una copia: lo único que cambia es que se callan
   * dos cosas que en un artículo recién nacido no dicen nada —los botones de
   * escandallo y el desplegable de descatalogados— y que el formulario nace
   * abierto. Construir un formulario aparte para el alta sería tener dos
   * sitios donde arreglar el mismo fallo.
   */
  modoAlta?: boolean
}

export default function PurchaseSourcesSection({
  item,
  units,
  actorId,
  actorName,
  onChanged,
  enfocar = false,
  modoAlta = false,
}: PurchaseSourcesSectionProps) {
  const seccionRef = useRef<HTMLDivElement | null>(null)
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

  // Formulario de alta. En el paso 2 del alta del artículo nace abierto: es
  // justo la pregunta que el alta tiene que hacer.
  const [addOpen, setAddOpen] = useState(modoAlta)
  const [supplierId, setSupplierId] = useState('')
  const [newSupplierName, setNewSupplierName] = useState('')
  const [formatName, setFormatName] = useState('')
  const [qty, setQty] = useState('')
  const [qtyUnitId, setQtyUnitId] = useState('')
  const [directBase, setDirectBase] = useState('')
  const [price, setPrice] = useState('')
  const [isPreferred, setIsPreferred] = useState(false)
  const [supplierCode, setSupplierCode] = useState('')
  // A4 — cómo lo llama ÉL (article_supplier.supplier_item_name). Hasta hoy solo
  // lo escribía learn_from_receipt al confirmar un albarán; en el alta no se
  // podía decir, y es justo lo que hace que sus albaranes casen solos.
  const [supplierItemName, setSupplierItemName] = useState('')
  // A1 — los DOS modos desde el principio. Hasta hoy «Caja con piezas» solo
  // existía al EDITAR, o sea después de guardar: la primera vez había que
  // aplanar la caja a mano y la herramienta buena se enseñaba después.
  const [addMode, setAddMode] = useState<'simple' | 'pack'>('simple')
  const [addCajaName, setAddCajaName] = useState('Caja')
  const [addCount, setAddCount] = useState('')
  const [addInnerName, setAddInnerName] = useState('')
  const [addInnerQty, setAddInnerQty] = useState('')
  const [addInnerUnitId, setAddInnerUnitId] = useState('')
  const [addInnerDirectBase, setAddInnerDirectBase] = useState('')
  // A7 — «¿En qué lo cuentas?». Lo decide quien crea el artículo (decisión 3
  // de Julio). Se guarda en `use_in_count` del nodo que toque.
  const [addCuentaEn, setAddCuentaEn] = useState<'caja' | 'pieza' | 'base'>('caja')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Mostrar también los proveedores archivados (descatalogados). Por defecto no.
  const [showArchived, setShowArchived] = useState(false)
  // B3 — fecha del último albarán de cada proveedor. No bloquea la sección:
  // si falla, las tarjetas se pintan igual y esa línea no aparece.
  const [ultimoAlbaran, setUltimoAlbaran] = useState<Map<string, string>>(new Map())
  // B4 — «Revisar el formato» abre el editor de formato de ESE enlace.
  const [revisarFormatoDe, setRevisarFormatoDe] = useState<string | null>(null)
  const [substituteOpen, setSubstituteOpen] = useState(false)
  const [addIngredientOpen, setAddIngredientOpen] = useState(false)
  const [removeIngredientOpen, setRemoveIngredientOpen] = useState(false)

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
        listSuppliersByItem(item.id, { includeInactive: showArchived }),
        listFormatsByItem(item.id),
      ])
      setSuppliers(sup)
      setLinks(lnk)
      setFormats(fmt)
      try {
        setUltimoAlbaran(await ultimoAlbaranPorProveedor(item.accountId, item.id))
      } catch (e) {
        console.error('[PurchaseSourcesSection] último albarán por proveedor', e)
        setUltimoAlbaran(new Map())
      }
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
  }, [item.id, showArchived])

  // Handlers de gestión de la fila (principal / archivar / reactivar). Cada uno
  // recostea en el service (cascada); aquí recargamos y avisamos al detalle.
  async function handleMakePreferred(linkId: string) {
    await setPreferredSupplier(linkId, item.id)
    setSuccessNote('Proveedor principal actualizado. Coste recalculado.')
    await reload()
    if (onChanged) onChanged()
  }

  async function handleArchive(linkId: string, supplierName: string) {
    const ok = window.confirm(
      `¿Archivar "${supplierName}" como proveedor de ${item.name}? Se conserva el histórico; puedes reactivarlo cuando quieras. El coste se recalculará con los proveedores que queden.`,
    )
    if (!ok) return
    await unlinkSupplierFormat(linkId)
    setSuccessNote('Proveedor archivado. Coste recalculado.')
    await reload()
    if (onChanged) onChanged()
  }

  async function handleReactivate(linkId: string) {
    await reactivateSupplierLink(linkId)
    setSuccessNote('Proveedor reactivado. Coste recalculado.')
    await reload()
    if (onChanged) onChanged()
  }

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

  // ── Modo PACK del alta: contenido de UNA pieza y total de la caja ──
  // El total NUNCA se teclea: se DERIVA aquí, en un único sitio, igual que en
  // ensurePackTree. Así es imposible que el total y el desglose se descuadren.
  const addCountNum = parseDecimal(addCount)
  const addInnerUnit = units.find((u) => u.id === addInnerUnitId) ?? null
  const innerConversion =
    parseDecimal(addInnerQty) !== null && addInnerUnit && baseUnit
      ? convertToBase(parseDecimal(addInnerQty)!, addInnerUnit, baseUnit)
      : null
  const innerMismatch =
    innerConversion !== null &&
    innerConversion.ok === false &&
    innerConversion.reason === 'dimension_mismatch'
  let addInnerBase: number | null = null
  if (innerConversion && innerConversion.ok) {
    addInnerBase = innerConversion.qtyInBase
  } else if (innerMismatch) {
    const d = parseDecimal(addInnerDirectBase)
    if (d !== null && d > 0) addInnerBase = d
  }
  const addPackTotalBase =
    addInnerBase !== null && addCountNum !== null && addCountNum > 0
      ? addInnerBase * addCountNum
      : null

  // El total que se guardará, sea cual sea el modo.
  const addQtyInBase = addMode === 'pack' ? addPackTotalBase : resolvedQtyInBase

  const priceNum = parseDecimal(price)
  const previewUnitCost =
    addQtyInBase !== null && priceNum !== null
      ? unitCostFromFormat(priceNum, addQtyInBase)
      : null
  // A5 — a cuánto queda la PIEZA (solo tiene sentido con caja con piezas).
  const previewPiecePrice =
    priceNum !== null && addCountNum !== null && addCountNum > 0 && addMode === 'pack'
      ? priceNum / addCountNum
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
    setSupplierItemName('')
    setAddMode('simple')
    setAddCajaName('Caja')
    setAddCount('')
    setAddInnerName('')
    setAddInnerQty('')
    setAddInnerUnitId(baseUnit?.id ?? '')
    setAddInnerDirectBase('')
    setAddCuentaEn('caja')
    setFormError(null)
  }

  function openAddForm() {
    resetForm()
    setSuccessNote(null)
    setAddOpen(true)
  }

  async function handleAdd(opts?: { seguirLuego?: boolean }) {
    const seguirLuego = opts?.seguirLuego === true
    setFormError(null)
    if (!baseUnit) {
      setFormError('Este ingrediente no tiene unidad base; defínela antes de añadir un proveedor.')
      return
    }
    // A9 — «Guardar y seguir luego»: el precio puede faltar. Lo que NO puede
    // faltar es cómo viene, porque sin eso no hay formato que guardar y el
    // artículo se queda exactamente igual de a medias que antes.
    const fName = addMode === 'pack' ? (addCajaName.trim() || 'Caja') : formatName.trim()
    if (fName === '') {
      setFormError('Dale un nombre al formato (Caja, Saco, Garrafa…).')
      return
    }
    if (addMode === 'pack') {
      if (addCountNum === null || !(addCountNum > 0)) {
        setFormError('Dime cuántas piezas trae la caja.')
        return
      }
      if (addInnerBase === null || !(addInnerBase > 0)) {
        setFormError('Dime cuánto lleva UNA pieza.')
        return
      }
    }
    if (addQtyInBase === null || !(addQtyInBase > 0)) {
      setFormError('Indica cuánto trae ese formato.')
      return
    }
    if (priceNum !== null && priceNum < 0) {
      setFormError('Pon un precio válido en €.')
      return
    }
    if (!seguirLuego && priceNum === null) {
      setFormError('Pon el precio, o usa «Guardar y seguir luego» si aún no lo sabes.')
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

      // BASE-FIRST: el cocinero teclea el precio del FORMATO (€/caja) + cuánto
      // trae (qtyInBase). last_price se guarda en €/UNIDAD BASE = precio ÷ qtyInBase
      // (el motor lo lee directo, idéntico al previewUnitCost que ve en pantalla).
      // Si pasáramos el €/caja crudo, el motor lo leería como €/base e inflaría el
      // coste ×qtyInBase (el bug Delicias, ahora en el alta).
      const perBase = priceNum === null ? null : unitCostFromFormat(priceNum, addQtyInBase)
      if (priceNum !== null && perBase === null) {
        setFormError('No se pudo calcular el precio por unidad base. Revisa el precio y la cantidad.')
        setSubmitting(false)
        return
      }

      // El FLIP fixed→last_purchase lo decide el service: le pasamos la estrategia
      // actual del ingrediente. Si es 'fixed', el service la cambia antes del alta.
      const result = await setupSimplePurchase({
        accountId: item.accountId,
        itemId: item.id,
        formatName: fName,
        qtyInBase: addQtyInBase,
        supplierId: supId,
        lastPrice: perBase,
        supplierCode: supplierCode.trim() || null,
        isPreferred,
        priorCostStrategy: item.costStrategy,
        createdBy: actorId,
        createdByName: actorName,
      })

      // A1/A2 — modo CAJA CON PIEZAS: el formato plano que acaba de crear el
      // service se convierte en el ÁRBOL de verdad (pieza + caja) y el enlace
      // se repunta a la caja. El plano se archiva para no dejarlo suelto: es
      // el mismo huérfano que hoy deja el editor inline al pasar de un modo a
      // otro, y aquí no lo repetimos.
      let cajaId = result.format.id
      let piezaId: string | null = null
      if (addMode === 'pack' && addCountNum !== null && addInnerBase !== null) {
        const { caja, inner } = await ensurePackTree({
          accountId: item.accountId,
          itemId: item.id,
          count: addCountNum,
          innerQtyInBase: addInnerBase,
          innerName: addInnerName.trim() || 'Ud',
          cajaName: fName,
          source: 'manual',
          createdBy: actorId,
          createdByName: actorName,
        })
        cajaId = caja.id
        piezaId = inner.id
        await updateArticleSupplier(result.link.id, { purchaseFormatId: caja.id })
        // Hay que descartar TAMBIÉN que sea la pieza, no solo la caja: con
        // count = 1 el total y el contenido de una pieza son el mismo número,
        // y ensurePackTree reutiliza como pieza cualquier nodo sin padre con
        // ese contenido — o sea, justo el plano que acaba de crear el service.
        // Sin esta segunda comprobación, archivaríamos la pieza del árbol que
        // estamos montando y la caja quedaría colgando de un nodo archivado.
        if (result.format.id !== caja.id && result.format.id !== inner.id) {
          await updatePurchaseFormat(result.format.id, {
            isActive: false,
            archivedAt: new Date().toISOString(),
          })
        }
      }

      // A4 — la denominación del proveedor. Va en su propia llamada porque
      // setupSimplePurchase no la acepta: se añade sin tocar su firma.
      const denominacion = supplierItemName.trim()
      if (denominacion !== '') {
        await updateArticleSupplier(result.link.id, { supplierItemName: denominacion })
      }

      // A7 — en qué lo cuentas. 'base' = ni caja ni pieza: se cuenta en la
      // unidad de siempre, así que ningún formato se marca.
      try {
        if (addCuentaEn === 'caja') await setUseInCount(cajaId, true)
        else if (addCuentaEn === 'pieza' && piezaId) await setUseInCount(piezaId, true)
      } catch (e) {
        console.error('[PurchaseSourcesSection] no se pudo marcar el formato de conteo', e)
      }

      resetForm()
      setAddOpen(false)
      setRecalculatedDishes(result.recalculatedDishes ?? [])
      setDishesOpen(false)
      // REGLA 8 — la confirmación lleva CONTENIDO, no un visto.
      setSuccessNote(
        priceNum === null
          ? `Guardado. ${fName} de ${fmtNum(addQtyInBase)} ${baseUnit.abbreviation}, sin precio todavía.`
          : result.ancestorsRecomputed > 0
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

  // ── B1 · «Se gasta en g · Se cuenta en cajas», y de quién sale el coste ──
  const activos = useMemo(() => links.filter((l) => l.isActive), [links])
  const principal = useMemo(() => activos.find((l) => l.isPreferred) ?? null, [activos])
  const principalNombre = principal
    ? suppliersById.get(principal.supplierId)?.name ?? 'su proveedor'
    : null
  // Los formatos marcados para contar. Si no hay ninguno, se cuenta en la
  // unidad de siempre — y eso se DICE, no se calla.
  const formatosDeConteo = useMemo(() => formats.filter((f) => f.useInCount), [formats])
  const seCuentaEn = comoSeCuenta(
    formatosDeConteo.map((f) => ({ nombre: f.name, qtyInBase: f.qtyInBase })),
    baseAbbr,
  )

  // ── B4 · Dos proveedores que no se parecen ──
  // Se compara el €/base de cada uno contra el del PRINCIPAL (que es el que
  // manda el coste). Salta al doble o a la mitad: por debajo de ahí la
  // diferencia es negociación, no un formato mal puesto. Un enlace ya revisado
  // (verifiedAt) deja de avisar: el aviso interrumpe, así que sí filtra
  // (regla 7 — el umbral va donde interrumpe, no donde se listan las filas).
  const discordantes = useMemo(() => {
    if (!principal || principal.lastPrice === null || !(principal.lastPrice > 0)) return []
    const ref = principal.lastPrice
    return activos
      .filter((l) => l.id !== principal.id)
      .filter((l) => l.lastPrice !== null && l.lastPrice > 0)
      .filter((l) => l.verifiedAt === null)
      .map((l) => ({ link: l, razon: l.lastPrice! / ref }))
      .filter((x) => x.razon >= 2 || x.razon <= 0.5)
  }, [activos, principal])

  // ── B5 · En cuántos platos entra este ingrediente ──
  const [platosQueLoUsan, setPlatosQueLoUsan] = useState<number | null>(null)
  useEffect(() => {
    let cancelado = false
    previewRemoveIngredient(item.id)
      .then((platos) => { if (!cancelado) setPlatosQueLoUsan(platos.length) })
      .catch(() => { if (!cancelado) setPlatosQueLoUsan(null) })
    return () => { cancelado = true }
  }, [item.id])

  async function marcarComoRevisado(linkId: string) {
    await updateArticleSupplier(linkId, {
      verifiedAt: new Date().toISOString(),
      verifiedBy: actorId,
    })
    setSuccessNote('Anotado: ese proveedor está bien. El aviso no volverá a salir.')
    await reload()
  }

  // E4 — traer la sección a la vista y abrir el formulario si no hay nada.
  // Va en un requestAnimationFrame, no en el cuerpo del efecto: el scroll
  // necesita que la sección esté PINTADA, y abrir el formulario antes del
  // pintado encadena un render de más (react-hooks/set-state-in-effect dice
  // exactamente eso). Después del pintado es una sola pasada.
  useEffect(() => {
    if (!enfocar || loading) return
    const id = requestAnimationFrame(() => {
      seccionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (links.filter((l) => l.isActive).length === 0) openAddForm()
    })
    return () => cancelAnimationFrame(id)
    // Una sola vez, cuando la sección termina de cargar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enfocar, loading])

  return (
    <div ref={seccionRef} className="rounded-lg border border-border-default bg-card scroll-mt-4">
      {/* B1 · Cabecera: cómo se gasta, cómo se cuenta, y el coste diciendo de
          QUIÉN sale. El coste sin nombre obliga a adivinar qué proveedor lo
          está mandando; con 71 artículos de más de un proveedor, eso es
          adivinar todos los días. */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border-default">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-accent shrink-0" />
            <h3 className="text-sm font-medium text-text-primary">Cómo lo compras</h3>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            Se gasta en {baseAbbr || '—'} · Se cuenta en {seCuentaEn}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] text-text-secondary leading-none">Coste actual</div>
          <div className="text-lg font-mono font-medium text-text-primary leading-tight">
            {item.computedCost !== null && item.computedCost !== undefined
              ? `${fmtEur(item.computedCost, 5)} / ${baseAbbr}`
              : '—'}
          </div>
          <div className="text-[11px] text-text-secondary">
            {principalNombre ? `según ${principalNombre}` : 'sin proveedor principal'}
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

        {/* B4 · Dos proveedores que no se parecen. No esconde ninguna fila
            (esas siguen abajo, todas): solo avisa de la que chirría. */}
        {!loading && !error && discordantes.length > 0 && principal && (
          <div className="rounded-md border border-warning/30 bg-warning-bg p-3 space-y-2">
            {discordantes.map(({ link, razon }) => {
              const nombre = suppliersById.get(link.supplierId)?.name ?? 'Un proveedor'
              const cuanto =
                razon < 1
                  ? `sale a ${razon <= 0.36 ? 'un tercio' : 'la mitad'} del principal`
                  : `sale a ${razon >= 2.5 ? 'el triple' : 'el doble'} del principal`
              return (
                <div key={link.id} className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-xs text-text-primary flex items-start gap-1.5 min-w-0">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warning shrink-0" />
                    <span>
                      <span className="font-medium">{nombre}</span> {cuanto}:{' '}
                      <span className="font-mono">{fmtEur(link.lastPrice, 5)}</span> contra{' '}
                      <span className="font-mono">{fmtEur(principal.lastPrice, 5)}</span> por{' '}
                      {baseAbbr}. Suele ser el formato mal puesto, no el precio.
                    </span>
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setRevisarFormatoDe(link.id)}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-accent text-text-on-accent hover:opacity-90 transition-base"
                    >
                      Revisar el formato
                    </button>
                    <button
                      type="button"
                      onClick={() => void marcarComoRevisado(link.id)}
                      className="px-2.5 py-1 text-[11px] rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-base"
                    >
                      Está bien
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && !error && links.length > 0 && (
          <div className="space-y-2">
            {links.map((link) => (
              <SourceRow
                key={link.id}
                link={link}
                accountId={item.accountId}
                itemId={item.id}
                costStrategy={item.costStrategy}
                actorId={actorId}
                actorName={actorName}
                supplierName={
                  link.supplierId && suppliersById.get(link.supplierId)
                    ? suppliersById.get(link.supplierId)!.name
                    : 'Proveedor'
                }
                format={link.purchaseFormatId ? formatsById.get(link.purchaseFormatId) ?? null : null}
                parentFormat={(() => {
                  const f = link.purchaseFormatId ? formatsById.get(link.purchaseFormatId) : null
                  return f && f.parentFormatId ? formatsById.get(f.parentFormatId) ?? null : null
                })()}
                ultimoAlbaran={ultimoAlbaran.get(link.supplierId) ?? null}
                abrirFormato={revisarFormatoDe === link.id}
                onFormatoAbierto={() => setRevisarFormatoDe(null)}
                baseUnit={baseUnit}
                priceUnits={qtyUnits}
                onSaved={async () => {
                  setSuccessNote('Coste actualizado desde la compra.')
                  await reload()
                  if (onChanged) onChanged()
                }}
                onMakePreferred={() => handleMakePreferred(link.id)}
                onArchive={(supplierName) => handleArchive(link.id, supplierName)}
                onReactivate={() => handleReactivate(link.id)}
              />
            ))}
          </div>
        )}

        {!loading && !error && !modoAlta && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-[11px] text-text-secondary hover:text-text-primary transition-base inline-flex items-center gap-1"
          >
            <Archive className="w-3 h-3" />
            {showArchived ? 'Ocultar descatalogados' : 'Ver descatalogados'}
          </button>
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

        {/* Alta · A6 — varios proveedores por artículo (decisión 2 de Julio) */}
        {!addOpen ? (
          <div className="space-y-1">
            <button
              type="button"
              onClick={openAddForm}
              disabled={loading || !baseUnit}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
            >
              <Plus size={16} />
              {activos.length > 0
                ? 'Añadir otro proveedor para este mismo artículo'
                : 'Añadir proveedor'}
            </button>
            {activos.length > 0 && (
              <p className="text-[11px] text-text-secondary">
                Un artículo puede tener varios. Hoy hay 71 con más de uno, cada uno con su formato y
                su referencia.
              </p>
            )}
          </div>
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

            {/* A1 · Los DOS MODOS, desde el principio.
                Hasta hoy «Caja con piezas» solo aparecía al EDITAR, o sea
                después de guardar: la primera vez había que aplanar la caja a
                mano. Es mover lo que ya existía, no inventarlo. */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                ¿Cómo viene?
              </label>
              <div className="inline-flex rounded-md border border-border-default overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setAddMode('simple')}
                  disabled={submitting}
                  className={`px-3 py-1.5 transition-base disabled:opacity-50 ${
                    addMode === 'simple'
                      ? 'bg-accent text-text-on-accent font-medium'
                      : 'bg-card text-text-secondary hover:text-text-primary'
                  }`}
                >
                  De una pieza
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('pack')}
                  disabled={submitting}
                  className={`px-3 py-1.5 border-l border-border-default transition-base disabled:opacity-50 ${
                    addMode === 'pack'
                      ? 'bg-accent text-text-on-accent font-medium'
                      : 'bg-card text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Caja con piezas dentro
                </button>
              </div>
            </div>

            {addMode === 'simple' ? (
              <>
                <div>
                  <input
                    type="text"
                    value={formatName}
                    onChange={(e) => setFormatName(e.target.value)}
                    disabled={submitting}
                    placeholder="Ej: Saco, Garrafa, Bidón…"
                    className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                </div>

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
              </>
            ) : (
              /* A2 · La fila se lee como una FRASE:
                 Caja · lleva · 6 · piezas de · Bote · de · 965 g */
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-text-primary">
                  <input
                    type="text"
                    value={addCajaName}
                    onChange={(e) => setAddCajaName(e.target.value)}
                    disabled={submitting}
                    aria-label="Nombre del contenedor"
                    placeholder="Caja"
                    className="w-28 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                  <span className="text-text-secondary">lleva</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={addCount}
                    onChange={(e) => setAddCount(e.target.value)}
                    disabled={submitting}
                    aria-label="Cuántas piezas trae"
                    placeholder="6"
                    className="w-16 px-2 py-1.5 text-sm text-center border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                  <span className="text-text-secondary">piezas de</span>
                  <input
                    type="text"
                    value={addInnerName}
                    onChange={(e) => setAddInnerName(e.target.value)}
                    disabled={submitting}
                    aria-label="Nombre de la pieza"
                    placeholder="Bote"
                    className="w-28 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                  <span className="text-text-secondary">de</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={addInnerQty}
                    onChange={(e) => setAddInnerQty(e.target.value)}
                    disabled={submitting}
                    aria-label="Cuánto lleva una pieza"
                    placeholder="965"
                    className="w-20 px-2 py-1.5 text-sm text-right border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                  <select
                    value={addInnerUnitId}
                    onChange={(e) => setAddInnerUnitId(e.target.value)}
                    disabled={submitting || qtyUnits.length === 0}
                    aria-label="Unidad del contenido de una pieza"
                    className="w-20 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  >
                    {qtyUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.abbreviation}
                      </option>
                    ))}
                  </select>
                </div>

                {innerMismatch && baseUnit && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-warning">
                      Dime cuánto lleva UNA pieza en {baseUnit.abbreviation}:
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={addInnerDirectBase}
                      onChange={(e) => setAddInnerDirectBase(e.target.value)}
                      disabled={submitting}
                      placeholder={`en ${baseUnit.abbreviation}`}
                      className="w-28 px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                  </div>
                )}
              </div>
            )}

            {/* A3 · La cuenta hecha, debajo y en verde. El total NUNCA se
                teclea: se deriva, así que no puede descuadrarse del desglose. */}
            {addQtyInBase !== null && baseUnit && (
              <p className="text-[11px] text-success font-mono">
                {addMode === 'pack' && addCountNum !== null && addInnerBase !== null
                  ? `1 ${addCajaName.trim() || 'Caja'} = ${fmtNum(addCountNum)} ${plural(addInnerName.trim() || 'pieza', addCountNum)} × ${fmtNum(addInnerBase)} ${baseUnit.abbreviation} = ${fmtNum(addQtyInBase)} ${baseUnit.abbreviation}`
                  : `1 ${formatName.trim() || 'formato'} = ${fmtNum(addQtyInBase)} ${baseUnit.abbreviation}`}
              </p>
            )}

            {/* A4 · Su referencia y cómo lo llama él, uno al lado del otro,
                con su porqué debajo. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Su referencia
                </label>
                <input
                  type="text"
                  value={supplierCode}
                  onChange={(e) => setSupplierCode(e.target.value)}
                  disabled={submitting}
                  placeholder="Ej: 520801061"
                  className="w-full px-2 py-1.5 text-sm font-mono border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Cómo lo llama él
                </label>
                <input
                  type="text"
                  value={supplierItemName}
                  onChange={(e) => setSupplierItemName(e.target.value)}
                  disabled={submitting}
                  placeholder="Su texto tal cual sale en el albarán"
                  className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
              </div>
              <p className="sm:col-span-2 text-[11px] text-text-secondary">
                Con ellas, sus albaranes casan solos. Hoy hay 73 enlaces sin referencia, y cada uno
                es una línea que alguien tiene que emparejar a mano cuando llega la mercancía.
              </p>
            </div>

            {/* A5 · El precio es el de la caja, y al lado a cuánto queda */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                ¿Cuánto te cuesta {addMode === 'pack' ? `una ${(addCajaName.trim() || 'caja').toLowerCase()}` : 'ese formato'}? (€)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={submitting}
                placeholder="Ej: 42,91"
                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
              {previewUnitCost !== null && baseUnit && (
                <div className="mt-1.5 rounded-md bg-accent-bg border border-accent/20 px-3 py-2 text-sm text-text-primary">
                  <span className="font-mono font-medium">
                    {fmtEur(previewUnitCost, 5)} / {baseUnit.abbreviation}
                  </span>
                  {previewPiecePrice !== null && (
                    <span className="font-mono text-text-secondary">
                      {' · '}
                      {fmtEur(previewPiecePrice, 2)} / {(addInnerName.trim() || 'pieza').toLowerCase()}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* A7 · ¿En qué lo cuentas? Lo elige quien crea el artículo
                (decisión 3 de Julio). Se guarda en `use_in_count`. */}
            {baseUnit && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  ¿En qué lo cuentas?
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ...(addMode === 'pack'
                      ? [{ id: 'caja' as const, label: plural(addCajaName.trim() || 'Caja', 2) },
                         { id: 'pieza' as const, label: plural(addInnerName.trim() || 'Pieza', 2) }]
                      : [{ id: 'caja' as const, label: plural(formatName.trim() || 'Formato', 2) }]),
                    { id: 'base' as const, label: baseUnit.abbreviation },
                  ]).map((op) => (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => setAddCuentaEn(op.id)}
                      disabled={submitting}
                      className={`px-3 py-1.5 text-xs rounded-md border transition-base disabled:opacity-50 ${
                        addCuentaEn === op.id
                          ? 'bg-accent text-text-on-accent border-accent font-medium'
                          : 'bg-card text-text-primary border-border-default hover:border-accent'
                      }`}
                    >
                      {op.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-text-secondary mt-1">
                  Es lo que verá quien haga el recuento de almacén. Se puede cambiar luego.
                </p>
              </div>
            )}

            {/* A8 · «Cómo queda»: las cuatro preguntas juntas.
                SIEMPRE visible mientras el formulario está abierto, con «—» en
                lo que aún no se ha dicho. Antes solo aparecía cuando ya estaba
                todo relleno, o sea justo cuando ya no hacía falta: quien abría
                el formulario en blanco no veía las cuatro preguntas por ningún
                lado. Enseñar el hueco es la mitad del trabajo de este resumen. */}
            {baseUnit && (
              <div className="rounded-md border border-border-default bg-card px-3 py-2 space-y-1">
                <div className="text-[11px] font-medium text-text-secondary">Cómo queda</div>
                <p className="text-xs text-text-primary">
                  Lo compro:{' '}
                  <span className={addQtyInBase === null ? 'text-text-secondary' : 'font-medium'}>
                    {addMode === 'pack'
                      ? addCountNum !== null && addInnerBase !== null
                        ? `${addCajaName.trim() || 'Caja'} de ${fmtNum(addCountNum)} ${plural(addInnerName.trim() || 'pieza', addCountNum).toLowerCase()} de ${fmtNum(addInnerBase)} ${baseUnit.abbreviation}`
                        : '— dime cuántas piezas trae y cuánto lleva una —'
                      : addQtyInBase !== null
                        ? `${formatName.trim() || 'formato'} de ${fmtNum(addQtyInBase)} ${baseUnit.abbreviation}`
                        : '— dime cómo viene y cuánto trae —'}
                  </span>
                </p>
                <p className="text-xs text-text-primary">
                  Lo cuento en:{' '}
                  <span className="font-medium">
                    {addCuentaEn === 'base'
                      ? baseUnit.abbreviation
                      : addCuentaEn === 'pieza'
                        ? plural(addInnerName.trim() || 'Pieza', 2).toLowerCase()
                        : plural((addMode === 'pack' ? addCajaName : formatName).trim() || 'Formato', 2).toLowerCase()}
                  </span>
                </p>
                <p className="text-xs text-text-primary">
                  Lo gasto en: <span className="font-medium">{baseUnit.abbreviation}</span>
                </p>
                <p className="text-xs text-text-primary">
                  Él lo llama:{' '}
                  <span className={supplierItemName.trim() === '' ? 'text-text-secondary' : 'font-medium'}>
                    {supplierItemName.trim() !== '' ? supplierItemName.trim() : '— aún no lo has dicho —'}
                  </span>
                  {supplierCode.trim() !== '' && (
                    <span className="text-text-secondary font-mono"> · {supplierCode.trim()}</span>
                  )}
                </p>
                {/* Y el precio, que es la cuarta cosa que se mira antes de guardar */}
                <p className="text-xs text-text-primary">
                  Me cuesta:{' '}
                  <span className={previewUnitCost === null ? 'text-text-secondary' : 'font-medium font-mono'}>
                    {previewUnitCost !== null
                      ? `${fmtEur(priceNum, 2)} · ${fmtEur(previewUnitCost, 5)} / ${baseUnit.abbreviation}`
                      : '— sin precio todavía, se puede guardar y seguir luego —'}
                  </span>
                </p>
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

            {/* A9 · Un artículo puede quedarse a medias A PROPÓSITO. Lo que
                no puede es quedarse a medias sin que nadie lo sepa: por eso
                «Guardar y seguir luego» guarda el formato (que es lo que
                faltaba) y deja el precio para cuando se sepa. */}
            <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => void handleAdd({ seguirLuego: true })}
                disabled={submitting}
                className="px-3 py-1.5 text-sm rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-base disabled:opacity-50"
              >
                Guardar y seguir luego
              </button>
              <div className="flex items-center gap-2">
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
                  onClick={() => void handleAdd()}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {submitting ? 'Guardando…' : 'Guardar compra'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* B5 · El pie de la ficha: en qué sale en el recuento, en qué se
            gasta y cuántos platos lo usan. Las tres cosas que hay que saber
            antes de tocar un formato. */}
        {!loading && !error && baseUnit && !modoAlta && (
          <div className="mt-3 pt-3 border-t border-border-default flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
            <span>
              En el recuento saldrá en <span className="text-text-primary">{seCuentaEn}</span>
            </span>
            <span>
              Se gasta en <span className="text-text-primary">{baseAbbr}</span>
            </span>
            <span>
              {platosQueLoUsan === null
                ? 'Platos que lo usan: —'
                : `Lo usan ${platosQueLoUsan} plato${platosQueLoUsan === 1 ? '' : 's'}`}
            </span>
          </div>
        )}

        {/* Este ingrediente en los escandallos: sustituir / añadir / quitar
            (granular por plato). En el alta no se enseña: un artículo que
            acaba de nacer no está en ningún escandallo todavía. */}
        {!modoAlta && (
        <div className="mt-4 pt-3 border-t border-border-default">
          <div className="text-xs font-medium text-text-secondary mb-2">Este ingrediente en los escandallos</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSubstituteOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default text-text-primary hover:bg-page hover:border-accent transition-base">
              <ArrowRightLeft className="w-4 h-4 text-accent" /> Sustituir por otro
            </button>
            <button type="button" onClick={() => setAddIngredientOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default text-text-primary hover:bg-page hover:border-accent transition-base">
              <Plus className="w-4 h-4 text-accent" /> Añadir a platos
            </button>
            <button type="button" onClick={() => setRemoveIngredientOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default text-text-primary hover:bg-page hover:border-accent transition-base">
              <Trash2 className="w-4 h-4 text-accent" /> Quitar de platos
            </button>
          </div>
        </div>
        )}
      </div>

      {substituteOpen && (
        <IngredientSubstituteModal
          source={{ id: item.id, name: item.name, accountId: item.accountId }}
          units={units}
          onClose={() => setSubstituteOpen(false)}
          onDone={() => { setSubstituteOpen(false); onChanged?.() }}
        />
      )}
      {addIngredientOpen && (
        <IngredientAddModal
          source={{ id: item.id, name: item.name, accountId: item.accountId, baseUnitId: item.baseUnitId }}
          units={units}
          onClose={() => setAddIngredientOpen(false)}
          onDone={() => { setAddIngredientOpen(false); onChanged?.() }}
        />
      )}
      {removeIngredientOpen && (
        <IngredientRemoveModal
          source={{ id: item.id, name: item.name, accountId: item.accountId }}
          units={units}
          onClose={() => setRemoveIngredientOpen(false)}
          onDone={() => { setRemoveIngredientOpen(false); onChanged?.() }}
        />
      )}
    </div>
  )
}

// ── Fila de una fuente de compra existente, con edición de precio BASE-FIRST ──
// El cocinero VE y EDITA el precio en su unidad humana (€/kg, €/g, €/L, €/ud),
// no el precio del formato. Internamente guardamos last_price como €/UNIDAD BASE
// directo (= unitPriceToBase del valor tecleado); el motor de coste lo lee tal
// cual, sin pasar por el formato. El €/caja es solo informativo y se DERIVA con
// formatPriceFromUnitCost cuando hay formato. Así es IMPOSIBLE teclear €/kg
// donde el sistema esperaba €/caja (el error COHELDI). Editar dispara
// updateArticleSupplier, que recostea los platos (cascada en el service).
interface SourceRowProps {
  link: ArticleSupplier
  accountId: string
  itemId: string
  costStrategy: string
  actorId: string | null
  actorName: string | null
  supplierName: string
  format: PurchaseFormat | null
  /** El nodo PIEZA del que cuelga la caja (parent_format_id). */
  parentFormat: PurchaseFormat | null
  /** B3 — fecha del último albarán de este proveedor (ISO date) o null. */
  ultimoAlbaran: string | null
  /** B4 — «Revisar el formato» abre el editor de este enlace al montarse. */
  abrirFormato: boolean
  onFormatoAbierto: () => void
  baseUnit: KitchenUnit | null
  priceUnits: KitchenUnit[]   // unidades de la misma dimensión que la base (kg/g, L/ml, ud)
  onSaved: () => void | Promise<void>
  onMakePreferred: () => void | Promise<void>
  onArchive: (supplierName: string) => void | Promise<void>
  onReactivate: () => void | Promise<void>
}

// Redondeo limpio para pre-rellenar el input (evita 8,9900000001).
function toInputStr(n: number): string {
  return String(Math.round(n * 10000) / 10000)
}

function SourceRow({
  link,
  accountId,
  itemId,
  costStrategy,
  actorId,
  actorName,
  supplierName,
  format,
  parentFormat,
  ultimoAlbaran,
  abrirFormato,
  onFormatoAbierto,
  baseUnit,
  priceUnits,
  onSaved,
  onMakePreferred,
  onArchive,
  onReactivate,
}: SourceRowProps) {
  const archived = !link.isActive
  const baseAbbr = baseUnit?.abbreviation ?? ''
  const displayUnit = pickDisplayUnit(priceUnits, baseUnit)
  const displayAbbr = displayUnit?.abbreviation ?? baseAbbr

  // €/base actual = link.lastPrice DIRECTO (last_price ya es €/base, desacoplado
  // del formato; no se deriva con unitCostFromFormat). Y su expresión humana.
  const unitCost = link.lastPrice
  const priceInDisplay =
    unitCost !== null && displayUnit && baseUnit
      ? unitPriceFromBase(unitCost, displayUnit, baseUnit)
      : null

  // ── Precio PACTADO (negotiated_price): dato PARALELO e independiente del normal.
  // €/base directo; se muestra/edita en la unidad humana igual que el precio, pero
  // NO afecta al coste (es solo referencia para la futura alarma).
  const negInDisplay =
    link.negotiatedPrice !== null && displayUnit && baseUnit
      ? unitPriceFromBase(link.negotiatedPrice, displayUnit, baseUnit)
      : null

  const [editing, setEditing] = useState(false)
  const [priceUnitId, setPriceUnitId] = useState<string>(displayUnit?.id ?? '')
  const [val, setVal] = useState('')
  const [codeVal, setCodeVal] = useState(link.supplierCode ?? '')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)   // estrella / archivar / reactivar

  // Estado propio del editor de pactado (no comparte nada con el del precio normal).
  const [editingNeg, setEditingNeg] = useState(false)
  const [negPriceUnitId, setNegPriceUnitId] = useState<string>(displayUnit?.id ?? '')
  const [negVal, setNegVal] = useState('')
  const [savingNeg, setSavingNeg] = useState(false)

  // ── Editor de FORMATO (crear o editar el formato de compra de este proveedor) ──
  // Dos modos: SIMPLE (un total: "Saco 25 kg") y PACK ("Caja = 6 × Lata de 3 kg").
  const [editingFmt, setEditingFmt] = useState(false)
  const [fmtMode, setFmtMode] = useState<'simple' | 'pack'>('simple')
  const [savingFmt, setSavingFmt] = useState(false)
  const [fmtError, setFmtError] = useState<string | null>(null)
  // simple
  const [fmtName, setFmtName] = useState('')
  const [fmtQty, setFmtQty] = useState('')
  const [fmtUnitId, setFmtUnitId] = useState<string>(baseUnit?.id ?? '')
  const [fmtDirectBase, setFmtDirectBase] = useState('')
  // pack
  const [packCajaName, setPackCajaName] = useState('Caja')
  const [packCount, setPackCount] = useState('')      // nº de piezas por caja
  const [packInnerName, setPackInnerName] = useState('')  // "Lata", "Bolsa"…
  const [packInnerQty, setPackInnerQty] = useState('')    // contenido de UNA pieza
  const [packUnitId, setPackUnitId] = useState<string>(baseUnit?.id ?? '')
  const [packDirectBase, setPackDirectBase] = useState('')
  // C · lo que este formato lleva detrás, para poder EXPLICAR la guarda
  // `trg_recipe_item_purchase_format_immutable` en vez de soltar su excepción.
  const [historia, setHistoria] = useState<HistoriaDelFormato | null>(null)
  // C4/A7 · ¿en qué lo cuentas? También aquí, no solo en el alta.
  const [cuentaEn, setCuentaEn] = useState<'caja' | 'pieza' | 'base'>('base')
  const [guardandoCuenta, setGuardandoCuenta] = useState(false)

  function openFmtEdit() {
    setFmtError(null)
    // Si el formato YA es una caja con piezas, el editor abre en ese modo y
    // relleno: hasta hoy abría siempre en «Un total» y volvía a pedir el árbol
    // desde cero, que es cómo se aplana una caja sin querer.
    const esPack = format !== null && format.qtyPerParent !== null && parentFormat !== null
    setFmtMode(esPack ? 'pack' : 'simple')
    setFmtName(format?.name ?? '')
    setFmtQty(format ? toInputStr(format.qtyInBase) : '')
    setFmtUnitId(baseUnit?.id ?? '')
    setFmtDirectBase('')
    setPackCajaName(esPack ? format!.name : 'Caja')
    setPackCount(esPack ? toInputStr(format!.qtyPerParent!) : '')
    setPackInnerName(esPack ? parentFormat!.name : '')
    setPackInnerQty(esPack ? toInputStr(parentFormat!.qtyInBase) : '')
    setPackUnitId(baseUnit?.id ?? '')
    setPackDirectBase('')
    setCuentaEn(
      format?.useInCount ? 'caja' : parentFormat?.useInCount ? 'pieza' : 'base',
    )
    setHistoria(null)
    if (format) {
      historiaDelFormato(accountId, format.id)
        .then(setHistoria)
        .catch((e) => {
          // Sin historia el editor sigue funcionando: lo que se pierde es la
          // explicación, no la puerta. La guarda de la base sigue ahí.
          console.error('[PurchaseSourcesSection] historia del formato', e)
          setHistoria(null)
        })
    }
    setEditingFmt(true)
  }

  // B4 — «Revisar el formato» abre este editor desde el aviso de arriba.
  // Mismo motivo que arriba: tras el pintado, no dentro del efecto.
  useEffect(() => {
    if (!abrirFormato) return
    const id = requestAnimationFrame(() => {
      openFmtEdit()
      onFormatoAbierto()
    })
    return () => cancelAnimationFrame(id)
    // Solo cuando el aviso lo pide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirFormato])

  async function guardarCuentaEn(op: 'caja' | 'pieza' | 'base') {
    setCuentaEn(op)
    setGuardandoCuenta(true)
    try {
      if (format) await setUseInCount(format.id, op === 'caja')
      if (parentFormat) await setUseInCount(parentFormat.id, op === 'pieza')
      await onSaved()
    } catch (e) {
      setFmtError(e instanceof Error ? e.message : 'No se pudo cambiar en qué se cuenta.')
    } finally {
      setGuardandoCuenta(false)
    }
  }

  // helper: convierte (cantidad + unidad) -> base, con fallback directo si la dimensión no cuadra
  function resolveBase(qtyStr: string, unitId: string, directStr: string): number | null {
    const q = parseDecimal(qtyStr)
    const u = priceUnits.find((x) => x.id === unitId) ?? baseUnit
    if (q === null || !u || !baseUnit) return null
    const c = convertToBase(q, u, baseUnit)
    if (c && c.ok) return c.qtyInBase
    // dimensión distinta -> el cocinero da el total en base
    const d = parseDecimal(directStr)
    return d !== null && d > 0 ? d : null
  }

  // SIMPLE: total en base
  const fmtQtyInBase = resolveBase(fmtQty, fmtUnitId, fmtDirectBase)
  const fmtMismatch = (() => {
    const q = parseDecimal(fmtQty)
    const u = priceUnits.find((x) => x.id === fmtUnitId) ?? baseUnit
    if (q === null || !u || !baseUnit) return false
    const c = convertToBase(q, u, baseUnit)
    return c !== null && c.ok === false && c.reason === 'dimension_mismatch'
  })()

  // PACK: contenido de UNA pieza, y total caja = count × inner
  const packInnerBase = resolveBase(packInnerQty, packUnitId, packDirectBase)
  const packCountNum = parseDecimal(packCount)
  const packTotalBase =
    packInnerBase !== null && packCountNum !== null && packCountNum > 0
      ? packInnerBase * packCountNum : null
  const packMismatch = (() => {
    const q = parseDecimal(packInnerQty)
    const u = priceUnits.find((x) => x.id === packUnitId) ?? baseUnit
    if (q === null || !u || !baseUnit) return false
    const c = convertToBase(q, u, baseUnit)
    return c !== null && c.ok === false && c.reason === 'dimension_mismatch'
  })()

  // C3 — lo que va a cambiar: el coste de hasta hoy y el de desde hoy.
  const nuevoTotalBase = fmtMode === 'pack' ? packTotalBase : fmtQtyInBase
  const costeHastaHoy = link.lastPrice
  // La cuenta vive en lib/ y está probada con los números reales de Alubias
  // (28,84 € la caja de 18.000 g). Aquí solo se pinta.
  const { precioDelFormato, costeDesdeHoy } = loQueVaACambiar({
    costeHastaHoy,
    totalHastaHoy: format?.qtyInBase ?? 0,
    totalDesdeHoy: nuevoTotalBase,
  })
  const contenidoCambia =
    format !== null && nuevoTotalBase !== null && Math.abs(nuevoTotalBase - format.qtyInBase) > 1e-9

  async function saveFmt() {
    setFmtError(null)
    try {
      // FLIP de estrategia: si el ingrediente está en coste 'fixed' (tecleado a
      // mano), al montar formato+compra el coste debe FLUIR desde el precio. Sin
      // esto el computed_cost se queda en fixed_cost (a menudo null=0) e ignora el
      // precio de compra. Mismo flip que hace setupSimplePurchase en el alta.
      if (costStrategy === 'fixed') {
        await updateRecipeItem(itemId, { costStrategy: 'last_purchase' })
      }
      if (fmtMode === 'simple') {
        const name = fmtName.trim()
        if (name === '') { setFmtError('Dale un nombre al formato (Caja, Saco, Garrafa…).'); return }
        if (fmtQtyInBase === null || !(fmtQtyInBase > 0)) { setFmtError('Indica cuánto trae ese formato.'); return }
        setSavingFmt(true)
        if (format) {
          // ENCARGO CODE (14/08) feat/formatos-documento-decide, Tramo C —
          // Ley 3: un formato con movimientos de stock no se edita, se
          // archiva y se sustituye. El trigger de la base
          // (trg_recipe_item_purchase_format_immutable) es la defensa real;
          // esta comprobación evita el viaje de ida y vuelta con el error de
          // la base cuando el contenido realmente cambió.
          const contentChanged = fmtQtyInBase !== format.qtyInBase
          const locked = contentChanged && await purchaseFormatHasStockMovements(format.id)
          if (locked) {
            await archiveAndReplacePurchaseFormat({
              accountId, itemId, oldFormatId: format.id, name, qtyInBase: fmtQtyInBase,
              articleSupplierId: link.id, createdBy: actorId, createdByName: actorName,
            })
          } else {
            await updatePurchaseFormat(format.id, { name, qtyInBase: fmtQtyInBase })
            await updateArticleSupplier(link.id, { purchaseFormatId: format.id })
          }
        } else {
          const created = await createPurchaseFormat({
            accountId, itemId, name, qtyInBase: fmtQtyInBase,
            source: 'manual', createdBy: actorId, createdByName: actorName,
          })
          await updateArticleSupplier(link.id, { purchaseFormatId: created.id })
        }
      } else {
        // PACK: caja = count × pieza
        const cajaName = packCajaName.trim() || 'Caja'
        const innerName = packInnerName.trim() || 'Ud'
        if (packCountNum === null || !(packCountNum > 0)) { setFmtError('¿Cuántas piezas trae la caja?'); return }
        if (packInnerBase === null || !(packInnerBase > 0)) { setFmtError('Indica el contenido de UNA pieza.'); return }
        setSavingFmt(true)
        const { caja, inner } = await ensurePackTree({
          accountId, itemId, count: packCountNum, innerQtyInBase: packInnerBase,
          innerName, cajaName, source: 'manual', createdBy: actorId, createdByName: actorName,
        })
        // enlaza el proveedor a la CAJA (el formato de compra)
        await updateArticleSupplier(link.id, { purchaseFormatId: caja.id })
        // Y archiva el formato plano que había antes, si ha quedado suelto.
        // Sin esto, pasar de «Un total» a «Caja con piezas» deja un nodo que
        // ya no enlaza nadie: son 5 de los 9 huérfanos vivos que hay hoy en
        // Foodint, todos con source='manual'. Archivar NO es borrar: los
        // albaranes viejos siguen apuntando a su id y siguen cuadrando.
        if (format && format.id !== caja.id && format.id !== inner.id) {
          await updatePurchaseFormat(format.id, {
            isActive: false,
            archivedAt: new Date().toISOString(),
          })
        }
      }
      setEditingFmt(false)
      await onSaved()
    } catch (e) {
      setFmtError(e instanceof Error ? e.message : 'No se pudo guardar el formato.')
    } finally {
      setSavingFmt(false)
    }
  }

  function openEdit() {
    setPriceUnitId(displayUnit?.id ?? '')
    setVal(priceInDisplay !== null ? toInputStr(priceInDisplay) : '')
    setCodeVal(link.supplierCode ?? '')
    setEditing(true)
  }

  // Derivación en vivo mientras se teclea (idéntica a lo que se guardará).
  const selectedUnit = priceUnits.find((u) => u.id === priceUnitId) ?? baseUnit
  const typed = parseDecimal(val)
  const previewPerBase =
    typed !== null && selectedUnit && baseUnit
      ? unitPriceToBase(typed, selectedUnit, baseUnit)
      : null
  const previewFormatPrice =
    previewPerBase !== null && format
      ? formatPriceFromUnitCost(previewPerBase, format.qtyInBase)
      : null

  // ── Editor del pactado: misma mecánica base-first, pero escribe negotiatedPrice.
  function openEditNeg() {
    setNegPriceUnitId(displayUnit?.id ?? '')
    setNegVal(negInDisplay !== null ? toInputStr(negInDisplay) : '')
    setEditingNeg(true)
  }
  const negSelectedUnit = priceUnits.find((u) => u.id === negPriceUnitId) ?? baseUnit
  const negTyped = parseDecimal(negVal)
  const negPreviewPerBase =
    negTyped !== null && negSelectedUnit && baseUnit
      ? unitPriceToBase(negTyped, negSelectedUnit, baseUnit)
      : null

  async function saveNeg() {
    const t = parseDecimal(negVal)
    // Vacío → borra el pacto (NULL). Negativo → cancela sin guardar.
    let newNeg: number | null = null
    if (t !== null) {
      if (t < 0) { setEditingNeg(false); return }
      newNeg = baseUnit && negSelectedUnit ? unitPriceToBase(t, negSelectedUnit, baseUnit) : t
    }
    setSavingNeg(true)
    try {
      await updateArticleSupplier(link.id, { negotiatedPrice: newNeg })
      setEditingNeg(false)
      await onSaved()
    } finally {
      setSavingNeg(false)
    }
  }

  async function save() {
    const t = parseDecimal(val)
    if (t === null || t < 0) {
      setEditing(false)
      return
    }
    // Base-first: lo tecleado es €/unidad → lo pasamos a €/base y ESO es lo que
    // se guarda en last_price (el motor lo lee directo, sin pasar por el formato).
    // El precio es editable SIEMPRE, con o sin formato: el formato ya no es
    // requisito del precio.
    let newLastPrice: number | null = null
    if (baseUnit && selectedUnit) {
      newLastPrice = unitPriceToBase(t, selectedUnit, baseUnit)
    } else {
      // Sin unidad/base resoluble (degenerado): guardamos el valor tal cual.
      newLastPrice = t
    }
    if (newLastPrice === null) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await updateArticleSupplier(link.id, {
        lastPrice: newLastPrice,
        supplierCode: codeVal.trim() || null,
      })
      setEditing(false)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function doMakePreferred() {
    if (link.isPreferred || busy) return
    setBusy(true)
    try { await onMakePreferred() } finally { setBusy(false) }
  }
  async function doArchive() {
    if (busy) return
    setBusy(true)
    try { await onArchive(supplierName) } finally { setBusy(false) }
  }
  async function doReactivate() {
    if (busy) return
    setBusy(true)
    try { await onReactivate() } finally { setBusy(false) }
  }

  return (
    <div className={`flex items-start gap-2 rounded-md border ${link.isPreferred && !archived ? 'border-accent/40' : 'border-border-default'} bg-page px-3 py-2.5 ${archived ? 'opacity-60' : ''}`}>
      {/* Estrella: marca este proveedor como PRINCIPAL (exclusivo por ingrediente).
          El principal manda el coste del ingrediente. No se muestra en archivados. */}
      {!archived && (
        <button
          type="button"
          onClick={() => void doMakePreferred()}
          disabled={busy}
          aria-label={link.isPreferred ? 'Proveedor principal' : 'Marcar como principal'}
          title={link.isPreferred ? 'Principal de este ingrediente' : 'Marcar como principal'}
          className={`flex-shrink-0 mt-0.5 p-1 rounded-md transition-base disabled:opacity-50 ${
            link.isPreferred ? 'text-warning' : 'text-text-secondary hover:text-warning'
          }`}
        >
          <Star className={`w-4 h-4 ${link.isPreferred ? 'fill-current' : ''}`} />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{supplierName}</span>
          {link.isPreferred && !archived && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-warning-bg text-warning flex-shrink-0">
              <Star className="w-3 h-3" />
              principal
            </span>
          )}
          {archived && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-page border border-border-default text-text-secondary flex-shrink-0">
              <Archive className="w-3 h-3" />
              descatalogado
            </span>
          )}
          {/* B3 · la fecha de su último albarán, junto al nombre */}
          {ultimoAlbaran && (
            <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary flex-shrink-0">
              <CalendarDays className="w-3 h-3" />
              último albarán {fmtFecha(ultimoAlbaran)}
            </span>
          )}
        </div>

        {/* B2 · Su referencia, su texto y su formato en una línea LEGIBLE.
            La referencia va en monoespaciada (F4): es un código, y en
            proporcional el 0 y la O se confunden justo cuando hay que
            teclearlo para casar un albarán. */}
        {link.supplierCode ? (
          <div className="text-[11px] text-text-secondary">
            <span className="font-mono text-text-primary">{link.supplierCode}</span>
            {link.supplierItemName && (
              <span className="ml-1.5" title={link.supplierItemName}>
                · {link.supplierItemName}
              </span>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-warning inline-flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Sin su referencia: sus albaranes hay que casarlos a mano
          </div>
        )}

        {/* El formato, dicho como una frase y con la cuenta hecha. */}
        <div className="text-xs text-text-secondary">
          {format
            ? cuentaDelFormato(comoRegla(format, parentFormat), baseAbbr)
            : 'Sin formato'}
          {format && link.lastPrice !== null && (
            <>
              {' · '}
              {/* €/caja DERIVADO del €/base (last_price) × qtyInBase, solo informativo */}
              <span className="font-mono">{fmtEur(formatPriceFromUnitCost(link.lastPrice, format.qtyInBase), 2)} / {format.name.toLowerCase()}</span>
              {/* A5 · y a cuánto queda la PIEZA, cuando la caja tiene piezas.
                  Es el número con el que se compara de verdad en la cocina. */}
              {parentFormat && format.qtyPerParent !== null && format.qtyPerParent > 0 && (
                <>
                  {' · '}
                  <span className="font-mono">
                    {fmtEur(
                      formatPriceFromUnitCost(link.lastPrice, format.qtyInBase)! / format.qtyPerParent,
                      2,
                    )}{' '}
                    / {parentFormat.name.toLowerCase()}
                  </span>
                </>
              )}
            </>
          )}
          {!archived && format && !editingFmt && (
            <button
              type="button"
              onClick={openFmtEdit}
              className="ml-2 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
              title="Editar el formato de compra"
            >
              <Pencil className="w-2.5 h-2.5" />editar formato
            </button>
          )}
        </div>

        {/* Llamada VISIBLE cuando falta formato: es lo que deja el artículo "sin terminar" */}
        {!archived && !format && !editingFmt && (
          <button
            type="button"
            onClick={openFmtEdit}
            className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-warning-bg text-warning text-xs font-medium border border-border-default hover:opacity-90 transition-base"
            title="Definir cómo viene (caja, saco, pack…) para terminar el artículo"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Falta el formato — pulsa para definirlo
          </button>
        )}

        {/* Editor de formato inline: modo SIMPLE o PACK */}
        {editingFmt && (
          <div className="mt-2 p-3 rounded-md border border-border-default bg-page space-y-3">
            {/* C1/C2 · Este formato tiene historia detrás. Hasta hoy la guarda
                `trg_recipe_item_purchase_format_immutable` cortaba el guardado
                con su excepción en crudo; ahora se dice ANTES, en castellano,
                y se dice también que no se pierde nada. */}
            {historia !== null && historia.conMovimiento > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 space-y-1.5">
                <p className="text-xs text-text-primary flex items-start gap-1.5">
                  <History className="w-3.5 h-3.5 mt-0.5 text-warning shrink-0" />
                  <span>
                    <span className="font-medium">
                      Este formato ya se ha usado {historia.conMovimiento}{' '}
                      {historia.conMovimiento === 1 ? 'vez' : 'veces'}
                      {historia.desde ? ` desde el ${fmtFecha(historia.desde)}` : ''}.
                    </span>
                  </span>
                </p>
                <p className="text-[11px] text-text-secondary">
                  No se tocan las entradas ni los costes de antes: lo que compraste con este formato
                  sigue valiendo lo que valía. Lo de ahora es una versión nueva, desde hoy.
                </p>

                {/* C3 · Lo que va a cambiar, con el coste de cada lado */}
                {contenidoCambia && format && baseUnit && (
                  <div className="mt-1 rounded-md border border-border-default bg-card px-2.5 py-2 text-[11px] space-y-1">
                    <div className="font-medium text-text-secondary">Lo que va a cambiar</div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-secondary">
                        Hasta hoy · {format.name} de {fmtNum(format.qtyInBase)} {baseUnit.abbreviation}
                      </span>
                      <span className="font-mono text-text-primary">
                        {costeHastaHoy !== null
                          ? `${fmtEur(costeHastaHoy, 5)} / ${baseUnit.abbreviation}`
                          : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-secondary">
                        Desde hoy · {(fmtMode === 'pack' ? packCajaName.trim() || 'Caja' : fmtName.trim() || format.name)} de{' '}
                        {nuevoTotalBase !== null ? fmtNum(nuevoTotalBase) : '—'} {baseUnit.abbreviation}
                      </span>
                      <span className="font-mono text-text-primary">
                        {costeDesdeHoy !== null
                          ? `${fmtEur(costeDesdeHoy, 5)} / ${baseUnit.abbreviation}`
                          : '—'}
                      </span>
                    </div>
                    <p className="text-text-secondary pt-0.5">
                      El precio de {(format.name).toLowerCase()} no cambia
                      {precioDelFormato !== null ? ` (${fmtEur(precioDelFormato, 2)})` : ''}: lo que
                      cambia es cuánto trae, y por eso cambia el {baseUnit.abbreviation}.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Un formato SIN movimientos se edita sin más: se dice también,
                para que nadie tenga miedo de tocarlo. */}
            {historia !== null && historia.conMovimiento === 0 && format && (
              <p className="text-[11px] text-text-secondary flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 text-text-secondary shrink-0" />
                <span>Este formato todavía no ha entrado en ningún albarán: se puede corregir tal cual.</span>
              </p>
            )}

            {/* selector de modo */}
            <div className="inline-flex rounded-md border border-border-default overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setFmtMode('simple')}
                className={`px-3 py-1.5 ${fmtMode === 'simple' ? 'bg-accent text-white' : 'bg-card text-text-secondary hover:text-text-primary'}`}
              >Un total</button>
              <button
                type="button"
                onClick={() => setFmtMode('pack')}
                className={`px-3 py-1.5 border-l border-border-default ${fmtMode === 'pack' ? 'bg-accent text-white' : 'bg-card text-text-secondary hover:text-text-primary'}`}
              >Caja con piezas</button>
            </div>

            {fmtMode === 'simple' ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">¿Cómo viene?</label>
                  <input type="text" value={fmtName} onChange={(e) => setFmtName(e.target.value)} disabled={savingFmt}
                    placeholder="Ej: Saco, Garrafa…"
                    className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">¿Cuánto trae?</label>
                  <div className="flex gap-2">
                    <input type="text" inputMode="decimal" value={fmtQty} onChange={(e) => setFmtQty(e.target.value)} disabled={savingFmt}
                      placeholder="Ej: 25"
                      className="flex-1 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                    <select value={fmtUnitId} onChange={(e) => setFmtUnitId(e.target.value)} disabled={savingFmt || priceUnits.length === 0}
                      className="w-24 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50">
                      {priceUnits.map((u) => (<option key={u.id} value={u.id}>{u.abbreviation}</option>))}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Caja = N × pieza de X */}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-28">
                    <label className="block text-[11px] font-medium text-text-secondary mb-1">Contenedor</label>
                    <input type="text" value={packCajaName} onChange={(e) => setPackCajaName(e.target.value)} disabled={savingFmt}
                      placeholder="Caja"
                      className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                  </div>
                  <span className="pb-2 text-text-secondary text-sm">=</span>
                  <div className="w-20">
                    <label className="block text-[11px] font-medium text-text-secondary mb-1">¿cuántas?</label>
                    <input type="text" inputMode="decimal" value={packCount} onChange={(e) => setPackCount(e.target.value)} disabled={savingFmt}
                      placeholder="6"
                      className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                  </div>
                  <span className="pb-2 text-text-secondary text-sm">×</span>
                  <div className="w-28">
                    <label className="block text-[11px] font-medium text-text-secondary mb-1">pieza</label>
                    <input type="text" value={packInnerName} onChange={(e) => setPackInnerName(e.target.value)} disabled={savingFmt}
                      placeholder="Lata, Bolsa…"
                      className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                  </div>
                  <span className="pb-2 text-text-secondary text-sm">de</span>
                  <div className="w-32">
                    <label className="block text-[11px] font-medium text-text-secondary mb-1">contenido</label>
                    <div className="flex gap-1">
                      <input type="text" inputMode="decimal" value={packInnerQty} onChange={(e) => setPackInnerQty(e.target.value)} disabled={savingFmt}
                        placeholder="3"
                        className="flex-1 w-12 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                      <select value={packUnitId} onChange={(e) => setPackUnitId(e.target.value)} disabled={savingFmt || priceUnits.length === 0}
                        className="w-16 px-1 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50">
                        {priceUnits.map((u) => (<option key={u.id} value={u.id}>{u.abbreviation}</option>))}
                      </select>
                    </div>
                  </div>
                </div>
                {packMismatch && baseUnit && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-warning">Dime el contenido de UNA pieza en {baseUnit.abbreviation}:</span>
                    <input type="text" inputMode="decimal" value={packDirectBase} onChange={(e) => setPackDirectBase(e.target.value)} disabled={savingFmt}
                      placeholder={`en ${baseUnit.abbreviation}`}
                      className="w-28 px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                  </div>
                )}
                {packTotalBase !== null && baseUnit && (
                  <p className="text-[11px] text-success">
                    → 1 {packCajaName.trim() || 'Caja'} = {fmtNum(packCountNum!)} × {fmtNum(packInnerBase!)} {baseUnit.abbreviation} = {fmtNum(packTotalBase)} {baseUnit.abbreviation}
                  </p>
                )}
              </div>
            )}

            {/* preview simple */}
            {fmtMode === 'simple' && fmtQtyInBase !== null && baseUnit && (
              <p className="text-[11px] text-success">→ {fmtNum(fmtQtyInBase)} {baseUnit.abbreviation} por {fmtName.trim() || 'formato'}</p>
            )}
            {fmtMode === 'simple' && fmtMismatch && baseUnit && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-warning">Dime el total en {baseUnit.abbreviation}:</span>
                <input type="text" inputMode="decimal" value={fmtDirectBase} onChange={(e) => setFmtDirectBase(e.target.value)} disabled={savingFmt}
                  placeholder={`en ${baseUnit.abbreviation}`}
                  className="w-28 px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
              </div>
            )}

            {fmtError && (
              <p className="text-[11px] text-danger flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />{fmtError}
              </p>
            )}

            {/* C4 · «¿En qué lo cuentas?» también aquí, no solo en el alta */}
            {format && baseUnit && (
              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">
                  ¿En qué lo cuentas?
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { id: 'caja' as const, label: plural(fmtMode === 'pack' ? packCajaName.trim() || 'Caja' : fmtName.trim() || format.name, 2) },
                    ...(parentFormat || fmtMode === 'pack'
                      ? [{ id: 'pieza' as const, label: plural(parentFormat?.name ?? packInnerName.trim() ?? 'Pieza', 2) }]
                      : []),
                    { id: 'base' as const, label: baseUnit.abbreviation },
                  ]).map((op) => (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => void guardarCuentaEn(op.id)}
                      disabled={savingFmt || guardandoCuenta}
                      className={`px-2.5 py-1 text-[11px] rounded-md border transition-base disabled:opacity-50 ${
                        cuentaEn === op.id
                          ? 'bg-accent text-text-on-accent border-accent font-medium'
                          : 'bg-card text-text-primary border-border-default hover:border-accent'
                      }`}
                    >
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void saveFmt()} disabled={savingFmt}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1">
                {savingFmt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                {historia !== null && historia.conMovimiento > 0 && contenidoCambia
                  ? 'Crear la versión nueva'
                  : 'Guardar formato'}
              </button>
              <button type="button" onClick={() => setEditingFmt(false)} disabled={savingFmt}
                className="px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50">
                Cancelar
              </button>
            </div>

            {/* C5 · Queda apuntado quién lo cambió y cuándo. Se dice ANTES,
                que es cuando sirve de algo. El formato guarda created_by /
                created_by_name, así que esto no es una promesa: es lo que
                `archiveAndReplacePurchaseFormat` escribe al crear el nuevo. */}
            {/* C5 · En FUTURO. Antes decía «queda apuntado que lo cambió …»
                antes de que nadie hubiera cambiado nada: anunciaba en pasado
                algo que todavía no había pasado. */}
            <p className="text-[11px] text-text-secondary flex items-start gap-1.5 pt-0.5 border-t border-border-default">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                Cuando guardes quedará apuntado que lo cambiaste{' '}
                {actorName ? <>tú, {actorName}</> : 'tú'}, y la fecha de hoy.
                {format?.createdByName
                  ? ` El de ahora lo puso ${format.createdByName} el ${fmtFecha(format.createdAt.slice(0, 10))}.`
                  : ''}
              </span>
            </p>
          </div>
        )}

        {/* Precio PACTADO: discreto, una línea. Editor base-first independiente. */}
        {!archived && (
          <div className="text-[11px] mt-0.5">
            {editingNeg ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="flex items-center rounded-md border border-border-default bg-card overflow-hidden focus-within:ring-1 focus-within:ring-accent">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={negVal}
                    onChange={(e) => setNegVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveNeg()
                      if (e.key === 'Escape') setEditingNeg(false)
                    }}
                    disabled={savingNeg}
                    placeholder="0,00 = sin pacto"
                    className="w-24 px-2 py-1 text-xs bg-transparent text-text-primary text-right focus:outline-none disabled:opacity-50"
                  />
                  <span className="pl-1 text-[10px] text-text-secondary">€/</span>
                  {priceUnits.length > 1 ? (
                    <select
                      value={negPriceUnitId}
                      onChange={(e) => setNegPriceUnitId(e.target.value)}
                      disabled={savingNeg}
                      aria-label="Unidad del precio pactado"
                      className="py-1 pr-1.5 text-[10px] bg-transparent text-text-primary cursor-pointer focus:outline-none disabled:opacity-50"
                    >
                      {priceUnits.map((u) => (
                        <option key={u.id} value={u.id}>{u.abbreviation}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="pr-2 text-[10px] text-text-secondary">{displayAbbr}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void saveNeg()}
                  disabled={savingNeg}
                  aria-label="Guardar precio pactado"
                  className="p-1 rounded-md text-success hover:bg-success-bg transition-base disabled:opacity-50"
                >
                  {savingNeg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingNeg(false)}
                  disabled={savingNeg}
                  aria-label="Cancelar"
                  className="p-1 rounded-md text-text-secondary hover:text-text-primary transition-base disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                {negPreviewPerBase !== null && baseUnit && (
                  <span className="font-mono text-text-secondary">= {fmtEur(negPreviewPerBase, 5)} / {baseAbbr}</span>
                )}
              </div>
            ) : negInDisplay !== null ? (
              <button
                type="button"
                onClick={openEditNeg}
                className="inline-flex items-center gap-1 text-text-secondary hover:text-accent transition-base"
                title="Editar precio pactado (en tu unidad: €/kg, €/g…)"
              >
                <Handshake className="w-3 h-3" />
                pactado{' '}
                <span className="font-mono text-text-primary">
                  {fmtEur(negInDisplay, negInDisplay < 1 ? 4 : 2)} / {displayAbbr}
                </span>
                <Pencil className="w-2.5 h-2.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={openEditNeg}
                className="inline-flex items-center gap-1 text-text-secondary hover:text-accent transition-base"
                title="Fijar el precio acordado con este proveedor"
              >
                <Plus className="w-3 h-3" /> pactar precio
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-start gap-1 pt-0.5">
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
                    if (e.key === 'Enter') void save()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  disabled={saving}
                  placeholder="0,00"
                  className="w-20 px-2 py-1 text-sm bg-transparent text-text-primary text-right focus:outline-none disabled:opacity-50"
                />
                <span className="pl-1 text-xs text-text-secondary">€/</span>
                {priceUnits.length > 1 ? (
                  <select
                    value={priceUnitId}
                    onChange={(e) => setPriceUnitId(e.target.value)}
                    disabled={saving}
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
                className="w-20 px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
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
            {/* Derivación en vivo: exactamente lo que se va a guardar (no aproximado) */}
            {previewPerBase !== null && baseUnit && (
              <div className="text-[11px] text-text-secondary font-mono">
                = {fmtEur(previewPerBase, 5)} / {baseAbbr}
                {previewFormatPrice !== null && format && (
                  <> · {fmtEur(previewFormatPrice, 2)} / {format.name.toLowerCase()}</>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={openEdit}
            className="inline-flex items-center gap-1.5 text-sm font-mono text-text-primary hover:text-accent transition-base"
            title="Editar precio (en tu unidad: €/kg, €/g…)"
          >
            {priceInDisplay !== null
              ? `${fmtEur(priceInDisplay, priceInDisplay < 1 ? 4 : 2)} / ${displayAbbr}`
              : fmtEur(link.lastPrice, 2)}
            <Pencil className="w-3 h-3 text-text-secondary" />
          </button>
        )}

        {/* Archivar (descatalogar) o reactivar. No durante la edición de precio. */}
        {!editing && (
          archived ? (
            <button
              type="button"
              onClick={() => void doReactivate()}
              disabled={busy}
              title="Volver a comprar este artículo a este proveedor"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-accent hover:bg-accent-bg transition-base disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Reactivar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void doArchive()}
              disabled={busy}
              aria-label="Archivar este proveedor"
              title="Archivar (descatalogar) este proveedor"
              className="p-1 rounded-md text-text-secondary hover:text-danger transition-base disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
            </button>
          )
        )}
      </div>
    </div>
  )
}
