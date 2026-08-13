// src/modules/multitenancy/services/channelDeliveryPolicyService.ts
//
// Quién reparte según PLATAFORMA × TIPO DE MARCA (channel_delivery_policy).
// ENCARGO CODE (13/08 noche) fix/hubrise-service-type-reparto, Tramo 2 —
// "esto no es de cambiar con una consulta SQL, esto es un SaaS que pretende
// ser serio" (Julio). El webhook de HubRise (resolveDeliveryServiceType) lee
// esta tabla para decidir si un pedido "delivery" entra como own_delivery o
// platform_delivery. Sin fila para una celda -> platform_delivery (seguro:
// no despachar es recuperable, despachar de más cuesta dinero real).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// channel_delivery_policy es una tabla NUEVA (migración 20260813T2230): aún
// no está en el database.ts generado. Mismo patrón de cast ya usado en
// goodsReceiptService.ts para tablas/RPC recién creadas.
function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}
type Row = Record<string, unknown>

export type OwnershipType = 'own' | 'licensed'
export type DeliveryServiceType = 'own_delivery' | 'platform_delivery'

export interface ChannelDeliveryPolicy {
  id: string
  channelSlug: string
  ownershipType: OwnershipType
  serviceType: DeliveryServiceType
  notes: string | null
}

// Mismo conjunto que channelSlug() en supabase/functions/hubrise-webhook/index.ts.
export const KNOWN_CHANNELS: { slug: string; label: string }[] = [
  { slug: 'uber', label: 'Uber Eats' },
  { slug: 'justeat', label: 'Just Eat' },
  { slug: 'glovo', label: 'Glovo' },
  { slug: 'deliveroo', label: 'Deliveroo' },
]

export async function listChannelDeliveryPolicies(accountId: string): Promise<ChannelDeliveryPolicy[]> {
  requireSupabase()
  const { data, error } = await from('channel_delivery_policy')
    .select('id, channel_slug, ownership_type, service_type, notes')
    .eq('account_id', accountId)
  if (error) throw new Error(`Error cargando la política de reparto: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({
    id: r.id as string,
    channelSlug: r.channel_slug as string,
    ownershipType: r.ownership_type as OwnershipType,
    serviceType: r.service_type as DeliveryServiceType,
    notes: (r.notes as string | null) ?? null,
  }))
}

/** Fija (crea o sustituye) la política de una celda plataforma × tipo de marca. */
export async function setChannelDeliveryPolicy(
  accountId: string,
  channelSlug: string,
  ownershipType: OwnershipType,
  serviceType: DeliveryServiceType,
  actor: { createdBy: string | null; createdByName: string | null },
): Promise<void> {
  requireSupabase()
  const { error } = await from('channel_delivery_policy')
    .upsert(
      {
        account_id: accountId,
        channel_slug: channelSlug,
        ownership_type: ownershipType,
        service_type: serviceType,
        updated_at: new Date().toISOString(),
        created_by: actor.createdBy,
        created_by_name: actor.createdByName,
      },
      { onConflict: 'account_id,channel_slug,ownership_type' },
    )
  if (error) throw new Error(`No se pudo guardar la política de reparto: ${error.message}`)
}

/** Borra la fila de una celda: vuelve al valor por defecto (platform_delivery). */
export async function clearChannelDeliveryPolicy(
  accountId: string, channelSlug: string, ownershipType: OwnershipType,
): Promise<void> {
  requireSupabase()
  const { error } = await from('channel_delivery_policy')
    .delete()
    .eq('account_id', accountId)
    .eq('channel_slug', channelSlug)
    .eq('ownership_type', ownershipType)
  if (error) throw new Error(`No se pudo restaurar la política de reparto: ${error.message}`)
}
