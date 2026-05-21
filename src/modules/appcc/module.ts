// src/modules/appcc/module.ts
//
// ModuleDefinition del módulo APPCC (Folvy Safety) — Bloque G-3, Sprint 3.
// Módulo PILOTO para validar el Module Contract del Shell.
//
// Referencia: folvy_arquitectura_reconciliada.md §5 (Module Contract) y §6
// (catálogo de módulos: APPCC = 'appcc' / display 'Folvy Safety').
//
// ALCANCE G-3: define identidad + sidebar del módulo y lo registra. Las
// `routes` se dejan VACÍAS a propósito: las rutas reales siguen viviendo en
// App.tsx hasta que el Shell tome el render (G-4/G-6). Rellenarlas ahora
// duplicaría el routing y generaría inconsistencia. Se cablean cuando el
// Shell renderice de verdad.
//
// Los paths de la sidebar son relativos al basePath 'appcc' y coinciden con
// el mapeo real de src/routes.ts (appcc, appcc/hoy, appcc/auditorias, etc.).

import {
  BarChart3, Leaf, AlertTriangle, ClipboardCheck, FolderOpen, FileText, Settings,
} from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'

export const appccModule: ModuleDefinition = {
  // Identidad
  id: 'appcc',
  name: 'Folvy Safety',
  icon: Leaf,
  topBarOrder: 2,

  // Gating
  requiredRole: 'manager',

  // Routing
  basePath: 'appcc',
  routes: [], // se cablean en G-4+ (ver nota de cabecera)

  // Navegación interna del módulo (ModuleSidebar).
  // path relativo al basePath 'appcc'. El Shell construirá la URL final
  // como /:slug/appcc/<path>.
  sidebar: {
    items: [
      { id: 'appcc_dashboard',       label: 'Dashboard',             icon: BarChart3,      path: '' },
      { id: 'appcc_today',           label: 'Hoy',                   icon: Leaf,           path: 'hoy' },
      { id: 'appcc_incidents',       label: 'Incidencias',           icon: AlertTriangle,  path: 'incidencias' },
      { id: 'appcc_audits',          label: 'Auditorías',            icon: ClipboardCheck, path: 'auditorias' },
      { id: 'appcc_audit_templates', label: 'Plantillas Auditoría',  icon: FolderOpen,     path: 'auditorias/plantillas', requiredRole: 'admin' },
      { id: 'appcc_reports',         label: 'Informes',              icon: FileText,       path: 'informes' },
      { id: 'appcc_templates',       label: 'Plantillas',            icon: FolderOpen,     path: 'plantillas' },
      { id: 'appcc_onboarding',      label: 'Configurar',            icon: Settings,       path: 'onboarding', requiredRole: 'admin' },
    ],
  },

  // Eventos que el módulo APPCC publicará (declarativo, sin emisores aún).
  publishes: [
    { key: 'appcc.incident.created', description: 'Se ha generado una incidencia APPCC' },
    { key: 'appcc.audit.completed',  description: 'Se ha completado una auditoría' },
  ],
}
