// src/modules/conta/ventas/LlevarAVentas.tsx
//
// V01 · Lo de antes (Facturación › Facturas emitidas y «Nueva factura
// emitida») lleva a Ventas › Facturas, con sus filtros: un enlace guardado o
// un favorito siguen sirviendo.

import { Navigate, useLocation } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'

export default function LlevarAVentas({ a }: { a: string }) {
  const { search } = useLocation()
  return <Navigate to={`${rutaConta(a)}${search}`} replace />
}
