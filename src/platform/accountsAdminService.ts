// src/platform/accountsAdminService.ts
//
// Service del panel admin para dar de alta cuentas cliente (Modalidad 3).
//
// CONTEXTO (Sesion 15, 21/05/2026 — Porteria):
// Encapsula la llamada a la Edge Function `create-account`, que hasta ahora
// se invocaba a mano (PowerShell / Invoke-RestMethod). La Function orquesta:
//   auth.user + cuenta + perfil admin + permisos (gerente_total global) +
//   location + marca + suscripcion + subscription_items + audit, de forma
//   atomica (si la parte Postgres falla, revierte el auth.user).
//
// La invocacion usa supabase.functions.invoke, que adjunta automaticamente
// el JWT de la sesion actual en el header Authorization. La Function exige
// que ese JWT sea de un platform_admin (claim folvy.is_platform_admin); si no,
// responde 403.
//
// DISENO: service aislado en src/platform/. No toca AppContext.

import { supabase } from '../lib/supabase'

// ─── Payload de alta de cuenta ─────────────────────────────────────────────
// Refleja 1:1 lo que espera la Edge Function create-account.
export interface CreateAccountPayload {
  accountName: string
  accountSlug: string
  adminEmail: string
  adminPassword: string        // contrasena temporal (v1 sin welcome email)
  adminDisplayName: string
  locationName: string
  brandName: string
  brandSlug: string
  submoduleIds: string[]       // submodulos a activar (subscription_items)
  planId: string | null        // opcional; null = sin plan asignado aun
  status: 'active' | 'trialing'
}

// ─── Respuesta exitosa de la Function ──────────────────────────────────────
export interface CreateAccountResult {
  status: 'ok'
  account_id: string
  admin_user_id: string
  slug: string
}

// ─── Resultado tipado del service ──────────────────────────────────────────
// No lanza excepciones por errores de negocio (slug en uso, validacion, etc.):
// los devuelve como { ok: false, error } para que la UI los muestre limpios.
// Solo casos verdaderamente inesperados podrian propagarse.
export type CreateAccountResponse =
  | { ok: true; data: CreateAccountResult }
  | { ok: false; error: string; detail?: string }

/**
 * Da de alta una cuenta cliente invocando la Edge Function create-account.
 *
 * El JWT de la sesion actual se adjunta automaticamente por
 * supabase.functions.invoke. La Function valida que sea platform_admin.
 *
 * Devuelve un resultado tipado (nunca throw por error de negocio):
 *   - { ok: true, data }   → cuenta creada; data trae account_id, admin_user_id.
 *   - { ok: false, error } → mensaje legible para mostrar en la UI.
 */
export async function createAccount(
  payload: CreateAccountPayload,
): Promise<CreateAccountResponse> {
  if (!supabase) {
    return { ok: false, error: 'Supabase no esta configurado en este entorno.' }
  }

  try {
    const { data, error } = await supabase.functions.invoke('create-account', {
      body: payload,
    })

    // Error de transporte / HTTP no-2xx. functions.invoke mete el cuerpo de
    // error en error.context (Response) cuando el status no es 2xx.
    if (error) {
      // Intentar extraer el JSON {error, detail} que devuelve la Function.
      let parsed: { error?: string; detail?: string } | null = null
      try {
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          parsed = await ctx.json()
        }
      } catch {
        parsed = null
      }
      return {
        ok: false,
        error: parsed?.error ?? error.message ?? 'Error al crear la cuenta.',
        detail: parsed?.detail,
      }
    }

    // Respuesta 2xx pero la Function pudo devolver un error de negocio en body.
    const body = data as Partial<CreateAccountResult> & { error?: string; detail?: string }
    if (body?.error) {
      return { ok: false, error: body.error, detail: body.detail }
    }

    if (body?.status === 'ok' && body.account_id) {
      return { ok: true, data: body as CreateAccountResult }
    }

    return { ok: false, error: 'Respuesta inesperada de create-account.', detail: JSON.stringify(body) }
  } catch (e) {
    return {
      ok: false,
      error: 'Error de red al invocar create-account.',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}
