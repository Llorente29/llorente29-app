// tests/__mocks__/supabase.ts
//
// Helper para mockear el cliente Supabase en tests unitarios.
//
// ⚠️ ALCANCE ACTUAL (minimal):
// Esta versión cubre solo lo que necesitamos hoy: tests de funciones puras
// (slug, mappers) que NO tocan la cadena `.from().select().eq()...`.
//
// Cuando empecemos a testear listBrands / createBrand / etc., habrá que
// ampliar este mock para simular la cadena encadenable con resolves
// configurables paso a paso. Lo dejo apuntado como TODO arriba.
//
// TODO Fase 1: añadir createSupabaseChainMock() que devuelva un proxy
// encadenable: .from().select().eq().single() → { data, error } configurable
// por método via mockResolvedValueOnce.

import { vi } from 'vitest'

export interface SupabaseMockResult<T = unknown> {
  data: T | null
  error: { message: string } | null
}

/**
 * Crea un mock mínimo del cliente Supabase.
 *
 * Útil cuando solo necesitas que `import { supabase } from '@/lib/supabase'`
 * no explote en tests que en realidad no llaman a Supabase (tests de funciones
 * puras del mismo módulo).
 *
 * Si tu test SÍ ejerce la cadena `.from(...).select(...)...`, usa el mock
 * encadenable (TODO Fase 1) en su lugar.
 *
 * Ejemplo de uso (top-level del archivo de test):
 *
 *   vi.mock('@/lib/supabase', () => ({
 *     supabase: createMinimalSupabaseMock(),
 *     isSupabaseEnabled: true,
 *   }))
 */
export function createMinimalSupabaseMock() {
  return {
    from: vi.fn(),
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      signInWithOtp: vi.fn(),
      signOut: vi.fn(),
    },
  }
}

/**
 * Construye un resultado `{ data, error }` con forma Supabase.
 *
 * Comodidad sintáctica para tests:
 *   ok({ id: '...' })          → { data: {...}, error: null }
 *   fail('No such row')        → { data: null, error: { message: 'No such row' } }
 */
export function ok<T>(data: T): SupabaseMockResult<T> {
  return { data, error: null }
}

export function fail(message: string): SupabaseMockResult<never> {
  return { data: null, error: { message } }
}
