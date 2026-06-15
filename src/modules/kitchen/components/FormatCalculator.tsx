// src/modules/kitchen/components/FormatCalculator.tsx
//
// Calculadora de formatos REUTILIZABLE (patrón tomado de tspoon, mejorado).
// El usuario dice CUÁNTAS unidades de cada formato tiene ("3 cajas de 3 kg +
// 5 cajas de 2,2 kg + 0,5 kg sueltos") y Folvy SUMA a la unidad base. Nunca
// multiplica ni convierte de cabeza. Devuelve el total en base (onAccept).
//
// Es transversal: se enchufa en conteo de inventario, recepción, pedido y el
// "¿cuánto trae?" del alta de proveedor. Carga ella sola los formatos del
// artículo (listFormatsByItem), así el cableado en cada sitio es mínimo.
//
// Asistencia IA (anti-invención, "perro guardián amable"):
//  · TRANSPARENCIA: el desglose y el total se ven SIEMPRE antes de aceptar
//    (cada fila muestra "cantidad × qty_in_base = total"). Esto, por sí solo,
//    elimina la confusión de unidad (el error de clase COHELDI en cantidades).
//  · NUDGE DE SENSATEZ: si se teclea un número de un mismo formato claramente
//    desproporcionado (> MANY_UNITS_WARN), aviso amable; NO bloquea (cero
//    falsos positivos: solo dispara ante disparates evidentes).
// El "inspector que razona" (motivo de variación, consecuencias) vive en la
// REVISIÓN del conteo, donde el dato existe y no es ciego — capa aparte.

import { useEffect, useMemo, useState } from 'react'
import { X, Calculator, Loader2, AlertTriangle } from 'lucide-react'
import { listFormatsByItem } from '@/modules/kitchen/services/purchaseFormatService'
import type { PurchaseFormat } from '@/types/kitchen'

// Por encima de este nº de unidades de UN MISMO formato, avisamos amablemente
// (posible error de dedo / unidad). Generoso a propósito: solo disparates.
const MANY_UNITS_WARN = 200

function parseDecimal(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function fmtNum(v: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(v)
}

interface FormatCalculatorProps {
  itemId: string
  itemName: string
  /** Abreviatura de la unidad base del artículo (g, kg, ml, L, ud…). */
  baseAbbr: string | null
  /** Cantidad de partida (en base), para precargar la fila de "sueltos". */
  initialQtyInBase?: number | null
  /** Devuelve el TOTAL en unidad base. */
  onAccept: (qtyInBase: number) => void
  onClose: () => void
}

export default function FormatCalculator({
  itemId,
  itemName,
  baseAbbr,
  initialQtyInBase,
  onAccept,
  onClose,
}: FormatCalculatorProps) {
  const abbr = baseAbbr ?? ''
  const [formats, setFormats] = useState<PurchaseFormat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Cantidad tecleada por formato (id → texto) y cantidad "suelta" en base.
  const [byFormat, setByFormat] = useState<Record<string, string>>({})
  const [directBase, setDirectBase] = useState<string>(
    initialQtyInBase !== null && initialQtyInBase !== undefined && initialQtyInBase !== 0
      ? String(initialQtyInBase)
      : '',
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listFormatsByItem(itemId)
      .then((fs) => {
        if (cancelled) return
        setFormats(fs.filter((f) => f.qtyInBase > 0))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudieron cargar los formatos.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [itemId])

  // Total por formato (cantidad × qty_in_base) y total general (+ sueltos).
  const rows = useMemo(
    () =>
      formats.map((f) => {
        const n = parseDecimal(byFormat[f.id] ?? '')
        return { format: f, qty: n, total: n !== null ? n * f.qtyInBase : null }
      }),
    [formats, byFormat],
  )

  const directNum = parseDecimal(directBase)

  const grandTotal = useMemo(() => {
    let sum = 0
    let any = false
    for (const r of rows) {
      if (r.total !== null) { sum += r.total; any = true }
    }
    if (directNum !== null) { sum += directNum; any = true }
    return any ? sum : null
  }, [rows, directNum])

  // Guardián amable: ¿algún formato con un nº de unidades desproporcionado?
  const bigRow = rows.find((r) => r.qty !== null && r.qty > MANY_UNITS_WARN) ?? null

  function setQtyFor(formatId: string, value: string) {
    setByFormat((prev) => ({ ...prev, [formatId]: value }))
  }

  function accept() {
    if (grandTotal === null) return
    onAccept(grandTotal)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="format-calc-title"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2 min-w-0">
            <Calculator className="w-4 h-4 text-accent flex-shrink-0" />
            <div className="min-w-0">
              <h3 id="format-calc-title" className="text-sm font-medium text-text-primary truncate">
                Calculadora de formatos
              </h3>
              <p className="text-[11px] text-text-secondary truncate">{itemName}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-base"
          >
            <X size={18} />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {loading && (
            <div className="py-6 text-center text-sm text-text-secondary flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando formatos…
            </div>
          )}

          {!loading && error && (
            <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              <p className="text-[11px] text-text-secondary">
                Di cuántas unidades tienes de cada formato. Folvy lo suma en {abbr || 'la unidad base'}.
              </p>

              {/* Una fila por formato */}
              {rows.map((r) => (
                <div key={r.format.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={byFormat[r.format.id] ?? ''}
                    onChange={(e) => setQtyFor(r.format.id, e.target.value)}
                    placeholder="0"
                    className="w-16 px-2 py-1.5 text-sm text-right border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-primary truncate">{r.format.name}</div>
                    <div className="text-[11px] text-text-secondary">
                      {fmtNum(r.format.qtyInBase)} {abbr} cada uno
                    </div>
                  </div>
                  <div className="text-sm tabular-nums text-text-secondary w-24 text-right">
                    {r.total !== null ? `${fmtNum(r.total)} ${abbr}` : '—'}
                  </div>
                </div>
              ))}

              {/* Fila de "sueltos" en unidad base directa */}
              <div className="flex items-center gap-2 pt-1 border-t border-border-default">
                <input
                  type="text"
                  inputMode="decimal"
                  value={directBase}
                  onChange={(e) => setDirectBase(e.target.value)}
                  placeholder="0"
                  className="w-16 px-2 py-1.5 text-sm text-right border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary">Sueltos</div>
                  <div className="text-[11px] text-text-secondary">directamente en {abbr || 'unidad base'}</div>
                </div>
                <div className="text-sm tabular-nums text-text-secondary w-24 text-right">
                  {directNum !== null ? `${fmtNum(directNum)} ${abbr}` : '—'}
                </div>
              </div>

              {formats.length === 0 && (
                <p className="text-[11px] text-text-secondary">
                  Este artículo aún no tiene formatos de compra. Introduce la cantidad en {abbr || 'la unidad base'}.
                </p>
              )}

              {/* Guardián amable: nº de un formato desproporcionado */}
              {bigRow && (
                <div className="p-2 rounded-md bg-warning-bg border border-warning/30 text-xs text-text-primary flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
                  <span>
                    Has puesto {fmtNum(bigRow.qty!)} de "{bigRow.format.name}" — son muchas. Si no es
                    correcto, revísalo antes de aceptar.
                  </span>
                </div>
              )}

              {/* Total */}
              <div className="flex items-center justify-between pt-2 border-t border-border-default">
                <span className="text-sm font-medium text-text-primary">Total</span>
                <span className="text-base font-mono font-medium text-text-primary tabular-nums">
                  {grandTotal !== null ? `${fmtNum(grandTotal)} ${abbr}` : '—'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Pie */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={grandTotal === null}
            className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            Usar {grandTotal !== null ? `${fmtNum(grandTotal)} ${abbr}` : 'total'}
          </button>
        </div>
      </div>
    </div>
  )
}
