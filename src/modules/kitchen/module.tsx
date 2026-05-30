// src/modules/kitchen/module.tsx
//
// ModuleDefinition del módulo Folvy Kitchen (escandallo de cocina).
// Sigue el patrón canónico de appcc/module.tsx.
//
// V1 mínima: solo la página de Ingredientes (recipe_item type='raw').
// El resto del modelo (recetas, sub-recetas, platos, conversiones,
// settings, plantillas) llegará en sesiones siguientes.
import { ChefHat, BookOpen, TrendingUp, Target } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import KitchenItemsPage from '@/modules/kitchen/pages/KitchenItemsPage'
// KitchenRecipePage (lienzo viejo) → reemplazado por RecipeEditorPage (rediseño V1).
// El editor ahora se monta DENTRO de KitchenRecipesPage (lista + detalle por
// estado), que es lo que cuelga de la ruta 'recetas'. KitchenRecipePage se
// conserva en disco por si hay que revertir; import desactivado.
// import KitchenRecipePage from '@/modules/kitchen/pages/KitchenRecipePage'
import KitchenRecipesPage from '@/modules/kitchen/pages/KitchenRecipesPage'
import KitchenProfitabilityPage from '@/modules/kitchen/pages/KitchenProfitabilityPage'
import KitchenMenuEngineeringPage from '@/modules/kitchen/pages/KitchenMenuEngineeringPage'
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
    { path: '',                  element: <KitchenItemsPage /> },
    { path: 'recetas',           element: <KitchenRecipesPage /> },
    { path: 'rentabilidad',      element: <KitchenProfitabilityPage /> },
    { path: 'ingenieria-menus',  element: <KitchenMenuEngineeringPage /> },
  ],
  // Navegación interna del módulo (ModuleSidebar).
  sidebar: {
    items: [
      { id: 'kitchen_items',         label: 'Ingredientes',        icon: ChefHat,    path: '' },
      { id: 'kitchen_recipes',       label: 'Recetas',             icon: BookOpen,   path: 'recetas',          requiredRole: 'manager' },
      { id: 'kitchen_profitability', label: 'Rentabilidad',        icon: TrendingUp, path: 'rentabilidad',     requiredRole: 'manager' },
      { id: 'kitchen_menu_eng',      label: 'Ingeniería de menús', icon: Target,     path: 'ingenieria-menus', requiredRole: 'manager' },
    ],
  },
  // Eventos que el módulo publica (declarativo, sin emisores cableados aún).
  publishes: [
    { key: 'kitchen.item.recomputed', description: 'Se ha recalculado el coste de un item de cocina' },
  ],
}
