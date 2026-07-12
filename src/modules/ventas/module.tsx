// src/modules/ventas/module.tsx
//
// ModuleDefinition del modulo Ventas (Folvy Sales).
// Añadida la pagina "Economia / Margenes" (EconomiaPlataformasPage), que lee la
// economia real de plataforma (channel_settlement + channel_settlement_order) via
// la RPC channel_economics_dashboard. Convive con el Resumen de ventas (que lee `sale`).

import { BarChart3, LineChart, Bike, Wallet, Percent, UtensilsCrossed, Target } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'

import VentasDashboardPage from '@/pages/VentasDashboardPage'
import VentasAnalisisPage from '@/pages/VentasAnalisisPage'
import EconomiaPlataformasPage from '@/pages/EconomiaPlataformasPage'
import MargenFinalPage from '@/pages/MargenFinalPage'
import TarifasCanalPage from '@/pages/TarifasCanalPage'
import MargenPlatoPage from '@/pages/MargenPlatoPage'
import PrediccionPersonalPage from '@/pages/PrediccionPersonalPage'
import ZonasPedidoPage from '@/pages/ZonasPedidoPage'

export const ventasModule: ModuleDefinition = {
  id: 'ventas',
  name: 'Folvy Sales',
  icon: BarChart3,
  topBarOrder: 3,
  requiredRole: 'manager',

  basePath: 'ventas',
  routes: [
    { path: '',           element: <VentasDashboardPage /> },
    { path: 'economia',    element: <EconomiaPlataformasPage /> },
    { path: 'margen-final', element: <MargenFinalPage /> },
    { path: 'margen',      element: <MargenPlatoPage /> },
    { path: 'tarifas',     element: <TarifasCanalPage /> },
    { path: 'analisis',   element: <VentasAnalisisPage /> },
    { path: 'prediccion', element: <PrediccionPersonalPage /> },
    { path: 'zonas',      element: <ZonasPedidoPage /> },
  ],

  sidebar: {
    items: [
      { id: 'ventas_dashboard',  label: 'Resumen de ventas',   icon: BarChart3, path: '',         requiredPermission: 'show_ventas_analisis' },
      { id: 'ventas_economia',   label: 'Economia / Margenes', icon: Wallet,           path: 'economia',     requiredPermission: 'show_ventas_analisis' },
      { id: 'ventas_margenfin',  label: 'Margen final',        icon: Target,           path: 'margen-final', requiredPermission: 'show_ventas_analisis' },
      { id: 'ventas_margen',     label: 'Food cost / Plato',   icon: UtensilsCrossed,  path: 'margen',       requiredPermission: 'show_ventas_analisis' },
      { id: 'ventas_tarifas',    label: 'Tarifas de canal',    icon: Percent,          path: 'tarifas',  requiredPermission: 'show_ventas_analisis' },
      { id: 'ventas_analisis',   label: 'Analisis (heredado)', icon: LineChart, path: 'analisis', requiredPermission: 'show_ventas_analisis' },
      { id: 'ventas_zonas',      label: 'Zonas de pedido',     icon: Bike,      path: 'zonas',    requiredPermission: 'show_zonas_pedido' },
    ],
  },

  publishes: [
    { key: 'ventas.sale.imported', description: 'Se han importado ventas de un TPV' },
  ],
}
