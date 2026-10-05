// src/modules/conta/plan/AlMayor.tsx
//
// La dirección vieja de una cuenta del plan (ajustes/plan/cuenta/:codigo) lleva
// a su Mayor (respuesta 5 del C02): los enlaces guardados siguen funcionando.

import { Navigate, useParams } from 'react-router-dom'
import { rutaMayor } from '@/config/navegacion'

export default function AlMayor() {
  const { codigo = '' } = useParams()
  return <Navigate to={rutaMayor(codigo)} replace />
}
