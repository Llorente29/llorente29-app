// src/modules/conta/nucleo/rutas.ts
//
// K03 · Las rutas de la contabilidad, para que el marco del núcleo pinte cada
// pestaña de trabajo con las suyas (useRoutes con la dirección de la pestaña).
// Las registra module.tsx al definirse: así el marco no importa module.tsx
// (que lo importa a él) y la lista es una sola, la de siempre.

import type { RouteObject } from 'react-router-dom'
import { CONTA } from '@/config/navegacion'
import type { ReactNode } from 'react'

let rutas: RouteObject[] = []

/** module.tsx: las rutas del módulo, relativas a él (como las declara el Shell). */
export function registrarRutasDelNucleo(lista: readonly { path?: string; element?: ReactNode }[]): void {
  rutas = lista.map((r) => ({
    path: r.path === '*' ? `/${CONTA.modulo}/*` : `/${CONTA.modulo}${r.path ? `/${r.path}` : ''}`,
    element: r.element,
  }))
}

export const rutasDelNucleo = (): RouteObject[] => rutas
