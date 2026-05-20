// tests/unit/services/accountStatusService.test.ts
//
// Sprint 2 F1 (20/05/2026): tests sobre checkAccountStatus().
//
// Cubre los 4 escenarios de respuesta + errores técnicos:
//   - 'ok' con redirect_to válido.
//   - 'no_active_profile' / 'all_accounts_suspended' / 'all_accounts_deleted'.
//   - Sin sesión activa → error.
//   - Network error (fetch rechaza).
//   - HTTP 4xx/5xx → error con mensaje.
//   - Respuesta no-JSON → error.
//   - Respuesta con shape inválido → error.
//
// MOCK HARNESS:
//   - `vi.mock('../../../src/lib/supabase')` reemplaza el cliente Supabase
//     con un stub controlado por test.
//   - `vi.stubGlobal('fetch', ...)` mockea fetch global.
//   - `vi.stubEnv()` para VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock del módulo supabase ANTES de importar checkAccountStatus.
// Importante: la ruta es relativa al test, no al import en el SUT.
vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
  isSupabaseEnabled: true,
}))

// Imports después del mock.
import { checkAccountStatus } from '../../../src/services/accountStatusService'
import { supabase } from '../../../src/lib/supabase'

/* =====================================================
   Helper: tipar el mock de getSession
   ===================================================== */

function mockSession(accessToken: string | null) {
  // supabase está mockeado pero TypeScript lo ve como SupabaseClient normal.
  // Usamos cast vía unknown para acceder al mock subyacente.
  const sb = supabase as unknown as {
    auth: { getSession: ReturnType<typeof vi.fn> }
  }
  if (accessToken === null) {
    sb.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    })
  } else {
    sb.auth.getSession.mockResolvedValue({
      data: { session: { access_token: accessToken } },
      error: null,
    })
  }
}

function mockSessionError(message: string) {
  const sb = supabase as unknown as {
    auth: { getSession: ReturnType<typeof vi.fn> }
  }
  sb.auth.getSession.mockResolvedValue({
    data: { session: null },
    error: { message },
  })
}

/* =====================================================
   Setup global
   ===================================================== */

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/* =====================================================
   Tests
   ===================================================== */

describe('checkAccountStatus', () => {
  describe('casos de éxito', () => {
    it('status=ok con redirect_to válido', async () => {
      mockSession('valid-jwt-token')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            status: 'ok',
            redirect_to: '/folvy/dashboard',
            message: null,
          }),
        })
      )

      const result = await checkAccountStatus()
      expect(result.status).toBe('ok')
      expect(result.redirect_to).toBe('/folvy/dashboard')
      expect(result.message).toBeNull()
    })

    it('status=no_active_profile con message', async () => {
      mockSession('valid-jwt')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            status: 'no_active_profile',
            redirect_to: null,
            message: 'No tienes acceso a ninguna cuenta activa.',
          }),
        })
      )

      const result = await checkAccountStatus()
      expect(result.status).toBe('no_active_profile')
      expect(result.redirect_to).toBeNull()
      expect(result.message).toContain('No tienes acceso')
    })

    it('status=all_accounts_suspended', async () => {
      mockSession('valid-jwt')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            status: 'all_accounts_suspended',
            redirect_to: null,
            message: 'Todas tus cuentas están suspendidas.',
          }),
        })
      )

      const result = await checkAccountStatus()
      expect(result.status).toBe('all_accounts_suspended')
    })

    it('status=all_accounts_deleted', async () => {
      mockSession('valid-jwt')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            status: 'all_accounts_deleted',
            redirect_to: null,
            message: null,
          }),
        })
      )

      const result = await checkAccountStatus()
      expect(result.status).toBe('all_accounts_deleted')
    })
  })

  describe('llamada HTTP correcta', () => {
    it('envía POST a /functions/v1/check-account-status con headers correctos', async () => {
      mockSession('my-jwt-token')
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', redirect_to: '/x', message: null }),
      })
      vi.stubGlobal('fetch', fetchMock)

      await checkAccountStatus()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('https://test.supabase.co/functions/v1/check-account-status')
      expect(options.method).toBe('POST')
      expect(options.headers).toMatchObject({
        'apikey': 'test-anon-key',
        'Authorization': 'Bearer my-jwt-token',
        'Content-Type': 'application/json',
      })
      expect(options.body).toBe('{}')
    })

    it('limpia trailing slash de VITE_SUPABASE_URL', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co/')
      mockSession('jwt')
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', redirect_to: '/x', message: null }),
      })
      vi.stubGlobal('fetch', fetchMock)

      await checkAccountStatus()

      const [url] = fetchMock.mock.calls[0]
      expect(url).toBe('https://test.supabase.co/functions/v1/check-account-status')
    })
  })

  describe('errores de sesión', () => {
    it('lanza si no hay sesión activa', async () => {
      mockSession(null)
      vi.stubGlobal('fetch', vi.fn())

      await expect(checkAccountStatus()).rejects.toThrow(/sesión Supabase activa/)
    })

    it('lanza si getSession devuelve error', async () => {
      mockSessionError('Token expired')
      vi.stubGlobal('fetch', vi.fn())

      await expect(checkAccountStatus()).rejects.toThrow(/Token expired/)
    })
  })

  describe('errores técnicos', () => {
    it('lanza si fetch falla (network error)', async () => {
      mockSession('jwt')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Failed to fetch'))
      )

      await expect(checkAccountStatus()).rejects.toThrow(/Error de red/)
    })

    it('lanza si HTTP 5xx con body JSON', async () => {
      mockSession('jwt')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ message: 'Internal Server Error' }),
        })
      )

      await expect(checkAccountStatus()).rejects.toThrow(/Internal Server Error/)
    })

    it('lanza si HTTP 401 con body JSON', async () => {
      mockSession('jwt')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({ message: 'JWT inválido' }),
        })
      )

      await expect(checkAccountStatus()).rejects.toThrow(/JWT inválido/)
    })

    it('lanza si respuesta no es JSON parseable', async () => {
      mockSession('jwt')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('Unexpected token')
          },
        })
      )

      await expect(checkAccountStatus()).rejects.toThrow(/no-JSON/)
    })

    it('lanza si shape de respuesta es inválido (sin status)', async () => {
      mockSession('jwt')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ redirect_to: '/x', message: null }),
        })
      )

      await expect(checkAccountStatus()).rejects.toThrow(/shape inesperado/)
    })

    it('lanza si shape es null', async () => {
      mockSession('jwt')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => null,
        })
      )

      await expect(checkAccountStatus()).rejects.toThrow(/shape inesperado/)
    })
  })

  describe('errores de configuración de entorno', () => {
    it('lanza si VITE_SUPABASE_URL no está configurado', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', '')
      mockSession('jwt')

      await expect(checkAccountStatus()).rejects.toThrow(/VITE_SUPABASE_URL/)
    })

    it('lanza si VITE_SUPABASE_ANON_KEY no está configurado', async () => {
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
      mockSession('jwt')

      await expect(checkAccountStatus()).rejects.toThrow(/VITE_SUPABASE_ANON_KEY/)
    })
  })
})
