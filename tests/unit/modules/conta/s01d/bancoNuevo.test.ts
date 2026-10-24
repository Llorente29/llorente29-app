// S01d · «+ Nuevo banco o tarjeta» (salir del círculo de «Dar de alta un banco»).
//
// Los `porque` son los que escribe bank_cuenta_nueva
// (supabase/migrations/20261122T0170_s01d_banco_nuevo.sql), copiados de su
// format() y de su rama sin plan: la confirmación en pantalla se mide contra
// lo que de verdad devuelve la base, no contra una frase inventada.
// El IBAN es el ES9121000418450200051332 que usa la prueba de staging de la 0170.
import { describe, it, expect } from 'vitest'
import {
  ACCION_NUEVO, PARAM_NUEVO, VALOR_NUEVO, comprobarBancoNuevo, ibanSinBanco, mensajeDeAlta, textoBancoNuevo, textoNuevoConIban,
} from '@/modules/conta/bancos/bancoNuevo'

const PORQUE_CON_PLAN = (code: string, nombre: string) => `Nueva subcuenta ${code} · Bancos · ${nombre}, enlazada al banco.`
const PORQUE_SIN_PLAN = 'El plan contable de la empresa aún no está activado: al activarlo, el banco tendrá su subcuenta 572.'

describe('comprobarBancoNuevo', () => {
  it('un banco necesita nombre e IBAN; el IBAN va sin espacios y en mayúsculas', () => {
    expect(comprobarBancoNuevo({ tipo: 'bank', nombre: '  Banco   Santander ', iban: 'es91 2100 0418 4502 0005 1332' }))
      .toEqual({ ok: true, nombre: 'Banco Santander', iban: 'ES9121000418450200051332' })
  })
  it('sin nombre, no', () => {
    expect(comprobarBancoNuevo({ tipo: 'bank', nombre: '   ', iban: 'ES9121000418450200051332' })).toEqual({ ok: false, motivo: 'Escribe el nombre del banco.' })
    expect(comprobarBancoNuevo({ tipo: 'card', nombre: '', iban: '' })).toEqual({ ok: false, motivo: 'Escribe el nombre de la tarjeta.' })
  })
  it('un banco sin IBAN, no (la base tampoco lo deja: 23514)', () => {
    const r = comprobarBancoNuevo({ tipo: 'bank', nombre: 'Banco Santander', iban: '  ' })
    expect(r.ok).toBe(false)
  })
  it('una tarjeta puede ir sin IBAN; si lo lleva, tiene que estar bien', () => {
    expect(comprobarBancoNuevo({ tipo: 'card', nombre: 'Tarjeta de empresa', iban: '' })).toEqual({ ok: true, nombre: 'Tarjeta de empresa', iban: null })
    expect(comprobarBancoNuevo({ tipo: 'card', nombre: 'Tarjeta de empresa', iban: 'ES9121000418450200051333' }).ok).toBe(false)
  })
  it('un IBAN con un dígito cambiado o corto lo dice', () => {
    expect(comprobarBancoNuevo({ tipo: 'bank', nombre: 'B', iban: 'ES9121000418450200051333' })).toEqual({ ok: false, motivo: 'Este IBAN no es correcto: revisa los dígitos.' })
    const corto = comprobarBancoNuevo({ tipo: 'bank', nombre: 'B', iban: 'ES91210004184502' })
    expect(corto.ok === false && corto.motivo).toMatch(/24 caracteres/)
  })
})

describe('textoBancoNuevo: la confirmación en pantalla (regla 8)', () => {
  it('con plan: dice la subcuenta nueva', () => {
    expect(textoBancoNuevo({ tipo: 'bank', nombre: 'Banco Santander', porque: PORQUE_CON_PLAN('57200003', 'Banco Santander') }))
      .toBe('Banco Santander dado de alta. Nueva subcuenta 57200003 · Bancos · Banco Santander, enlazada al banco.')
  })
  it('sin plan: dice por qué aún no tiene subcuenta', () => {
    expect(textoBancoNuevo({ tipo: 'bank', nombre: 'Banco Santander', porque: PORQUE_SIN_PLAN }))
      .toBe(`Banco Santander dado de alta. ${PORQUE_SIN_PLAN}`)
  })
  it('una tarjeta, y de qué local es cuando el eje está encendido', () => {
    expect(textoBancoNuevo({ tipo: 'card', nombre: 'Visa empresa', porque: PORQUE_CON_PLAN('57200004', 'Visa empresa'), local: 'Alcalá' }))
      .toBe('Tarjeta Visa empresa dada de alta, del local Alcalá. Nueva subcuenta 57200004 · Bancos · Visa empresa, enlazada al banco.')
    expect(textoBancoNuevo({ tipo: 'bank', nombre: 'BBVA', porque: '', comun: true })).toBe('BBVA dado de alta, común a todos los locales.')
  })
})

describe('Subir extracto: la cuenta del fichero que no es de ningún banco', () => {
  const bancos = [{ iban: 'ES9121000418450200051332', ibanes: ['ES7921000813610123456789'] }]
  it('ofrece el banco nuevo con su IBAN en grupos de cuatro', () => {
    expect(textoNuevoConIban('ES1000492352082414205416')).toBe('Nuevo banco con este IBAN (ES10 0049 2352 0824 1420 5416)')
    expect(textoNuevoConIban(null)).toBe('Nuevo banco para esta cuenta')
  })
  it('sin bancos, toda cuenta está sin banco', () => {
    expect(ibanSinBanco('ES9121000418450200051332', [])).toBe(true)
  })
  it('el IBAN de un banco, o uno recordado, ya tiene banco (con o sin espacios)', () => {
    expect(ibanSinBanco('ES91 2100 0418 4502 0005 1332', bancos)).toBe(false)
    expect(ibanSinBanco('ES7921000813610123456789', bancos)).toBe(false)
    expect(ibanSinBanco('ES1000492352082414205416', bancos)).toBe(true)
  })
})

describe('el error de la base y la entrada', () => {
  it('quita el nombre de la función delante de la frase', () => {
    expect(mensajeDeAlta(new Error('bank_cuenta_nueva: ¿De qué local es esta cuenta? Elige un local o «común».'))).toBe('¿De qué local es esta cuenta? Elige un local o «común».')
    expect(mensajeDeAlta(new Error('Sin conexión.'))).toBe('Sin conexión.')
  })
  it('?nuevo=banco abre el diálogo; la acción se llama igual en todas partes', () => {
    expect(`${PARAM_NUEVO}=${VALOR_NUEVO}`).toBe('nuevo=banco')
    expect(ACCION_NUEVO).toBe('+ Nuevo banco o tarjeta')
  })
})
