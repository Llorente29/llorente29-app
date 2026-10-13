// src/modules/conta/bancos/contexto.ts
//
// B01 · Lo que comparten las pestañas de Bancos: la empresa, el banco y el mes
// elegidos, lo leído arriba y cómo pedir que se vuelva a leer.

import { createContext, useContext } from 'react'
import type { BancoVista, DatosBancos } from '@/modules/conta/services/bancosPantallas'

export interface ContextoBancos {
  accountId: string
  companyId: string
  quien: string | null
  movil: boolean
  hoy: string
  datos: DatosBancos
  banco: BancoVista | null
  mes: string
  /** Elegir otro banco (se queda en la dirección: ?banco=). */
  elegirBanco: (id: string) => void
  /** Abre «Subir extracto» con este fichero (el gesto único: soltarlo en cualquier pantalla de Bancos). */
  subir: (f?: File) => void
  /** El fichero soltado que espera en «Subir extracto» (se toma una vez). */
  archivo: File | null
  tomarArchivo: () => File | null
  vuelta: number
  recargar: () => void
}

export const BancosCtx = createContext<ContextoBancos | null>(null)

export function useBancos(): ContextoBancos {
  const c = useContext(BancosCtx)
  if (!c) throw new Error('useBancos fuera de Bancos')
  return c
}
