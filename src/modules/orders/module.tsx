// src/modules/orders/module.tsx
//
// ModuleDefinition de Folvy Orders — el centro de mando de pedidos de delivery.
// Hermano operativo del KDS: misma verdad (el pedido), distinta lente. El KDS es
// el tablero de COCINA (por estación); Orders es el tablero de OPERACIÓN del
// pedido (feed + ciclo de vida + ajustes de la superficie de pedidos).
//
// Benchmark (Toast Orders Hub / Otter Order Manager / Deliverect): la operación
// del pedido vive en su propio módulo, y sus AJUSTES (auto-aceptación, tiempos,
// sonidos, throttling…) en una zona de ajustes propia que CRECE — separada del
// tablero en vivo, pero dentro del mundo "pedidos", no en integraciones.
//
// ESTE TRAMO (19/06): solo la zona de Ajustes con la sección "Auto-aceptación".
// El FEED en vivo (aceptar/rechazar/listo/ajustar hora) aterriza en el siguiente
// tramo COMO RUTA PROPIA de este mismo módulo, sin mover nada.
//
// Gating: requiredRole 'manager' (operar pedidos = encargado), igual que KDS.
// Ruta propia 'orders' (cuidado con el secuestro de prefijo que pasó con /kds).

import { ClipboardList, SlidersHorizontal } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import OrdersSettingsPage from '@/modules/orders/pages/OrdersSettingsPage'

export const ordersModule: ModuleDefinition = {
  // Identidad
  id: 'orders',
  name: 'Folvy Orders',
  icon: ClipboardList,
  topBarOrder: 8, // junto al KDS (operación de servicio), justo después de él (KDS=7)
  // Gating
  requiredRole: 'manager',
  // Routing: paths relativos al basePath 'orders'.
  basePath: 'orders',
  routes: [
    // El feed en vivo ocupará la raíz '' en el siguiente tramo.
    // Hoy la raíz redirige a ajustes (única vista disponible).
    { path: '',         element: <OrdersSettingsPage /> },
    { path: 'ajustes',  element: <OrdersSettingsPage /> },
  ],
  // Navegación interna del módulo (ModuleSidebar).
  sidebar: {
    items: [
      { id: 'orders_settings', label: 'Ajustes', icon: SlidersHorizontal, path: 'ajustes' },
    ],
  },
}
