// DM1 · PR 1 (30/10/2026). invitar-persona: leer el pedido y decir lo que ha
// pasado (regla 8). Correos inventados, de dominio de pruebas.
import { describe, it, expect } from 'vitest'
import { fraseDelEnvio, leerInvitacion, leerReenvio, lista } from '../../../supabase/functions/invitar-persona/pedido'

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
  it('dice lo que ha pasado, con contenido (Julio, 03/11)', () => {
    expect(lista(['Bar Prueba', 'Restaurante Ejemplo', 'Casa Demo'])).toBe('Bar Prueba, Restaurante Ejemplo y Casa Demo')
    expect(fraseDelEnvio('a@prueba.test', [{ nombre: 'Bar Prueba', permiso: 'Todo' }, { nombre: 'Casa Demo', permiso: 'Encargado' }], true, null))
      .toBe('Invitación enviada a a@prueba.test para Bar Prueba (Todo) y Casa Demo (Encargado). Le llega un correo con un enlace que vale 7 días; hasta que acepte, sale en Pendientes.')
    expect(fraseDelEnvio('a@prueba.test', [{ nombre: 'Casa Demo', permiso: 'Todo' }], true, null, true))
      .toMatch(/^Invitación reenviada a a@prueba.test para Casa Demo \(Todo\)\./)
    expect(fraseDelEnvio('a@prueba.test', [{ nombre: 'Casa Demo', permiso: 'Todo' }], false, 'los correos de invitación están cerrados'))
      .toBe('Invitación guardada para a@prueba.test en Casa Demo (Todo), pero el correo no ha salido (los correos de invitación están cerrados). Sale en Pendientes: reenvíala más tarde.')
  })
  it('reenviar: una invitación por su id', () => {
    expect(leerReenvio({ id: A, marca: 'sumied' })).toEqual({ ok: true, pedido: { id: A, marca: 'sumied' } })
    expect(leerReenvio({ id: 'x' }).ok).toBe(false)
  })
})
