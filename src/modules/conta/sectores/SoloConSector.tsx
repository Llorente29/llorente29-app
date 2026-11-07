// src/modules/conta/sectores/SoloConSector.tsx
//
// G03 · La puerta de las pantallas de un sector en su propia dirección (Julio,
// 07/11): Clientes y cuotas y Tarifa y paquetes solo se abren en una empresa
// del sector Gestoría. Sin él, la pantalla no se pinta y se dice por qué y
// dónde se cambia (regla 8: nada en blanco sin explicación). Solo la puerta:
// la pantalla de dentro no cambia.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { rutaTuEmpresa } from '@/config/navegacion'
import { useGestoria } from '@/modules/conta/marco/nuevo/contexto'
import { TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'

export const AVISO_GESTORIA = 'Esto sale en las empresas del sector Gestoría. Puedes cambiar el sector en Ajustes › Tu empresa.'

export function SoloGestoria({ children }: { children: ReactNode }) {
  const gestoria = useGestoria()
  if (gestoria === null) return <TarjetaCargando />
  if (!gestoria) {
    return <Vacio titulo="Esta empresa no es del sector Gestoría." explicacion={AVISO_GESTORIA}
      accion={<Link className="cx-boton-sec" to={rutaTuEmpresa()}>Ir a Ajustes › Tu empresa</Link>} />
  }
  return <>{children}</>
}
