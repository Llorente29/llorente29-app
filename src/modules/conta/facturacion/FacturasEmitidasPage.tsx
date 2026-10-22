// src/modules/conta/facturacion/FacturasEmitidasPage.tsx
//
// S02 · PR 2 · Facturación › Facturas emitidas (plantilla Lista). Pendiente de
// hacer en este PR: de momento, el encabezado y el principal.

import { Link } from 'react-router-dom'
import { rutaNuevaEmitida } from '@/config/navegacion'
import { EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'

export default function FacturasEmitidasPage() {
  return (
    <EncabezadoPagina titulo="Facturas emitidas" principal={<Link to={rutaNuevaEmitida()} className="s-boton s-boton-principal">Nueva factura emitida</Link>} />
  )
}
