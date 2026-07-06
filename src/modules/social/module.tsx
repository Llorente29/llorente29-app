// src/modules/social/module.tsx
//
// ModuleDefinition de Folvy Social — el canal de contenido de la marca.
// El agente propone borradores y aquí el humano los revisa, aprueba y publica;
// además dirige (empujar/tematizar/a medida) y marca la fase del lanzamiento.
//
// Vistas:
//   Cola     (/social)          revisar y decidir (aprobar/editar/regenerar/descartar/publicar)
//   Parrilla (/social/parrilla) el feed real (publicados + programados)
//   Ajustes  (/social/ajustes)  palanca de fase (apetito/comunidad/conversión)
// (Directivas se añade como item en su pieza.)
//
// Gating: requiredRole 'manager'. basePath 'social'.

import { Megaphone, Inbox, LayoutGrid, SlidersHorizontal } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import SocialQueuePage from '@/modules/social/pages/SocialQueuePage'
import SocialGridPage from '@/modules/social/pages/SocialGridPage'
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
    { path: 'ajustes', element: <SocialSettingsPage /> },
  ],
  sidebar: {
    items: [
      { id: 'social_queue', label: 'Cola', icon: Inbox, path: '' },
      { id: 'social_grid', label: 'Parrilla', icon: LayoutGrid, path: 'parrilla' },
      { id: 'social_settings', label: 'Ajustes', icon: SlidersHorizontal, path: 'ajustes' },
    ],
  },
}
