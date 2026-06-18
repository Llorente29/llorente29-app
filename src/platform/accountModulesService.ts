// src/platform/accountModulesService.ts
//
// Service del panel admin para gestionar los módulos (submódulos) contratados
// por una cuenta cliente. Sesión 16.
//
// Lee el catálogo de submódulos DIRECTAMENTE de la BBDD (tablas modules +
// submodules), no hardcodeado: un módulo nuevo insertado en BBDD aparece solo
// en la pantalla, sin tocar código.
//
// SEGURIDAD: la RLS de subscription_items exige current_user_is_admin()
// (= estar en platform_admins activo) para escribir. Por eso este service
// escribe directo con la sesión actual del platform admin, sin RPC ni Edge
// Function. Si lo invoca un no-admin, la RLS rechaza el write.
//
// PRECIO (Sesión 18, capa de precios P-C): al activar un add-on (type='addon')
// se siembra unit_price_eur desde submodules.price_eur (precio de catálogo),
// editable por cliente. Los 'tier' (parte del plan) van a 0. Al reactivar un
// add-on se refresca su precio al de catálogo vigente.
//
// BAJA: quitar un submódulo NO borra el item; lo marca status='canceled' +
// ends_at=now() (conserva historial). Reactivar uno dado de baja lo vuelve a
// 'active' y limpia ends_at.
//
// AUDITORÍA (Sesión 18): tras reconciliar, registra un evento
// account_modules_changed (vía RPC log_platform_event) con los códigos de los
// submódulos activados/desactivados. Best-effort: si el log falla, la operación
// de negocio (que ya está persistida) NO se revierte ni lanza error.

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

// ─── Auditoría (best-effort) ───────────────────────────────────────────────

/**
 * Resuelve una lista de submodule ids a sus codes legibles (para el detalle
 * del evento de auditoría). Si falla, devuelve los ids tal cual (no crítico).
 */
async function resolveSubmoduleCodes(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const sb = requireSupabase()
  try {
    const { data } = await sb.from('submodules').select('id, code').in('id', ids)
    const byId = new Map((data ?? []).map(r => [r.id, r.code]))
    return ids.map(id => byId.get(id) ?? id)
  } catch {
    return ids
  }
}

/**
 * Registra el evento account_modules_changed. Best-effort: nunca lanza.
 */
async function auditModulesChange(
  accountId: string,
  activatedIds: string[],
  deactivatedIds: string[],
): Promise<void> {
  if (activatedIds.length === 0 && deactivatedIds.length === 0) return
  try {
    const sb = requireSupabase()
    const [activated, deactivated] = await Promise.all([
      resolveSubmoduleCodes(activatedIds),
      resolveSubmoduleCodes(deactivatedIds),
    ])
    await sb.rpc('log_platform_event', {
      p_event_type: 'account_modules_changed',
      p_target_account_id: accountId,
      p_target_user_id: undefined,
      p_details: { activated, deactivated },
    })
  } catch (e) {
    // El cambio de módulos ya está persistido; el log es secundario.
    console.warn('[auditModulesChange] no se pudo registrar el evento:', e)
  }
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
 *
 * Tras reconciliar, registra el evento de auditoría con lo activado/desactivado.
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

  // Precio de catálogo a sembrar: add-ons -> submodules.price_eur; tiers -> 0.
  const priceBySubmodule = new Map<string, number>()
  if (desiredSubmoduleIds.length > 0) {
    const { data: meta, error: metaErr } = await sb
      .from('submodules')
      .select('id, type, price_eur')
      .in('id', desiredSubmoduleIds)
    if (metaErr) throw new Error(`Error cargando precios de catálogo: ${metaErr.message}`)
    for (const r of meta ?? []) {
      priceBySubmodule.set(r.id, r.type === 'addon' ? Number(r.price_eur ?? 0) : 0)
    }
  }
  const priceFor = (id: string) => priceBySubmodule.get(id) ?? 0

  const currentBySubmodule = new Map(current.map(i => [i.submoduleId, i]))
  const activeBefore = new Set(current.filter(i => i.active).map(i => i.submoduleId))

  // Diffs para la auditoría (qué pasó a activo / qué se dio de baja).
  const activatedIds: string[] = []
  const deactivatedIds: string[] = []

  // 1. Activar / reactivar / crear los deseados.
  for (const submoduleId of desired) {
    const existing = currentBySubmodule.get(submoduleId)
    if (!existing) {
      const { error } = await sb.from('subscription_items').insert({
        subscription_id: subscriptionId,
        submodule_id: submoduleId,
        quantity: 1,
        unit_price_eur: priceFor(submoduleId),
        status: 'active',
        starts_at: nowIso,
        ends_at: null,
      })
      if (error) throw new Error(`Error activando submódulo ${submoduleId}: ${error.message}`)
      activatedIds.push(submoduleId)
    } else if (!existing.active) {
      const { error } = await sb
        .from('subscription_items')
        .update({ status: 'active', ends_at: null, unit_price_eur: priceFor(submoduleId) })
        .eq('id', existing.itemId)
      if (error) throw new Error(`Error reactivando submódulo ${submoduleId}: ${error.message}`)
      activatedIds.push(submoduleId)
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
      deactivatedIds.push(item.submoduleId)
    }
  }

  // 3. Auditoría (best-effort, tras persistir los cambios). No rompe si falla.
  void activeBefore // (referencia conservada por claridad del diff arriba)
  await auditModulesChange(accountId, activatedIds, deactivatedIds)
}
