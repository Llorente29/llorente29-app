// src/modules/integrations/services/connectorCredentialsService.ts
//
// Service que invoca la Edge Function `connector-credentials` (D2.2b) para
// gestionar las credenciales cifradas de un conector (guardadas en Vault).
//
// Patrón idéntico a accountsAdminService: supabase.functions.invoke adjunta
// automáticamente el JWT de la sesión en Authorization (la Edge Function lo
// valida para sacar el user_id y comprobar que es admin/manager de la cuenta).
// Resultado tipado { ok } — nunca throw por error de negocio, para UI limpia.
//
// SEGURIDAD: el secreto (token de la plataforma) viaja en `secrets` por HTTPS a
// la Edge Function, que lo cifra en Vault. NUNCA vuelve al front: status solo
// devuelve un booleano (hasCredentials), jamás el valor.

import { supabase } from '@/lib/supabase'

// Campos secretos (type:'secret') del config_schema → { key: value }
export type ConnectorSecrets = Record<string, string>
// Campos no sensibles (store_ids, auto_accept, …) → { key: value }
export type ConnectorConfigValues = Record<string, unknown>

export type SaveCredentialsResponse =
  | { ok: true; status: string }
  | { ok: false; error: string }

export type StatusCredentialsResponse =
  | { ok: true; hasCredentials: boolean }
  | { ok: false; error: string }

export type ClearCredentialsResponse =
  | { ok: true; status: string }
  | { ok: false; error: string }

// Helper: extrae el mensaje de error del context (Response) de functions.invoke.
async function parseInvokeError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const parsed = await ctx.json()
      if (parsed?.error) return parsed.error as string
    }
  } catch {
    // ignore
  }
  return (error as { message?: string })?.message ?? 'Error invocando connector-credentials.'
}

/**
 * Guarda las credenciales de un conector: los `secrets` se cifran en Vault, los
 * `config` (no sensibles) se guardan en account_connector.config. Marca conectado.
 */
export async function saveConnectorCredentials(input: {
  accountConnectorId: string
  secrets: ConnectorSecrets
  config?: ConnectorConfigValues
}): Promise<SaveCredentialsResponse> {
  if (!supabase) return { ok: false, error: 'Supabase no está configurado.' }
  try {
    const { data, error } = await supabase.functions.invoke('connector-credentials', {
      body: {
        action: 'save',
        accountConnectorId: input.accountConnectorId,
        secrets: input.secrets,
        config: input.config ?? null,
      },
    })
    if (error) return { ok: false, error: await parseInvokeError(error) }
    const body = data as { ok?: boolean; status?: string; error?: string }
    if (body?.error) return { ok: false, error: body.error }
    return { ok: true, status: body?.status ?? 'connected' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de red.' }
  }
}

/**
 * Consulta si un conector tiene credenciales guardadas (sin revelar el valor).
 */
export async function getConnectorCredentialsStatus(
  accountConnectorId: string,
): Promise<StatusCredentialsResponse> {
  if (!supabase) return { ok: false, error: 'Supabase no está configurado.' }
  try {
    const { data, error } = await supabase.functions.invoke('connector-credentials', {
      body: { action: 'status', accountConnectorId },
    })
    if (error) return { ok: false, error: await parseInvokeError(error) }
    const body = data as { ok?: boolean; hasCredentials?: boolean; error?: string }
    if (body?.error) return { ok: false, error: body.error }
    return { ok: true, hasCredentials: body?.hasCredentials === true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de red.' }
  }
}

/**
 * Borra las credenciales de un conector (las elimina de Vault). Marca 'paused'.
 */
export async function clearConnectorCredentials(
  accountConnectorId: string,
): Promise<ClearCredentialsResponse> {
  if (!supabase) return { ok: false, error: 'Supabase no está configurado.' }
  try {
    const { data, error } = await supabase.functions.invoke('connector-credentials', {
      body: { action: 'clear', accountConnectorId },
    })
    if (error) return { ok: false, error: await parseInvokeError(error) }
    const body = data as { ok?: boolean; status?: string; error?: string }
    if (body?.error) return { ok: false, error: body.error }
    return { ok: true, status: body?.status ?? 'paused' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de red.' }
  }
}
