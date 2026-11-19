// src/modules/conta/nucleo/asiento/LibroDelDiarioSegun.tsx
//
// N10 · Las dos direcciones de Libros que viven bajo libros/diario/ y no son asientos:
// libros/diario/libro-diario y libros/diario/diario-resumido (las de «Libros › Diario» por su
// área y su acción). La ruta del asiento (libros/diario/:entryId) gana a la de Libros
// (libros/:area/:accion) y las pintaba como un asiento que no existe, en la pestaña «Asiento».
// Con `conta_nucleo` encendido y en el ordenador, llevan a su pantalla: el Libro diario
// (libros/diario) y el Diario resumido (libros/diario/resumido). Apagado, o en el móvil, lo de
// hoy, tal cual (la misma regla que el marco, cualMarco).

import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useIsMobile } from '@/shell/useIsMobile'
import { rutaConta } from '@/config/navegacion'
import { cualMarco, useNucleoEncendido } from '@/modules/conta/nucleo/interruptor'

export function LibroDelDiarioSegun({ a, hoy }: { a: string; hoy: ReactNode }) {
  const movil = useIsMobile()
  const encendido = useNucleoEncendido()
  const { search } = useLocation()
  if (encendido === null) return null
  if (cualMarco({ encendido, movil }) !== 'nucleo') return <>{hoy}</>
  return <Navigate to={`${rutaConta(a)}${search}`} replace />
}
