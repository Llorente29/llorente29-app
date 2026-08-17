// src/admin/services/hubriseOpsService.ts
//
// Tablero de vigilancia HubRise (Fase 3, A.1 — Portal de staff). Una llamada a
// hubrise_ops_dashboard() (superadmin-only, RPC lanza si no eres platform admin)
// + acción bajo demanda "Verificar callback ahora" contra hubrise-callback-ensure
// con { integration_id } (backend ya event-driven, nunca cron — ver
// folvy_mapa_sistema.md, regla permanente "ningún cron sondea GET /callback").

import { supabase } from '../../lib/supabase'

export type HubriseLocationOpsStatus =
  | 'local_inactivo' | 'conectando' | 'sin_conectar' | 'token_invalido' | 'conectado'
export type HealthStatus = 'ok' | 'invalid' | 'unknown' | null
export type CallbackHealthStatus = 'ok' | 'missing' | 'unknown' | null

export interface HubriseOpsLocationRow {
  accountId: string
  accountName: string
  locationId: string
  locationName: string
  integrationId: string | null
  connectionName: string | null
  isStandardConnection: boolean
  status: HubriseLocationOpsStatus
  externalLocationId: string | null
  externalAccountName: string | null
  externalLocationName: string | null
  tokenStatus: HealthStatus
  tokenCheckedAt: string | null
  callbackStatus: CallbackHealthStatus
  callbackCheckedAt: string | null
  revokePending: boolean
  lastOrderAt: string | null
  brandDiff: boolean
  brandsCatalogOnly: string[]
  brandsMappedOnly: string[]
}

export interface HubriseOpsWriterRow {
  accountId: string
  accountName: string
  hubriseAccountId: string | null
  tokenStatus: HealthStatus
  tokenCheckedAt: string | null
  connectedAt: string | null
}

export interface HubriseOpsDashboard {
  locations: HubriseOpsLocationRow[]
  writers: HubriseOpsWriterRow[]
  alerts48h: number
  generatedAt: string
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

function rowToLocation(r: Record<string, unknown>): HubriseOpsLocationRow {
  return {
    accountId: r.account_id as string,
    accountName: r.account_name as string,
    locationId: r.location_id as string,
    locationName: r.location_name as string,
    integrationId: (r.integration_id as string | null) ?? null,
    connectionName: (r.connection_name as string | null) ?? null,
    isStandardConnection: r.is_standard_connection !== false,
    status: r.status as HubriseLocationOpsStatus,
    externalLocationId: (r.external_location_id as string | null) ?? null,
    externalAccountName: (r.external_account_name as string | null) ?? null,
    externalLocationName: (r.external_location_name as string | null) ?? null,
    tokenStatus: (r.token_status as HealthStatus) ?? null,
    tokenCheckedAt: (r.token_checked_at as string | null) ?? null,
    callbackStatus: (r.callback_status as CallbackHealthStatus) ?? null,
    callbackCheckedAt: (r.callback_checked_at as string | null) ?? null,
    revokePending: r.revoke_pending === true,
    lastOrderAt: (r.last_order_at as string | null) ?? null,
    brandDiff: r.brand_diff === true,
    brandsCatalogOnly: Array.isArray(r.brands_catalog_only) ? (r.brands_catalog_only as string[]) : [],
    brandsMappedOnly: Array.isArray(r.brands_mapped_only) ? (r.brands_mapped_only as string[]) : [],
  }
}

function rowToWriter(r: Record<string, unknown>): HubriseOpsWriterRow {
  return {
    accountId: r.account_id as string,
    accountName: r.account_name as string,
    hubriseAccountId: (r.hubrise_account_id as string | null) ?? null,
    tokenStatus: (r.token_status as HealthStatus) ?? null,
    tokenCheckedAt: (r.token_checked_at as string | null) ?? null,
    connectedAt: (r.connected_at as string | null) ?? null,
  }
}

/** Tablero cruzado entre cuentas. Lanza si el usuario no es platform admin (la RPC lo verifica). */
export async function getHubriseOpsDashboard(): Promise<HubriseOpsDashboard> {
  const sb = requireSupabase()
  const { data, error } = await sb.rpc('hubrise_ops_dashboard')
  if (error) throw new Error(error.message)
  const d = (data ?? {}) as Record<string, unknown>
  return {
    locations: ((d.locations as Record<string, unknown>[]) ?? []).map(rowToLocation),
    writers: ((d.writers as Record<string, unknown>[]) ?? []).map(rowToWriter),
    alerts48h: Number(d.alerts_48h ?? 0),
    generatedAt: (d.generated_at as string) ?? new Date().toISOString(),
  }
}

export interface VerifyCallbackResult {
  ok: boolean
  outcome: string | null
  error: string | null
}

/**
 * Botón "Verificar callback ahora" — GET puntual con causa humana (el clic), no
 * un bucle. Acota hubrise-callback-ensure a esta sola conexión vía integration_id.
 */
export async function verifyHubriseCallbackNow(integrationId: string): Promise<VerifyCallbackResult> {
  const sb = requireSupabase()
  const { data, error } = await sb.functions.invoke('hubrise-callback-ensure', {
    body: { integration_id: integrationId },
  })
  if (error) return { ok: false, outcome: null, error: error.message }
  const d = (data ?? {}) as Record<string, unknown>
  const results = (d.results as Array<Record<string, unknown>> | undefined) ?? []
  const outcome = (results[0]?.outcome as string | undefined) ?? null
  if (d.ok !== true) {
    return { ok: false, outcome, error: (d.error as string | undefined) ?? 'La verificación falló.' }
  }
  return { ok: true, outcome, error: null }
}
