// tests/unit/services/authService.test.ts
//
// Sprint 2 F1 (20/05/2026): cobertura completa del wrapper authService.
//
// Cubre:
//   - signInWithPassword: success/failed + logging E1.
//   - signOut: orden correcto (log ANTES de invalidar sesión).
//   - resetPasswordForEmail: redirectTo bien construido + manejo errores.
//   - updateUserPassword: success + traducción errores.
//   - getCurrentUser: caso normal + 'Auth session missing!' silencioso.
//   - logSecurityEvent: INSERT correcto + actor_user_id resuelto.
//   - onAuthStateChange: subscribe + unsubscribe.
//   - verifyOtpInvite: success + error de token expirado.
//
// MOCK HARNESS:
//   - vi.mock('../../../src/lib/supabase') con cliente stub completo.
//   - Cada test resetea mocks en beforeEach.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      getUser: vi.fn(),
      verifyOtp: vi.fn(),
      signInWithOtp: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn(),
  },
  isSupabaseEnabled: true,
}))

import {
  signInWithPassword,
  signOut,
  resetPasswordForEmail,
  updateUserPassword,
  getCurrentUser,
  verifyOtpInvite,
  sendMagicLink,
  logSecurityEvent,
  onAuthStateChange,
} from '../../../src/services/authService'
import { supabase } from '../../../src/lib/supabase'

/* =====================================================
   Helpers de tipado del mock
   ===================================================== */

function getAuthMock() {
  return (supabase as unknown as {
    auth: {
      signInWithPassword: ReturnType<typeof vi.fn>
      signOut: ReturnType<typeof vi.fn>
      resetPasswordForEmail: ReturnType<typeof vi.fn>
      updateUser: ReturnType<typeof vi.fn>
      getUser: ReturnType<typeof vi.fn>
      verifyOtp: ReturnType<typeof vi.fn>
      signInWithOtp: ReturnType<typeof vi.fn>
      onAuthStateChange: ReturnType<typeof vi.fn>
    }
  }).auth
}

function getFromMock() {
  return (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from
}

/**
 * Configura el chain de query: supabase.from('xxx').insert(row).
 * Por defecto el INSERT resuelve sin error.
 */
function mockInsertSuccess() {
  const insertFn = vi.fn().mockResolvedValue({ error: null })
  getFromMock().mockReturnValue({ insert: insertFn })
  return insertFn
}

/* =====================================================
   Setup global
   ===================================================== */

beforeEach(() => {
  vi.stubEnv('VITE_APP_URL', 'https://app.folvy.app')
  vi.clearAllMocks()
  // Por defecto getUser devuelve null (sin sesión). Cada test sobrescribe
  // si necesita user activo (e.g. para logSecurityEvent con actor).
  getAuthMock().getUser.mockResolvedValue({
    data: { user: null },
    error: null,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/* =====================================================
   signInWithPassword
   ===================================================== */

describe('signInWithPassword', () => {
  it('devuelve ok:true con user cuando Supabase retorna user', async () => {
    const fakeUser = { id: 'user-123', email: 'test@x.com' }
    getAuthMock().signInWithPassword.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    })
    mockInsertSuccess()

    const result = await signInWithPassword('test@x.com', 'password')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user).toEqual(fakeUser)
    }
  })

  it('devuelve ok:false con error.message cuando Supabase devuelve error', async () => {
    getAuthMock().signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    })
    mockInsertSuccess()

    const result = await signInWithPassword('bad@x.com', 'wrong')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Invalid login credentials')
    }
  })

  it('E1: registra login_success en audit log tras éxito', async () => {
    getAuthMock().signInWithPassword.mockResolvedValue({
      data: { user: { id: 'u1', email: 'x@x.com' } },
      error: null,
    })
    // Tras login exitoso, getUser devuelve el user nuevo
    getAuthMock().getUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'x@x.com' } },
      error: null,
    })
    const insertFn = mockInsertSuccess()

    await signInWithPassword('x@x.com', 'Pass1234')

    // Esperar a que el void logSecurityEvent termine.
    await new Promise(r => setTimeout(r, 0))

    expect(getFromMock()).toHaveBeenCalledWith('security_audit_log')
    expect(insertFn).toHaveBeenCalled()
    const insertedRow = insertFn.mock.calls[0][0]
    expect(insertedRow.action).toBe('login_success')
    expect(insertedRow.details).toMatchObject({ email: 'x@x.com' })
    expect(insertedRow.actor_user_id).toBe('u1')
  })

  it('E1: registra login_failed en audit log tras error', async () => {
    getAuthMock().signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    })
    // No hay user tras fallo
    const insertFn = mockInsertSuccess()

    await signInWithPassword('bad@x.com', 'wrong')

    await new Promise(r => setTimeout(r, 0))

    const insertedRow = insertFn.mock.calls[0][0]
    expect(insertedRow.action).toBe('login_failed')
    expect(insertedRow.details).toMatchObject({
      email: 'bad@x.com',
      error_message: 'Invalid login credentials',
    })
    expect(insertedRow.actor_user_id).toBeNull()
  })

  it('devuelve ok:false si data.user es null sin error explícito', async () => {
    getAuthMock().signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: null,
    })
    mockInsertSuccess()

    const result = await signInWithPassword('x@x.com', 'p')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('sin user retornado')
    }
  })
})

/* =====================================================
   signOut
   ===================================================== */

describe('signOut', () => {
  it('devuelve ok:true cuando Supabase signOut OK', async () => {
    getAuthMock().signOut.mockResolvedValue({ error: null })
    mockInsertSuccess()

    const result = await signOut()
    expect(result.ok).toBe(true)
  })

  it('devuelve ok:false cuando Supabase signOut devuelve error', async () => {
    getAuthMock().signOut.mockResolvedValue({
      error: { message: 'Network error' },
    })
    mockInsertSuccess()

    const result = await signOut()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Network error')
    }
  })

  it('E1: registra logout ANTES de invalidar la sesión (orden crítico)', async () => {
    // Setup: hay user logueado al inicio
    getAuthMock().getUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'x@x.com' } },
      error: null,
    })
    getAuthMock().signOut.mockResolvedValue({ error: null })
    const insertFn = mockInsertSuccess()

    // Snapshot del orden de llamadas
    const callOrder: string[] = []
    insertFn.mockImplementation(async () => {
      callOrder.push('insert')
      return { error: null }
    })
    getAuthMock().signOut.mockImplementation(async () => {
      callOrder.push('signOut')
      return { error: null }
    })

    await signOut()

    // El insert (audit log) debe ocurrir ANTES del signOut, para que
    // getCurrentUser dentro de logSecurityEvent resuelva actor_user_id.
    expect(callOrder.indexOf('insert')).toBeLessThan(
      callOrder.indexOf('signOut')
    )

    const insertedRow = insertFn.mock.calls[0][0]
    expect(insertedRow.action).toBe('logout')
    expect(insertedRow.actor_user_id).toBe('u1')
  })
})

/* =====================================================
   resetPasswordForEmail
   ===================================================== */

describe('resetPasswordForEmail', () => {
  it('llama a Supabase con redirectTo construido desde VITE_APP_URL', async () => {
    getAuthMock().resetPasswordForEmail.mockResolvedValue({ error: null })

    await resetPasswordForEmail('user@x.com')

    expect(getAuthMock().resetPasswordForEmail).toHaveBeenCalledWith(
      'user@x.com',
      { redirectTo: 'https://app.folvy.app/reset-password/confirm' }
    )
  })

  it('limpia trailing slash de VITE_APP_URL', async () => {
    vi.stubEnv('VITE_APP_URL', 'https://app.folvy.app/')
    getAuthMock().resetPasswordForEmail.mockResolvedValue({ error: null })

    await resetPasswordForEmail('user@x.com')

    expect(getAuthMock().resetPasswordForEmail).toHaveBeenCalledWith(
      'user@x.com',
      { redirectTo: 'https://app.folvy.app/reset-password/confirm' }
    )
  })

  it('devuelve ok:true cuando Supabase responde OK', async () => {
    getAuthMock().resetPasswordForEmail.mockResolvedValue({ error: null })

    const result = await resetPasswordForEmail('user@x.com')
    expect(result.ok).toBe(true)
  })

  it('devuelve ok:false cuando Supabase devuelve error', async () => {
    getAuthMock().resetPasswordForEmail.mockResolvedValue({
      error: { message: 'Rate limit exceeded' },
    })

    const result = await resetPasswordForEmail('user@x.com')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Rate limit')
    }
  })
})

/* =====================================================
   updateUserPassword
   ===================================================== */

describe('updateUserPassword', () => {
  it('llama a Supabase auth.updateUser con la nueva password', async () => {
    getAuthMock().updateUser.mockResolvedValue({ error: null })

    await updateUserPassword('NewP4ssw0rd')

    expect(getAuthMock().updateUser).toHaveBeenCalledWith({
      password: 'NewP4ssw0rd',
    })
  })

  it('devuelve ok:true tras éxito', async () => {
    getAuthMock().updateUser.mockResolvedValue({ error: null })
    const result = await updateUserPassword('NewP4ss')
    expect(result.ok).toBe(true)
  })

  it('devuelve ok:false con error de Supabase', async () => {
    getAuthMock().updateUser.mockResolvedValue({
      error: { message: 'Password should be at least 8 characters' },
    })
    const result = await updateUserPassword('short')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('at least 8 characters')
    }
  })

  it('devuelve ok:false con error de leaked password', async () => {
    getAuthMock().updateUser.mockResolvedValue({
      error: { message: 'Password is leaked' },
    })
    const result = await updateUserPassword('password123')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain('leaked')
    }
  })
})

/* =====================================================
   getCurrentUser
   ===================================================== */

describe('getCurrentUser', () => {
  it('devuelve user cuando hay sesión activa', async () => {
    const fakeUser = { id: 'u1', email: 'x@x.com' }
    getAuthMock().getUser.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    })

    const user = await getCurrentUser()
    expect(user).toEqual(fakeUser)
  })

  it('devuelve null si no hay sesión (error "Auth session missing!")', async () => {
    getAuthMock().getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Auth session missing!' },
    })

    const user = await getCurrentUser()
    expect(user).toBeNull()
  })

  it('devuelve null si data.user es null sin error', async () => {
    getAuthMock().getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const user = await getCurrentUser()
    expect(user).toBeNull()
  })

  it('devuelve null y loggea error si Supabase devuelve error inesperado', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getAuthMock().getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Unexpected DB error' },
    })

    const user = await getCurrentUser()
    expect(user).toBeNull()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

/* =====================================================
   verifyOtpInvite
   ===================================================== */

describe('verifyOtpInvite', () => {
  it('llama a Supabase verifyOtp con type=invite', async () => {
    getAuthMock().verifyOtp.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    })

    await verifyOtpInvite('user@x.com', 'token123')

    expect(getAuthMock().verifyOtp).toHaveBeenCalledWith({
      email: 'user@x.com',
      token: 'token123',
      type: 'invite',
    })
  })

  it('devuelve ok:true con user tras éxito', async () => {
    const fakeUser = { id: 'u1', email: 'x@x.com' }
    getAuthMock().verifyOtp.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    })

    const result = await verifyOtpInvite('x@x.com', 'tok')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user).toEqual(fakeUser)
    }
  })

  it('devuelve ok:false con error de token expirado', async () => {
    getAuthMock().verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: 'Token has expired or is invalid' },
    })

    const result = await verifyOtpInvite('x@x.com', 'tok')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('expired or is invalid')
    }
  })
})

/* =====================================================
   sendMagicLink (deprecated, pero hay que mantener tests)
   ===================================================== */

describe('sendMagicLink (deprecated)', () => {
  it('llama a signInWithOtp con shouldCreateUser=false por defecto', async () => {
    getAuthMock().signInWithOtp.mockResolvedValue({ error: null })

    await sendMagicLink('user@x.com')

    expect(getAuthMock().signInWithOtp).toHaveBeenCalledWith({
      email: 'user@x.com',
      options: {
        shouldCreateUser: false,
        emailRedirectTo: 'https://app.folvy.app',
      },
    })
  })

  it('respeta shouldCreateUser=true cuando se pasa explícitamente', async () => {
    getAuthMock().signInWithOtp.mockResolvedValue({ error: null })

    await sendMagicLink('user@x.com', true)

    expect(getAuthMock().signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ shouldCreateUser: true }),
      })
    )
  })
})

/* =====================================================
   logSecurityEvent (Regla 4: solo invocamos, NO la modificamos)
   ===================================================== */

describe('logSecurityEvent', () => {
  it('INSERT con actor_user_id desde getCurrentUser', async () => {
    getAuthMock().getUser.mockResolvedValue({
      data: { user: { id: 'actor-uuid', email: 'a@x.com' } },
      error: null,
    })
    const insertFn = mockInsertSuccess()

    await logSecurityEvent('test_action', { foo: 'bar' })

    const row = insertFn.mock.calls[0][0]
    expect(row.action).toBe('test_action')
    expect(row.actor_user_id).toBe('actor-uuid')
    expect(row.target_user_id).toBeNull()
    expect(row.details).toEqual({ foo: 'bar' })
  })

  it('INSERT con actor_user_id null si no hay sesión', async () => {
    // getUser ya devuelve null por defecto en beforeEach
    const insertFn = mockInsertSuccess()

    await logSecurityEvent('login_failed', { email: 'x@x.com' })

    const row = insertFn.mock.calls[0][0]
    expect(row.actor_user_id).toBeNull()
    expect(row.action).toBe('login_failed')
  })

  it('INSERT con target_user_id si se pasa', async () => {
    const insertFn = mockInsertSuccess()

    await logSecurityEvent('admin_action', undefined, 'target-uuid')

    const row = insertFn.mock.calls[0][0]
    expect(row.target_user_id).toBe('target-uuid')
  })

  it('details default null si no se pasa', async () => {
    const insertFn = mockInsertSuccess()

    await logSecurityEvent('simple_action')

    const row = insertFn.mock.calls[0][0]
    expect(row.details).toBeNull()
  })

  it('NO bloquea flujo si INSERT falla (catch interno)', async () => {
    const insertFn = vi.fn().mockRejectedValue(new Error('RLS denied'))
    getFromMock().mockReturnValue({ insert: insertFn })
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // No debe lanzar
    await expect(logSecurityEvent('test')).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('user_agent se incluye desde navigator', async () => {
    const insertFn = mockInsertSuccess()
    vi.stubGlobal('navigator', { userAgent: 'TestUA/1.0' })

    await logSecurityEvent('test')

    const row = insertFn.mock.calls[0][0]
    expect(row.user_agent).toBe('TestUA/1.0')
  })
})

/* =====================================================
   onAuthStateChange
   ===================================================== */

describe('onAuthStateChange', () => {
  it('subscribe a Supabase y devuelve función para desuscribir', () => {
    const unsubscribeFn = vi.fn()
    getAuthMock().onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: unsubscribeFn } },
    })

    const cb = vi.fn()
    const dispose = onAuthStateChange(cb)

    expect(getAuthMock().onAuthStateChange).toHaveBeenCalledWith(cb)
    expect(typeof dispose).toBe('function')

    dispose()
    expect(unsubscribeFn).toHaveBeenCalledTimes(1)
  })
})
