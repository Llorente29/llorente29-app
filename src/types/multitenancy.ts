// src/types/multitenancy.ts
//
// Capa de dominio (camelCase) sobre las tablas multi-tenant.
//
// SECCIÓN 1-5 — Módulo Stock (Fase 0 del Bloque Stock):
//   - brand
//   - sales_channel
//   - analysis_account
//   - cost_center
//   - brand_location_availability
//
// SECCIÓN 7-9 — Shell (Fase 0 del Bloque B):
//   - accounts
//   - user_profiles
//   - manager_permissions
//
// Convenciones:
//   - Interface "X" = entidad de dominio (camelCase), lo que consumen componentes/páginas
//   - "XInsert" / "XUpdate" = payloads para services (parciales sin campos auto)
//   - Enums string literales (no enum TS) → alinean con CHECK constraints SQL
//   - Tipos Row* importados de database.ts → fuente de verdad de la BBDD
//   - Mappers (rowTo* y *ToRow) viven en cada service, no aquí
//
// Filosofía: este archivo NO se autogenera. Cuando cambien las tablas
// regeneras database.ts con `npm run types:gen` y, si añadiste columnas
// nuevas, las añades aquí a mano. Es deliberado: ofrece el control total
// sobre cómo se expone el dominio al resto de la app.

import type { Database } from './database'

// ─────────────────────────────────────────────────────────────────────
// Tipos Row* (snake_case, vienen directos de BBDD vía database.ts)
// Sólo se usan dentro de services para tipar el output de queries Supabase
// ─────────────────────────────────────────────────────────────────────

export type RowBrand = Database['public']['Tables']['brand']['Row']
export type RowBrandInsert = Database['public']['Tables']['brand']['Insert']
export type RowBrandUpdate = Database['public']['Tables']['brand']['Update']

export type RowSalesChannel = Database['public']['Tables']['sales_channel']['Row']
export type RowSalesChannelInsert = Database['public']['Tables']['sales_channel']['Insert']
export type RowSalesChannelUpdate = Database['public']['Tables']['sales_channel']['Update']

export type RowAnalysisAccount = Database['public']['Tables']['analysis_account']['Row']
export type RowAnalysisAccountInsert = Database['public']['Tables']['analysis_account']['Insert']
export type RowAnalysisAccountUpdate = Database['public']['Tables']['analysis_account']['Update']

export type RowCostCenter = Database['public']['Tables']['cost_center']['Row']
export type RowCostCenterInsert = Database['public']['Tables']['cost_center']['Insert']
export type RowCostCenterUpdate = Database['public']['Tables']['cost_center']['Update']

export type RowBrandLocationAvailability = Database['public']['Tables']['brand_location_availability']['Row']
export type RowBrandLocationAvailabilityInsert = Database['public']['Tables']['brand_location_availability']['Insert']
export type RowBrandLocationAvailabilityUpdate = Database['public']['Tables']['brand_location_availability']['Update']

export type RowAccount = Database['public']['Tables']['accounts']['Row']
export type RowAccountInsert = Database['public']['Tables']['accounts']['Insert']
export type RowAccountUpdate = Database['public']['Tables']['accounts']['Update']

export type RowUserProfile = Database['public']['Tables']['user_profiles']['Row']
export type RowUserProfileInsert = Database['public']['Tables']['user_profiles']['Insert']
export type RowUserProfileUpdate = Database['public']['Tables']['user_profiles']['Update']

export type RowManagerPermissions = Database['public']['Tables']['manager_permissions']['Row']
export type RowManagerPermissionsInsert = Database['public']['Tables']['manager_permissions']['Insert']
export type RowManagerPermissionsUpdate = Database['public']['Tables']['manager_permissions']['Update']

// ─────────────────────────────────────────────────────────────────────
// Enums string literales (alineados con CHECK constraints SQL)
// ─────────────────────────────────────────────────────────────────────

export type BrandOwnershipType = 'own' | 'licensed'

export type SalesChannelType =
  | 'delivery'
  | 'dine_in'
  | 'takeaway'
  | 'catering'
  | 'other'

export type AnalysisAccountType =
  | 'expense'
  | 'revenue'
  | 'cost_of_goods'
  | 'other'

/** Estados de cuenta. Alineado con CHECK accounts_status_check. */
export type AccountStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'canceled'

/** Roles de un user_profile dentro de una cuenta. Alineado con CHECK valid_role. */
export type UserProfileRole = 'admin' | 'manager' | 'worker'

// ─────────────────────────────────────────────────────────────────────
// 1. BRAND — Marcas
// ─────────────────────────────────────────────────────────────────────

export interface Brand {
  id: string
  accountId: string
  name: string
  slug: string
  ownershipType: BrandOwnershipType
  color: string | null
  logoUrl: string | null
  /** Solo aplica si ownershipType === 'licensed'. null en marcas propias. */
  commissionPct: number | null
  notes: string | null
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}

export interface BrandInsert {
  accountId: string
  name: string
  slug: string
  ownershipType?: BrandOwnershipType
  color?: string | null
  logoUrl?: string | null
  commissionPct?: number | null
  notes?: string | null
  isActive?: boolean
  createdBy?: string | null
  createdByName?: string | null
}

export interface BrandUpdate {
  name?: string
  slug?: string
  ownershipType?: BrandOwnershipType
  color?: string | null
  logoUrl?: string | null
  commissionPct?: number | null
  notes?: string | null
  isActive?: boolean
  archivedAt?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// 2. SALES_CHANNEL — Canales de venta
// ─────────────────────────────────────────────────────────────────────

export interface SalesChannel {
  id: string
  accountId: string
  name: string
  slug: string
  channelType: SalesChannelType
  defaultCommissionPct: number | null
  color: string | null
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SalesChannelInsert {
  accountId: string
  name: string
  slug: string
  channelType?: SalesChannelType
  defaultCommissionPct?: number | null
  color?: string | null
  isActive?: boolean
}

export interface SalesChannelUpdate {
  name?: string
  slug?: string
  channelType?: SalesChannelType
  defaultCommissionPct?: number | null
  color?: string | null
  isActive?: boolean
  archivedAt?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// 3. ANALYSIS_ACCOUNT — Cuentas de análisis contables
// ─────────────────────────────────────────────────────────────────────

export interface AnalysisAccount {
  id: string
  accountId: string
  code: string
  name: string
  /** Null = cuenta raíz. UUID = cuenta hija de otra. */
  parentId: string | null
  accountType: AnalysisAccountType
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AnalysisAccountInsert {
  accountId: string
  code: string
  name: string
  parentId?: string | null
  accountType?: AnalysisAccountType
  isActive?: boolean
}

export interface AnalysisAccountUpdate {
  code?: string
  name?: string
  parentId?: string | null
  accountType?: AnalysisAccountType
  isActive?: boolean
}

/** Forma de árbol para renderizar jerarquía en UI. Se construye en service. */
export interface AnalysisAccountNode extends AnalysisAccount {
  children: AnalysisAccountNode[]
}

// ─────────────────────────────────────────────────────────────────────
// 4. COST_CENTER — Centros de coste
// ─────────────────────────────────────────────────────────────────────

export interface CostCenter {
  id: string
  accountId: string
  /** Opcional: vinculado a un local concreto, null si agrupa varios. */
  locationId: string | null
  code: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CostCenterInsert {
  accountId: string
  locationId?: string | null
  code: string
  name: string
  isActive?: boolean
}

export interface CostCenterUpdate {
  locationId?: string | null
  code?: string
  name?: string
  isActive?: boolean
}

// ─────────────────────────────────────────────────────────────────────
// 5. BRAND_LOCATION_AVAILABILITY — Qué marca opera en qué local
// ─────────────────────────────────────────────────────────────────────

export interface BrandLocationAvailability {
  id: string
  accountId: string
  brandId: string
  locationId: string
  isActive: boolean
  /** ISO date YYYY-MM-DD. Null si desconocido. */
  activeSince: string | null
  /** Null si sigue operando. */
  inactiveSince: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface BrandLocationAvailabilityInsert {
  accountId: string
  brandId: string
  locationId: string
  isActive?: boolean
  activeSince?: string | null
  inactiveSince?: string | null
  notes?: string | null
}

export interface BrandLocationAvailabilityUpdate {
  isActive?: boolean
  activeSince?: string | null
  inactiveSince?: string | null
  notes?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// 6. SCOPE — Selector de local activo (para header + context)
// ─────────────────────────────────────────────────────────────────────

/**
 * Valor del selector de local en el header.
 *   - 'all'  → modo consolidado (lectura agregada de los locales)
 *   - UUID   → location_id activo concreto
 *
 * REGLA DE NEGOCIO: en modo 'all', las operaciones de escritura del módulo
 * Stock (crear pedido, recibir albarán, hacer conteo, ajustar stock) están
 * bloqueadas. Solo lectura/analítica. Las páginas deben usar el hook
 * useLocationScope() que expone requireLocation() para forzar elección.
 */
export type ActiveLocationId = 'all' | string

export interface LocationScope {
  /** Valor crudo del selector. */
  activeLocationId: ActiveLocationId
  /** True si activeLocationId === 'all'. */
  isConsolidated: boolean
  /** UUID resuelto, null si está en modo consolidado. */
  resolvedLocationId: string | null
}

/**
 * Filtro de marca para vistas analíticas. Multi-select.
 *   - []              → sin filtro (todas las marcas)
 *   - [uuid, uuid...] → filtrar por estas marcas
 */
export type BrandFilter = string[]

// ═════════════════════════════════════════════════════════════════════
// SHELL — Tipos del núcleo multi-tenant (Bloque B)
// ═════════════════════════════════════════════════════════════════════
//
// Entidades raíz del modelo multi-tenant. Su gestión (CRUD, RLS, hooks)
// vive bajo src/modules/multitenancy/. Estas entidades NO siguen el
// patrón soft-delete (archivedAt + isActive):
//   - Account     → ciclo de vida vía `status` (trial/active/canceled…)
//   - UserProfile → flag `active: boolean`, sin archivedAt
//   - ManagerPermissions → 1:1 con UserProfile, ON DELETE CASCADE
//
// Por la misma razón, los services del Shell exponen READS sin parámetro
// `accountId` obligatorio: la RLS de Supabase ya restringe lo visible.
// Esta es una excepción consciente al patrón consolidado de brandsService.
//
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// 7. ACCOUNT — Cuentas (tenants)
// ─────────────────────────────────────────────────────────────────────

export interface Account {
  id: string
  name: string
  slug: string
  legalName: string | null
  cif: string | null
  billingEmail: string | null
  billingPhone: string | null
  /** JSONB libre. Forma sugerida: { street, city, postalCode, country }. */
  billingAddress: Record<string, unknown>
  country: string
  timezone: string | null
  locale: string | null
  currency: string | null
  status: AccountStatus
  isInternal: boolean
  trialEndsAt: string | null
  stripeCustomerId: string | null
  /** JSONB libre para extensiones futuras. */
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

export interface AccountInsert {
  name: string
  slug: string
  legalName?: string | null
  cif?: string | null
  billingEmail?: string | null
  billingPhone?: string | null
  billingAddress?: Record<string, unknown>
  country?: string
  timezone?: string | null
  locale?: string | null
  currency?: string | null
  status?: AccountStatus
  isInternal?: boolean
  trialEndsAt?: string | null
  stripeCustomerId?: string | null
  metadata?: Record<string, unknown>
  createdBy?: string | null
}

export interface AccountUpdate {
  name?: string
  slug?: string
  legalName?: string | null
  cif?: string | null
  billingEmail?: string | null
  billingPhone?: string | null
  billingAddress?: Record<string, unknown>
  country?: string
  timezone?: string | null
  locale?: string | null
  currency?: string | null
  status?: AccountStatus
  trialEndsAt?: string | null
  stripeCustomerId?: string | null
  metadata?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────
// 8. USER_PROFILE — Perfil de un user dentro de una cuenta
// ─────────────────────────────────────────────────────────────────────

/**
 * NOTA IMPORTANTE: un mismo user_id puede tener N user_profiles (uno por
 * cada cuenta a la que pertenece). UNIQUE (user_id, account_id) impide
 * duplicados dentro de la misma cuenta.
 */
export interface UserProfile {
  id: string
  userId: string
  /** Nullable en BBDD por compatibilidad legacy. Producción: siempre presente. */
  accountId: string | null
  /** FK opcional a employees(id). Permite vincular un admin/manager con su ficha de empleado. */
  employeeId: string | null
  role: UserProfileRole
  displayName: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface UserProfileInsert {
  userId: string
  accountId: string
  employeeId?: string | null
  role?: UserProfileRole
  displayName?: string | null
  active?: boolean
}

export interface UserProfileUpdate {
  employeeId?: string | null
  role?: UserProfileRole
  displayName?: string | null
  active?: boolean
}

// ─────────────────────────────────────────────────────────────────────
// 9. MANAGER_PERMISSIONS — Permisos granulares por user_profile
// ─────────────────────────────────────────────────────────────────────

/**
 * Tabla 1:1 con user_profiles. PK = user_profile_id (NO id propio).
 * 30 booleanos hoy. Cuando lleguemos a 40-50 migrar a modelo flexible
 * (clave/valor sobre tabla permissions). Ver deuda en CONTEXTO §11.
 */
export interface ManagerPermissions {
  userProfileId: string
  showDashboard: boolean
  showStaff: boolean
  showAhoraMismo: boolean
  showFichajesGlobal: boolean
  showKioskoFichaje: boolean
  showSolicitudesPendientes: boolean
  showTurnosAbiertos: boolean
  showCambiosPendientes: boolean
  showCalendario: boolean
  showPlantillaTurnos: boolean
  showInformesPersonal: boolean
  showBolsaHoras: boolean
  showTasks: boolean
  showScheduled: boolean
  showTemplates: boolean
  showIncidents: boolean
  showAudits: boolean
  showHistory: boolean
  showTspoon: boolean
  showVentasAnalisis: boolean
  showPrediccionPersonal: boolean
  showZonasPedido: boolean
  showInventory: boolean
  showLocations: boolean
  showTspoonSettings: boolean
  showSalaries: boolean
  canManageEmployees: boolean
  /** Nullable en BBDD (default false). Tratado como boolean en cliente. */
  showAppccToday: boolean
  showAppccIncidents: boolean
  createdAt: string | null
  updatedAt: string | null
}

export type ManagerPermissionsPatch = Partial<
  Omit<ManagerPermissions, 'userProfileId' | 'createdAt' | 'updatedAt'>
>
