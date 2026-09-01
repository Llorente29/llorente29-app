// src/shell/home/cards/homeMetricsContext.ts
//
// El contexto y su hook, SIN JSX y en fichero aparte del proveedor: mezclar
// componentes y no-componentes en el mismo módulo rompe el fast refresh (regla
// de react-refresh del repo). El proveedor vive en HomeMetricsProvider.tsx.

import { createContext, useContext } from 'react'
import type { HomeMetrics } from '../homeMetricsService'

export interface EstadoMetricas {
  metrics: HomeMetrics | null
  loading: boolean
}

export const HomeMetricsContext = createContext<EstadoMetricas>({ metrics: null, loading: true })

export function useHomeMetrics(): EstadoMetricas {
  return useContext(HomeMetricsContext)
}
