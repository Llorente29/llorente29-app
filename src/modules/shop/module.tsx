// src/modules/shop/module.tsx
//
// ModuleDefinition del módulo Folvy Shop (canal directo del cliente).
// Sigue el patrón canónico de kitchen/module.tsx.
// En este tramo solo monta la capa de DISEÑO (Asistente de marca). El resto
// (storefront público, checkout, pedidos→ingesta canónica) se enchufa después
// como submódulos, sin reescribir esta base.
import { Store, Palette } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import ShopDesignPage from '@/modules/shop/pages/ShopDesignPage'

export const shopModule: ModuleDefinition = {
  id: 'shop',
  name: 'Folvy Shop',
  icon: Store,
  topBarOrder: 9,
  requiredRole: 'manager',
  basePath: 'shop',
  routes: [
    { path: '',       element: <ShopDesignPage /> },
    { path: 'diseno', element: <ShopDesignPage /> },
  ],
  sidebar: {
    items: [
      { id: 'shop_design', label: 'Diseño', icon: Palette, path: 'diseno', requiredRole: 'manager' },
    ],
  },
  publishes: [],
}
