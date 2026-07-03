// src/modules/shop/module.tsx
//
// ModuleDefinition del módulo Folvy Shop (canal directo del cliente).
// Sigue el patrón canónico de kitchen/module.tsx.
// Monta la capa de DISEÑO (Asistente de marca) y la de ENTREGA (zonas de
// reparto · Capa 1 del motor de envío). El resto (storefront público, checkout,
// pedidos→ingesta canónica) se enchufa después como submódulos, sin reescribir
// esta base.
import { Store, Palette, MapPin, Megaphone, Home } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import ShopHomePage from '@/modules/shop/pages/ShopHomePage'
import ShopDesignPage from '@/modules/shop/pages/ShopDesignPage'
import ShopDeliveryPage from '@/modules/shop/pages/ShopDeliveryPage'
import ShopCampaignsPage from '@/modules/shop/admin/ShopCampaignsPage'

export const shopModule: ModuleDefinition = {
  id: 'shop',
  name: 'Folvy Shop',
  icon: Store,
  topBarOrder: 9,
  requiredRole: 'manager',
  basePath: 'shop',
  routes: [
    // G2e.4: el módulo abre en INICIO (dashboard de mando). Secciones detrás.
    { path: '',         element: <ShopHomePage /> },
    { path: 'inicio',   element: <ShopHomePage /> },
    { path: 'diseno',   element: <ShopDesignPage /> },
    { path: 'campanas', element: <ShopCampaignsPage /> },
    { path: 'entrega',  element: <ShopDeliveryPage /> },
  ],
  sidebar: {
    items: [
      { id: 'shop_home',      label: 'Inicio',   icon: Home,      path: 'inicio',   requiredRole: 'manager' },
      { id: 'shop_design',    label: 'Diseño',   icon: Palette,   path: 'diseno',   requiredRole: 'manager' },
      { id: 'shop_campaigns', label: 'Campañas', icon: Megaphone, path: 'campanas', requiredRole: 'manager' },
      { id: 'shop_delivery',  label: 'Entrega',  icon: MapPin,    path: 'entrega',  requiredRole: 'manager' },
    ],
  },
  publishes: [],
}
