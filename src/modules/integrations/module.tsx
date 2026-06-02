// src/modules/integrations/module.tsx
//
// ModuleDefinition del módulo Folvy Connect (Integraciones / conectores).
// Sigue el patrón canónico de kitchen/module.tsx.
//
// El módulo es la cara visible del conector multi-fuente de Folvy: Last.app,
// Catcher, Glovo (integración directa) y futuros. Dos vistas:
//   - "Tus integraciones" (índice): las conexiones de la cuenta (account_connector).
//   - "Marketplace": el catálogo de conectores disponibles (connector).
//
// Gating: requiredRole 'manager' (las integraciones las gestiona admin/manager).

import { Cable, Plug, Store } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import IntegrationsPage from '@/modules/integrations/pages/IntegrationsPage'
import IntegrationsMarketplacePage from '@/modules/integrations/pages/IntegrationsMarketplacePage'

export const integrationsModule: ModuleDefinition = {
  // Identidad
  id: 'integrations',
  name: 'Folvy Connect',
  icon: Cable,
  topBarOrder: 5,
  // Gating
  requiredRole: 'manager',
  // Routing: paths relativos al basePath 'integraciones'.
  basePath: 'integraciones',
  routes: [
    { path: '',            element: <IntegrationsPage /> },
    { path: 'marketplace', element: <IntegrationsMarketplacePage /> },
  ],
  // Navegación interna del módulo (ModuleSidebar).
  sidebar: {
    items: [
      { id: 'integrations_yours',       label: 'Tus integraciones', icon: Plug,  path: '' },
      { id: 'integrations_marketplace', label: 'Marketplace',        icon: Store, path: 'marketplace' },
    ],
  },
}
