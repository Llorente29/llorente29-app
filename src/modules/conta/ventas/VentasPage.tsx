// src/modules/conta/ventas/VentasPage.tsx
//
// «Ventas» en el menú, como la maqueta (respuesta 1 del repaso de compras).
// Su pantalla todavía no existe: llega con el detalle diario de las
// plataformas (encargo «Plataformas»). Mientras tanto la entrada dice que aún
// no y dónde está hoy lo que hay de ventas —los asientos de cada día en el
// libro diario—, como las entradas de Ajustes que aún no tienen pantalla.
//
// N2 (24/10): con hostelería, arriba, «Lo que deja el cierre del día» (C11b).
//
// S01: sin hostelería no hay plataformas ni cierre del día: las ventas llegarán
// con Facturación, y hoy una factura emitida se apunta a mano («Expedida»).

import { Link } from 'react-router-dom'
import { rutaLibroDiario, rutaNuevoAsiento } from '@/config/navegacion'
import { useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
import { Cabecera, Vacio } from '@/modules/conta/ui/piezas'
import { LoQueDejaElCierre } from './LoQueDejaElCierre'

export default function VentasPage() {
  const hosteleria = useHosteleria()
  return (
    <div className="cxc">
      <Cabecera antetitulo="Contabilidad" titulo="Ventas" />
      {/* N2 · Lo que deja el cierre del día (C11b): la cola, con la acción de cada pedido. */}
      {hosteleria && <LoQueDejaElCierre />}
      <div className="cx-tarjeta">
        {hosteleria
          ? <Vacio titulo="Aún no."
              explicacion="Lo que vendes cada día, plataforma a plataforma, llega con el detalle de las plataformas. Hoy las ventas ya se apuntan solas al cerrar cada día: están en el libro diario."
              accion={<Link to={rutaLibroDiario('ventas')} className="cx-enlace">Ver los asientos de ventas</Link>} />
          : <Vacio titulo="Aún no."
              explicacion="Tus ventas llegan con Facturación: cada factura que emitas, con su asiento. Mientras, una factura emitida se apunta a mano."
              accion={<Link to={`${rutaNuevoAsiento()}?tipo=expedida`} className="cx-enlace">Apuntar una factura expedida</Link>} />}
      </div>
    </div>
  )
}
