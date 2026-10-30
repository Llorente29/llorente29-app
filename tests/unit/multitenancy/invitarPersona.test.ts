// DM1 · PR 1 (30/10/2026). invitar-persona: leer el pedido y decir lo que ha
// pasado (regla 8). Correos inventados, de dominio de pruebas.
import { describe, it, expect } from 'vitest'
import { fraseDelResultado, leerInvitacion, lista } from '../../../supabase/functions/invitar-persona/pedido'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'

describe('DM1 · invitar a una persona', () => {
  it('lee el correo (en minúscula) y una fila por empresa con su permiso', () => {
    const r = leerInvitacion({ correo: ' Persona@Prueba.test ', cuentas: [{ account_id: A, rol: 'admin' }, { account_id: B, rol: 'manager' }], marca: 'sumied' })
    expect(r).toEqual({ ok: true, pedido: { correo: 'persona@prueba.test', cuentas: [{ accountId: A, rol: 'admin' }, { accountId: B, rol: 'manager' }], marca: 'sumied' } })
  })
  it('para lo que no vale, en palabras', () => {
    expect(leerInvitacion({ correo: 'no-es-un-correo', cuentas: [{ account_id: A, rol: 'admin' }] })).toEqual({ ok: false, error: 'Escribe un correo válido.' })
    expect(leerInvitacion({ correo: 'a@prueba.test', cuentas: [] })).toEqual({ ok: false, error: 'Elige al menos una empresa.' })
    expect(leerInvitacion({ correo: 'a@prueba.test', cuentas: [{ account_id: A, rol: 'worker' }] }).ok).toBe(false)
    expect(leerInvitacion({ correo: 'a@prueba.test', cuentas: [{ account_id: A, rol: 'admin' }, { account_id: A, rol: 'manager' }] })).toEqual({ ok: false, error: 'Una empresa está dos veces.' })
    expect(leerInvitacion({ correo: 'a@prueba.test', cuentas: [{ account_id: 'x', rol: 'admin' }] }).ok).toBe(false)
  })
  it('la marca: Sumied si lo dice; si no, Folvy', () => {
    const r = leerInvitacion({ correo: 'a@prueba.test', cuentas: [{ account_id: A, rol: 'admin' }], marca: 'otra' })
    expect(r.ok && r.pedido.marca).toBe('folvy')
  })
  it('dice lo que ha pasado, con contenido', () => {
    expect(lista(['Bar Prueba', 'Restaurante Ejemplo', 'Casa Demo'])).toBe('Bar Prueba, Restaurante Ejemplo y Casa Demo')
    expect(fraseDelResultado('a@prueba.test', { nuevo: true, anadidas: ['Bar Prueba', 'Casa Demo'], yaEstaba: [], enviada: true, motivo: null }))
      .toBe('Invitación a a@prueba.test para Bar Prueba y Casa Demo. Le ha llegado un correo para poner su contraseña; el enlace caduca en 7 días.')
    expect(fraseDelResultado('a@prueba.test', { nuevo: false, anadidas: ['Casa Demo'], yaEstaba: ['Bar Prueba'], enviada: false, motivo: null }))
      .toBe('a@prueba.test ya tenía usuario: se le ha dado acceso a Casa Demo. Entra con su contraseña de siempre y elige la empresa arriba. Ya entraba en Bar Prueba: no se ha cambiado nada ahí.')
    expect(fraseDelResultado('a@prueba.test', { nuevo: true, anadidas: ['Casa Demo'], yaEstaba: [], enviada: false, motivo: 'los correos de invitación están cerrados' }))
      .toContain('El correo no ha salido (los correos de invitación están cerrados): vuelve a invitarla más tarde')
  })
})
