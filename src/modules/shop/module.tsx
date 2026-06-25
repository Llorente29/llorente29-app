// src/modules/shop/module.tsx
//
// ModuleDefinition del módulo Folvy Shop (canal directo del cliente).
// Sigue el patrón canónico de kitchen/module.tsx.
// Monta la capa de DISEÑO (Asistente de marca) y la de ENTREGA (zonas de
// reparto · Capa 1 del motor de envío). El resto (storefront público, checkout,
// pedidos→ingesta canónica) se enchufa después como submódulos, sin reescribir
// esta base.
import { Store, Palette, MapPin } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import ShopDesignPage from '@/modules/shop/pages/ShopDesignPage'
import ShopDeliveryPage from '@/modules/shop/pages/ShopDeliveryPage'

export const shopModule: ModuleDefinition = {
  id: 'shop',
  name: 'Folvy Shop',
  icon: Store,
  topBarOrder: 9,
  requiredRole: 'manager',
  basePath: 'shop',
  routes: [
    { path: '',        element: <ShopDesignPage /> },
    { path: 'diseno',  element: <ShopDesignPage /> },
    { path: 'entrega', element: <ShopDeliveryPage /> },
  ],
  sidebar: {
    items: [
      { id: 'shop_design',   label: 'Diseño',  icon: Palette, path: 'diseno',  requiredRole: 'manager' },
      { id: 'shop_delivery', label: 'Entrega', icon: MapPin,  path: 'entrega', requiredRole: 'manager' },
    ],
  },
  publishes: [],
}
