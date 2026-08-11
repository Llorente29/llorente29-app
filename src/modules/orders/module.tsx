// src/modules/orders/module.tsx
//
// ModuleDefinition de Folvy Orders — el centro de mando del pedido (delivery y,
// más adelante, sala). UN módulo, cuatro vistas de la MISMA realidad (el pedido):
//   - Pedidos   (/orders)          feed operativo: ver/marcar/aceptar/rechazar (A1)
//   - Despacho  (/orders/despacho) board del dispatcher: entregas en vivo + acción
//   - Cocina    (/orders/cocina)   el tablero KDS (KdsBoardPage) — ruta viva, SIN
//                                   entrada de menú desde el 11/08 (ver más abajo)
//   - Ajustes   (/orders/ajustes)  auto-aceptación + estaciones/ruteo/dispositivos
//
// FUSIÓN (19/06): Orders y KDS eran dos botones del TopBar para la misma cosa.
// Se funden aquí (un botón). El KDS NO se mueve de carpeta: su board, componentes,
// servicio y kiosco siguen en src/modules/kds/. El kiosco /cocina-tv (App.tsx) NO se toca.
//
// OCULTA (11/08, fix/limpieza-kds-viejo-y-prevencion): kds_board registró 2
// llamadas en 6h+ con las 3 tablets vivas (frente a 6.568 de orders_feed_by_token)
// — Julio confirma que este tablero (kds_board, filtra por "no bumpeado en Pase",
// no por order_status) es el KDS viejo, sustituido por el feed de Orders. Se
// retira SOLO la entrada de la sidebar: la ruta 'cocina'→KdsBoardPage sigue
// registrada más abajo (nadie llega por navegación, pero no se borra nada:
// ni la ruta, ni KdsBoardPage, ni KdsBoard, ni kds_board). Sin entrada de menú
// y sin nadie navegando a /orders/cocina, KdsBoard no monta y su polling +
// suscripción Realtime (canal kds-board-*) dejan de generar tráfico — no hay
// nada que desmontar aparte del propio componente.
//
// RECON: KdsBoard también se usa en otros 2 sitios, NINGUNO tocado aquí (fuera
// del alcance de esta tarea, ver parte de vuelta): la pestaña "Cocina" dentro
// de TabletStationRoute.tsx (/estacion, la app de tablet EN USO — pestaña
// visible, no oculta) y el kiosco /cocina-tv (KdsKioskRoute.tsx, ya excluido
// por decisión de proyecto anterior).
//
// El FEED de pedidos (OrdersFeedPage) ya es la raíz '/orders' (lente "por pedido").
//
// Gating: requiredRole 'manager' (operar pedidos / cocina = encargado).
// Ruta propia 'orders' (cuidado con el secuestro de prefijo, como /kds→/cocina-tv).

import { ClipboardList, ListOrdered, SlidersHorizontal, Bike, Clock } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import OrdersFeedPage from '@/modules/orders/pages/OrdersFeedPage'
import DispatchBoardPage from '@/modules/orders/pages/DispatchBoardPage'
import KdsBoardPage from '@/modules/kds/pages/KdsBoardPage'
import OrdersSettingsPage from '@/modules/orders/pages/OrdersSettingsPage'
import KitchenTimesPanelPage from '@/modules/orders/pages/KitchenTimesPanelPage'

export const ordersModule: ModuleDefinition = {
  // Identidad
  id: 'orders',
  name: 'Folvy Orders',
  icon: ClipboardList,
  topBarOrder: 7, // ocupa el hueco del KDS (que desaparece como módulo propio)
  // Gating
  requiredRole: 'manager',
  // Routing: paths relativos al basePath 'orders'.
  basePath: 'orders',
  routes: [
    { path: '',         element: <OrdersFeedPage /> },   // ← el feed de pedidos (lente por pedido)
    { path: 'despacho', element: <DispatchBoardPage /> },
    { path: 'cocina',   element: <KdsBoardPage /> },
    { path: 'tiempos',  element: <KitchenTimesPanelPage /> },
    { path: 'ajustes',  element: <OrdersSettingsPage /> },
  ],
  // Navegación interna del módulo (ModuleSidebar).
  sidebar: {
    items: [
      { id: 'orders_feed',     label: 'Pedidos',  icon: ListOrdered,       path: '' },
      { id: 'orders_dispatch', label: 'Despacho', icon: Bike,              path: 'despacho' },
      // 'orders_kitchen' (Cocina, KdsBoardPage) oculta 11/08 — KDS viejo sin uso,
      // ver nota de cabecera. Ruta 'cocina' sigue viva más abajo, sin borrar nada;
      // reactivar es descomentar esta línea.
      // { id: 'orders_kitchen',  label: 'Cocina',   icon: MonitorPlay,       path: 'cocina' },
      { id: 'orders_tiempos',  label: 'Tiempos',  icon: Clock,             path: 'tiempos', requiredRole: 'manager' },
      { id: 'orders_settings', label: 'Ajustes',  icon: SlidersHorizontal, path: 'ajustes', requiredRole: 'manager' },
    ],
  },
}
