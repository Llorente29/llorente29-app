// src/modules/supply/pages/ReceiptOfficeReview.tsx
//
// ENCARGO CODE (14/08) feat/recepcion-oficina-cierre, Tramo B — la pantalla de
// OFICINA, separada de GoodsReceiptForm. El asistente de cocina (ReceiptWizard)
// ya metió el stock; esta pantalla VERIFICA, no rehace la recepción. Especificación
// visual OBLIGATORIA: docs/folvy_recepcion_oficina_maqueta.html (14/08, datos
// reales de ALB-00113) — B.8: idéntica en textos, estructura y orden.
//
// B.2 — qty_in_base/unit_cost/doc_qty/doc_amount se leen de la línea y se
// muestran TAL CUAL. Cero re-derivación desde el catálogo del proveedor. El
// catálogo solo se consulta para RESOLVER una línea que la oficina cambia.

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, FileText, ChevronDown, ChevronUp, Pencil, Check, AlertTriangle } from 'lucide-react'
import {
  getGoodsReceiptById,
  updateGoodsReceipt,
  unverifiedReason,
  listGoodsReceiptLines,
  getReceiptDocTotal,
  getRecipeItemDisplayInfo,
  getPurchaseFormatNames,
  adjustGoodsReceiptLine,
  updateGoodsReceiptLine,
  confirmReceipt,
  matchReceiptLine,
  getGoodsReceiptCostWarnings,
  ackGoodsReceiptCostWarning,
  getGoodsReceiptFractionalWarnings,
  OFFICE_QTY_REASON_PREFIX,
  OFFICE_QTY_REASONS,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type LineMatchCandidate,
  type CostWarning,
  type FractionalWarning,
} from '@/modules/supply/services/goodsReceiptService'
import { getSupplierCatalog, listSupplyLocations, buildFormatLabel, type SupplierCatalogEntry } from '@/modules/supply/services/supplierCatalogService'
import { listSuppliers, createPurchaseFormat, listFormatsByItem } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import { fmtMoney, fmtMoneyPrecise, fmtNumEs, isNum, DASH } from '@/lib/format'
import {
  TIPOS_IVA, netoDesdeBruto, importePapel, importeAlAlmacen, costePorUnidadBase,
  avisoIvaProbable,
} from '@/modules/supply/lib/lineCost'
import LineMatchPicker from '@/modules/supply/pages/LineMatchPicker'
import ReceiptPhotoViewer from '@/modules/supply/components/ReceiptPhotoViewer'

// ENCARGO CODE (20/08) «Verificar un albarán a ciegas» §2.2 — los formatos
// VIVOS de un artículo, con la medida en la etiqueta ("Caja (5 kg)"), para que
// la oficina pueda cambiar el envase y no solo la cantidad. Sin la medida el
// desplegable es una lista de palabras ("Caja", "Paquete") que no dice nada.
export interface FormatOption {
  id: string
  label: string
  qtyInBase: number
}

const NOT_GOODS_KINDS: { value: string; label: string }[] = [
  { value: 'portes', label: 'Portes' },
  { value: 'envases', label: 'Envases' },
  { value: 'descuento', label: 'Descuento' },
  { value: 'impuesto', label: 'Impuesto' },
  { value: 'otro', label: 'Otro' },
]

type LineClass = 'resuelta' | 'dudosa' | 'sin_decidir' | 'not_goods'

function classify(l: GoodsReceiptLine): LineClass {
  if (l.notGoods) return 'not_goods'
  const undecided = !l.recipeItemId || l.qtyInBase == null || l.qtyInBase <= 0
  if (undecided) return 'sin_decidir'
  if (l.flaggedForOffice || l.mapNeedsReview) return 'dudosa'
  return 'resuelta'
}
const CLASS_RANK: Record<LineClass, number> = { resuelta: 0, dudosa: 1, sin_decidir: 2, not_goods: 3 }

function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
function numToInputStr(n: number): string {
  return n.toLocaleString('es-ES', { useGrouping: false, maximumFractionDigits: 6 })
}
// Naive pluralizador ES para nombres de formato ("Pack" -> "packs", "Caja" ->
// "cajas"). Mismo espíritu que el stem() naive que ya usa el casado (R1'):
// sirve para el vocabulario de compra habitual de esta cuenta, no aspira a
// ser lingüística fina.
function pluralizeEs(name: string, n: number): string {
  const base = name.trim().toLowerCase()
  if (n === 1) return base
  return base.endsWith('s') ? base : base + 's'
}
function unitNoun(abbr: string | null, n: number): string {
  const a = (abbr ?? 'ud').toLowerCase()
  if (a === 'ud') return n === 1 ? 'unidad' : 'unidades'
  return a
}
function sentenceCase(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}
function fmtQtyDisplay(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString('es-ES', { maximumFractionDigits: 3 })
}
function relativeDay(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (diffDays === 0) return 'hoy'
  if (diffDays === 1) return 'ayer'
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}
function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso: string | null): string {
  if (!iso) return DASH
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface ReceiptOfficeReviewProps {
  accountId: string
  receiptId: string
  onBack: () => void
  onSaved: (message?: string) => void
}

export default function ReceiptOfficeReview({ accountId, receiptId, onBack, onSaved }: ReceiptOfficeReviewProps) {
  const [receipt, setReceipt] = useState<GoodsReceipt | null>(null)
  const [lines, setLines] = useState<GoodsReceiptLine[]>([])
  const [docTotal, setDocTotal] = useState<number | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locationName, setLocationName] = useState<string>('')
  const [itemInfo, setItemInfo] = useState<Record<string, { name: string; baseUnitAbbr: string | null }>>({})
  const [formatNames, setFormatNames] = useState<Record<string, string>>({})
  const [catalog, setCatalog] = useState<SupplierCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [closedPeriodNote, setClosedPeriodNote] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  // ENCARGO CODE (31/08) §3 — guardar confirma en pantalla.
  // `pendingConfirm` se guarda CON LA RECARGA EN LA QUE SE PIDIÓ, y
  // `loadedTick` dice cuál ha vuelto ya. La confirmación no se pinta hasta que
  // haya llegado una recarga POSTERIOR: mientras tanto `lines` sigue teniendo
  // el valor viejo, y confirmar con él diría «guardado: 92,00 €» justo después
  // de haber guardado 83,64 — el mismo fallo del encargo, pero en verde.
  const [pendingConfirm, setPendingConfirm] = useState<{ lineId: string; tick: number } | null>(null)
  const [loadedTick, setLoadedTick] = useState(0)
  // ENCARGO CODE (14/08) feat/formatos-documento-decide, Tramo D.1 — aviso
  // bloqueante-suave de coste fuera de rango. null = aún no comprobado;
  // [] = comprobado y sin avisos; costWarningsAcked = el trabajador ya
  // pulsó "es correcto, continuar" en ESTA sesión de pantalla.
  const [costWarnings, setCostWarnings] = useState<CostWarning[] | null>(null)
  const [costWarningsAcked, setCostWarningsAcked] = useState(false)
  // Tramo D.3 — cantidades fraccionadas en artículos por unidades.
  const [fractionalWarnings, setFractionalWarnings] = useState<FractionalWarning[] | null>(null)
  // §5 — «este importe parece llevar el IVA dentro». Es exactamente el caso
  // ALB-00080 (30/07): AMIRSA facturó con el IVA dentro, nadie lo corrigió, y
  // ese stock quedó valorado un 10 % por encima de su coste real durante un mes.
  //
  // Solo salta si el proveedor está MARCADO como «factura con IVA incluido».
  // Sin esa marca no se avisa, a propósito: en Cloudtown (597 líneas), Makro
  // (79) o Europastry (22) unit_cost = doc_amount y eso es lo NORMAL cuando el
  // albarán lista base imponible y suma el IVA al pie. Un aviso que no se puede
  // afirmar enseña a ignorar los avisos que sí.
  const [ivaWarningsAcked, setIvaWarningsAcked] = useState(false)

  // ENCARGO CODE (20/08) «Verificar un albarán a ciegas».
  // §2.1 — el papel. En pantalla ancha va AL LADO de las líneas; en móvil,
  // detrás de un botón grande (no cabe al lado y esconderlo en un icono de 9px
  // es lo mismo que no tenerlo).
  const [showDoc, setShowDoc] = useState(false)
  // §2.2 — formatos vivos por artículo, para poder cambiar el envase.
  const [formatsByItem, setFormatsByItem] = useState<Record<string, FormatOption[]>>({})
  // §2.3 — proveedor y nº de albarán, editables. ALB-00119 llegó con los dos
  // a null y la cabecera enseñaba "Nº de albarán —" sin forma de arreglarlo.
  const [hdrOpen, setHdrOpen] = useState(false)
  const [hdrSupplierId, setHdrSupplierId] = useState('')
  const [hdrDocNumber, setHdrDocNumber] = useState('')
  const [hdrError, setHdrError] = useState<string | null>(null)

  // ── Carga ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const [r, ls, sups] = await Promise.all([
          getGoodsReceiptById(receiptId),
          listGoodsReceiptLines(receiptId),
          listSuppliers(accountId),
        ])
        if (cancelled) return
        if (!r) throw new Error('No se pudo recuperar la recepción.')
        setReceipt(r)
        setLines(ls)
        setLoadedTick(reloadTick)
        setSuppliers(sups)
        setHdrSupplierId(r.supplierId ?? '')
        setHdrDocNumber(r.supplierDocNumber ?? '')
        // Si falta cualquiera de los dos, la cabecera se abre sola: es un
        // hueco que hay que rellenar, no una preferencia de vista.
        setHdrOpen(!r.supplierId || !r.supplierDocNumber)

        const [locs, cat] = await Promise.all([
          listSupplyLocations(accountId),
          r.supplierId ? getSupplierCatalog(accountId, r.supplierId, r.locationId) : Promise.resolve([]),
        ])
        if (cancelled) return
        setLocationName(locs.find(l => l.id === r.locationId)?.name ?? '')
        setCatalog(cat)

        if (r.aiSessionId) {
          try { setDocTotal(await getReceiptDocTotal(r.aiSessionId)) }
          catch (e) { console.error('ReceiptOfficeReview: no se pudo leer el total del albarán', e) }
        } else {
          setDocTotal(null)
        }

        const itemIds = ls.map(l => l.recipeItemId).filter((x): x is string => !!x)
        const formatIds = ls.map(l => l.purchaseFormatId).filter((x): x is string => !!x)
        const [info, fmts] = await Promise.all([
          getRecipeItemDisplayInfo(itemIds),
          getPurchaseFormatNames(formatIds),
        ])
        if (cancelled) return
        setItemInfo(info)
        setFormatNames(fmts)

        // ENCARGO CODE (20/08) §2.2 — formatos vivos de cada artículo, con la
        // medida en la etiqueta. Se piden después de pintar (no bloquean la
        // pantalla): si tardan, la fila enseña el formato actual como texto y
        // el desplegable aparece cuando llegan.
        const uniqueItemIds = Array.from(new Set(itemIds))
        const fetched = await Promise.all(
          uniqueItemIds.map(async id => {
            try {
              const fs = await listFormatsByItem(id)
              const abbr = info[id]?.baseUnitAbbr ?? null
              const opts: FormatOption[] = fs
                .filter(f => f.isActive && f.qtyInBase > 0)
                .map(f => ({
                  id: f.id,
                  label: buildFormatLabel(f.name, f.qtyInBase, abbr) ?? f.name,
                  qtyInBase: f.qtyInBase,
                }))
              return [id, opts] as const
            } catch (e) {
              console.error('ReceiptOfficeReview: no se pudieron leer los formatos de', id, e)
              return [id, [] as FormatOption[]] as const
            }
          }),
        )
        if (cancelled) return
        setFormatsByItem(Object.fromEntries(fetched))
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo abrir la recepción.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [accountId, receiptId, reloadTick])

  const supplier = useMemo(
    () => suppliers.find(s => s.id === receipt?.supplierId) ?? null,
    [suppliers, receipt],
  )
  const supplierName = supplier?.name ?? ''

  const ivaWarnings = useMemo(() => {
    if (!supplier?.pricesIncludeVat) return []
    return lines.flatMap(l => {
      if (l.notGoods) return []
      const aviso = avisoIvaProbable(l, true, supplier.defaultVatRate)
      if (!aviso) return []
      const nombre = (l.recipeItemId ? itemInfo[l.recipeItemId]?.name : null) ?? sentenceCase(l.productName)
      return [{ lineId: l.id, nombre, ...aviso }]
    })
  }, [lines, supplier, itemInfo])

  // ── Reordenar: lo decidido primero (resuelta · dudosa), luego lo pendiente ──
  const ordered = useMemo(
    () => [...lines].sort((a, b) => CLASS_RANK[classify(a)] - CLASS_RANK[classify(b)] || a.position - b.position),
    [lines],
  )

  const pendingLines = useMemo(() => lines.filter(l => classify(l) === 'sin_decidir'), [lines])
  const decidedInStockCount = useMemo(
    () => lines.filter(l => { const c = classify(l); return c === 'resuelta' || c === 'dudosa' }).length,
    [lines],
  )
  const verifiedSum = useMemo(
    () => lines.reduce((sum, l) => {
      const c = classify(l)
      if (c !== 'resuelta' && c !== 'dudosa') return sum
      const amt = l.docAmount ?? (l.unitCost != null ? l.unitCost * l.qtyReceived : 0)
      return sum + amt
    }, 0),
    [lines],
  )
  const totalSum = useMemo(() => {
    if (docTotal != null) return docTotal
    return lines.reduce((sum, l) => sum + (l.docAmount ?? 0), 0)
  }, [docTotal, lines])
  const missingSum = Math.max(0, totalSum - verifiedSum)
  const allDecided = pendingLines.length === 0
  // ENCARGO CODE (20/08) §2.3 — sin proveedor ni nº de albarán no se cierra.
  // El servidor lo exige también (confirm_goods_receipt), para que no dependa
  // de que la pantalla se acuerde.
  const headerComplete = !!receipt?.supplierId && !!(receipt?.supplierDocNumber ?? '').trim()
  const canClose = allDecided && headerComplete

  // ── Picker de artículo (se reutiliza en las 3 clases: cambiar/dudosa/sin decidir) ──
  const [pickerLineId, setPickerLineId] = useState<string | null>(null)
  const [pickerCreateOpen, setPickerCreateOpen] = useState(false)
  const [pickerCandidates, setPickerCandidates] = useState<LineMatchCandidate[]>([])
  useEffect(() => {
    if (!pickerLineId) { setPickerCandidates([]); return }
    const line = lines.find(l => l.id === pickerLineId)
    if (!line) return
    let cancelled = false
    matchReceiptLine(accountId, line.productName, line.supplierCode)
      .then(cands => { if (!cancelled) setPickerCandidates(cands) })
      .catch(() => { if (!cancelled) setPickerCandidates([]) })
    return () => { cancelled = true }
  }, [pickerLineId, accountId, lines])

  function openPicker(lineId: string, createOpen = false) {
    setPickerCreateOpen(createOpen)
    setPickerLineId(lineId)
  }

  // Resuelve purchaseFormatId/qtyInBase para un artículo (elegido o recién
  // creado) desde el catálogo del proveedor de ESTE albarán. Si el artículo no
  // tiene ningún formato con este proveedor, se crea un formato 1:1 con la
  // unidad base (mismo criterio, sin inventar una equivalencia que nadie dio).
  async function resolveFormatForItem(itemId: string): Promise<{ formatId: string | null; qtyInBaseFactor: number | null }> {
    const entry = catalog.find(c => c.recipeItemId === itemId)
    if (entry?.purchaseFormatId && entry.formatQtyInBase) {
      return { formatId: entry.purchaseFormatId, qtyInBaseFactor: entry.formatQtyInBase }
    }
    try {
      const fmt = await createPurchaseFormat({
        accountId, itemId, name: 'Ud', qtyInBase: 1, source: 'manual', needsReview: false,
      })
      return { formatId: fmt.id, qtyInBaseFactor: 1 }
    } catch (e) {
      console.error('ReceiptOfficeReview: no se pudo resolver/crear formato', e)
      return { formatId: null, qtyInBaseFactor: null }
    }
  }

  async function persistLineResolution(
    line: GoodsReceiptLine,
    args: {
      recipeItemId: string | null; purchaseFormatId: string | null; qtyReceived: number; unitCost: number | null
      mapSource: string | null; needsReview?: boolean; discrepancyReason?: string | null
    },
  ) {
    setSaving(true); setError(null)
    try {
      const res = await adjustGoodsReceiptLine(line.id, {
        recipeItemId: args.recipeItemId,
        purchaseFormatId: args.purchaseFormatId,
        qtyReceived: args.qtyReceived,
        unitCost: args.unitCost,
        discrepancyReason: args.discrepancyReason ?? line.discrepancyReason,
        notGoods: false,
        notGoodsKind: null,
      })
      await updateGoodsReceiptLine(line.id, {
        mapSource: args.mapSource,
        mapNeedsReview: args.needsReview ?? false,
        flaggedForOffice: args.needsReview ?? false,
      })
      if (res.closedPeriodNote) setClosedPeriodNote(res.closedPeriodNote)
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la línea.')
    } finally {
      setSaving(false)
    }
  }

  async function handlePickerChoose(recipeItemId: string, _name: string, _semaphore: 'green' | 'yellow' | null, matchType: string | null) {
    const line = lines.find(l => l.id === pickerLineId)
    setPickerLineId(null)
    if (!line) return
    const { formatId, qtyInBaseFactor } = await resolveFormatForItem(recipeItemId)
    // ENCARGO CODE (15/08) — Ley 1 y Ley 2 se mueven juntas: si el formato
    // cambia (típico al corregir una línea cuya ficha estaba mal — Carne de
    // Birria/Pollo Mechado del ALB-00115, Bolsa 2 kg → Caja 6 kg), la
    // cantidad recibida NO puede heredarse del formato VIEJO. Orden de
    // prioridad (Julio, 15/08):
    //   1) doc_qty si existe — lo dice el papel.
    //   2) si no, CONSERVAR EL TOTAL: la mercancía que entró no cambia
    //      porque cambiemos cómo la describimos — qty_nueva =
    //      qty_in_base_vieja / factor_nuevo, y el coste se reescala igual
    //      (unit_cost_nuevo = unit_cost_viejo × qty_vieja / qty_nueva) para
    //      que el importe total tampoco se mueva.
    //   3) si esa división no da un número limpio, NO SE ADIVINA (mismo
    //      criterio que NO_RESUELTO en el intérprete): se guarda el total
    //      preservado tal cual (sin redondear — el total sigue intacto) y
    //      la línea queda marcada para que la mire un humano, con el
    //      motivo explícito.
    const formatChanged = formatId !== line.purchaseFormatId
    let qty: number
    let unitCost: number | null
    let needsReview = false
    let discrepancyReason: string | null = line.discrepancyReason

    if (!formatChanged) {
      qty = line.qtyReceived > 0 ? line.qtyReceived : (line.docQty ?? 1)
      unitCost = qtyInBaseFactor && line.docAmount != null ? line.docAmount / qty : (line.unitCost ?? null)
    } else if (line.docQty != null && line.docQty > 0) {
      qty = line.docQty
      unitCost = qtyInBaseFactor && line.docAmount != null
        ? line.docAmount / qty
        : (line.unitCost != null && line.qtyReceived > 0 ? line.unitCost * line.qtyReceived / qty : (line.unitCost ?? null))
    } else if (qtyInBaseFactor && line.qtyInBase != null && line.qtyInBase > 0) {
      const rawQty = line.qtyInBase / qtyInBaseFactor
      const rounded = Math.round(rawQty)
      const clean = rounded > 0 && Math.abs(rawQty - rounded) < 0.02
      qty = clean ? rounded : rawQty
      unitCost = line.unitCost != null && line.qtyReceived > 0 ? line.unitCost * line.qtyReceived / qty : (line.unitCost ?? null)
      if (!clean) {
        needsReview = true
        discrepancyReason = `Formato cambiado sin dato del papel: ${line.qtyInBase} en base ÷ ${qtyInBaseFactor} = ${rawQty.toFixed(3)}, no es un número limpio. Revisa a mano.`
      }
    } else {
      qty = line.qtyReceived > 0 ? line.qtyReceived : 1
      unitCost = line.unitCost ?? null
      needsReview = true
      discrepancyReason = 'Formato cambiado sin poder recalcular la cantidad (sin doc_qty ni total anterior). Revisa a mano.'
    }

    await persistLineResolution(line, {
      recipeItemId, purchaseFormatId: formatId, qtyReceived: qty, unitCost,
      mapSource: matchType ?? 'manual', needsReview, discrepancyReason,
    })
  }

  // "Sí, es esta" (dudosa): nada cambia en el stock, solo se levanta la duda.
  async function handleConfirmDudosa(line: GoodsReceiptLine) {
    setSaving(true); setError(null)
    try {
      await updateGoodsReceiptLine(line.id, { mapNeedsReview: false, flaggedForOffice: false })
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar la línea.')
    } finally {
      setSaving(false)
    }
  }

  // "No es mercancía" (sin decidir): reversa si había algo posteado, no repostea.
  const [notGoodsLineId, setNotGoodsLineId] = useState<string | null>(null)
  async function handleNotGoods(line: GoodsReceiptLine, kind: string) {
    setNotGoodsLineId(null)
    setSaving(true); setError(null)
    try {
      await adjustGoodsReceiptLine(line.id, {
        recipeItemId: null,
        purchaseFormatId: null,
        qtyReceived: line.qtyReceived,
        unitCost: null,
        discrepancyReason: line.discrepancyReason,
        notGoods: true,
        notGoodsKind: kind,
      })
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar la línea.')
    } finally {
      setSaving(false)
    }
  }

  // ── ENCARGO CODE (20/08) §2.3 — proveedor y nº de albarán ──────────────
  // No existía forma de ponerlos desde la pantalla. ALB-00119 llegó con los
  // dos a null (albarán manuscrito, la IA no leyó emisor) y sin ellos no se
  // puede casar con su factura ni reclamar nada.
  async function saveHeader() {
    if (!receipt) return
    const sup = hdrSupplierId.trim()
    const doc = hdrDocNumber.trim()
    if (!sup) { setHdrError('Elige el proveedor. Sin emisor este albarán no se puede reclamar.'); return }
    if (!doc) { setHdrError('Pon el nº de albarán. Es lo que lo casa con su factura.'); return }
    setSaving(true); setHdrError(null); setError(null)
    try {
      await updateGoodsReceipt(receipt.id, { supplierId: sup, supplierDocNumber: doc })
      setHdrOpen(false)
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setHdrError(err instanceof Error ? err.message : 'No se pudo guardar la cabecera.')
    } finally {
      setSaving(false)
    }
  }

  // ── "Corregir": cantidad, FORMATO y coste, con motivo ──────────────────
  // ENCARGO CODE (20/08) §2.2 — adjust_goods_receipt_line lleva desplegada
  // desde el 13/08 y hace exactamente esto, pero en 24 h se llamó 2 veces
  // frente a 357 peticiones de la pantalla: el camino existía y no se llegaba
  // a él. Dos cosas cambian aquí:
  //   · el editor deja cambiar el FORMATO (antes solo cantidad y coste, así
  //     que un albarán en kilos casado a un formato de 6 unidades no tenía
  //     arreglo desde la pantalla — el caso ALB-00119);
  //   · el editor se abre también desde una línea DUDOSA, que antes solo
  //     ofrecía "Sí, es esta" / "No, es otro artículo". Las 408 líneas
  //     marcadas de Foodint son dudosas: ninguna tenía botón de corregir.
  const [editLineId, setEditLineId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editCost, setEditCost] = useState('')
  const [editFormatId, setEditFormatId] = useState('')
  const [editReason, setEditReason] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // ENCARGO CODE (31/08) §4 — quitar el IVA deja de ser aritmética mental.
  // `editIvaOn` = «el precio del papel lleva IVA». El neto se propone y se
  // ENSEÑA antes de guardar; el campo de coste sigue siendo editable a mano.
  const [editIvaOn, setEditIvaOn] = useState(false)
  const [editIvaRate, setEditIvaRate] = useState('10')

  // §3 — guardar confirma en pantalla. `pendingConfirmLineId` se pone al
  // guardar; la confirmación se compone DESPUÉS de recargar, con los valores
  // que devuelve el servidor — nunca con lo que se tecleó. Un estado optimista
  // aquí sería exactamente el fallo que se está arreglando: dar por bueno un
  // cambio que quizá no entró.

  function openEditor(line: GoodsReceiptLine) {
    setEditLineId(line.id)
    setEditQty(numToInputStr(line.qtyReceived))
    setEditCost(line.unitCost != null ? numToInputStr(line.unitCost) : '')
    setEditFormatId(line.purchaseFormatId ?? '')
    setEditReason(null)
    setEditError(null)
    // §4 — el defecto del proveedor entra como SUGERENCIA VISIBLE: la casilla
    // aparece marcada y con su tipo, y quien mira ve el cálculo antes de
    // guardar. Nunca se aplica en silencio: si no se toca Guardar, no cambia
    // nada, y el coste sigue siendo editable a mano.
    setEditIvaOn(false)
    setEditIvaRate(supplier?.defaultVatRate != null ? String(supplier.defaultVatRate) : '10')
  }
  function closeEditor() {
    setEditLineId(null); setEditError(null); setEditIvaOn(false)
  }
  async function saveEditor(line: GoodsReceiptLine) {
    const newQty = parseNum(editQty)
    if (newQty === null) { setEditError('Pon una cantidad. Una casilla vacía no es cero.'); return }
    const newCost = parseNum(editCost)
    const newFormatId = editFormatId || null
    const qtyChanged = newQty !== line.qtyReceived
    const formatChanged = newFormatId !== line.purchaseFormatId
    // El motivo se exige cuando cambia lo que ENTRÓ al almacén — cantidad o
    // formato. Corregir solo el coste no mueve stock.
    if ((qtyChanged || formatChanged) && !editReason) {
      setEditError('Elige un motivo para el cambio. Sin motivo no queda rastro de por qué.')
      return
    }
    setSaving(true); setError(null)
    try {
      const res = await adjustGoodsReceiptLine(line.id, {
        recipeItemId: line.recipeItemId,
        purchaseFormatId: newFormatId,
        qtyReceived: newQty,
        unitCost: newCost,
        discrepancyReason: (qtyChanged || formatChanged) && editReason
          ? OFFICE_QTY_REASON_PREFIX + editReason
          : line.discrepancyReason,
        notGoods: false,
        notGoodsKind: null,
      })
      // Corregir a mano ES confirmar: la duda se levanta con el cambio, no
      // hace falta un segundo clic en "Sí, es esta".
      await updateGoodsReceiptLine(line.id, { mapNeedsReview: false, flaggedForOffice: false })
      if (res.closedPeriodNote) setClosedPeriodNote(res.closedPeriodNote)
      setEditLineId(null)
      setEditIvaOn(false)
      // §3 — la confirmación NO se compone aquí. Se pide, y se escribe cuando
      // vuelva el dato del servidor (efecto de abajo). Si la recarga trae otra
      // cosa, es esa otra cosa la que se enseña.
      setPendingConfirm({ lineId: line.id, tick: reloadTick })
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      // El editor se queda ABIERTO con lo tecleado y el error a la vista. No se
      // recarga, no se cierra y no se confirma nada: si la escritura falló, la
      // pantalla no puede dar el cambio por bueno.
      setPendingConfirm(null)
      setEditError(err instanceof Error ? err.message : 'No se pudo guardar el cambio.')
    } finally {
      setSaving(false)
    }
  }

  // §3 — la confirmación, compuesta con lo que devolvió el servidor tras
  // recargar. Cuarta aparición esta semana del mismo patrón (kds_heartbeat→200,
  // autocierre→warning, Publicar mudo, fichaje «registrada»): un botón que hace
  // algo importante confirma o falla en pantalla; callar no es una opción.
  // Derivado en render, no en un efecto: así el texto SIEMPRE describe la línea
  // que hay ahora mismo en `lines` — es decir, lo que devolvió el servidor. Si
  // una recarga posterior trae otra cosa, la confirmación cambia con ella en vez
  // de quedarse congelada afirmando algo que ya no es verdad.
  const savedConfirm = useMemo(() => {
    if (!pendingConfirm) return null
    if (loadedTick <= pendingConfirm.tick) return null   // la recarga aún no ha vuelto
    const l = lines.find(x => x.id === pendingConfirm.lineId)
    if (!l) return null
    const nombre = (l.recipeItemId ? itemInfo[l.recipeItemId]?.name : null) ?? sentenceCase(l.productName)
    const almacen = importeAlAlmacen(l)
    const porBase = costePorUnidadBase(l)
    const uSingular = unitNoun(l.recipeItemId ? itemInfo[l.recipeItemId]?.baseUnitAbbr ?? null : null, 1)
    const papel = importePapel(l)
    if (almacen == null) return `Guardado: ${nombre} queda sin coste, así que no valora el almacén.`
    return `Guardado: ${nombre} entra al almacén por ${fmtMoney(almacen)}`
      + (porBase != null ? ` (${fmtMoneyPrecise(porBase)} la ${uSingular})` : '')
      + (papel != null ? `. El papel sigue diciendo ${fmtMoney(papel)}.` : '.')
  }, [pendingConfirm, loadedTick, lines, itemInfo])

  // ── Cierre ───────────────────────────────────────────────────────────
  // ENCARGO CODE (14/08) feat/formatos-documento-decide, Tramo D.1/D.3 —
  // antes de confirmar, comprueba coste fuera de rango (mediana del
  // artículo) y cantidades fraccionadas en artículos por unidades. Con
  // avisos y sin confirmar aún ⇒ los enseña y para (bloqueante-suave); "es
  // correcto, continuar" registra quién y cuándo aceptó el de coste
  // (ackGoodsReceiptCostWarning — D.3 no lo pide) y entonces sí cierra.
  async function handleClose() {
    if (!receipt || !allDecided) return
    if (!headerComplete) {
      setHdrOpen(true)
      setHdrError('Antes de cerrar, pon el proveedor y el nº de albarán.')
      return
    }
    setSaving(true); setError(null)
    try {
      // §5 — el aviso de IVA se comprueba ANTES que los del servidor: es el
      // único que se puede afirmar sin consultar nada (ya está todo en
      // pantalla) y es el que evita cerrar un albarán valorado un 10 % de más.
      if (!ivaWarningsAcked && ivaWarnings.length > 0) {
        setSaving(false)
        return
      }
      if (!costWarningsAcked) {
        const [cost, fractional] = await Promise.all([
          getGoodsReceiptCostWarnings(accountId, receipt.id),
          getGoodsReceiptFractionalWarnings(accountId, receipt.id),
        ])
        if (cost.length > 0 || fractional.length > 0) {
          setCostWarnings(cost)
          setFractionalWarnings(fractional)
          setSaving(false)
          return
        }
      }
      await confirmReceipt(receipt.id)
      onSaved(`Recepción ${receipt.code ?? ''} verificada y cerrada.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar el albarán.')
      setSaving(false)
    }
  }
  // "Es correcto, continuar" de los avisos: registra el de coste (quién y
  // cuándo) y cierra directamente (no delega a handleClose —
  // costWarningsAcked no estaría actualizado todavía dentro de este mismo
  // evento).
  async function acceptWarningsAndClose() {
    if (!receipt) return
    setCostWarnings(null)
    setFractionalWarnings(null)
    setCostWarningsAcked(true)
    setIvaWarningsAcked(true)
    setSaving(true); setError(null)
    try {
      await ackGoodsReceiptCostWarning(accountId, receipt.id)
      await confirmReceipt(receipt.id)
      onSaved(`Recepción ${receipt.code ?? ''} verificada y cerrada.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar el albarán.')
      setSaving(false)
    }
  }
  function handleLeaveHalfway() {
    onSaved(receipt?.code ? `${receipt.code}: cambios guardados, sigue pendiente de verificar.` : undefined)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…
      </div>
    )
  }
  if (!receipt) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft size={16} /> Volver
        </button>
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error ?? 'No se pudo abrir la recepción.'}</div>
      </div>
    )
  }

  const pickerLine = pickerLineId ? lines.find(l => l.id === pickerLineId) ?? null : null

  return (
    // ENCARGO CODE (20/08) §2.1 — el papel AL LADO de las líneas. El documento
    // lleva guardado desde siempre en goods_receipt.raw_document_url (125 de
    // 132 recepciones lo tienen); esta pantalla simplemente no lo enseñaba.
    // Verificar sin el papel delante no es verificar.
    <div className="max-w-7xl mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:gap-4 lg:items-start">
    <div className="max-w-3xl mx-auto lg:mx-0 lg:max-w-none space-y-3.5">
      <button type="button" onClick={onBack} disabled={saving}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50">
        <ArrowLeft size={16} /> Volver
      </button>

      {/* En móvil el papel no cabe al lado: botón grande, no un icono de 9px. */}
      <div className="lg:hidden">
        <button type="button" onClick={() => setShowDoc(v => !v)}
          className="w-full min-h-touch px-4 rounded-lg text-base font-semibold border border-border-default bg-card text-text-primary hover:bg-page transition-base inline-flex items-center justify-center gap-2">
          <FileText size={18} />
          {showDoc ? 'Ocultar el albarán' : 'Ver el albarán'}
          {showDoc ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {showDoc && <div className="mt-2"><ReceiptPhotoViewer path={receipt.rawDocumentUrl} /></div>}
      </div>

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}
      {closedPeriodNote && (
        <div className="p-3 rounded-md bg-accent-bg text-accent border border-accent/20 text-sm">{closedPeriodNote}</div>
      )}

      {/* ══ CABECERA ══ */}
      <div className="bg-card border border-border-default rounded-lg px-5 py-4.5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-display font-semibold tracking-tight text-text-primary">
              Albarán {receipt.code ?? ''} · {supplierName || 'proveedor sin poner'}
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              {receipt.createdByName ?? 'Alguien'} lo recibió {relativeDay(receipt.receivedAt)} a las {fmtTime(receipt.receivedAt)} en {locationName}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1 rounded-full bg-success-bg text-success border border-success/20">
            ✓ La mercancía ya está en el almacén
          </span>
        </div>
        <div className="flex gap-6 flex-wrap mt-3.5 pt-3.5 border-t border-border-default">
          <div>
            <div className="text-xs text-text-secondary">Fecha del albarán</div>
            <div className="text-sm text-text-primary font-medium">{fmtDate(receipt.receiptDate)}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">Nº de albarán</div>
            <div className="text-sm text-text-primary font-medium">{receipt.supplierDocNumber ?? DASH}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">Total del papel</div>
            <div className="text-sm text-text-primary font-medium">{isNum(docTotal) ? fmtMoney(docTotal) : DASH}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">Tu trabajo aquí</div>
            <div className="text-sm text-text-primary font-medium">Verificar, no recontar</div>
          </div>
          {headerComplete && !hdrOpen && (
            <button type="button" onClick={() => { setHdrOpen(true); setHdrError(null) }} disabled={saving}
              className="self-end inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline disabled:opacity-50">
              <Pencil size={13} /> Cambiar proveedor o nº
            </button>
          )}
        </div>

        {/* ENCARGO CODE (20/08) §2.3 — proveedor y nº de albarán editables, y
            obligatorios para cerrar. Se propone lo que se sabe: si la IA leyó
            un emisor, ya viene elegido; si no (albarán manuscrito), la lista
            es la de proveedores de la cuenta. Proponer, no preguntar en blanco. */}
        {hdrOpen && (
          <div className={`mt-3.5 pt-3.5 border-t border-border-default space-y-2.5 ${headerComplete ? '' : 'rounded-md'}`}>
            {!headerComplete && (
              <p className="text-sm font-semibold text-text-primary">
                Este albarán no tiene {!receipt.supplierId ? 'proveedor' : ''}
                {!receipt.supplierId && !(receipt.supplierDocNumber ?? '').trim() ? ' ni ' : ''}
                {!(receipt.supplierDocNumber ?? '').trim() ? 'nº de albarán' : ''}. Sin eso no se puede cerrar.
              </p>
            )}
            <div className="flex gap-3 flex-wrap">
              <label className="text-xs text-text-secondary">
                Proveedor
                <select value={hdrSupplierId} onChange={e => setHdrSupplierId(e.target.value)} disabled={saving}
                  className="mt-0.5 block w-64 max-w-full px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent">
                  <option value="">— elige el proveedor —</option>
                  {suppliers.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-text-secondary">
                Nº de albarán
                <input type="text" value={hdrDocNumber} onChange={e => setHdrDocNumber(e.target.value)} disabled={saving}
                  placeholder="el que viene en el papel"
                  className="mt-0.5 block w-52 max-w-full px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
              </label>
            </div>
            {hdrError && <p className="text-xs text-danger">{hdrError}</p>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={saveHeader} disabled={saving}
                className="px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
                Guardar cabecera
              </button>
              {headerComplete && (
                <button type="button" onClick={() => { setHdrOpen(false); setHdrError(null) }} disabled={saving}
                  className="px-3 py-2 rounded-md text-sm border border-border-default bg-card hover:bg-page disabled:opacity-50">
                  Cancelar
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══ PROGRESO ══ */}
      <div className={`rounded-lg border px-4 py-3 flex items-center gap-2.5 ${allDecided ? 'bg-success-bg border-success/30' : 'bg-warning-bg border-warning/30'}`}>
        <div>
          <div className="font-semibold text-base text-text-primary">
            {allDecided ? `Las ${lines.length} líneas están decididas` : `Faltan ${pendingLines.length} de ${lines.length} líneas por decidir`}
          </div>
          {!allDecided && decidedInStockCount > 0 && (
            <div className="text-sm text-text-primary mt-0.5">
              {decidedInStockCount === 1
                ? 'La primera está bien y no tienes que tocarla.'
                : `Las ${decidedInStockCount} primeras están bien y no tienes que tocarlas.`}
            </div>
          )}
        </div>
      </div>

      {/* ══ LÍNEAS ══ */}
      <div className="flex flex-col gap-2">
        {ordered.map(l => {
          const cls = classify(l)
          // ENCARGO CODE (20/08) §2.2 — el editor es el mismo para una línea
          // resuelta y para una dudosa: corregir es corregir.
          if ((cls === 'resuelta' || cls === 'dudosa') && editLineId === l.id) {
            return (
              <LineEditor key={l.id} line={l} itemInfo={itemInfo}
                formats={formatsByItem[l.recipeItemId ?? ''] ?? []}
                saving={saving} qty={editQty} cost={editCost} formatId={editFormatId}
                reason={editReason} editError={editError}
                onSetQty={setEditQty} onSetCost={setEditCost} onSetFormatId={setEditFormatId}
                onSetReason={setEditReason} onSave={() => saveEditor(l)} onCancel={closeEditor}
                onChangeArticle={() => openPicker(l.id)}
                ivaOn={editIvaOn} ivaRate={editIvaRate}
                ivaSugeridoPorProveedor={!!supplier?.pricesIncludeVat}
                onSetIvaOn={setEditIvaOn} onSetIvaRate={setEditIvaRate} />
            )
          }
          if (cls === 'resuelta') return <ResueltaRow key={l.id} line={l} itemInfo={itemInfo} formatNames={formatNames} saving={saving} onOpenEditor={() => openEditor(l)} />
          if (cls === 'dudosa') return <DudosaRow key={l.id} line={l} itemInfo={itemInfo} formatNames={formatNames} saving={saving} onConfirm={() => handleConfirmDudosa(l)} onCorregir={() => openEditor(l)} onChangeArticle={() => openPicker(l.id)} />
          if (cls === 'not_goods') return <NotGoodsRow key={l.id} line={l} />
          return (
            <SinDecidirRow key={l.id} line={l} saving={saving}
              onSearch={() => openPicker(l.id, false)}
              onCreate={() => openPicker(l.id, true)}
              notGoodsOpen={notGoodsLineId === l.id}
              onToggleNotGoods={() => setNotGoodsLineId(n => n === l.id ? null : l.id)}
              onPickNotGoods={kind => handleNotGoods(l, kind)}
            />
          )
        })}
      </div>

      {/* ENCARGO CODE (14/08) feat/formatos-documento-decide, Tramo D.1/D.3 —
          aviso bloqueante-suave: coste fuera de rango y/o cantidad
          fraccionada en un artículo por unidades. No impide cerrar, pero
          exige un clic explícito (el de coste, además, queda registrado). */}
      {/* §3 — GUARDAR CONFIRMA EN PANTALLA. El texto se compone con lo que
          devolvió el servidor tras recargar, no con lo que se tecleó: si la
          escritura no entró, aquí no aparece nada. */}
      {savedConfirm && (
        <div className="rounded-md border border-success/30 bg-success-bg px-4 py-3 flex items-start gap-2.5">
          <Check size={17} className="text-success shrink-0 mt-0.5" />
          <p className="text-sm text-text-primary flex-1 tabular-nums">{savedConfirm}</p>
          <button type="button" onClick={() => setPendingConfirm(null)}
            className="text-xs font-medium text-text-secondary hover:text-text-primary shrink-0">
            Vale
          </button>
        </div>
      )}

      {/* §5 — «este importe parece llevar el IVA dentro». Bloqueante-suave,
          igual que los avisos de coste: enseña y para, no impide cerrar. */}
      {ivaWarnings.length > 0 && !ivaWarningsAcked && (
        <div className="rounded-lg border border-warning bg-page p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={17} className="text-warning shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">
                {supplierName || 'Este proveedor'} factura con el IVA dentro
                {supplier?.defaultVatRate != null ? ` (${supplier.defaultVatRate} %)` : ''}, y en{' '}
                {ivaWarnings.length === 1 ? 'una línea' : `${ivaWarnings.length} líneas`} el coste del almacén
                es idéntico al importe del papel. {ivaWarnings.length === 1 ? 'Ese importe parece' : 'Esos importes parecen'} llevar el IVA dentro.
              </p>
              <ul className="space-y-1 mt-1.5">
                {ivaWarnings.map(w => (
                  <li key={w.lineId} className="text-sm text-text-secondary tabular-nums">
                    <span className="text-text-primary font-medium">{w.nombre}</span>: papel {fmtMoney(w.papel)} = almacén {fmtMoney(w.almacen)}
                    {w.netoPropuesto != null && <> · sin IVA serían <b className="text-text-primary">{fmtMoney(w.netoPropuesto)}</b></>}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-secondary mt-1.5">
                Corrígelo con «Corregir» en la línea (la casilla del IVA lo calcula), o sigue si el albarán
                venía en base imponible esta vez.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => setIvaWarningsAcked(true)} disabled={saving}
              className="px-4 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
              Es correcto, continuar
            </button>
          </div>
        </div>
      )}

      {((costWarnings && costWarnings.length > 0) || (fractionalWarnings && fractionalWarnings.length > 0)) && (
        <div className="rounded-lg border border-warning bg-page p-4 space-y-3">
          {costWarnings && costWarnings.length > 0 && (
            <div>
              <p className="text-sm font-medium text-text-primary">
                {costWarnings.length === 1 ? 'Una línea' : `${costWarnings.length} líneas`} con un coste que no cuadra con lo habitual:
              </p>
              <ul className="space-y-1 mt-1">
                {costWarnings.map(w => (
                  <li key={w.lineId} className="text-sm text-text-secondary">
                    <span className="text-text-primary font-medium">{w.productName}</span>: suele entrar a {fmtMoney(w.medianCostPerBase)}/base
                    y esta línea sale a {fmtMoney(w.unitCostPerBase)}/base ({w.ratio}×). Revisa cantidad y formato.
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fractionalWarnings && fractionalWarnings.length > 0 && (
            <div>
              <p className="text-sm font-medium text-text-primary">
                {fractionalWarnings.length === 1 ? 'Una línea' : `${fractionalWarnings.length} líneas`} con cantidad fraccionada:
              </p>
              <ul className="space-y-1 mt-1">
                {fractionalWarnings.map(w => (
                  <li key={w.lineId} className="text-sm text-text-secondary">
                    <span className="text-text-primary font-medium">{w.productName}</span>: {w.qtyReceived.toLocaleString('es-ES', { maximumFractionDigits: 2 })} {w.formatName ?? 'formato'}.
                    Si el paquete real es más pequeño, el formato está mal — no lo compenses con la cantidad.
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={acceptWarningsAndClose} disabled={saving}
              className="px-4 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
              Es correcto, continuar
            </button>
          </div>
        </div>
      )}

      {/* ══ PIE ══ */}
      <div className="bg-card border border-border-default rounded-lg px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-text-secondary tabular-nums">
          Lo que has verificado suma
          <span className="block text-lg font-display font-semibold text-text-primary">{fmtMoney(verifiedSum)} de {fmtMoney(totalSum)}</span>
          {!allDecided && <>faltan {fmtMoney(missingSum)} en las {pendingLines.length} línea{pendingLines.length === 1 ? '' : 's'} sin decidir</>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleLeaveHalfway} disabled={saving}
            className="px-3 py-2 rounded-md text-sm text-text-secondary border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
            Dejar a medias
          </button>
          <button type="button" onClick={handleClose} disabled={!canClose || saving}
            title={
              !allDecided
                ? `Faltan por decidir: ${pendingLines.map(l => itemInfo[l.recipeItemId ?? '']?.name ?? sentenceCase(l.productName)).join(', ')}`
                : !headerComplete
                  ? 'Falta el proveedor o el nº de albarán'
                  : undefined
            }
            className="min-h-close-desktop px-6 rounded-lg text-base font-bold bg-success text-text-on-accent disabled:bg-border-default disabled:text-text-secondary disabled:cursor-not-allowed transition-base">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificado — cerrar albarán'}
          </button>
        </div>
        <p className="text-sm text-text-secondary w-full">
          El botón se enciende cuando las {lines.length} líneas tengan decisión y la cabecera tenga proveedor
          y nº de albarán. Ninguna línea se pierde en silencio: o entra al almacén, o dices tú que no es mercancía.
        </p>
      </div>

      {pickerLine && (
        <LineMatchPicker
          accountId={accountId}
          rawText={pickerLine.rawText ?? pickerLine.productName}
          supplierCode={pickerLine.supplierCode}
          candidates={pickerCandidates}
          currentRecipeItemId={pickerLine.recipeItemId}
          createdBy={null}
          createdByName={null}
          initialCreateOpen={pickerCreateOpen}
          onChoose={handlePickerChoose}
          onClear={() => setPickerLineId(null)}
          onClose={() => setPickerLineId(null)}
        />
      )}
    </div>

    {/* Columna del papel: pegada arriba para que siga visible al bajar por
        las líneas. Solo en pantalla ancha; en móvil va tras el botón grande. */}
    <div className="hidden lg:block lg:sticky lg:top-4">
      <ReceiptPhotoViewer path={receipt.rawDocumentUrl} />
    </div>
    </div>
  )
}

// ── Editor de línea · ENCARGO CODE (20/08) §2.2 ────────────────────────
// Cantidad, FORMATO y coste, con motivo obligatorio si se mueve el stock.
// Escribe SIEMPRE por adjust_goods_receipt_line: reverso del movimiento viejo
// + reposteo del nuevo, con quién y por qué. Nunca por un UPDATE a pelo (§9.8).
function LineEditor({
  line, itemInfo, formats, saving, qty, cost, formatId, reason, editError,
  onSetQty, onSetCost, onSetFormatId, onSetReason, onSave, onCancel, onChangeArticle,
  ivaOn, ivaRate, ivaSugeridoPorProveedor, onSetIvaOn, onSetIvaRate,
}: {
  line: GoodsReceiptLine
  itemInfo: Record<string, { name: string; baseUnitAbbr: string | null }>
  formats: FormatOption[]
  saving: boolean
  qty: string
  cost: string
  formatId: string
  reason: string | null
  editError: string | null
  onSetQty: (v: string) => void
  onSetCost: (v: string) => void
  onSetFormatId: (v: string) => void
  onSetReason: (v: string) => void
  onSave: () => void
  onCancel: () => void
  onChangeArticle: () => void
  /** §4 — «el precio del papel lleva IVA». */
  ivaOn: boolean
  ivaRate: string
  /** El proveedor está marcado como «factura con IVA incluido» en su ficha. */
  ivaSugeridoPorProveedor: boolean
  onSetIvaOn: (v: boolean) => void
  onSetIvaRate: (v: string) => void
}) {
  const info = line.recipeItemId ? itemInfo[line.recipeItemId] : undefined
  const name = info?.name ?? sentenceCase(line.productName)
  const chosen = formats.find(f => f.id === formatId) ?? null
  const qtyN = parseNum(qty)
  const costN = parseNum(cost)
  const qtyChanged = qtyN !== null && qtyN !== line.qtyReceived
  const formatChanged = (formatId || null) !== line.purchaseFormatId
  const uNoun = unitNoun(info?.baseUnitAbbr ?? null, 2)
  // Lo que va a entrar al almacén con lo que hay escrito ahora mismo. Sin esto
  // el editor pide números a ciegas, que es justo lo que estamos arreglando.
  const previewBase = qtyN !== null && chosen ? qtyN * chosen.qtyInBase : null
  const previewTotal = qtyN !== null && costN !== null ? qtyN * costN : null

  // ── §4 · quitar el IVA deja de ser aritmética mental ──────────────────
  // El BRUTO por unidad sale del papel (doc_amount ÷ unidades). Si el papel no
  // dice importe, se toma lo que hay escrito en el campo como bruto: es lo
  // único que se puede afirmar, y se dice en el texto de qué sale.
  const rateN = parseNum(ivaRate)
  const brutoPorUnidad = qtyN !== null && qtyN !== 0 && line.docAmount != null
    ? line.docAmount / qtyN
    : null
  const brutoBase = brutoPorUnidad ?? costN
  const netoPropuesto = netoDesdeBruto(brutoBase, rateN)
  // «→ 83,64 €» tiene que ser exactamente lo que se va a guardar, no una
  // aproximación distinta: se compara contra lo que hay escrito con la misma
  // tolerancia de céntimo con la que se enseña.
  const netoYaAplicado = netoPropuesto != null && costN !== null
    && Math.abs(costN - netoPropuesto) < 0.005

  // Marcar la casilla ESCRIBE el neto en el campo. No lo guarda: el campo
  // sigue siendo editable a mano y no pasa nada hasta pulsar Guardar.
  function aplicarIva(on: boolean, tipo: string) {
    onSetIvaOn(on)
    onSetIvaRate(tipo)
    if (!on) return
    const r = parseNum(tipo)
    const neto = netoDesdeBruto(brutoBase, r)
    if (neto != null) onSetCost(numToInputStr(neto))
  }

  return (
    <div className="rounded-lg border border-accent bg-card px-4 py-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-primary">{name}</span>
        <button type="button" onClick={onChangeArticle} disabled={saving}
          className="text-xs font-medium text-accent hover:underline disabled:opacity-50">Cambiar artículo</button>
      </div>

      {(line.rawText || line.docQty != null || line.docAmount != null) && (
        <div className="text-sm text-text-secondary tabular-nums">
          El albarán dice:{' '}
          <b className="text-text-primary">
            {line.rawText}
            {line.docQty != null ? ` · ${fmtQtyDisplay(line.docQty)}` : ''}
            {line.docAmount != null ? ` · ${fmtMoney(line.docAmount)}` : ''}
          </b>
        </div>
      )}

      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-xs text-text-secondary">
          En qué viene
          {formats.length > 0 ? (
            <select value={formatId} onChange={e => onSetFormatId(e.target.value)} disabled={saving}
              className="mt-0.5 block w-56 max-w-full px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent">
              <option value="">— sin formato —</option>
              {formats.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          ) : (
            <span className="mt-0.5 block w-56 px-2.5 py-2 text-sm text-text-secondary">
              Este artículo no tiene formatos vivos
            </span>
          )}
        </label>
        <label className="text-xs text-text-secondary">
          Cuántos
          <input type="text" value={qty} onChange={e => onSetQty(e.target.value)} disabled={saving}
            className="mt-0.5 block w-28 px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label className="text-xs text-text-secondary">
          Coste de cada uno
          <input type="text" value={cost} onChange={e => onSetCost(e.target.value)} disabled={saving}
            className="mt-0.5 block w-28 px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
      </div>

      {/* §4 — la casilla del IVA. Vive pegada al campo de coste porque es lo que
          modifica. Si el proveedor está marcado en su ficha, se dice aquí: es
          una sugerencia VISIBLE, no un cálculo que pasa solo. */}
      <div className="px-3 py-2.5 rounded-md border border-border-default bg-page space-y-2">
        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
          <input type="checkbox" checked={ivaOn} disabled={saving}
            onChange={e => aplicarIva(e.target.checked, ivaRate)}
            className="w-4 h-4 accent-accent" />
          El precio del papel lleva IVA
        </label>
        {ivaSugeridoPorProveedor && !ivaOn && (
          <p className="text-xs text-text-secondary">
            Este proveedor está marcado en su ficha como «factura con IVA incluido». Marca la casilla si
            este albarán también lo lleva.
          </p>
        )}
        {ivaOn && (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-text-secondary">Tipo:</span>
              {TIPOS_IVA.map(t => (
                <button key={t} type="button" disabled={saving}
                  onClick={() => aplicarIva(true, String(t))}
                  className={`px-2 py-1 rounded-md text-xs font-medium border transition-base disabled:opacity-50 ${rateN === t ? 'border-accent bg-accent-bg text-accent' : 'border-border-default bg-card text-text-primary hover:bg-page'}`}>
                  {t} %
                </button>
              ))}
              <input type="text" value={ivaRate} disabled={saving}
                onChange={e => aplicarIva(true, e.target.value)}
                aria-label="Otro tipo de IVA en porcentaje"
                className="w-16 px-2 py-1 text-xs border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
              <span className="text-xs text-text-secondary">%</span>
            </div>
            <p className="text-sm text-text-primary tabular-nums">
              {brutoBase == null || netoPropuesto == null ? (
                <span className="text-text-secondary">
                  Falta el importe del papel o la cantidad para poder quitarle el IVA.
                </span>
              ) : (
                <>
                  {brutoPorUnidad != null ? 'Papel' : 'Lo escrito'} {fmtMoney(brutoBase)} con IVA {fmtNumEs(rateN, 0)} %
                  {' → '}al almacén <b>{fmtMoney(netoPropuesto)}</b> cada uno
                  {!netoYaAplicado && <span className="text-warning"> · lo escrito ahora es {costN !== null ? fmtMoney(costN) : 'nada'}</span>}
                </>
              )}
            </p>
          </>
        )}
      </div>

      {(previewBase != null || previewTotal != null) && (
        <div className="px-3 py-2 rounded-md border border-dashed border-border-default bg-page text-sm text-text-secondary tabular-nums">
          Entrará al almacén:{' '}
          <b className="text-text-primary">
            {previewBase != null ? `${fmtQtyDisplay(previewBase)} ${uNoun}` : 'nada (sin formato)'}
          </b>
          {previewTotal != null && <> · total <b className="text-text-primary">{fmtMoney(previewTotal)}</b></>}
        </div>
      )}

      {(qtyChanged || formatChanged) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-text-secondary">Motivo:</span>
          {OFFICE_QTY_REASONS.map(r => (
            <button key={r} type="button" disabled={saving} onClick={() => onSetReason(r)}
              className={`px-2 py-1 rounded-md text-xs font-medium border transition-base disabled:opacity-50 ${reason === r ? 'border-accent bg-accent-bg text-accent' : 'border-border-default bg-page text-text-primary hover:bg-card'}`}>
              {r}
            </button>
          ))}
        </div>
      )}
      {editError && <p className="text-xs text-danger">{editError}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSave} disabled={saving}
          className="px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">Guardar</button>
        <button type="button" onClick={onCancel} disabled={saving}
          className="px-3 py-2 rounded-md text-sm border border-border-default bg-card hover:bg-page disabled:opacity-50">Cancelar</button>
      </div>
    </div>
  )
}

// ── LAS DOS CIFRAS DE LA LÍNEA ─────────────────────────────────────────
// ENCARGO CODE (31/08) «El albarán con IVA incluido» §1 — hasta hoy la tarjeta
// plegada pintaba UNA cifra sin decir cuál era, y era `doc_amount` (el papel).
// Por eso Pamela guardó 83,64 en el ALB-00134 y la pantalla siguió diciendo
// «92,00 €»: no era el mismo campo.
//
// Se enseñan las dos, con su nombre, SIEMPRE — también cuando coinciden. Que
// coincidan es información (el albarán trae base imponible), no ausencia de
// información: esconderlas al coincidir devolvería la ambigüedad de no saber
// cuál se está mirando.
//
// El €/unidad base sale de `unit_cost` (lo que valora el almacén) y con
// decimales suficientes: es EL número que tiene que moverse cuando alguien
// corrige el coste. Con fmtMoney, 0,0092 y 0,0084 se pintaban los dos «0,01 €».
function ImportesLinea({ line, baseUnitAbbr }: {
  line: GoodsReceiptLine
  baseUnitAbbr: string | null
}) {
  const papel = importePapel(line)
  const almacen = importeAlAlmacen(line)
  const porBase = costePorUnidadBase(line)
  const uSingular = unitNoun(baseUnitAbbr, 1)

  return (
    <>
      {papel != null && <> · <span className="text-text-secondary">Papel:</span> {fmtMoney(papel)}</>}
      {almacen != null
        ? <> · <span className="text-text-secondary">Al almacén:</span> <b className="text-text-primary">{fmtMoney(almacen)}</b></>
        : <b className="text-warning"> · sin coste (no valora el almacén)</b>}
      {porBase != null && <> · <b className="text-text-primary">{fmtMoneyPrecise(porBase)}</b> la {uSingular}</>}
    </>
  )
}

// ── Fila CLASE 1 · resuelta ────────────────────────────────────────────
function ResueltaRow({ line, itemInfo, formatNames, saving, onOpenEditor }: {
  line: GoodsReceiptLine
  itemInfo: Record<string, { name: string; baseUnitAbbr: string | null }>
  formatNames: Record<string, string>
  saving: boolean
  onOpenEditor: () => void
}) {
  const info = line.recipeItemId ? itemInfo[line.recipeItemId] : undefined
  const name = info?.name ?? sentenceCase(line.productName)
  const formatName = line.purchaseFormatId ? formatNames[line.purchaseFormatId] : null
  const qtyInBase = line.qtyInBase ?? 0
  const uNoun = unitNoun(info?.baseUnitAbbr ?? null, qtyInBase)

  return (
    <div className="rounded-lg border border-border-default border-l-4 border-l-success bg-card px-4 py-3 flex items-center gap-3">
      <span className="text-success font-bold text-base shrink-0" aria-hidden="true">✓</span>
      <span className="font-semibold text-text-primary shrink-0">{name}</span>
      <span className="text-sm text-text-secondary min-w-0 flex-1">
        {fmtQtyDisplay(line.qtyReceived)} {formatName ? pluralizeEs(formatName, line.qtyReceived) : ''} ·{' '}
        <b className="text-text-primary">{fmtQtyDisplay(qtyInBase)} {uNoun} al almacén</b>
        <ImportesLinea line={line} baseUnitAbbr={info?.baseUnitAbbr ?? null} />
      </span>
      <button type="button" onClick={onOpenEditor} disabled={saving}
        className="shrink-0 min-h-touch px-3.5 rounded-md text-sm font-semibold border border-border-default bg-card text-text-primary hover:bg-page disabled:opacity-50 transition-base">
        Corregir
      </button>
    </div>
  )
}

// ── Fila CLASE 2 · dudosa ───────────────────────────────────────────────
function DudosaRow({ line, itemInfo, formatNames, saving, onConfirm, onCorregir, onChangeArticle }: {
  line: GoodsReceiptLine
  itemInfo: Record<string, { name: string; baseUnitAbbr: string | null }>
  formatNames: Record<string, string>
  saving: boolean
  onConfirm: () => void
  onCorregir: () => void
  onChangeArticle: () => void
}) {
  const info = line.recipeItemId ? itemInfo[line.recipeItemId] : undefined
  const name = info?.name ?? sentenceCase(line.productName)
  const shortName = name.split(' ')[0]
  const formatName = line.purchaseFormatId ? formatNames[line.purchaseFormatId] : null
  const qtyInBase = line.qtyInBase ?? 0
  // §1/§2 — antes: (line.docAmount ?? 0) / qtyInBase. Salía del PAPEL, así que
  // corregir el coste no movía este número; y con fmtMoney se aplastaba a
  // «0,01 €». Ahora sale de unit_cost y con decimales suficientes.
  const perUnit = costePorUnidadBase(line)
  const perUnitPapel = qtyInBase > 0 && line.docAmount != null ? line.docAmount / qtyInBase : null
  const almacen = importeAlAlmacen(line)
  const uNoun = unitNoun(info?.baseUnitAbbr ?? null, qtyInBase)
  const uNounSingular = unitNoun(info?.baseUnitAbbr ?? null, 1)
  const docQty = line.docQty
  const docUdLabel = docQty != null ? (docQty === 1 ? 'ud' : 'uds') : ''

  return (
    <div className="rounded-lg border border-border-default border-l-4 border-l-warning bg-card overflow-hidden">
      <div className="px-4 pt-3.5">
        <div className="text-base font-semibold text-text-primary">{name}</div>
        {(line.rawText || docQty != null || line.docAmount != null) && (
          <div className="text-sm text-text-secondary mt-0.5 tabular-nums">
            El albarán dice:{' '}
            <b className="text-text-primary">
              {line.rawText}{docQty != null ? ` · ${fmtQtyDisplay(docQty)} ${docUdLabel}` : ''}{line.docAmount != null ? ` · ${fmtMoney(line.docAmount)}` : ''}
            </b>
          </div>
        )}
      </div>
      {/* ENCARGO CODE (20/08) — el aviso decía SIEMPRE "lo emparejó el sistema
          por parecido de nombre". En Foodint eso es falso para 400 de las 408
          líneas marcadas: son map_source='unmapped' (el sistema no las casó en
          absoluto) y solo 11 líneas en toda la base son fuzzy. Un aviso que
          describe mal el problema manda a mirar donde no es. Ahora dice lo que
          le pasa a ESTA línea. */}
      <div className="mx-4 mt-3 px-3.5 py-3 rounded-md bg-warning-bg text-base font-semibold text-text-primary">
        ¿Es esta {shortName} la que tienes tú en el catálogo?
        <span className="block font-normal text-sm text-text-primary mt-1">
          {unverifiedReason({
            recipeItemId: line.recipeItemId,
            mapSource: line.mapSource,
            qtyInBase: line.qtyInBase,
            unitCost: line.unitCost,
          })}. Nadie lo ha confirmado todavía, y ya entró al almacén.
        </span>
      </div>
      {qtyInBase > 0 && (line.docAmount != null || almacen != null) && (
        <div className="mx-4 mt-2.5 px-3 py-2.5 rounded-md border border-dashed border-border-default bg-page text-sm text-text-secondary tabular-nums space-y-1">
          <div>
            {fmtQtyDisplay(line.qtyReceived)} {formatName ? pluralizeEs(formatName, line.qtyReceived) : ''} × {fmtQtyDisplay(qtyInBase / Math.max(line.qtyReceived, 1))} {uNoun} = <b className="text-text-primary">{fmtQtyDisplay(qtyInBase)} {uNoun}</b>
          </div>
          {/* El desglose enseña la cuenta DE VERDAD, la que valora el almacén.
              La del papel se deja al lado cuando difiere: ver la diferencia es
              justamente lo que permite cazar un IVA colado. */}
          <div>
            Al almacén: <b className="text-text-primary">{almacen != null ? fmtMoney(almacen) : DASH}</b>
            {' '}÷ {fmtQtyDisplay(qtyInBase)} = <b className="text-text-primary">{perUnit != null ? fmtMoneyPrecise(perUnit) : DASH} la {uNounSingular}</b>
          </div>
          {line.docAmount != null && (
            <div>
              Papel: {fmtMoney(line.docAmount)}
              {perUnitPapel != null && <> ÷ {fmtQtyDisplay(qtyInBase)} = {fmtMoneyPrecise(perUnitPapel)} la {uNounSingular}</>}
            </div>
          )}
        </div>
      )}
      {/* ENCARGO CODE (20/08) §2.2 — tercer camino. Antes solo se podía decir
          "sí" o "es otro artículo": si el artículo era el correcto pero la
          cantidad, el formato o el precio estaban mal (ALB-00119), no había
          por dónde arreglarlo desde aquí. */}
      <div className="flex gap-2.5 flex-wrap px-4 py-3.5">
        <button type="button" onClick={onConfirm} disabled={saving}
          className="min-h-touch px-4.5 rounded-md text-sm font-semibold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
          Sí, es esta
        </button>
        <button type="button" onClick={onChangeArticle} disabled={saving}
          className="min-h-touch px-4.5 rounded-md text-sm font-semibold border border-border-default bg-card text-text-primary hover:bg-page disabled:opacity-50 transition-base">
          No, es otro artículo
        </button>
        <button type="button" onClick={onCorregir} disabled={saving}
          className="min-h-touch px-4.5 rounded-md text-sm font-semibold border border-border-default bg-card text-text-primary hover:bg-page disabled:opacity-50 transition-base">
          Corregir cantidad, formato o precio
        </button>
      </div>
    </div>
  )
}

// ── Fila CLASE 3 · sin decidir ───────────────────────────────────────────
function SinDecidirRow({ line, saving, onSearch, onCreate, notGoodsOpen, onToggleNotGoods, onPickNotGoods }: {
  line: GoodsReceiptLine
  saving: boolean
  onSearch: () => void
  onCreate: () => void
  notGoodsOpen: boolean
  onToggleNotGoods: () => void
  onPickNotGoods: (kind: string) => void
}) {
  const name = sentenceCase(line.productName)
  const docQty = line.docQty
  const docUdLabel = docQty != null ? (docQty === 1 ? 'ud' : 'uds') : ''
  return (
    <div className="rounded-lg border border-border-default border-l-4 border-l-accent bg-card overflow-hidden">
      <div className="px-4 pt-3.5">
        <div className="text-base font-semibold text-text-primary">{name}</div>
        {(line.rawText || docQty != null || line.docAmount != null) && (
          <div className="text-sm text-text-secondary mt-0.5 tabular-nums">
            El albarán dice:{' '}
            <b className="text-text-primary">
              {line.rawText}{docQty != null ? ` · ${fmtQtyDisplay(docQty)} ${docUdLabel}` : ''}{line.docAmount != null ? ` · ${fmtMoney(line.docAmount)}` : ''}
            </b>
          </div>
        )}
      </div>
      <div className="mx-4 mt-3 px-3.5 py-3 rounded-md bg-accent-bg text-base font-semibold text-text-primary">
        Esto no lo tienes en el catálogo. ¿Qué hacemos?
        <span className="block font-normal text-sm text-text-primary mt-1">
          No ha entrado al almacén. Si lo dejas así, estos {line.docAmount != null ? fmtMoney(line.docAmount) : DASH} de género no aparecerán en tu inventario ni en tu coste.
        </span>
      </div>
      {!notGoodsOpen ? (
        <div className="flex gap-2.5 flex-wrap px-4 py-3.5">
          <button type="button" onClick={onSearch} disabled={saving}
            className="min-h-touch px-4.5 rounded-md text-sm font-semibold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            Buscar en mi catálogo
          </button>
          <button type="button" onClick={onCreate} disabled={saving}
            className="min-h-touch px-4.5 rounded-md text-sm font-semibold border border-border-default bg-card text-text-primary hover:bg-page disabled:opacity-50 transition-base">
            Crear artículo nuevo
          </button>
          <button type="button" onClick={onToggleNotGoods} disabled={saving}
            className="min-h-touch px-3.5 rounded-md text-sm text-text-secondary border border-transparent hover:border-border-default hover:bg-page disabled:opacity-50 transition-base">
            No es mercancía (portes, envases…)
          </button>
        </div>
      ) : (
        <div className="px-4 py-3.5 space-y-2">
          <p className="text-xs text-text-secondary">¿Qué es?</p>
          <div className="flex gap-1.5 flex-wrap">
            {NOT_GOODS_KINDS.map(k => (
              <button key={k.value} type="button" disabled={saving} onClick={() => onPickNotGoods(k.value)}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-border-default bg-page text-text-primary hover:bg-card disabled:opacity-50 transition-base">
                {k.label}
              </button>
            ))}
            <button type="button" onClick={onToggleNotGoods} disabled={saving}
              className="px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary disabled:opacity-50">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Fila "no es mercancía" ya decidida (sin ejemplo en la maqueta — colapsada
// como la resuelta, pero neutra: no es un tick de éxito, es una exclusión) ──
function NotGoodsRow({ line }: { line: GoodsReceiptLine }) {
  const kindLabel = NOT_GOODS_KINDS.find(k => k.value === line.notGoodsKind)?.label ?? line.notGoodsKind ?? 'otro'
  return (
    <div className="rounded-lg border border-border-default border-l-4 border-l-border-default bg-card px-4 py-3 flex items-center gap-3">
      <span className="text-text-secondary shrink-0">—</span>
      <span className="text-sm text-text-secondary min-w-0 flex-1">
        {sentenceCase(line.productName)} · No es mercancía ({kindLabel}){line.docAmount != null ? ` · ${fmtMoney(line.docAmount)}` : ''}
      </span>
    </div>
  )
}
