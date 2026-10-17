// src/modules/reparto/components/EtiquetaReparto.tsx
//
// R02 · La etiqueta de reparto de un pedido. Pieza del estilo nuevo dentro de
// la tarjeta vieja del pedido: lleva `.cx-colores` (solo los colores de
// tokens.css) y sus clases de reparto.css. NUNCA rojo (encargo §5).
//
// Una sola acción: «Despachar», el botón de siempre, para un «propio» que no
// ha salido. R03 (Julio, 16/10): fuera «Pedirla al cliente» y «Cambiar a “la
// reparte X”». Un pedido sin dirección completa sale a Catcher como cualquier
// otro (lo dice la línea informativa de la tarjeta), y pasar una marca a
// «Plataforma» porque lleguen pedidos sin dirección no puede existir.
import { etiquetaDeReparto, type PedidoParaEtiqueta } from '../lib/etiqueta'
// Los colores salen del único sitio (tokens.css del estilo nuevo); se importa
// aquí porque la cocina puede no haber cargado el módulo de contabilidad.
import '@/modules/conta/estilo/tokens.css'
import '../reparto.css'

export interface EtiquetaRepartoProps {
  pedido: PedidoParaEtiqueta & { sale_id: string }
  onDespachar?: () => void
  despachando?: boolean
  /** En la tarjeta del pedido va en una franja; en la pantalla de ajustes, suelta. */
  franja?: boolean
}

export default function EtiquetaReparto({ pedido, onDespachar, despachando = false, franja = true }: EtiquetaRepartoProps) {
  const e = etiquetaDeReparto(pedido)
  if (!e) return null

  return (
    <div className={`cx-colores${franja ? ' cx-et-franja' : ''}`} data-testid="etiqueta-reparto" data-tono={e.tono}
      onClick={ev => ev.stopPropagation()}>
      <div className={`cx-et cx-et-${e.tono}`}>
        <span className="cx-et-pildora">{e.texto}</span>
        {e.detalle && <span className="cx-et-detalle">{e.detalle}</span>}
      </div>
      {e.acciones.length > 0 && (
        <div className="cx-et-acciones" style={{ marginTop: 6 }}>
          <button type="button" onClick={onDespachar} disabled={despachando || !onDespachar}>
            {despachando ? 'Despachando…' : 'Despachar'}
          </button>
        </div>
      )}
    </div>
  )
}
