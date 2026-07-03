// src/modules/kitchen/services/mirrorService.ts
//
// Artículo espejo (versión promo): lee el estado combinado del par
// original/espejo y ejecuta el swap COMPLETO (is_available de ambos, coherente).
// swap_mirror y mirror_state viven en el servidor (SECURITY DEFINER, guard de
// cuenta); aquí solo los envolvemos. El swap SIEMPRE se ejecuta sobre el id del
// ORIGINAL (aunque se dispare desde la ficha del espejo).

import { supabase } from '@/lib/supabase'

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>
  }
}

export type MirrorRole = 'none' | 'original' | 'mirror'

export interface MirrorState {
  role: MirrorRole
  originalId: string | null
  originalName: string | null
  originalAvailable: boolean
  mirrorId: string | null
  mirrorName: string | null
  mirrorAvailable: boolean
  usingMirror: boolean          // el espejo es el visible ahora
}

const EMPTY: MirrorState = {
  role: 'none',
  originalId: null, originalName: null, originalAvailable: false,
  mirrorId: null, mirrorName: null, mirrorAvailable: false,
  usingMirror: false,
}

export async function getMirrorState(accountId: string, itemId: string): Promise<MirrorState> {
  try {
    const { data, error } = await db().rpc('mirror_state', { p_account: accountId, p_item: itemId })
    if (error || !data || !data.role) return EMPTY
    return {
      role: (data.role as MirrorRole) ?? 'none',
      originalId: data.originalId ?? null,
      originalName: data.originalName ?? null,
      originalAvailable: data.originalAvailable === true,
      mirrorId: data.mirrorId ?? null,
      mirrorName: data.mirrorName ?? null,
      mirrorAvailable: data.mirrorAvailable === true,
      usingMirror: data.usingMirror === true,
    }
  } catch {
    return EMPTY
  }
}

// Alterna la visibilidad entre original y espejo. p_item es SIEMPRE el original.
export async function swapMirror(
  accountId: string, originalItemId: string, useMirror: boolean,
): Promise<{ ok: boolean; usingMirror?: boolean; reason?: string }> {
  try {
    const { data, error } = await db().rpc('swap_mirror', {
      p_account: accountId, p_item: originalItemId, p_use_mirror: useMirror,
    })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true, usingMirror: data.usingMirror === true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'error' }
  }
}
