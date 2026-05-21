// src/routes.ts
//
// Mapeo entre el tipo `Page` (estado interno legacy) y las rutas URL del
// sistema multi-tenant.
//
// BLOQUE C completo (17/05/2026):
//   - Fase 1: helpers de slug de cuenta.
//   - Fase 2-3: mapeo Page↔path completo + helpers de conversión.
//
// CONTRATO:
//   URL completa = /{basename}/{slug}/{pageRest}
//   Donde:
//     - basename: SIN basename (eliminado en Bloque K Sprint 3, 20/05/2026).
//     - slug: identifica la cuenta activa (e.g. 'llorente29', 'Folvy').
//     - pageRest: identifica la página interna (e.g. 'dashboard', 'appcc/hoy').
//
// EXCEPCIÓN: RUTAS DE AUTH PÚBLICAS (D-S2.30 Sesión 9, 20/05/2026):
//   Las pantallas pre-sesión y de gestión de password viven FUERA del
//   namespace por cuenta. Su URL NO tiene slug delante. Ejemplos:
//     - /login                       (pre-sesión: introducir credenciales)
//     - /welcome                     (post-invite: activar cuenta)
//     - /reset-password              (pre-sesión: pedir email de reset)
//     - /reset-password/confirm      (post-link de reset: nueva password)
//
//   Helper `isPublicAuthRoute(pathname)` para detectarlas. AppContext lo
//   usa para SALTARSE la lógica de "sincronizar slug en URL ↔ cuenta
//   activa" cuando el user está en una ruta pública. Sin esto, AppContext
//   interpretaba 'reset-password' como slug inválido y navegaba a
//   '/{cuenta-activa}/{rest-de-la-url}', expulsando al user del flow
//   (bug Sesión 9: "reset password redirige al dashboard sin pasar por
//   la pantalla de nueva password").
//
// PÁGINAS CON PARÁMETROS:
//   - appcc_execution       → /{slug}/appcc/hoy/:executionId
//   - appcc_audit_execution → /{slug}/appcc/auditorias/:auditId
//
// MODO TRABAJADOR (deuda):
//   No tiene URL específica todavía. Se gestiona por state local en App.tsx
//   (modo='trabajador' o forceWorkerMode). Mover a URL es deuda futura.

import type { Page } from './types'

export interface ParsedRoute {
  slug: string | null
  rest: string
}

export function parseRoute(pathname: string): ParsedRoute {
  const clean = pathname.replace(/^\/+|\/+$/g, '')
  if (clean === '') {
    return { slug: null, rest: '' }
  }
  const firstSlash = clean.indexOf('/')
  if (firstSlash === -1) {
    return { slug: clean, rest: '' }
  }
  return {
    slug: clean.slice(0, firstSlash),
    rest: clean.slice(firstSlash + 1),
  }
}

export function buildRoute(slug: string, rest: string = ''): string {
  const cleanRest = rest.replace(/^\/+|\/+$/g, '')
  return cleanRest === '' ? `/${slug}` : `/${slug}/${cleanRest}`
}

export function isValidSlugShape(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug)
}

/* =====================================================
   RUTAS DE AUTH PÚBLICAS (D-S2.30 Sesión 9)
   ===================================================== */

/**
 * Lista de pathnames (sin basename) que son rutas de auth globales y NO
 * deben mezclarse con la lógica de slug-de-cuenta del Shell.
 *
 * AppContext usa `isPublicAuthRoute(pathname)` para decidir si saltarse
 * la corrección de URL hacia /{slug}/{rest} en arranque/cambio de cuenta.
 * App.tsx usa estas rutas directamente vía routing declarativo (AuthRouter +
 * paso 1-bis de /reset-password/confirm).
 *
 * Si se añaden más pantallas pre-sesión (e.g. /verify-email en Sprint 3),
 * añadirlas aquí.
 */
export const PUBLIC_AUTH_ROUTES: readonly string[] = [
  '/login',
  '/welcome',
  '/reset-password',
  '/reset-password/confirm',
] as const

/**
 * True si el pathname dado corresponde a una ruta de auth pública.
 *
 * Match exacto sobre la lista PUBLIC_AUTH_ROUTES. NO usa startsWith porque
 * podría dar falsos positivos (p.ej. '/login-extra' empezaría con '/login').
 *
 * Pathname debe venir SIN basename (la firma de useLocation() ya lo elimina).
 */
export function isPublicAuthRoute(pathname: string): boolean {
  return PUBLIC_AUTH_ROUTES.includes(pathname)
}

/* =====================================================
   MAPEO Page ↔ path
   ===================================================== */

const PAGE_TO_PATH: Partial<Record<Page, string>> = {
  // Personal
  dashboard:              'dashboard',
  staff:                  'personal',
  fichajes_global:        'fichajes-global',
  kiosko_fichaje:         'kiosko-fichaje',
  solicitudes_pendientes: 'solicitudes',
  ahora_mismo:            'ahora-mismo',
  turnos_abiertos:        'turnos-abiertos',
  cambios_pendientes:     'cambios-pendientes',
  calendario:             'calendario',
  plantilla_turnos:       'plantilla-turnos',
  informes_personal:      'informes-personal',
  bolsa_horas:            'bolsa-horas',
  // Ventas
  ventas_analisis:        'ventas/analisis',
  prediccion_personal:    'ventas/prediccion',
  zonas_pedido:           'ventas/zonas',
  // Stock / multitenancy
  brands:                 'stock/marcas',
  locations:              'locales',
  // Configuración
  avisos_settings:        'config/avisos',
  // APPCC
  appcc_dashboard:        'appcc',
  appcc_today:            'appcc/hoy',
  appcc_audits:           'appcc/auditorias',
  appcc_audit_templates:  'appcc/auditorias/plantillas',
  appcc_audit_execution:  'appcc/auditorias/exec/:auditId',
  appcc_incidents:        'appcc/incidencias',
  appcc_reports:          'appcc/informes',
  appcc_templates:        'appcc/plantillas',
  appcc_execution:        'appcc/hoy/exec/:executionId',
  appcc_onboarding:       'appcc/onboarding',
}

const PATH_TO_PAGE: Map<string, Page> = (() => {
  const m = new Map<string, Page>()
  for (const [page, path] of Object.entries(PAGE_TO_PATH)) {
    if (path) m.set(path, page as Page)
  }
  return m
})()

export function pageToPath(page: Page): string {
  return PAGE_TO_PATH[page] ?? 'dashboard'
}

export function pageToRoute(
  page: Page,
  slug: string,
  params?: Record<string, string>
): string {
  let path = pageToPath(page)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, encodeURIComponent(value))
    }
  }
  return buildRoute(slug, path)
}

export function pathToPage(rest: string): Page {
  const clean = rest.replace(/^\/+|\/+$/g, '')
  if (clean === '') return 'dashboard'

  const direct = PATH_TO_PAGE.get(clean)
  if (direct) return direct

  // Match con parámetro.
  for (const [path, page] of PATH_TO_PAGE.entries()) {
    if (!path.includes(':')) continue
    if (pathMatchesPattern(clean, path)) return page
  }

  return 'dashboard'
}

function pathMatchesPattern(realPath: string, pattern: string): boolean {
  const a = realPath.split('/')
  const b = pattern.split('/')
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (b[i].startsWith(':')) continue
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Lista de páginas con sus paths para registrar las rutas en <Routes>.
 * Útil en AuthenticatedApp para generar <Route /> programáticamente o
 * para iteraciones.
 */
export const ROUTE_ENTRIES: ReadonlyArray<{ page: Page; path: string }> =
  Object.entries(PAGE_TO_PATH)
    .filter((e): e is [Page, string] => typeof e[1] === 'string')
    .map(([page, path]) => ({ page: page as Page, path }))

export type { Page }
