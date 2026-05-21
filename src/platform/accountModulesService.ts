// src/platform/accountModulesService.ts
//
// Service del panel admin para gestionar los módulos (submódulos) contratados
// por una cuenta cliente. Sesión 16.
//
// Lee el catálogo de submódulos DIRECTAMENTE de la BBDD (tablas modules +
// submodules), no hardcodeado: un módulo nuevo insertado en BBDD aparece solo
// en la pantalla, sin tocar código. (Resuelve la deuda de NuevaCuentaPage que
// sí tiene el catálogo a mano.)
//
// SEGURIDAD: la RLS de subscription_items exige current_user_is_admin()
// (= estar en platform_admins activo) para escribir. Por eso este service
// escribe directo con la sesión actual del platform admin, sin RPC ni Edge
// Function. Si lo invoca un no-admin, la RLS rechaza el write.
//
// PRECIO: al activar un submódulo se guarda unit_price_eur = 0 (modelo de
// precios desacoplado, decisión registrada en CONTEXTO_ESTADO §1). El precio
// real se gestionará donde se decida el cobro; rellenar este campo después
// no rompe nada.
//
// BAJA: quitar un submódulo NO borra el item; lo marca status='canceled' +
// ends_at=now() (conserva historial). Reactivar uno dado de baja lo vuelve a
// 'active' y limpia ends_at. (Valores de status válidos por CHECK:
// active / trialing / canceled.)

import { supabase } from '../lib/supabase'

// ─── Tipos de dominio del catálogo ─────────────────────────────────────────

export interface CatalogModule {
  id: string
  code: string
  name: string
  sortOrder: number
  submodules: CatalogSubmodule[]
}

export interface CatalogSubmodule {
  id: string
  code: string
  name: string
  type: string            // 'tier' | 'addon'
  tierLevel: number | null
  sortOrder: number
}

export interface AccountModuleItem {
  itemId: string
  submoduleId: string
  active: boolean         // true si status='active'
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase no está configurado.')
  }
  return supabase
}

// ─── Catálogo (módulos + submódulos activos), desde BBDD ───────────────────

/**
 * Devuelve el catálogo comercial agrupado por módulo, ordenado.
 * Solo submódulos con status='active' (el catálogo vivo).
 */
export async function getCatalog(): Promise<CatalogModule[]> {
  const sb = requireSupabase()

  const { data: modules, error: modErr } = await sb
    .from('modules')
    .select('id, code, name, sort_order')
    .eq('status', 'active')
    .order('sort_order', { ascending: true })
  if (modErr) throw new Error(`Error cargando módulos: ${modErr.message}`)

  const { data: subs, error: subErr } = await sb
    .from('submodules')
    .select('id, code, name, type, tier_level, sort_order, module_id')
    .eq('status', 'active')
    .order('sort_order', { ascending: true })
  if (subErr) throw new Error(`Error cargando submódulos: ${subErr.message}`)

  return (modules ?? []).map(m => ({
    id: m.id,
    code: m.code,
    name: m.name,
    sortOrder: m.sort_order ?? 0,
    submodules: (subs ?? [])
      .filter(s => s.module_id === m.id)
      .map(s => ({
        id: s.id,
        code: s.code,
        name: s.name,
        type: s.type,
        tierLevel: s.tier_level,
        sortOrder: s.sort_order ?? 0,
      })),
  }))
}

// ─── Items de una cuenta ───────────────────────────────────────────────────

/**
 * Resuelve la subscription de una cuenta. El alta crea una por cuenta.
 * Devuelve null si no existe (cuenta sin suscripción).
 */
async function getSubscriptionId(accountId: string): Promise<string | null> {
  const sb = requireSupabase()
  const { data, error } = await sb
    .from('subscriptions')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw new Error(`Error resolviendo suscripción: ${error.message}`)
  return data?.id ?? null
}

/**
 * Lista los items de la cuenta (todos, activos e inactivos), para saber
 * qué está marcado y qué existe ya en BBDD (para reactivar en vez de duplicar).
 */
export async function getAccountItems(accountId: string): Promise<AccountModuleItem[]> {
  const sb = requireSupabase()
  const subscriptionId = await getSubscriptionId(accountId)
  if (!subscriptionId) return []

  const { data, error } = await sb
    .from('subscription_items')
    .select('id, submodule_id, status')
    .eq('subscription_id', subscriptionId)
  if (error) throw new Error(`Error cargando items: ${error.message}`)

  return (data ?? []).map(r => ({
    itemId: r.id,
    submoduleId: r.submodule_id,
    active: r.status === 'active',
  }))
}

// ─── Reconciliación: fija el conjunto de submódulos activos ────────────────

/**
 * Reconcilia los submódulos activos de una cuenta con la lista deseada.
 *
 *   - submódulo deseado SIN item        → INSERT (active, qty 1, precio 0).
 *   - submódulo deseado CON item inactivo → UPDATE a active, ends_at=null.
 *   - submódulo NO deseado CON item activo → UPDATE a canceled, ends_at=now().
 *   - submódulo deseado con item ya activo → no se toca.
 *
 * No usa transacción multi-statement (supabase-js no la expone); cada cambio
 * es idempotente y la operación es segura de re-ejecutar.
 */
export async function setAccountModules(
  accountId: string,
  desiredSubmoduleIds: string[],
): Promise<void> {
  const sb = requireSupabase()
  const subscriptionId = await getSubscriptionId(accountId)
  if (!subscriptionId) {
    throw new Error('La cuenta no tiene suscripción; no se pueden asignar módulos.')
  }

  const current = await getAccountItems(accountId)
  const desired = new Set(desiredSubmoduleIds)
  const nowIso = new Date().toISOString()

  const currentBySubmodule = new Map(current.map(i => [i.submoduleId, i]))

  // 1. Activar / reactivar / crear los deseados.
  for (const submoduleId of desired) {
    const existing = currentBySubmodule.get(submoduleId)
    if (!existing) {
      const { error } = await sb.from('subscription_items').insert({
        subscription_id: subscriptionId,
        submodule_id: submoduleId,
        quantity: 1,
        unit_price_eur: 0,
        status: 'active',
        starts_at: nowIso,
        ends_at: null,
      })
      if (error) throw new Error(`Error activando submódulo ${submoduleId}: ${error.message}`)
    } else if (!existing.active) {
      const { error } = await sb
        .from('subscription_items')
        .update({ status: 'active', ends_at: null })
        .eq('id', existing.itemId)
      if (error) throw new Error(`Error reactivando submódulo ${submoduleId}: ${error.message}`)
    }
  }

  // 2. Dar de baja los activos que ya no se desean.
  for (const item of current) {
    if (item.active && !desired.has(item.submoduleId)) {
      const { error } = await sb
        .from('subscription_items')
        .update({ status: 'canceled', ends_at: nowIso })
        .eq('id', item.itemId)
      if (error) throw new Error(`Error dando de baja submódulo ${item.submoduleId}: ${error.message}`)
    }
  }
}
