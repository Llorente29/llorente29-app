// src/modules/supply/pages/UnverifiedLinesPage.tsx
//
// ENCARGO CODE (20/08) «Verificar un albarán a ciegas», §6 — la puerta que le
// faltaba a la alarma.
//
// La pantalla de oficina ya avisa, línea a línea, de que algo entró al almacén
// sin que nadie lo confirmara. El aviso está bien escrito y es honesto, pero
// avisa de UNA línea dentro de UN albarán: para atacar las 410 que hay en
// producción habría que abrir los 132 albaranes uno por uno y acordarse de
// cuáles ya se miraron. Eso es una alarma sin puerta (§7).
//
// Esto es la lista: todas las líneas marcadas, de toda la cuenta, ORDENADAS
// POR IMPORTE. Se ataca por lo que más vale, no por lo que salga antes. Cada
// fila lleva su albarán detrás, así que corregir es un clic.
//
// No decide nada por su cuenta: no toca datos, solo enseña y lleva. Corregir
// se sigue haciendo en la pantalla de oficina, por adjust_goods_receipt_line,
// con motivo y rastro.

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, ChevronRight } from 'lucide-react'
import {
  listUnverifiedLines,
  getRecipeItemDisplayInfo,
  type UnverifiedLine,
} from '@/modules/supply/services/goodsReceiptService'
import { listSupplyLocations, type SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import { fmtMoney, DASH } from '@/lib/format'

interface UnverifiedLinesPageProps {
  accountId: string
  /** Local preseleccionado. '' o null = toda la cuenta. */
  locationId?: string | null
  onBack: () => void
  /** Abrir el albarán de esta línea en la pantalla de oficina. */
  onOpenReceipt: (receiptId: string) => void
}

function fmtDate(iso: string): string {
  if (!iso) return DASH
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })
}
function sentenceCase(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

export default function UnverifiedLinesPage({ accountId, locationId, onBack, onOpenReceipt }: UnverifiedLinesPageProps) {
  const [rows, setRows] = useState<UnverifiedLine[]>([])
  const [itemInfo, setItemInfo] = useState<Record<string, { name: string; baseUnitAbbr: string | null }>>({})
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locFilter, setLocFilter] = useState<string>(locationId ?? '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const [ls, locs, sups] = await Promise.all([
          listUnverifiedLines(accountId),
          listSupplyLocations(accountId),
          listSuppliers(accountId),
        ])
        if (cancelled) return
        setRows(ls)
        setLocations(locs)
        setSuppliers(sups)
        const ids = Array.from(new Set(ls.map(l => l.recipeItemId).filter((x): x is string => !!x)))
        const info = await getRecipeItemDisplayInfo(ids)
        if (cancelled) return
        setItemInfo(info)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudieron leer las líneas sin verificar.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [accountId])

  const locationName = useMemo(() => {
    const m = new Map<string, string>()
    locations.forEach(l => m.set(l.id, l.name))
    return m
  }, [locations])
  const supplierName = useMemo(() => {
    const m = new Map<string, string>()
    suppliers.forEach(s => m.set(s.id, s.name))
    return m
  }, [suppliers])

  const visible = useMemo(
    () => (locFilter ? rows.filter(r => r.locationId === locFilter) : rows),
    [rows, locFilter],
  )
  // El total es lo que hay en juego. Las líneas sin importe se cuentan aparte:
  // no se pueden sumar, pero tampoco se esconden.
  const totalAmount = useMemo(
    () => visible.reduce((s, r) => s + (r.amount ?? 0), 0),
    [visible],
  )
  const sinImporte = useMemo(() => visible.filter(r => r.amount == null).length, [visible])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-3.5">
      <button type="button" onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
        <ArrowLeft size={16} /> Volver
      </button>

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      <div className="bg-card border border-border-default rounded-lg px-5 py-4.5">
        <h1 className="text-lg font-display font-semibold tracking-tight text-text-primary">
          Líneas que entraron sin que nadie las confirmara
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {visible.length === 0
            ? 'Ninguna. Todo lo que hay en el almacén lo ha mirado alguien.'
            : <>
                {visible.length} línea{visible.length === 1 ? '' : 's'} · {fmtMoney(totalAmount)} en juego
                {sinImporte > 0 && <> · {sinImporte} sin importe en el papel</>}
                . Ordenadas por lo que valen: ataca por arriba.
              </>}
        </p>
        {locations.length > 1 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setLocFilter('')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-base ${locFilter === '' ? 'border-accent bg-accent-bg text-accent' : 'border-border-default bg-page text-text-primary hover:bg-card'}`}>
              Todos los locales
            </button>
            {locations.map(l => (
              <button key={l.id} type="button" onClick={() => setLocFilter(l.id)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-base ${locFilter === l.id ? 'border-accent bg-accent-bg text-accent' : 'border-border-default bg-page text-text-primary hover:bg-card'}`}>
                {l.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {visible.map(r => {
          const name = r.recipeItemId ? (itemInfo[r.recipeItemId]?.name ?? sentenceCase(r.productName)) : sentenceCase(r.productName)
          const enStock = r.recipeItemId != null && r.qtyInBase != null && r.qtyInBase > 0
          return (
            <button key={r.lineId} type="button" onClick={() => onOpenReceipt(r.receiptId)}
              className={`text-left rounded-lg border border-border-default border-l-4 bg-card px-4 py-3 flex items-center gap-3 hover:bg-page transition-base ${enStock ? 'border-l-warning' : 'border-l-accent'}`}>
              <span className="shrink-0 w-24 text-base font-display font-semibold text-text-primary tabular-nums">
                {r.amount != null ? fmtMoney(r.amount) : DASH}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-text-primary truncate">{name}</span>
                <span className="block text-sm text-text-secondary truncate">{r.why}</span>
                <span className="block text-xs text-text-secondary mt-0.5 tabular-nums">
                  {r.receiptCode ?? 'sin código'} · {fmtDate(r.receiptDate)}
                  {r.supplierId && <> · {supplierName.get(r.supplierId) ?? 'proveedor desconocido'}</>}
                  {!r.supplierId && <> · sin proveedor</>}
                  {r.locationId && <> · {locationName.get(r.locationId) ?? ''}</>}
                </span>
              </span>
              <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded border ${enStock ? 'border-warning/30 bg-warning-bg text-text-primary' : 'border-border-default bg-page text-text-secondary'}`}>
                {enStock ? 'en el almacén' : 'no entró'}
              </span>
              <ChevronRight size={18} className="shrink-0 text-text-secondary" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
