// tests/unit/modules/conta/pc01/cobrosRedsys.test.ts
//
// S01 · PR 1 · Lo que se ve del TPV del banco y del abono, sin palabras de
// técnico (lib/cobros.ts y src/publicas/pagar.ts):
//   · el chip de una factura cobrada por el enlace: «Cobrado · pendiente del
//     abono» y, casado el abono en Bancos, «Cobrado · abonado el 05/11»;
//   · el estado del TPV en palabras («Activo», «Falta el número de comercio»,
//     «Falta la clave del comercio», «En pruebas») y su nota;
//   · lo que se escribe en Ajustes: comercio, terminal y clave, con su fallo;
//   · la página de pago: dónde se paga, quién confirma, y que solo manda el
//     formulario a Redsys (nunca a otra dirección).

import { describe, expect, it } from 'vitest'
import { chipEstado, errorClave, errorComercio, errorTerminal, notaRedsys, textoRedsys, type CobroRedsys, type FilaCobro } from '@/modules/conta/lib/cobros'
import { dondeSePaga, irARedsys, quienConfirma } from '@/publicas/pagarPuro'

const fila = (p: Partial<FilaCobro> = {}): FilaCobro => ({
  id: 'f1', clienteId: 'c1', cliente: 'Club Deportivo Vallecas', numero: 'F-2026/0084', fecha: '2026-10-20', vence: '2026-11-01', total: 432, cobrado: 432, pendiente: 0,
  estadoBase: 'cobrada', diasVencida: null, forma: 'card', localId: null, local: null, mandato: null, mandatoFirmado: null, conMandato: false, iban4: null,
  conCuenta: true, remesa: null, devuelto: null, ...p,
})
const tpv = (p: Partial<CobroRedsys> = {}): CobroRedsys => ({
  estado: 'pruebas', comercio: '999008881', terminal: '1', conClave: true, bizum: false, enEnlace: true, modo: 'prueba', cobra: true, proveedorEnlace: 'redsys', cambiado: null, ...p,
})

describe('El chip de una factura cobrada por el enlace', () => {
  it('pendiente del abono, y abonado con su día', () => {
    expect(chipEstado(fila(), { proveedor: 'stripe', cobrado: '2026-11-03', abonado: null })).toEqual({ texto: 'Cobrado · pendiente del abono', tono: 'neutro' })
    expect(chipEstado(fila(), { proveedor: 'redsys', cobrado: '2026-11-03', abonado: '2026-11-05' })).toEqual({ texto: 'Cobrado · abonado el 05/11', tono: 'seguro' })
  })
  it('sin enlace, como antes; y una por cobrar no cambia por tener abono', () => {
    expect(chipEstado(fila())).toEqual({ texto: 'Cobrada', tono: 'seguro' })
    expect(chipEstado(fila({ estadoBase: 'por_cobrar', pendiente: 432, cobrado: 0 }), { proveedor: 'stripe', cobrado: null, abonado: null }).texto).toBe('Por cobrar')
  })
})

describe('El TPV en palabras', () => {
  it('cada estado, como en el encargo', () => {
    expect(textoRedsys(null)).toBe('Falta el número de comercio')
    expect(textoRedsys(tpv({ estado: 'falta_comercio' }))).toBe('Falta el número de comercio')
    expect(textoRedsys(tpv({ estado: 'falta_clave' }))).toBe('Falta la clave del comercio')
    expect(textoRedsys(tpv())).toBe('En pruebas')
    expect(textoRedsys(tpv({ estado: 'activo', modo: 'real' }))).toBe('Activo')
  })
  it('la nota: en pruebas sin abrir, en pruebas abierto, activo con el enlace por Stripe', () => {
    expect(notaRedsys(tpv({ cobra: false }))).toBe('Aún en pruebas: tus clientes no pagan por aquí hasta que lo abramos para tu empresa.')
    expect(notaRedsys(tpv())).toBe('En pruebas: los pagos van al entorno de pruebas de Redsys y no mueven dinero.')
    expect(notaRedsys(tpv({ estado: 'activo', proveedorEnlace: 'stripe' }))).toBe('El enlace de pago cobra ahora por Stripe.')
    expect(notaRedsys(tpv({ estado: 'activo' }))).toBeNull()
  })
  it('ninguna palabra de técnico en lo que se enseña', () => {
    const todo = [null, tpv(), tpv({ cobra: false }), tpv({ estado: 'falta_clave' })].flatMap((c) => [textoRedsys(c), notaRedsys(c) ?? ''])
      .concat([errorComercio('12'), errorTerminal('x'), errorClave('x')].map(String)).join(' ')
    expect(todo).not.toMatch(/webhook|HMAC|cuenta puente|Vault|API|token|FUC|3DES/i)
  })
})

describe('Lo que se escribe en Ajustes', () => {
  it('el comercio son 9 cifras (con espacios, también); el terminal, de 1 a 3; la clave, 32', () => {
    expect(errorComercio('999 008 881')).toBeNull()
    expect(errorComercio('')).toBeNull()
    expect(errorComercio('99900888')).toBe('El número de comercio son 9 cifras.')
    expect(errorTerminal('001')).toBeNull()
    expect(errorTerminal('1234')).toBe('El terminal es un número de 1 a 3 cifras (casi siempre, 1).')
    expect(errorClave('')).toBeNull()
    expect(errorClave('sq7HjrUOBfKmC576ILgskD5srU870gJ7')).toBeNull()
    expect(errorClave('corta')).toMatch(/^La clave son 32 letras y números/)
  })
})

describe('La página de pago', () => {
  it('dónde se paga y quién lo confirma, según el proveedor', () => {
    expect(dondeSePaga('redsys')).toBe('la página segura del banco (Redsys)')
    expect(dondeSePaga('stripe')).toBe('la página segura de Stripe')
    expect(dondeSePaga(undefined)).toBe('la página segura de Stripe')
    expect(quienConfirma('redsys')).toBe('el banco')
    expect(quienConfirma(null)).toBe('Stripe')
  })
  it('el formulario va a Redsys por POST con los tres campos, y a ninguna otra dirección', () => {
    // Un documento de mentira, lo justo: crear elementos, colgarlos y leerlos.
    type Nodo = Record<string, unknown> & { hijos: Nodo[]; append: (x: Nodo) => void }
    const nodo = (): Nodo => { const n: Nodo = { hijos: [], append: (x) => { n.hijos.push(x) } }; return n }
    const cuerpo = nodo()
    const doc = { createElement: () => nodo(), body: cuerpo } as unknown as Pick<Document, 'createElement' | 'body'>
    const f = irARedsys({ url: 'https://sis-t.redsys.es:25443/sis/realizarPago', campos: { Ds_SignatureVersion: 'HMAC_SHA256_V1', Ds_MerchantParameters: 'eyJ9', Ds_Signature: 'abc=' } }, doc) as unknown as Nodo
    expect(f.method).toBe('POST')
    expect(f.action).toBe('https://sis-t.redsys.es:25443/sis/realizarPago')
    expect(f.hijos.map((i) => `${i.type}:${i.name}=${i.value}`)).toEqual(['hidden:Ds_SignatureVersion=HMAC_SHA256_V1', 'hidden:Ds_MerchantParameters=eyJ9', 'hidden:Ds_Signature=abc='])
    expect(cuerpo.hijos).toEqual([f])
    expect(() => irARedsys({ url: 'https://sis.redsys.es/sis/realizarPago', campos: {} }, doc)).not.toThrow()
    expect(() => irARedsys({ url: 'https://malo.example/sis/realizarPago', campos: {} }, doc)).toThrow('No se ha podido abrir el pago.')
    expect(() => irARedsys({ url: 'https://sis.redsys.es.malo.example/sis', campos: {} }, doc)).toThrow('No se ha podido abrir el pago.')
  })
})
