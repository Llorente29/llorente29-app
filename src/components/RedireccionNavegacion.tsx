// src/components/RedireccionNavegacion.tsx
//
// La ruta vieja que redirige a la nueva cuando una dirección cambia. Las
// redirecciones se declaran en src/config/navegacion.ts (REDIRECCIONES) y cada
// módulo monta las suyas con `redireccionesDelModulo(basePath)`. `replace`:
// el enlace viejo no se queda en el historial.

import { Navigate, useLocation, useParams } from 'react-router-dom'
import { resolverRedireccion } from '@/config/navegacion'

export default function RedireccionNavegacion({ hasta }: { hasta: string }) {
  const params = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={`${resolverRedireccion(hasta, params)}${search}${hash}`} replace />
}
