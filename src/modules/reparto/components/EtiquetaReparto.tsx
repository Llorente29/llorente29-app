// src/modules/reparto/components/EtiquetaReparto.tsx
//
// R02 · La etiqueta de reparto de un pedido. Pieza del estilo nuevo dentro de
// la tarjeta vieja del pedido: lleva `.cx-colores` (solo los colores de
// tokens.css) y sus clases de reparto.css. NUNCA rojo (encargo §5).
//
// Las acciones:
//   · «Pedirla al cliente»: lo que hay hoy (B68): llamar al cliente si la
//     plataforma dio teléfono; si no, el portal de la plataforma.
//   · «Cambiar a “la reparte X”»: escribe la celda marca × plataforma
//     (source manual) y recoloca ESTE pedido. Solo en la web con sesión de
//     encargado o administrador; en la tablet de cocina no sale (la base lo
//     rechazaría igual).
//   · «Despachar»: el botón de siempre, para un «propio» con dirección que no
//     ha salido.
import { useState } from 'react'
import { etiquetaDeReparto, plataformaCorta, type PedidoParaEtiqueta } from '../lib/etiqueta'
import { cambiarDesdePedido } from '../services/quienReparteService'
// Los colores salen del único sitio (tokens.css del estilo nuevo); se importa
// aquí porque la cocina puede no haber cargado el módulo de contabilidad.
import '@/modules/conta/estilo/tokens.css'
import '../reparto.css'

export interface EtiquetaRepartoProps {
  pedido: PedidoParaEtiqueta & { sale_id: string; customer_phone?: string | null }
  portal?: { url: string; nombre: string } | null
  /** Web con sesión (no la tablet): puede cambiar la celda desde aquí. */
  puedeDecidir?: boolean
  onDespachar?: () => void
  despachando?: boolean
  /** Tras cambiar quién reparte: refrescar el feed. */
  onCambiado?: () => void
  /** En la tarjeta del pedido va en una franja; en la pantalla de ajustes, suelta. */
  franja?: boolean
}

// Lo que acaba de pasar en cada pedido, unos segundos. Al cambiar a «la
// reparte X», el pedido se recarga y pasa a pintarse en OTRA rama de la
// tarjeta (la de plataforma), con otra etiqueta: el «Hecho» que vivía en la
// de antes se perdía, a veces antes de que nadie lo viera (regla 8; e2e
// 37216044758, 04/10: la celda se escribió y la pantalla no dijo nada).
const RECIENTES = new Map<string, { texto: string; hasta: number }>()
const DURA_MS = 20_000
function reciente(saleId: string): string | null {
  const r = RECIENTES.get(saleId)
  if (!r) return null
  if (r.hasta < Date.now()) { RECIENTES.delete(saleId); return null }
  return r.texto
}

export default function EtiquetaReparto({
  pedido, portal = null, puedeDecidir = false, onDespachar, despachando = false, onCambiado, franja = true,
}: EtiquetaRepartoProps) {
  const [cambiando, setCambiando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(() => reciente(pedido.sale_id))
  const [error, setError] = useState<string | null>(null)
  const e = etiquetaDeReparto(pedido)
  if (!e) return null
  const plataforma = plataformaCorta(pedido.channel)

  async function cambiar() {
    if (cambiando) return
    setCambiando(true); setError(null)
    try {
      await cambiarDesdePedido(pedido.sale_id, 'platform')
      const texto = `Hecho: a partir de ahora esta marca en ${plataforma} la reparte ${plataforma}. Este pedido ya no se despacha.`
      RECIENTES.set(pedido.sale_id, { texto, hasta: Date.now() + DURA_MS })
      setResultado(texto)
      onCambiado?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido cambiar.')
    } finally {
      setCambiando(false)
    }
  }

  const tel = (pedido.customer_phone ?? '').replace(/\s+/g, '')
  const acciones = e.acciones.filter(a => a !== 'cambiar_a_plataforma' || puedeDecidir)

  return (
    <div className={`cx-colores${franja ? ' cx-et-franja' : ''}`} data-testid="etiqueta-reparto" data-tono={e.tono}
      onClick={ev => ev.stopPropagation()}>
      <div className={`cx-et cx-et-${e.tono}`}>
        <span className="cx-et-pildora">{e.texto}</span>
        {e.detalle && <span className="cx-et-detalle">{e.detalle}</span>}
      </div>
      {acciones.length > 0 && !resultado && (
        <div className="cx-et-acciones" style={{ marginTop: 6 }}>
          {acciones.map((a, i) => {
            const sep = i > 0 ? <span aria-hidden="true"> · </span> : null
            if (a === 'pedir_direccion') {
              if (tel) return <span key={a}>{sep}<a href={`tel:${tel}`}>Pedirla al cliente</a></span>
              if (portal) return <span key={a}>{sep}<a href={portal.url} target="_blank" rel="noopener noreferrer">Pedirla al cliente (en {portal.nombre})</a></span>
              return null
            }
            if (a === 'cambiar_a_plataforma') {
              return <span key={a}>{sep}<button type="button" onClick={cambiar} disabled={cambiando}>
                {cambiando ? 'Cambiando…' : `Cambiar a «la reparte ${plataforma}»`}</button></span>
            }
            return <span key={a}>{sep}<button type="button" onClick={onDespachar} disabled={despachando || !onDespachar}>
              {despachando ? 'Despachando…' : 'Despachar'}</button></span>
          })}
        </div>
      )}
      <div role="status" aria-live="polite">
        {resultado && <div className="cx-et-resultado" style={{ marginTop: 6 }}>{resultado}</div>}
        {error && <div className="cx-et-error" style={{ marginTop: 6 }}>{error}</div>}
      </div>
    </div>
  )
}
