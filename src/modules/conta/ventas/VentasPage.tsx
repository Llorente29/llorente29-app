// src/modules/conta/ventas/VentasPage.tsx
//
// «Ventas» en el menú, como la maqueta (respuesta 1 del repaso de compras).
// Su pantalla todavía no existe: llega con el detalle diario de las
// plataformas (encargo «Plataformas»). Mientras tanto la entrada dice que aún
// no y dónde está hoy lo que hay de ventas —los asientos de cada día en el
// libro diario—, como las entradas de Ajustes que aún no tienen pantalla.

import { Link } from 'react-router-dom'
import { rutaLibroDiario } from '@/config/navegacion'
import { Cabecera, Vacio } from '@/modules/conta/ui/piezas'

export default function VentasPage() {
  return (
    <div className="cxc">
      <Cabecera antetitulo="Contabilidad" titulo="Ventas" />
      <div className="cx-tarjeta">
        <Vacio titulo="Aún no."
          explicacion="Lo que vendes cada día, plataforma a plataforma, llega con el detalle de las plataformas. Hoy las ventas ya se apuntan solas al cerrar cada día: están en el libro diario."
          accion={<Link to={rutaLibroDiario('ventas')} className="cx-enlace">Ver los asientos de ventas</Link>} />
      </div>
    </div>
  )
}
