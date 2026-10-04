// src/modules/conta/proveedor/contexto.ts
//
// Lo que comparten todas las pantallas de una ficha: los datos cargados, cómo
// guardar, quién es la persona y cómo ir a un apartado (o a un campo concreto,
// que es adonde llevan los enlaces de «Falta: …»).

import { createContext, useContext } from 'react'
import type { UsoFicha, DatosFicha } from '@/modules/conta/hooks/useFichaProveedor'
import type { ExtensionesProveedor } from '@/modules/conta/extensiones'
import type { Apartado } from '@/modules/conta/lib/resumenFicha'

export interface ContextoFicha extends UsoFicha {
  datos: DatosFicha
  actor: { id: string | null; name: string | null }
  movil: boolean
  extensiones: ExtensionesProveedor
  /** Ruta de un apartado; con `campo`, lleva el ancla del campo. */
  rutaApartado: (ap: Apartado, campo?: string) => string
}

export const FichaContext = createContext<ContextoFicha | null>(null)

export function useFicha(): ContextoFicha {
  const c = useContext(FichaContext)
  if (!c) throw new Error('useFicha fuera de una ficha de proveedor')
  return c
}
