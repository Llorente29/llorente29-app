// src/modules/multitenancy/services/brandDeliveryService.ts
//
// Interruptor de reparto propio POR MARCA. Corrige el defecto detectado el
// 2026-08-01: pedidos de marcas cedidas (ownership_type='licensed') se
// despachaban a Catcher por error porque resolve_dispatch() no miraba la
// marca. Ver migración 20260801T1800_dispatch_guard_marca_reparto_propio.sql
// (registro del guard ya aplicado en producción).
//
// Modelo: brand.own_delivery_enabled boolean NULLABLE.
//   - NULL  → hereda de ownership_type (propia=on, cedida=off).
//   - true/false → override explícito.
//   - Interruptor EFECTIVO (el que usa resolve_dispatch en BBDD):
//     coalesce(own_delivery_enabled, ownership_type = 'own').

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { BrandOwnershipType } from '../../../types/multitenancy'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

export interface BrandDeliveryFlag {
  id: string
  name: string
  ownershipType: BrandOwnershipType
  /** Valor explícito guardado. null = hereda de ownershipType. */
  ownDeliveryEnabled: boolean | null
  /** Lo que resolve_dispatch usaría de verdad: coalesce(ownDeliveryEnabled, ownershipType==='own'). */
  effectiveEnabled: boolean
}

/** Interruptor de reparto propio de todas las marcas activas de la cuenta. */
export async function listBrandDeliveryFlags(accountId: string): Promise<BrandDeliveryFlag[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand')
    .select('id, name, ownership_type, own_delivery_enabled')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .is('archived_at', null)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error cargando reparto por marca: ${error.message}`)
  return (data ?? []).map(r => {
    const ownershipType = r.ownership_type as BrandOwnershipType
    const ownDeliveryEnabled = r.own_delivery_enabled
    return {
      id: r.id,
      name: r.name,
      ownershipType,
      ownDeliveryEnabled,
      effectiveEnabled: ownDeliveryEnabled ?? (ownershipType === 'own'),
    }
  })
}

/** Fija el interruptor de UNA marca. null = restaurar por defecto (hereda de ownershipType). */
export async function setBrandOwnDelivery(brandId: string, enabled: boolean | null): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('brand')
    .update({ own_delivery_enabled: enabled })
    .eq('id', brandId)
  if (error) throw new Error(`No se pudo guardar el reparto de la marca: ${error.message}`)
}

/** Fija el interruptor de VARIAS marcas a la vez ("por grupo": selección manual + aplicar). */
export async function setBrandOwnDeliveryBulk(brandIds: string[], enabled: boolean | null): Promise<void> {
  requireSupabase()
  if (brandIds.length === 0) return
  const { error } = await supabase!
    .from('brand')
    .update({ own_delivery_enabled: enabled })
    .in('id', brandIds)
  if (error) throw new Error(`No se pudo guardar el reparto en bloque: ${error.message}`)
}
