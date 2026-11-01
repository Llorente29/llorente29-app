// B01 Revolut · Los permisos que pide Sumied al conectar (respuesta 5, 01/11):
// READ y WRITE, para que el aviso de Revolut funcione y lo terminado entre al
// momento. PAY, nunca al conectar: solo con «Activar pagos».
import { describe, expect, it } from 'vitest'
import { dejanAvisar, paginaDeAutorizar, PERMISOS_AL_CONECTAR, PERMISOS_AL_CONECTAR_TEXTO } from '../../../../../supabase/functions/_shared/revolut/cliente.ts'

describe('los permisos al conectar', () => {
  it('son READ y WRITE, y nunca PAY', () => {
    expect([...PERMISOS_AL_CONECTAR]).toEqual(['READ', 'WRITE'])
    expect(PERMISOS_AL_CONECTAR_TEXTO).not.toMatch(/PAY/)
  })
  it('la página de Revolut los pide, con la vuelta, el state y el sandbox fuera de producción', () => {
    const u = new URL(paginaDeAutorizar('sandbox', { clientId: 'client-id-inventado', vuelta: 'https://app.sumied.com/bancos/revolut/vuelta', permisos: PERMISOS_AL_CONECTAR_TEXTO, estado: 'e'.repeat(64) }))
    expect(u.origin).toBe('https://sandbox-business.revolut.com')
    expect(u.searchParams.get('scope')).toBe('READ,WRITE')
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.sumied.com/bancos/revolut/vuelta')
    expect(u.searchParams.get('response_type')).toBe('code')
  })
  it('con WRITE se registra el aviso; con solo READ, no', () => {
    expect(dejanAvisar(PERMISOS_AL_CONECTAR_TEXTO)).toBe(true)
    expect(dejanAvisar('READ')).toBe(false)
    expect(dejanAvisar(null)).toBe(false)
    expect(dejanAvisar('READ WRITE')).toBe(true)
  })
})
