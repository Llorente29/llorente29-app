// GB · La pestaña «Sumied» en la ficha de Bitrix24: lo que se decide sin llamar
// a nadie (supabase/functions/conta-bitrix-pestana/puro.ts).
import { describe, expect, it } from 'vitest'
import {
  direccionDeLaPagina, esNuestraAplicacion, leerLlegada, PORTAL_DE_PRUEBAS, portalLimpio, portalPermitido, usuarioDeBitrix,
} from '../../../../../supabase/functions/conta-bitrix-pestana/puro'

const form = (x: Record<string, string>) => new URLSearchParams(x)

describe('GB · lo que manda Bitrix24 al abrir la pestaña', () => {
  it('la ficha de una empresa, con su token y su portal', () => {
    const l = leerLlegada(form({ AUTH_ID: 'abcdef0123456789', PLACEMENT: 'CRM_COMPANY_DETAIL_TAB', PLACEMENT_OPTIONS: '{"ID":"123"}' }),
      new URLSearchParams({ DOMAIN: 'B24-S3MR2Y.bitrix24.es', PROTOCOL: '1' }))
    expect(l).toEqual({ auth: 'abcdef0123456789', portal: PORTAL_DE_PRUEBAS, hueco: 'CRM_COMPANY_DETAIL_TAB', tipo: 'empresa', id: '123' })
  })
  it('la de un contacto', () => {
    const l = leerLlegada(form({ AUTH_ID: 'abcdef0123456789', PLACEMENT: 'CRM_CONTACT_DETAIL_TAB', PLACEMENT_OPTIONS: '{"ID":7}' }), new URLSearchParams({ DOMAIN: PORTAL_DE_PRUEBAS }))
    expect(l.tipo).toBe('contacto')
    expect(l.id).toBe('7')
  })
  it('otro hueco, una ficha rara o un token raro no pasan', () => {
    const q = new URLSearchParams({ DOMAIN: PORTAL_DE_PRUEBAS })
    expect(leerLlegada(form({ AUTH_ID: 'abcdef0123456789', PLACEMENT: 'CRM_DEAL_DETAIL_TAB', PLACEMENT_OPTIONS: '{"ID":"1"}' }), q).tipo).toBeNull()
    expect(leerLlegada(form({ AUTH_ID: 'abcdef0123456789', PLACEMENT: 'CRM_COMPANY_DETAIL_TAB', PLACEMENT_OPTIONS: '{"ID":"1 or 1=1"}' }), q).id).toBeNull()
    expect(leerLlegada(form({ AUTH_ID: 'abcdef0123456789', PLACEMENT: 'CRM_COMPANY_DETAIL_TAB', PLACEMENT_OPTIONS: 'no es json' }), q).id).toBeNull()
    expect(leerLlegada(form({ AUTH_ID: '<script>', PLACEMENT: 'CRM_COMPANY_DETAIL_TAB' }), q).auth).toBeNull()
  })
  it('todo va detrás del «#», que no llega a ningún servidor', () => {
    const d = direccionDeLaPagina('https://app.sumied.com/bitrix-pestana.html', { auth: 'abcdef0123456789', portal: PORTAL_DE_PRUEBAS, hueco: 'x', tipo: 'empresa', id: '123' })
    const u = new URL(d)
    expect(u.search).toBe('')
    expect(new URLSearchParams(u.hash.slice(1)).get('a')).toBe('abcdef0123456789')
    expect(new URLSearchParams(u.hash.slice(1)).get('id')).toBe('123')
  })
})

describe('GB · solo en el portal de pruebas', () => {
  it('el de pruebas sí; el real de QBO y uno cualquiera, no', () => {
    expect(portalPermitido(portalLimpio('https://b24-s3mr2y.bitrix24.es/'))).toBe(true)
    expect(portalPermitido(portalLimpio('crm.asesoriaqbo.es'))).toBe(false)
    expect(portalPermitido(portalLimpio('servidor-ajeno.example.com'))).toBe(false)
    expect(portalLimpio('b24-s3mr2y.bitrix24.es@evil.com')).toBeNull()
    expect(portalPermitido(null)).toBe(false)
  })
})

describe('GB · lo que contesta Bitrix24', () => {
  it('app.info: solo vale el token de la aplicación de Sumied', () => {
    expect(esNuestraAplicacion({ result: { CODE: 'local.0000.1111' } }, 'local.0000.1111')).toBe(true)
    expect(esNuestraAplicacion({ result: { CODE: 'local.otra.app' } }, 'local.0000.1111')).toBe(false)
    expect(esNuestraAplicacion({ error: 'expired_token' }, 'local.0000.1111')).toBe(false)
    expect(esNuestraAplicacion({ result: { CODE: '' } }, '')).toBe(false)
  })
  it('user.current: un usuario activo con correo; si no, nadie', () => {
    expect(usuarioDeBitrix({ result: { ID: '1', ACTIVE: true, EMAIL: ' Gestora@Example.com ', NAME: 'Ana', LAST_NAME: 'Prueba' } }))
      .toEqual({ id: '1', correo: 'gestora@example.com', nombre: 'Ana Prueba' })
    expect(usuarioDeBitrix({ result: { ID: '1', ACTIVE: false, EMAIL: 'gestora@example.com' } })).toBeNull()
    expect(usuarioDeBitrix({ result: { ID: '1', ACTIVE: true, EMAIL: '' } })).toBeNull()
    expect(usuarioDeBitrix({ error: 'NO_AUTH_FOUND' })).toBeNull()
  })
})

describe('GB (nº 5) · el porqué en el registro, sin datos personales ni secretos', () => {
  const ID = 'local.0000aaaa1111bb.22223333'
  it('app.info: sin secreto, con error, con otro código o bien', async () => {
    const { porqueApp } = await import('../../../../../supabase/functions/conta-bitrix-pestana/puro')
    expect(porqueApp({ result: { CODE: ID } }, '')).toBe('falta BITRIX_PESTANA_CLIENT_ID en la función')
    expect(porqueApp({ error: 'insufficient_scope', error_description: 'x' }, ID)).toBe('app.info: error insufficient_scope')
    expect(porqueApp(null, ID)).toBe('app.info: sin respuesta o no es JSON')
    const otro = porqueApp({ result: { ID: 13, CODE: 'local.otra.app', VERSION: 1 } }, ID)!
    expect(otro).toBe('app.info: el código no coincide (campos: CODE,ID,VERSION; CODE de 14 letras, empieza por local.; el esperado, de 29)')
    expect(otro).not.toContain('local.otra.app')
    expect(porqueApp({ result: { CODE: ID } }, ID)).toBeNull()
  })
  it('user.current: sin EMAIL (dice qué campos trae, no sus valores), inactivo o bien', async () => {
    const { porqueUsuario } = await import('../../../../../supabase/functions/conta-bitrix-pestana/puro')
    const sin = porqueUsuario({ result: { ID: '1', NAME: 'Ana', LAST_NAME: 'Prueba' } })!
    expect(sin).toBe('user.current: no trae EMAIL (campos: ID,LAST_NAME,NAME)')
    expect(sin).not.toMatch(/Ana|Prueba/)
    expect(porqueUsuario({ result: { ID: '1', ACTIVE: false, EMAIL: 'gestora@example.com' } })).toBe('user.current: el usuario no está activo')
    expect(porqueUsuario({ result: { ID: '1', ACTIVE: true, EMAIL: '' } })).toBe('user.current: el EMAIL está vacío o no es un correo')
    expect(porqueUsuario({ error: 'expired_token' })).toBe('user.current: error expired_token')
    expect(porqueUsuario({ result: { ID: '1', ACTIVE: true, EMAIL: 'gestora@example.com' } })).toBeNull()
  })
})
