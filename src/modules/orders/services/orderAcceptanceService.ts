// src/modules/orders/services/orderAcceptanceService.ts
//
// Auto-aceptación de pedidos — servicio de la zona de Ajustes de Folvy Orders.
// Frontera fina sobre la tabla `order_acceptance_config` (cuenta × canal × marca).
//
// MODELO (baseline ON, igual que la frontera del webhook):
//   - SIN fila que case  -> auto-aceptar ON (estándar de integradores).
//   - fila auto_accept=false -> OFF para ese caso.
//   La UI escribe una fila EXPLÍCITA por canal al togglear (auditable: autor+fecha),
//   pero la lectura respeta el baseline: un canal nunca tocado se muestra ON.
//   El nivel MARCA llegará con P-A (hoy brand_id null = nivel canal).
//
// `order_acceptance_config` aún no está en database.ts (tabla nueva) -> patrón
// from() casteado, calcado de kdsService. DEUDA menor: regenerar types y tipar.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>
function from(table: string) {
  requireSupabase()
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

// Best-effort: id del usuario actual para `updated_by` (rastro). Si no hay
// sesión legible, devuelve null (la columna lo admite) — nunca bloquea.
async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase!.auth.getUser()
    return data?.user?.id ?? null
  } catch {
    return null
  }
}

export interface ChannelAcceptance {
  channelId: string
  slug: string | null
  name: string
  color: string | null
  /** Estado efectivo mostrado en la UI (baseline ON si no hay fila). */
  autoAccept: boolean
  /** true si existe una fila explícita para este canal (toque previo). */
  hasExplicitRow: boolean
}

/**
 * Lista los canales activos de la cuenta con su estado de auto-aceptación.
 * Resuelve por baseline: fila de canal > defecto de cuenta (channel_id null) > ON.
 */
export async function listChannelAcceptance(accountId: string): Promise<ChannelAcceptance[]> {
  // 1) Canales activos de la cuenta.
  const { data: chData, error: chErr } = await from('sales_channel')
    .select('id, slug, name, color, is_active')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('name')
  if (chErr) throw new Error(`Orders · canales: ${chErr.message}`)
  const channels = (chData ?? []) as Row[]

  // 2) Config de nivel canal/cuenta (brand_id null = no específico de marca).
  const { data: cfgData, error: cfgErr } = await from('order_acceptance_config')
    .select('channel_id, auto_accept')
    .eq('account_id', accountId)
    .is('brand_id', null)
  if (cfgErr) throw new Error(`Orders · config: ${cfgErr.message}`)
  const cfg = (cfgData ?? []) as Row[]

  const byChannel = new Map<string, boolean>()
  let accountDefault: boolean | null = null
  for (const r of cfg) {
    const ch = (r['channel_id'] as string | null) ?? null
    const aa = r['auto_accept'] !== false // null/true -> true
    if (ch === null) accountDefault = aa
    else byChannel.set(ch, aa)
  }

  return channels.map((c): ChannelAcceptance => {
    const id = c['id'] as string
    const explicit = byChannel.has(id)
    const effective = explicit
      ? (byChannel.get(id) as boolean)
      : (accountDefault ?? true) // sin fila de canal: defecto de cuenta, o ON
    return {
      channelId: id,
      slug: (c['slug'] as string | null) ?? null,
      name: (c['name'] as string | null) ?? 'Canal',
      color: (c['color'] as string | null) ?? null,
      autoAccept: effective,
      hasExplicitRow: explicit,
    }
  })
}

/**
 * Enciende/apaga la auto-aceptación de un canal (nivel canal, brand_id null).
 * Escribe una fila explícita (upsert manual: el índice único es sobre expresión
 * COALESCE, así que no se usa onConflict de PostgREST). Idempotente.
 */
export async function setChannelAutoAccept(
  accountId: string, channelId: string, autoAccept: boolean,
): Promise<void> {
  const updatedBy = await currentUserId()

  // ¿Existe ya la fila de este canal (brand null)?
  const { data: existing, error: exErr } = await from('order_acceptance_config')
    .select('id')
    .eq('account_id', accountId)
    .eq('channel_id', channelId)
    .is('brand_id', null)
    .limit(1)
    .maybeSingle()
  if (exErr) throw new Error(`Orders · lookup: ${exErr.message}`)

  if (existing) {
    const { error } = await from('order_acceptance_config')
      .update({ auto_accept: autoAccept, updated_at: new Date().toISOString(), updated_by: updatedBy })
      .eq('id', (existing as { id: string }).id)
    if (error) throw new Error(`Orders · update: ${error.message}`)
    return
  }

  const { error } = await from('order_acceptance_config').insert({
    account_id: accountId,
    channel_id: channelId,
    brand_id: null,
    auto_accept: autoAccept,
    updated_by: updatedBy,
  })
  if (error) throw new Error(`Orders · insert: ${error.message}`)
}
