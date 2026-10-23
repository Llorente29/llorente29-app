// src/modules/conta/documentos/LlevarACompras.tsx
//
// S02 · PR 2 · Las facturas recibidas son de Compras y gastos (regla 1 del
// patrón: cada cosa en un sitio). Las direcciones de antes, desde Contabilidad ›
// Asientos (libros/diario/recibidas…), llevan a su sitio, con lo que traían:
//   · …/recibidas?nueva=a-mano  → Compras › Escribir una a mano;
//   · …/recibidas               → Facturas recibidas, «Por revisar»;
//   · …/recibidas/<id>?…        → la ficha de esa factura, con su consulta.

import { Navigate, useLocation, useParams } from 'react-router-dom'
import { CONSULTA_RECIBIDA_A_MANO, rutaRecibidaAMano, rutaRecibidaEnAsientos, rutaRevisarFactura } from '@/config/navegacion'

export default function LlevarACompras() {
  const { invoiceId } = useParams()
  const { search } = useLocation()
  if (invoiceId) return <Navigate replace to={`${rutaRevisarFactura(invoiceId)}${search}`} />
  // Con otros parámetros detrás (la marca, un origen…) sigue siendo «a mano».
  const [clave, valor] = CONSULTA_RECIBIDA_A_MANO.split('=')
  if (new URLSearchParams(search).get(clave) === valor) return <Navigate replace to={rutaRecibidaAMano()} />
  return <Navigate replace to={rutaRecibidaEnAsientos()} />
}
