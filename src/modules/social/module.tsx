// src/modules/social/module.tsx
//
// ModuleDefinition de Folvy Social — el canal de contenido de la marca.
// El agente propone; el humano revisa, aprueba, publica y DIRIGE.
//
// Vistas:
//   Cola       (/social)            revisar y decidir (aprobar/editar/regenerar/descartar/publicar)
//   Parrilla   (/social/parrilla)   el feed real (publicados + programados)
//   Directivas (/social/directivas) empujar marca/plato · tematizar el día · post a medida
//   Ajustes    (/social/ajustes)    palanca de fase (apetito/comunidad/conversión)
//
// Gating: requiredRole 'manager'. basePath 'social'.

import { Megaphone, Inbox, LayoutGrid, Wand2, SlidersHorizontal } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import SocialQueuePage from '@/modules/social/pages/SocialQueuePage'
import SocialGridPage from '@/modules/social/pages/SocialGridPage'
import SocialDirectivesPage from '@/modules/social/pages/SocialDirectivesPage'
import SocialSettingsPage from '@/modules/social/pages/SocialSettingsPage'

export const socialModule: ModuleDefinition = {
  id: 'social',
  name: 'Folvy Social',
  icon: Megaphone,
  topBarOrder: 8,
  requiredRole: 'manager',
  basePath: 'social',
  routes: [
    { path: '', element: <SocialQueuePage /> },
    { path: 'parrilla', element: <SocialGridPage /> },
    { path: 'directivas', element: <SocialDirectivesPage /> },
    { path: 'ajustes', element: <SocialSettingsPage /> },
  ],
  sidebar: {
    items: [
      { id: 'social_queue', label: 'Cola', icon: Inbox, path: '' },
      { id: 'social_grid', label: 'Parrilla', icon: LayoutGrid, path: 'parrilla' },
      { id: 'social_directives', label: 'Directivas', icon: Wand2, path: 'directivas' },
      { id: 'social_settings', label: 'Ajustes', icon: SlidersHorizontal, path: 'ajustes' },
    ],
  },
}
