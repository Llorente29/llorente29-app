// src/modules/supply/components/OrderShortfallPanel.tsx
//
// QUÉ FALTA DE ESTE PEDIDO, Y RECLAMARLO — ENCARGO CODE (21/08).
//
// «Recibido parcial» decía QUE pasa algo y se acababa ahí. El dato existía —lo
// sabe purchase_order_shortfall— y no se enseñaba. Es la misma enfermedad del
// recuadro amarillo de las recepciones: una etiqueta de color que no dice QUÉ
// ni QUÉ HACES.
//
// LO QUE FALTA VA ARRIBA. El orden lo impone el servidor (incompletas primero,
// luego por posición), no esta pantalla: así la ficha y el texto de la
// reclamación enseñan lo mismo en el mismo orden. Las completas se pliegan.
//
// RECLAMAR NO ES UN CANAL NUEVO. Va a ctb_notification_queue, la misma cola de
// «Comunicar a CTB» que lleva 55 envíos y que ya sale por WhatsApp (Web Share
// con el adjunto; en PC, portapapeles). El humano es el transporte, a propósito.
//
// EL MENSAJE LO COMPONE EL SISTEMA. El operario revisa y envía, no redacta —
// y ve el texto EXACTO antes de que salga: la última pantalla antes de escribir
// dice qué escribe.

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, ChevronDown, ChevronRight, Send, Check, X } from 'lucide-react'
import {
  getOrderShortfall, buildOrderClaimMessage, queueOrderClaim,
  type OrderShortfallLine, type PurchaseOrder,
} from '@/modules/supply/services/purchaseOrderService'

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString('es-ES', { maximumFractionDigits: 3 })
}

export default function OrderShortfallPanel({
  order, supplierName, locationName, puedeReclamar,
}: {
  order: PurchaseOrder
  supplierName: string | null
  locationName: string | null
  /** El proveedor comunica por el grupo de CTB. Si no, no hay a dónde reclamar. */
  puedeReclamar: boolean
}) {
  const [lineas, setLineas] = useState<OrderShortfallLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verCompletas, setVerCompletas] = useState(false)
  const [previo, setPrevio] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getOrderShortfall(order.id)
      .then(rs => { if (vivo) setLineas(rs) })
      .catch(e => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo leer lo que falta.') })
    return () => { vivo = false }
  }, [order.id])

  if (error) {
    return (
      <div className="rounded-lg border border-danger/20 bg-danger-bg/40 px-4 py-3 text-sm text-danger">{error}</div>
    )
  }
  if (lineas === null) {
    return (
      <div className="rounded-lg border border-border-default bg-card px-4 py-3 flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" /> Mirando qué falta…
      </div>
    )
  }

  const faltan = lineas.filter(l => l.qtyMissing > 0)
  const completas = lineas.filter(l => l.qtyMissing <= 0)

  // Nada que enseñar: el pedido está entero. Un panel que siempre está deja de
  // leerse, así que aquí no se pinta nada.
  if (faltan.length === 0) return null

  function abrirPrevio() {
    setPrevio(buildOrderClaimMessage({
      orderCode: order.code,
      supplierName,
      locationName,
      expectedDate: order.expectedDate,
      faltan,
    }))
  }

  async function reclamar() {
    if (!previo) return
    setEnviando(true); setError(null)
    try {
      // 1) Deja el rastro ANTES de compartir: si se comparte y no se encola, la
      //    reclamación no existe para nadie más que para quien la mandó.
      await queueOrderClaim(order.id)

      // 2) El mismo camino que la cola de CTB: compartir nativo si lo hay
      //    (móvil → WhatsApp), y si no, portapapeles.
      const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void> }
      let compartido = false
      if (nav.share) {
        try { await nav.share({ text: previo }); compartido = true } catch { /* cancelado o no disponible */ }
      }
      if (!compartido) {
        try { await navigator.clipboard.writeText(previo) } catch { /* sin portapapeles */ }
      }
      setPrevio(null)
      setHecho(compartido
        ? 'Reclamación anotada y compartida. Queda en «Comunicar a CTB» hasta que la marques enviada.'
        : 'Reclamación anotada y copiada. Pégala en el grupo; queda en «Comunicar a CTB» hasta que la marques enviada.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anotar la reclamación.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rounded-lg border border-warning/30 bg-warning-bg/30">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-warning/20 flex-wrap">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
          <div>
            <h3 className="text-base font-medium text-text-primary">
              Falta{faltan.length === 1 ? '' : 'n'} {faltan.length} de {lineas.length}
            </h3>
            <p className="text-sm text-text-secondary mt-0.5">
              Esto es lo que se pidió y no ha llegado. Lo demás está completo.
            </p>
          </div>
        </div>
        {puedeReclamar ? (
          <button type="button" onClick={abrirPrevio} disabled={enviando}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            <Send size={14} /> Reclamar lo que falta
          </button>
        ) : (
          <span className="text-xs text-text-secondary max-w-xs text-right">
            Este proveedor no comunica por el grupo de CTB: la reclamación hay que hacerla por su vía de siempre.
          </span>
        )}
      </div>

      {hecho && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-success-bg text-success border border-success/20 text-sm flex items-start gap-1.5">
          <Check size={14} className="mt-0.5 shrink-0" /> {hecho}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-text-secondary">
            <tr>
              <th className="text-left font-medium px-4 py-2">Artículo</th>
              <th className="text-right font-medium px-3 py-2">Pedido</th>
              <th className="text-right font-medium px-3 py-2">Llegó</th>
              <th className="text-right font-medium px-4 py-2">Falta</th>
            </tr>
          </thead>
          <tbody>
            {faltan.map(l => (
              <tr key={l.lineId} className="border-t border-warning/20">
                <td className="px-4 py-2 text-text-primary">
                  {l.productName}
                  {l.formatName && <span className="text-text-secondary"> · {l.formatName}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{num(l.qtyOrdered)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{num(l.qtyReceived)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-warning">{num(l.qtyMissing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {completas.length > 0 && (
        <div className="border-t border-warning/20">
          <button type="button" onClick={() => setVerCompletas(v => !v)}
            className="w-full flex items-center gap-1.5 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary transition-base">
            {verCompletas ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            {verCompletas ? 'Ocultar' : 'Ver'} {completas.length} línea{completas.length === 1 ? '' : 's'} completa{completas.length === 1 ? '' : 's'}
          </button>
          {verCompletas && (
            <div className="overflow-x-auto pb-1">
              <table className="w-full text-sm">
                <tbody>
                  {completas.map(l => (
                    <tr key={l.lineId} className="border-t border-border-default/60">
                      <td className="px-4 py-1.5 text-text-secondary">
                        {l.productName}
                        {l.formatName && <span className="text-text-tertiary"> · {l.formatName}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary">{num(l.qtyOrdered)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary">{num(l.qtyReceived)}</td>
                      <td className="px-4 py-1.5 text-right text-success">✓</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── EL TEXTO EXACTO QUE VA A SALIR, antes de que salga ── */}
      {previo !== null && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
          role="dialog" aria-modal="true" onClick={() => !enviando && setPrevio(null)}>
          <div className="bg-card w-full sm:max-w-lg max-h-[95vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
              <h3 className="text-base font-medium text-text-primary">Esto es lo que se va a enviar</h3>
              <button type="button" aria-label="Cerrar" onClick={() => setPrevio(null)} disabled={enviando}
                className="text-text-secondary hover:text-text-primary disabled:opacity-50"><X size={18} /></button>
            </div>
            <div className="px-4 py-4 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-text-primary bg-page border border-border-default rounded-md p-3 font-sans">{previo}</pre>
              <p className="text-xs text-text-secondary mt-2">
                Va al grupo de CTB. Queda anotado quién lo reclamó y cuándo; si se reclama dos veces, se ve.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
              <button type="button" onClick={() => setPrevio(null)} disabled={enviando}
                className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={reclamar} disabled={enviando}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
                {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send size={14} />}
                {enviando ? 'Anotando…' : 'Reclamar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
