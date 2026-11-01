// B01 Revolut · PR 2c-1 · La línea de los pagos en la tarjeta de Revolut
// (maqueta «Activar pagos», aprobada) y la página de vuelta. Todo inventado (T11).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { eurosTope, lineaPagos, pagaConRevolut, type ConexionRevolut, type QuienPaga } from '@/modules/conta/bancos/revolut/revolut'

const base: ConexionRevolut = { estado: 'conectada', entorno: 'sandbox', certificado: '-----BEGIN CERTIFICATE-----', vuelta: 'https://app.sumied.com/bancos/revolut/vuelta',
  desdeHistorico: '2026-08-01', conectadaAt: '2026-10-31T10:00:00Z', conectadaPor: 'Ana Prueba', lastOkAt: '2026-10-31T11:55:00Z', lastError: null,
  permisos: 'READ,WRITE', oauthPara: null }
const admin: QuienPaga = { yoPuedo: false, soyAdmin: true, personas: [] }
const encargado: QuienPaga = { yoPuedo: false, soyAdmin: false, personas: [] }

describe('pagaConRevolut', () => {
  it('solo con PAY, se escriba con comas o con espacios', () => {
    expect(pagaConRevolut(base)).toBe(false)
    expect(pagaConRevolut({ permisos: 'READ,WRITE,PAY' })).toBe(true)
    expect(pagaConRevolut({ permisos: 'READ WRITE PAY' })).toBe(true)
    expect(pagaConRevolut({ permisos: 'READ,WRITE,PAYMENTS' })).toBe(false)
    expect(pagaConRevolut(null)).toBe(false)
  })
})

describe('lineaPagos', () => {
  it('sin conectar no hay línea de pagos', () => {
    expect(lineaPagos(null, admin)).toBeNull()
    expect(lineaPagos({ ...base, estado: 'autorizar' }, admin)).toBeNull()
    expect(lineaPagos({ ...base, estado: 'retirada' }, admin)).toBeNull()
  })
  it('conectada para leer: «puede leer · aún no paga», y «Activar pagos» solo para un administrador', () => {
    expect(lineaPagos(base, admin)).toEqual({ nivel: 'nada', texto: 'puede leer · aún no paga', botones: ['activar'], pideselo: null })
    const l = lineaPagos(base, encargado, ['Ana Prueba', 'Luis Ejemplo'])!
    expect(l.botones).toEqual([])
    expect(l.pideselo).toBe('Solo un administrador activa los pagos. Pídeselo a Ana Prueba o Luis Ejemplo, que son administradores de la cuenta.')
    expect(lineaPagos(base, encargado, ['Ana Prueba'])!.pideselo).toBe('Solo un administrador activa los pagos. Pídeselo a Ana Prueba, que es administrador de la cuenta.')
  })
  it('con PAY: «lee y paga», quién paga, y «Topes y permisos» y «Dejar de pagar» para un administrador', () => {
    const c = { ...base, permisos: 'READ,WRITE,PAY' }
    expect(lineaPagos(c, { ...admin, personas: [{ nombre: 'Ana Prueba', yo: true }] })).toEqual({ nivel: 'ok', texto: 'lee y paga · puede pagar: Ana Prueba', botones: ['topes', 'dejar'], pideselo: null })
    expect(lineaPagos(c, { ...encargado, personas: [{ nombre: 'Ana Prueba', yo: false }, { nombre: 'Luis Ejemplo', yo: false }] })!.texto).toBe('lee y paga · puede pagar: Ana Prueba o Luis Ejemplo')
    // Regla 7: con PAY y nadie con permiso, se dice; no se esconde.
    expect(lineaPagos(c, admin)!.texto).toBe('lee y paga · nadie tiene el permiso de pagar')
  })
  it('dejó de pagar y canceló en Revolut: lo dice, y deja quitarlo allí', () => {
    const l = lineaPagos({ ...base, oauthPara: 'dejar_de_pagar' }, admin)!
    expect(l.nivel).toBe('aviso')
    expect(l.texto).toMatch(/Revolut aún tiene el permiso de pagar/)
    expect(l.botones).toEqual(['quitar_en_revolut'])
  })
  it('activar pagos cancelado en Revolut sigue como antes', () => {
    expect(lineaPagos({ ...base, oauthPara: 'activar_pagos' }, admin)!.botones).toEqual(['activar'])
  })
})

describe('eurosTope', () => {
  it('sin céntimos y con el punto de los miles', () => {
    expect(eurosTope(3000)).toBe('3.000 €')
    expect(eurosTope(10000)).toBe('10.000 €')
    expect(eurosTope(950.4)).toBe('950 €')
  })
})

describe('la página de vuelta', () => {
  const pagina = readFileSync('revolut-vuelta.html', 'utf8')
  it('sin el permiso, devuelve también el «state» (solo si tiene su forma)', () => {
    expect(pagina).toMatch(/p\.set\('revolut_error'[^\n]*p\.set\('revolut_state', estado\)/)
    expect(pagina).toMatch(/\/\^\[0-9a-f\]\{64\}\$\/\.test\(estado\)/)
  })
})

describe('las palabras de la vuelta cancelada', () => {
  const funcion = readFileSync('supabase/functions/conta-revolut-conectar/index.ts', 'utf8')
  it('dejar de pagar cancelado dice que en Sumied ya está quitado', () => {
    expect(funcion).toMatch(/const DEJADO = "En Sumied ya están quitados los pagos: nadie puede pagar con Revolut desde aquí\."/)
    expect(funcion).toMatch(/para === "dejar_de_pagar"\) return `\$\{DEJADO\} En Revolut no has cambiado el permiso/)
  })
  it('dejar de pagar quita antes en Sumied (conta_pago_dejar) que ir a Revolut', () => {
    const caso = funcion.slice(funcion.indexOf('case "dejar_de_pagar"'), funcion.indexOf('case "vuelta"'))
    expect(caso.indexOf('conta_pago_dejar')).toBeGreaterThan(0)
    expect(caso.indexOf('conta_pago_dejar')).toBeLessThan(caso.indexOf('paginaDeAutorizar'))
    expect(caso).toMatch(/permisos: PERMISOS_AL_CONECTAR_TEXTO/)
    expect(caso).not.toMatch(/PERMISOS_CON_PAGOS_TEXTO/)
    expect(caso).toMatch(/current_user_is_admin_of/)
  })
  it('desconectar también deja de pagar, antes de quitar la conexión', () => {
    const caso = funcion.slice(funcion.indexOf('case "desconectar"'))
    expect(caso.indexOf('conta_pago_dejar')).toBeGreaterThan(0)
    expect(caso.indexOf('conta_pago_dejar')).toBeLessThan(caso.indexOf('conta_revolut_desconectar'))
  })
})
