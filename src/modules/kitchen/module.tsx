// src/modules/kitchen/module.tsx
//
// ModuleDefinition del módulo Folvy Kitchen (escandallo de cocina).
// Sigue el patrón canónico de appcc/module.tsx.
//
// V1 mínima: solo la página de Ingredientes (recipe_item type='raw').
// El resto del modelo (recetas, sub-recetas, platos, conversiones,
// settings, plantillas) llegará en sesiones siguientes.

import { ChefHat } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'

import KitchenItemsPage from '@/modules/kitchen/pages/KitchenItemsPage'

export const kitchenModule: ModuleDefinition = {
  // Identidad
  id: 'kitchen',
  name: 'Folvy Kitchen',
  icon: ChefHat,
  topBarOrder: 4,

  // Gating
  requiredRole: 'manager',

  // Routing: paths relativos al basePath 'kitchen' — el Shell las monta
  // bajo /:slug/kitchen/<path>.
  basePath: 'kitchen',
  routes: [
    { path: '', element: <KitchenItemsPage /> },
  ],

  // Navegación interna del módulo (ModuleSidebar).
  sidebar: {
    items: [
      { id: 'kitchen_items', label: 'Ingredientes', icon: ChefHat, path: '' },
    ],
  },

  // Eventos que el módulo publica (declarativo, sin emisores cableados aún).
  publishes: [
    { key: 'kitchen.item.recomputed', description: 'Se ha recalculado el coste de un item de cocina' },
  ],
}
