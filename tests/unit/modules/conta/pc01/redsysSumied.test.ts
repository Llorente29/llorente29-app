// tests/unit/modules/conta/pc01/redsysSumied.test.ts
//
// S01 · PR 1 · El cobro con tarjeta y Bizum por el TPV del banco (Redsys):
// supabase/functions/_shared/redsysSumied.ts.
//   · el 3DES de aquí, byte a byte contra el de Node (des-ede3-cbc), con los
//     números de pedido de Redsys (4 a 12 caracteres) y la clave de PRUEBA que
//     publica Redsys (comercio 999008881);
//   · la firma «HMAC_SHA256_V1», contra la que sale del 3DES y el HMAC de Node;
//   · el aviso del banco: bueno (también con la firma en base64 de URL), con la
//     firma tocada, con otra clave, sin versión o sin pedido: solo el bueno vale;
//   · el pago: el importe en céntimos, euros, pago normal, solo tarjeta sin
//     Bizum; pruebas (sis-t) o real (sis) según Julio;
//   · autorizado (0000–0099), Bizum (68) y quién está en real.

import { createCipheriv, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  COMERCIO_PRUEBA, REDSYS_PRUEBAS, REDSYS_REAL, aBase64, autorizado, avisoValido, claveValida, deBase64, empresaEnReal, firmar, formularioPago,
  importeRedsys, leerParametros, metodoRedsys, parametrosEnBase64, parametrosPago, tresDesCbc, type PagoRedsys,
} from '../../../../../supabase/functions/_shared/redsysSumied'

const CLAVE = COMERCIO_PRUEBA.clave

/** El 3DES de Node, como lo usa Redsys: vector cero y relleno con ceros hasta múltiplo de 8. */
function tresDesNode(clave: string, pedido: string): Buffer {
  const datos = Buffer.alloc(Math.max(8, Math.ceil(Buffer.byteLength(pedido) / 8) * 8))
  datos.write(pedido)
  const c = createCipheriv('des-ede3-cbc', Buffer.from(clave, 'base64'), Buffer.alloc(8))
  c.setAutoPadding(false)
  return Buffer.concat([c.update(datos), c.final()])
}
const firmaNode = (clave: string, pedido: string, parametros: string) => createHmac('sha256', tresDesNode(clave, pedido)).update(parametros).digest('base64')

const PAGO: PagoRedsys = {
  comercio: COMERCIO_PRUEBA.comercio, terminal: '1', pedido: '261027214793', euros: 1452, descripcion: 'Factura A-2026/0010 de Foodint', titular: 'Foodint',
  aviso: 'https://ejemplo.supabase.co/functions/v1/conta-redsys-aviso', vuelta: 'https://app.sumied.com/pagar.html?t=x&vuelta=ok',
  otraVez: 'https://app.sumied.com/pagar.html?t=x&vuelta=no', bizum: false,
}

describe('El 3DES y la firma, contra Node', () => {
  it.each(['1446068581', '261027214793', '0001', 'A1B2', '99990000ZZZZ'])('el 3DES del pedido «%s» es el de Node', (pedido) => {
    const nuestro = tresDesCbc(deBase64(CLAVE)!, new TextEncoder().encode(pedido))
    expect(Buffer.from(nuestro).toString('hex')).toBe(tresDesNode(CLAVE, pedido).toString('hex'))
  })

  it('la firma de unos parámetros es la de Node', async () => {
    const p = parametrosEnBase64(parametrosPago(PAGO))
    expect(await firmar(CLAVE, PAGO.pedido, p)).toBe(firmaNode(CLAVE, PAGO.pedido, p))
  })

  it('el base64, de ida y vuelta, también el «de URL»', () => {
    const b = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    expect(aBase64(b)).toBe(Buffer.from(b).toString('base64'))
    expect([...deBase64(Buffer.from(b).toString('base64url'))!]).toEqual([...b])
    expect(deBase64('esto no es base64!')).toBeNull()
  })

  it('una clave de comercio son 24 bytes en base64 (32 caracteres)', () => {
    expect(claveValida(CLAVE)).toBe(true)
    expect(claveValida('sq7HjrUOBfKmC576ILgskD5srU870gJ')).toBe(false)
    expect(claveValida('no es una clave')).toBe(false)
  })
})

describe('El aviso del banco: solo vale el bien firmado', () => {
  const params = parametrosEnBase64({ Ds_Date: '27%2F10%2F2026', Ds_Hour: '21:48', Ds_Amount: '145200', Ds_Currency: '978', Ds_Order: PAGO.pedido,
    Ds_MerchantCode: COMERCIO_PRUEBA.comercio, Ds_Terminal: '001', Ds_Response: '0000', Ds_AuthorisationCode: '123456', Ds_ProcessedPayMethod: '1' })
  const firma = firmaNode(CLAVE, PAGO.pedido, params)

  it('bueno: con la firma en base64 y en base64 de URL (como la manda Redsys)', async () => {
    expect(await avisoValido(CLAVE, { version: 'HMAC_SHA256_V1', parametros: params, firma })).toBe(true)
    expect(await avisoValido(CLAVE, { version: 'HMAC_SHA256_V1', parametros: params, firma: firma.replace(/\+/g, '-').replace(/\//g, '_') })).toBe(true)
  })

  it('malo: la firma tocada, otra clave, otros parámetros, sin versión o sin firma', async () => {
    const tocada = `${firma.slice(0, 10)}${firma[10] === 'A' ? 'B' : 'A'}${firma.slice(11)}`
    expect(await avisoValido(CLAVE, { version: 'HMAC_SHA256_V1', parametros: params, firma: tocada })).toBe(false)
    expect(await avisoValido('Mk9m98IfEblmPfrpsawt7BmxObt98Jev', { version: 'HMAC_SHA256_V1', parametros: params, firma })).toBe(false)
    const otros = parametrosEnBase64({ ...leerParametros(params)!, Ds_Amount: '1' })
    expect(await avisoValido(CLAVE, { version: 'HMAC_SHA256_V1', parametros: otros, firma })).toBe(false)
    expect(await avisoValido(CLAVE, { version: null, parametros: params, firma })).toBe(false)
    expect(await avisoValido(CLAVE, { version: 'HMAC_SHA256_V1', parametros: params, firma: null })).toBe(false)
  })

  it('sin pedido no hay con qué firmar: no vale', async () => {
    const sinPedido = parametrosEnBase64({ Ds_Amount: '100', Ds_Response: '0000' })
    expect(await avisoValido(CLAVE, { version: 'HMAC_SHA256_V1', parametros: sinPedido, firma: firmaNode(CLAVE, '', sinPedido) })).toBe(false)
  })

  it('lee los parámetros, con lo que Redsys manda escapado («27%2F10%2F2026»)', () => {
    const p = leerParametros(params)!
    expect(p.Ds_Date).toBe('27/10/2026')
    expect(p.Ds_Order).toBe(PAGO.pedido)
    expect(leerParametros('###')).toBeNull()
  })
})

describe('El pago', () => {
  it('importe en céntimos, euros, pago normal; sin Bizum en el TPV, solo tarjeta', () => {
    const p = parametrosPago(PAGO)
    expect(p).toMatchObject({ DS_MERCHANT_AMOUNT: '145200', DS_MERCHANT_CURRENCY: '978', DS_MERCHANT_TRANSACTIONTYPE: '0', DS_MERCHANT_ORDER: PAGO.pedido,
      DS_MERCHANT_MERCHANTCODE: '999008881', DS_MERCHANT_TERMINAL: '1', DS_MERCHANT_CONSUMERLANGUAGE: '001', DS_MERCHANT_PAYMETHODS: 'C' })
    expect(parametrosPago({ ...PAGO, bizum: true })).not.toHaveProperty('DS_MERCHANT_PAYMETHODS')
    expect(importeRedsys(0.1 + 0.2)).toBe('30')
    expect(importeRedsys(1452)).toBe('145200')
  })

  it('en pruebas va a sis-t; de verdad, a sis; los tres campos, firmados', async () => {
    const prueba = await formularioPago(CLAVE, PAGO, false)
    expect(prueba.url).toBe(REDSYS_PRUEBAS)
    expect((await formularioPago(CLAVE, PAGO, true)).url).toBe(REDSYS_REAL)
    expect(prueba.campos.Ds_SignatureVersion).toBe('HMAC_SHA256_V1')
    expect(leerParametros(prueba.campos.Ds_MerchantParameters)?.DS_MERCHANT_ORDER).toBe(PAGO.pedido)
    expect(prueba.campos.Ds_Signature).toBe(firmaNode(CLAVE, PAGO.pedido, prueba.campos.Ds_MerchantParameters))
  })

  it('autorizado es 0000 a 0099; Bizum es el 68; real solo quien Julio pase', () => {
    expect(['0000', '0099', '99', '0'].map(autorizado)).toEqual([true, true, true, true])
    expect(['0100', '0190', '9915', '', null, 'SIS0042'].map(autorizado)).toEqual([false, false, false, false, false, false])
    expect(metodoRedsys({ Ds_ProcessedPayMethod: '68' })).toBe('bizum')
    expect(metodoRedsys({ Ds_ProcessedPayMethod: '1' })).toBe('tarjeta')
    expect(metodoRedsys({})).toBe('tarjeta')
    const id = '3B34403A-A7D6-4A48-A8D7-737E8CABABDC'
    expect(empresaEnReal(` otra, ${id.toLowerCase()} `, id)).toBe(true)
    expect(empresaEnReal('', id)).toBe(false)
    expect(empresaEnReal(undefined, id)).toBe(false)
  })
})
