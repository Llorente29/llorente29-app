// src/modules/conta/marco/Portada.tsx
//
// A dónde lleva /conta (y una dirección del módulo que no existe). Con Folvy,
// a Ajustes, como siempre; en el producto vendido solo (C06), a su Inicio.

import { Navigate } from 'react-router-dom'
import { CONTA, rutaConta } from '@/config/navegacion'
import { useProductoSolo } from '@/modules/conta/cuenta/useProductoSolo'

export function Portada() {
  const solo = useProductoSolo()
  return <Navigate to={rutaConta(solo ? CONTA.rutas.inicio : CONTA.rutas.empresa)} replace />
}
