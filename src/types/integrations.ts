// src/types/integrations.ts
//
// Capa de dominio (camelCase) del módulo de Integraciones (conectores).
//
// Tablas cubiertas (2):
//   - connector          → catálogo global de conectores (sin account_id)
//   - account_connector  → conexión de un conector por cuenta (con RLS)
//
// Convenciones (idénticas a multitenancy.ts / kitchen.ts):
//   - Interface "X" = entidad de dominio (camelCase), lo que consumen páginas/componentes
//   - "XInsert" / "XUpdate" = payloads para services (parciales sin campos auto)
//   - Uniones de literales string (NO enum TS) → alinean con los CHECK de la BBDD
//   - Tipos Row* importados de database.ts → fuente de verdad de la BBDD
//   - Mappers (rowTo* y *ToRow) viven en el service, no aquí
//
// SEGURIDAD: las credenciales (appId/appSecret/token) NUNCA viajan en estos tipos en
// claro. account_connector solo guarda `credentialsRef` (referencia a credenciales
// cifradas fuera de la tabla). Los tipos lo reflejan: no hay campo de secreto en claro.

import type { Database } from './database'

// ─────────────────────────────────────────────────────────────────────
// Tipos Row crudos (snake_case) derivados del schema autogenerado.
// ─────────────────────────────────────────────────────────────────────
export type RowConnector = Database['public']['Tables']['connector']['Row']
export type RowConnectorInsert = Database['public']['Tables']['connector']['Insert']
export type RowConnectorUpdate = Database['public']['Tables']['connector']['Update']

export type RowAccountConnector = Database['public']['Tables']['account_connector']['Row']
export type RowAccountConnectorInsert = Database['public']['Tables']['account_connector']['Insert']
export type RowAccountConnectorUpdate = Database['public']['Tables']['account_connector']['Update']

// ─────────────────────────────────────────────────────────────────────
// Uniones de literales (reflejan los CHECK constraints de la BBDD).
// NO son enums (regla: verbatimModuleSyntax / erasableSyntaxOnly).
// ─────────────────────────────────────────────────────────────────────
export type ConnectorCategory =
  | 'pos'
  | 'delivery_platform'
  | 'logistics'
  | 'payments'
  | 'reservations'
  | 'loyalty'
  | 'reports'
  | 'other'

export type ConnectionType = 'oauth' | 'credentials' | 'request'
export type ConnectorManagedBy = 'client' | 'superadmin' | 'either'
export type ConnectorDirection = 'inbound' | 'outbound' | 'bidirectional'

export type AccountConnectorStatus =
  | 'available'
  | 'requested'
  | 'connecting'
  | 'connected'
  | 'paused'
  | 'error'

export type AccountConnectorScope = 'account' | 'brand' | 'location'

// Forma del config_schema (campos que pide un conector para conectarse).
// Render dinámico del formulario "Configurar" en la UI (I2).
export interface ConnectorConfigField {
  key: string
  label: string
  type: 'text' | 'secret' | 'number' | 'boolean'
  required: boolean
}
export interface ConnectorConfigSchema {
  fields: ConnectorConfigField[]
}

// ─────────────────────────────────────────────────────────────────────
// connector (catálogo global)
// ─────────────────────────────────────────────────────────────────────
export interface Connector {
  id: string
  code: string
  name: string
  category: ConnectorCategory
  connectionType: ConnectionType
  managedBy: ConnectorManagedBy
  direction: ConnectorDirection
  description: string | null
  logoUrl: string | null
  configSchema: ConnectorConfigSchema | null
  features: unknown
  isAvailable: boolean
  status: string
  sortOrder: number | null
  createdAt: string
  updatedAt: string
}
export interface ConnectorInsert {
  code: string
  name: string
  category: ConnectorCategory
  connectionType: ConnectionType
  managedBy: ConnectorManagedBy
  direction?: ConnectorDirection
  description?: string | null
  logoUrl?: string | null
  configSchema?: ConnectorConfigSchema | null
  features?: unknown
  isAvailable?: boolean
  status?: string
  sortOrder?: number | null
}
export interface ConnectorUpdate {
  name?: string
  category?: ConnectorCategory
  connectionType?: ConnectionType
  managedBy?: ConnectorManagedBy
  direction?: ConnectorDirection
  description?: string | null
  logoUrl?: string | null
  configSchema?: ConnectorConfigSchema | null
  features?: unknown
  isAvailable?: boolean
  status?: string
  sortOrder?: number | null
}

// ─────────────────────────────────────────────────────────────────────
// account_connector (conexión por cuenta)
// ─────────────────────────────────────────────────────────────────────
export interface AccountConnector {
  id: string
  accountId: string
  connectorId: string
  status: AccountConnectorStatus
  scope: AccountConnectorScope
  brandId: string | null
  locationId: string | null
  credentialsRef: string | null
  externalAccountId: string | null
  lastSyncAt: string | null
  lastError: string | null
  requestedBy: string | null
  requestedAt: string | null
  connectedBy: string | null
  connectedAt: string | null
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}
export interface AccountConnectorInsert {
  accountId: string
  connectorId: string
  status?: AccountConnectorStatus
  scope?: AccountConnectorScope
  brandId?: string | null
  locationId?: string | null
  credentialsRef?: string | null
  externalAccountId?: string | null
  requestedBy?: string | null
  requestedAt?: string | null
  createdBy?: string | null
  createdByName?: string | null
}
export interface AccountConnectorUpdate {
  status?: AccountConnectorStatus
  scope?: AccountConnectorScope
  brandId?: string | null
  locationId?: string | null
  credentialsRef?: string | null
  externalAccountId?: string | null
  lastSyncAt?: string | null
  lastError?: string | null
  connectedBy?: string | null
  connectedAt?: string | null
  isActive?: boolean
  archivedAt?: string | null
}
