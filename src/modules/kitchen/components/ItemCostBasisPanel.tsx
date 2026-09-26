// src/modules/kitchen/components/ItemCostBasisPanel.tsx
//
// «De dónde sale el coste» (27/09). Para una materia prima: las líneas de
// albarán de la ventana (90 días por defecto) que componen la media ponderada,
// y las que el guardia deja fuera con su motivo. TODAS las líneas se pintan:
// el guardia decide si una línea entra en la media, nunca si se ve (regla 7).
//
// Si el artículo aún está a «último precio» y es uno de los que estaban
// marcados como media (recipe_item_cost_rollout pendiente), enseña cuánto
// cambiaría y deja aprobarlo — uno a uno, con el antes y el después delante,
// y la confirmación dice qué ha pasado (regla 8).

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import {
  getCostBreakdown, approveAverageCost,
  type CostBreakdown, type CostDiscardReason, type CostAverageMethod,
} from '@/modules/kitchen/services/costAverageService'

const MOTIVO: Record<CostDiscardReason, string> = {
  importe_no_positivo: 'importe 0 o negativo',
  mas_de_3x_la_mediana: 'más de 3× la mediana',
  menos_de_un_tercio_de_la_mediana: 'menos de ⅓ de la mediana',
}

const GRUPO: Record<string, string> = {
  quieto: 'no se mueve',
  se_mueve: 'se mueve',
  imposible: 'formato mal casado en algún albarán',
  sin_compras: 'sin compras en la ventana',
}

const fmtQty = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)
const fmtEurTotal = (v: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })

// €/base con los decimales que hacen falta, y su equivalente legible (€/kg, €/L).
function fmtUnitCost(v: number | null, unitAbbr: string | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const base = new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 5,
  }).format(v)
  const suf = unitAbbr ? ` / ${unitAbbr}` : ''
  if (unitAbbr === 'g') return `${base}${suf} (${fmtEurTotal(v * 1000)}/kg)`
  if (unitAbbr === 'ml') return `${base}${suf} (${fmtEurTotal(v * 1000)}/L)`
  return `${base}${suf}`
}

function pct(a: number | null, b: number | null): string | null {
  if (a === null || b === null || a === 0) return null
  const p = (b / a - 1) * 100
  return `${p > 0 ? '+' : ''}${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(p)} %`
}

function resumen(b: CostBreakdown, unitAbbr: string | null): string {
  const m: CostAverageMethod = b.metodo
  const ventana = `los últimos ${b.ventanaDias} días (desde ${fmtDate(b.desde)})`
  if (m === 'media' || m === 'poco_dato') {
    const entran = b.lineasVentana - b.descartadas
    const cuenta = `${fmtEurTotal(b.importe ?? 0)} ÷ ${fmtQty(b.cantidad ?? 0)}${unitAbbr ? ` ${unitAbbr}` : ''}`
    return m === 'media'
      ? `Media de ${entran} compras de ${ventana}: ${cuenta} = ${fmtUnitCost(b.coste, unitAbbr)}.`
      : `Una sola compra en ${ventana}: ${cuenta} = ${fmtUnitCost(b.coste, unitAbbr)}. Poco dato.`
  }
  if (m === 'ultima_conocida' && b.ultimaCompra) {
    return `Sin compras en ${ventana}. Última conocida: ${b.ultimaCompra.albaran ?? 'albarán sin código'} del ${fmtDate(b.ultimaCompra.fecha)}, a ${fmtUnitCost(b.ultimaCompra.eurUnidad, unitAbbr)}.`
  }
  return `Nunca se ha recibido por albarán. El coste se queda en el que tenía y el artículo queda para revisar.`
}

export default function ItemCostBasisPanel({
  itemId, unitAbbr, onApproved,
}: {
  itemId: string
  unitAbbr: string | null
  /** Tras aprobar: refrescar la ficha y recostear los platos que lo usan. */
  onApproved: () => void | Promise<void>
}) {
  const [tick, setTick] = useState(0)
  // Lo leído va sellado con la clave que lo pidió: «cargando» es que la clave
  // actual todavía no tiene respuesta (sin setState síncrono en el efecto).
  const key = `${itemId}:${tick}`
  const [loaded, setLoaded] = useState<{ key: string; data: CostBreakdown | null; error: string | null } | null>(null)
  const [approving, setApproving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    getCostBreakdown(itemId)
      .then(d => { if (!cancelled) setLoaded({ key, data: d, error: null }) })
      .catch(e => { if (!cancelled) setLoaded({ key, data: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { cancelled = true }
  }, [itemId, key])

  const loading = loaded?.key !== key
  const data = loading ? null : loaded?.data ?? null
  const error = loading ? null : loaded?.error ?? null

  if (loading) {
    return <div className="flex items-center gap-2 text-text-secondary text-sm py-2"><Loader2 size={14} className="animate-spin" /> Leyendo las compras…</div>
  }
  if (error || !data) {
    return <p className="text-sm text-danger py-1">{error ?? 'No se pudo leer de dónde sale el coste.'}</p>
  }

  const aMedia = data.estrategia === 'average_weighted'
  const pendiente = !aMedia && data.rollout?.estado === 'pendiente'
  const cambio = pct(data.costeActual, data.coste)
  const muchosFuera = data.pctDescartadas > 20

  async function aprobar() {
    if (!data) return
    const texto = `Pasar a media ponderada.\n\nCoste hoy: ${fmtUnitCost(data.costeActual, unitAbbr)}\n`
      + `Con la media: ${fmtUnitCost(data.coste, unitAbbr)}${cambio ? ` (${cambio})` : ''}\n\n`
      + `Los platos que lo usan se recalculan con el coste nuevo.`
    if (!window.confirm(texto)) return
    setApproving(true)
    setResult(null)
    try {
      const r = await approveAverageCost(itemId)
      if (r.encendido) {
        setResult({
          ok: true,
          text: `A media ponderada. Coste ${fmtUnitCost(r.antes, unitAbbr)} → ${fmtUnitCost(r.despues, unitAbbr)}`
            + ` con ${r.lineas ?? 0} líneas${r.descartadas ? `, ${r.descartadas} fuera` : ''}.`
            + (r.avisoDescartes ? ' Deja fuera más del 20 %: revisa el formato en esos albaranes.' : ''),
        })
        await onApproved()
      } else {
        setResult({ ok: false, text: `No se ha cambiado: ${r.motivo ?? 'sin motivo'}.` })
      }
      setTick(t => t + 1)
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="space-y-2.5">
      <p className="text-sm text-text-primary">
        {aMedia
          ? resumen(data, unitAbbr)
          : <>Hoy el coste es el último precio del proveedor principal: <b className="font-mono">{fmtUnitCost(data.costeActual, unitAbbr)}</b>.
              {' '}Con la media ponderada sería <b className="font-mono">{fmtUnitCost(data.coste, unitAbbr)}</b>{cambio ? ` (${cambio})` : ''}. {resumen(data, unitAbbr)}</>}
      </p>

      {pendiente && data.rollout && (
        <div className="flex items-center justify-between gap-3 flex-wrap p-2.5 rounded-md bg-page border border-border-default">
          <span className="text-xs text-text-secondary">
            Estaba marcado como media ponderada y calculaba el último precio.
            {GRUPO[data.rollout.grupo] ? ` Grupo: ${GRUPO[data.rollout.grupo]}.` : ''}
          </span>
          <button
            type="button"
            onClick={() => { void aprobar() }}
            disabled={approving || data.coste === null}
            className="text-xs rounded-md px-3 py-1.5 bg-accent text-text-on-accent disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {approving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Aprobar media ponderada
          </button>
        </div>
      )}
      {aMedia && data.rollout?.decididoAt && (
        <p className="text-[11px] text-text-tertiary">
          A media desde el {fmtDate(data.rollout.decididoAt)}{data.rollout.decididoByName ? `, aprobado por ${data.rollout.decididoByName}` : ''}.
        </p>
      )}

      {result && (
        <p className={`text-sm ${result.ok ? 'text-success' : 'text-danger'}`}>{result.text}</p>
      )}

      {muchosFuera && (
        <div className="p-2.5 rounded-md bg-warning-bg border border-warning/30 flex items-start gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
          <span>
            {data.descartadas} de {data.lineasVentana} líneas se quedan fuera de la media. Tantas no son un dato raro:
            el artículo se está recibiendo con formatos distintos. Revisa el formato casado en esos albaranes.
          </span>
        </div>
      )}

      {data.lineas.length === 0 ? (
        <p className="text-sm text-text-tertiary">Ninguna compra con importe en la ventana.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border-default">
                <th className="py-1.5 pr-2 font-medium">Fecha</th>
                <th className="py-1.5 pr-2 font-medium">Albarán</th>
                <th className="py-1.5 pr-2 font-medium hidden sm:table-cell">Proveedor</th>
                <th className="py-1.5 pr-2 font-medium text-right">Cantidad</th>
                <th className="py-1.5 pr-2 font-medium text-right">Importe</th>
                <th className="py-1.5 pr-2 font-medium text-right">€ / {unitAbbr ?? 'ud'}</th>
                <th className="py-1.5 font-medium">En la media</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {data.lineas.map(l => (
                <tr key={l.lineaId} className={l.entra ? '' : 'text-text-tertiary'}>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDate(l.fecha)}</td>
                  <td className="py-1.5 pr-2 font-mono whitespace-nowrap" title={l.producto}>{l.albaran ?? '—'}</td>
                  <td className="py-1.5 pr-2 truncate max-w-[10rem] hidden sm:table-cell">{l.proveedor ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(l.cantidad)}{unitAbbr ? ` ${unitAbbr}` : ''}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtEurTotal(l.importe)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-mono">
                    {new Intl.NumberFormat('es-ES', { maximumFractionDigits: 5 }).format(l.eurUnidad)}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    {l.entra
                      ? <span className="text-success">Sí</span>
                      : <span className="text-warning">No · {l.motivo ? MOTIVO[l.motivo] : 'fuera'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
