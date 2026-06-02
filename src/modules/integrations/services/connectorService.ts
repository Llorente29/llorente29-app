// src/modules/integrations/services/connectorService.ts
//
// Service del módulo de Integraciones. Dos planos:
//   - connector          → catálogo global (lectura para la app; escritura solo plataforma)
//   - account_connector  → conexión de un conector por cuenta (CRUD multi-tenant)
//
// Operaciones:
//   Catálogo:
//     - listConnectors(opts?)              → catálogo de conectores disponibles
//     - getConnectorByCode(code)           → un conector del catálogo
//   Conexiones de cuenta:
//     - listAccountConnectors(accountId)   → conexiones (con datos del conector)
//     - getAccountConnectorById(id)        → una conexión
//     - requestConnector(input)            → el cliente SOLICITA (status 'requested')
//     - upsertAccountConnector(input)      → crea/actualiza la conexión
//     - setConnectionStatus(id, status, …) → cambia estado (connecting/connected/paused/error)
//     - updateAccountConnector(id, patch)  → modificación puntual
//     - archiveAccountConnector(id)        → soft delete
//
// Convención de errores: todos los métodos LANZAN Error. Componentes en try/catch.
// Identidad operativa (v17.1): el caller pasa createdBy/createdByName y requestedBy.
//
// SEGURIDAD: este service NO maneja credenciales en claro. La lógica de authorize/OAuth
// y el cifrado de secretos vive en las Edge Functions de cada conector (I3+), no aquí.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  Connector,
  ConnectorConfigSchema,
  RowConnector,
  AccountConnector,
  AccountConnectorInsert,
  AccountConnectorUpdate,
  AccountConnectorStatus,
  RowAccountConnector,
  RowAccountConnectorInsert,
  RowAccountConnectorUpdate,
  ConnectorCategory,
  ConnectionType,
  ConnectorManagedBy,
  ConnectorDirection,
  AccountConnectorScope,
} from '../../../types/integrations'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

export function rowToConnector(row: RowConnector): Connector {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category as ConnectorCategory,
    connectionType: row.connection_type as ConnectionType,
    managedBy: row.managed_by as ConnectorManagedBy,
    direction: row.direction as ConnectorDirection,
    description: row.description,
    logoUrl: row.logo_url,
    configSchema: (row.config_schema as ConnectorConfigSchema | null) ?? null,
    features: row.features,
    isAvailable: row.is_available,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function rowToAccountConnector(row: RowAccountConnector): AccountConnector {
  return {
    id: row.id,
    accountId: row.account_id,
    connectorId: row.connector_id,
    status: row.status as AccountConnectorStatus,
    scope: row.scope as AccountConnectorScope,
    brandId: row.brand_id,
    locationId: row.location_id,
    credentialsRef: row.credentials_ref,
    externalAccountId: row.external_account_id,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    connectedBy: row.connected_by,
    connectedAt: row.connected_at,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  }
}

function accountConnectorInsertToRow(
  input: AccountConnectorInsert
): RowAccountConnectorInsert {
  return {
    account_id: input.accountId,
    connector_id: input.connectorId,
    status: input.status ?? 'available',
    scope: input.scope ?? 'account',
    brand_id: input.brandId ?? null,
    location_id: input.locationId ?? null,
    credentials_ref: input.credentialsRef ?? null,
    external_account_id: input.externalAccountId ?? null,
    requested_by: input.requestedBy ?? null,
    requested_at: input.requestedAt ?? null,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function accountConnectorUpdateToRow(
  patch: AccountConnectorUpdate
): RowAccountConnectorUpdate {
  const row: RowAccountConnectorUpdate = {}
  if (patch.status !== undefined) row.status = patch.status
  if (patch.scope !== undefined) row.scope = patch.scope
  if (patch.brandId !== undefined) row.brand_id = patch.brandId
  if (patch.locationId !== undefined) row.location_id = patch.locationId
  if (patch.credentialsRef !== undefined) row.credentials_ref = patch.credentialsRef
  if (patch.externalAccountId !== undefined) row.external_account_id = patch.externalAccountId
  if (patch.lastSyncAt !== undefined) row.last_sync_at = patch.lastSyncAt
  if (patch.lastError !== undefined) row.last_error = patch.lastError
  if (patch.connectedBy !== undefined) row.connected_by = patch.connectedBy
  if (patch.connectedAt !== undefined) row.connected_at = patch.connectedAt
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  return row
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// API pública — Catálogo (connector)
// ─────────────────────────────────────────────────────────────────────

export interface ListConnectorsOptions {
  /** Si false, incluye los no disponibles. Default true (solo is_available). */
  onlyAvailable?: boolean
  category?: ConnectorCategory
}

/**
 * Lista el catálogo de conectores. Ordenado por sort_order y luego nombre.
 */
export async function listConnectors(
  opts?: ListConnectorsOptions
): Promise<Connector[]> {
  requireSupabase()
  let query = supabase!
    .from('connector')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (opts?.onlyAvailable !== false) {
    query = query.eq('is_available', true)
  }
  if (opts?.category) {
    query = query.eq('category', opts.category)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando el catálogo de conectores: ${error.message}`)
  }
  return (data ?? []).map(rowToConnector)
}

/**
 * Obtiene un conector del catálogo por su code. Devuelve null si no existe.
 */
export async function getConnectorByCode(code: string): Promise<Connector | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('connector')
    .select('*')
    .eq('code', code)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo el conector "${code}": ${error.message}`)
  }
  return data ? rowToConnector(data) : null
}

// ─────────────────────────────────────────────────────────────────────
// API pública — Conexiones por cuenta (account_connector)
// ─────────────────────────────────────────────────────────────────────

export interface ListAccountConnectorsOptions {
  accountId: string
  includeArchived?: boolean
  status?: AccountConnectorStatus
}

/**
 * Lista las conexiones de una cuenta. Ordenadas por creación.
 */
export async function listAccountConnectors(
  opts: ListAccountConnectorsOptions
): Promise<AccountConnector[]> {
  requireSupabase()
  let query = supabase!
    .from('account_connector')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('created_at', { ascending: true })

  if (!opts.includeArchived) {
    query = query.is('archived_at', null)
  }
  if (opts.status) {
    query = query.eq('status', opts.status)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando conexiones de la cuenta: ${error.message}`)
  }
  return (data ?? []).map(rowToAccountConnector)
}

export async function getAccountConnectorById(
  id: string
): Promise<AccountConnector | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('account_connector')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo la conexión ${id}: ${error.message}`)
  }
  return data ? rowToAccountConnector(data) : null
}

/**
 * El cliente SOLICITA un conector (flujo 'request'): crea la conexión en estado
 * 'requested' para que el superadmin (o el propio cliente) la atienda después.
 * requestedAt se sella aquí.
 */
export async function requestConnector(
  input: AccountConnectorInsert
): Promise<AccountConnector> {
  requireSupabase()
  const payload: AccountConnectorInsert = {
    ...input,
    status: 'requested',
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  }
  const { data, error } = await supabase!
    .from('account_connector')
    .insert(accountConnectorInsertToRow(payload))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error solicitando el conector: ${error.message}`)
  }
  return rowToAccountConnector(data)
}

/**
 * Crea o actualiza la conexión de un conector para una cuenta+alcance.
 * Aprovecha el UNIQUE (account_id, connector_id, scope, brand_id, location_id).
 */
export async function upsertAccountConnector(
  input: AccountConnectorInsert
): Promise<AccountConnector> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('account_connector')
    .upsert(accountConnectorInsertToRow(input), {
      onConflict: 'account_id,connector_id,scope,brand_id,location_id',
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error guardando la conexión: ${error.message}`)
  }
  return rowToAccountConnector(data)
}

/**
 * Cambia el estado de una conexión. Para 'connected' sella connectedAt/connectedBy;
 * para 'error' registra el mensaje en lastError.
 */
export async function setConnectionStatus(
  id: string,
  status: AccountConnectorStatus,
  opts?: { connectedBy?: string | null; errorMessage?: string | null }
): Promise<AccountConnector> {
  requireSupabase()
  const patch: AccountConnectorUpdate = { status }
  if (status === 'connected') {
    patch.connectedAt = new Date().toISOString()
    if (opts?.connectedBy !== undefined) patch.connectedBy = opts.connectedBy
  }
  if (status === 'error') {
    patch.lastError = opts?.errorMessage ?? null
  }
  return updateAccountConnector(id, patch)
}

/**
 * Actualiza una conexión. Solo campos presentes en patch se modifican.
 */
export async function updateAccountConnector(
  id: string,
  patch: AccountConnectorUpdate
): Promise<AccountConnector> {
  requireSupabase()

  const rowPatch = accountConnectorUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getAccountConnectorById(id)
    if (!current) throw new Error(`Conexión ${id} no encontrada.`)
    return current
  }

  const { data, error } = await supabase!
    .from('account_connector')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando la conexión ${id}: ${error.message}`)
  }
  return rowToAccountConnector(data)
}

/**
 * Archiva una conexión (soft delete). is_active=false y archived_at=now().
 */
export async function archiveAccountConnector(id: string): Promise<AccountConnector> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('account_connector')
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error archivando la conexión ${id}: ${error.message}`)
  }
  return rowToAccountConnector(data)
}
