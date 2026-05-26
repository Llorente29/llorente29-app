// src/modules/appcc/module.tsx
//
// ModuleDefinition del módulo APPCC (Folvy Safety) — Bloque G-3 + G-8.2.
// Módulo PILOTO para validar el Module Contract del Shell.
//
// Referencia: folvy_arquitectura_reconciliada.md §5 (Module Contract) y §6
// (catálogo de módulos: APPCC = 'appcc' / display 'Folvy Safety').
//
// G-3: identidad + sidebar.
// G-8.2: `routes` cableadas con las páginas REALES (RouteObject[]). El Shell
// las monta en su área de contenido vía <Routes> anidado. Los paths son
// relativos al basePath 'appcc' y coinciden con src/routes.ts. Incluye rutas
// con parámetro (exec/:executionId, exec/:auditId).
//
// Fichero .tsx (no .ts) porque los `element` de las rutas son JSX.

import {
  BarChart3, Leaf, AlertTriangle, ClipboardCheck, FolderOpen, FileText, Settings,
} from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'

import AppccDashboardPage from '@/modules/appcc/pages/AppccDashboardPage'
import TodayPage from '@/modules/appcc/pages/TodayPage'
import ExecutionPage from '@/modules/appcc/pages/ExecutionPage'
import IncidentsPage from '@/modules/appcc/pages/IncidentsPage'
import OnboardingPage from '@/modules/appcc/pages/OnboardingPage'
import ReportsPage from '@/modules/appcc/pages/ReportsPage'
import TemplateEditorPage from '@/modules/appcc/pages/TemplateEditorPage'
import AuditsPage from '@/modules/appcc/audits/AuditsPage'
import AuditExecutionPage from '@/modules/appcc/audits/AuditExecutionPage'
import AuditTemplateEditorPage from '@/modules/appcc/audits/AuditTemplateEditorPage'

export const appccModule: ModuleDefinition = {
  // Identidad
  id: 'appcc',
  name: 'Folvy Safety',
  icon: Leaf,
  topBarOrder: 2,

  // Gating
  requiredRole: 'manager',

  // Routing: rutas reales del módulo (G-8.2). Paths RELATIVOS al basePath
  // 'appcc' — el Shell las monta bajo /shell/appcc/<path>. Coinciden con los
  // paths del sidebar y con src/routes.ts.
  basePath: 'appcc',
  routes: [
    { path: '',                      element: <AppccDashboardPage /> },
    { path: 'hoy',                   element: <TodayPage /> },
    { path: 'hoy/exec/:executionId', element: <ExecutionPage /> },
    { path: 'incidencias',           element: <IncidentsPage /> },
    { path: 'auditorias',            element: <AuditsPage /> },
    { path: 'auditorias/plantillas', element: <AuditTemplateEditorPage /> },
    { path: 'auditorias/exec/:auditId', element: <AuditExecutionPage /> },
    { path: 'informes',              element: <ReportsPage /> },
    { path: 'plantillas',            element: <TemplateEditorPage /> },
    { path: 'onboarding',            element: <OnboardingPage /> },
  ],

  // Navegación interna del módulo (ModuleSidebar).
  // path relativo al basePath 'appcc'. El Shell construirá la URL final
  // como /:slug/appcc/<path>.
  sidebar: {
    items: [
      { id: 'appcc_dashboard',       label: 'Dashboard',             icon: BarChart3,      path: '',                       requiredPermission: 'show_dashboard' },
      { id: 'appcc_today',           label: 'Hoy',                   icon: Leaf,           path: 'hoy',                    requiredPermission: 'show_appcc_today' },
      { id: 'appcc_incidents',       label: 'Incidencias',           icon: AlertTriangle,  path: 'incidencias',            requiredPermission: 'show_appcc_incidents' },
      { id: 'appcc_audits',          label: 'Auditorías',            icon: ClipboardCheck, path: 'auditorias',             requiredRole: 'admin' },
      { id: 'appcc_audit_templates', label: 'Plantillas Auditoría',  icon: FolderOpen,     path: 'auditorias/plantillas',  requiredRole: 'admin' },
      { id: 'appcc_reports',         label: 'Informes',              icon: FileText,       path: 'informes',               requiredRole: 'admin' },
      { id: 'appcc_templates',       label: 'Plantillas',            icon: FolderOpen,     path: 'plantillas',             requiredRole: 'admin' },
      { id: 'appcc_onboarding',      label: 'Configurar',            icon: Settings,       path: 'onboarding',             requiredRole: 'admin' },
    ],
  },

  // Eventos que el módulo APPCC publicará (declarativo, sin emisores aún).
  publishes: [
    { key: 'appcc.incident.created', description: 'Se ha generado una incidencia APPCC' },
    { key: 'appcc.audit.completed',  description: 'Se ha completado una auditoría' },
  ],
}
