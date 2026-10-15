// tests/unit/modules/conta/tarjetaEnteraB01.test.ts
//
// B01 · Nunca se guarda una tarjeta entera (15/10). Números de PRUEBA de las
// pasarelas (4111…, 5555…4444), nunca reales. La regla de la base
// (20261101T0190) es la misma; la prueba de staging la pasa por bank_importar.

import { describe, expect, it } from 'vitest'
import { escribirNorma43, leerNorma43 } from '@/modules/conta/lib/norma43'
import { cuadrar, limpiarConcepto, ocultarTarjetas, pareceTarjeta, pasaLuhn } from '@/modules/conta/lib/extractoBanco'
import { digitosTarjeta } from '@/modules/conta/lib/conciliacion'
import { crearBancos, type Bd } from '@/modules/conta/services/bancosNucleo'

describe('Luhn: qué es una tarjeta', () => {
  it('las de prueba de las pasarelas, sí; una cifra cambiada o una referencia, no', () => {
    expect(pasaLuhn('4111111111111111')).toBe(true)
    expect(pasaLuhn('5555555555554444')).toBe(true)
    expect(pasaLuhn('378282246310005')).toBe(true) // 15 cifras
    expect(pasaLuhn('4111111111111112')).toBe(false)
    expect(pasaLuhn('123456789012345')).toBe(false)
    expect(pasaLuhn('411111111111')).toBe(false) // 12: no es tira de tarjeta
  })
})

describe('qué se tapa (Julio, 15/10, opción a): 15 a 19 cifras, comienzo de tarjeta y Luhn', () => {
  it('Visa, Mastercard (51–55 y 2221–2720) y Amex, sí', () => {
    for (const t of ['4111111111111111', '5555555555554444', '2221000000000009', '2720000000000005', '378282246310005']) expect(pareceTarjeta(t), t).toBe(true)
  })
  it('la referencia de 14 cifras que pasa Luhn por casualidad, no: pasa sin tocar', () => {
    expect(pasaLuhn('12345678901237')).toBe(true)
    expect(pareceTarjeta('12345678901237')).toBe(false)
    expect(ocultarTarjetas('TRANSFERENCIA REF 12345678901237')).toBe('TRANSFERENCIA REF 12345678901237')
  })
  it('una tira de 16 cifras que pasa Luhn pero no empieza como tarjeta, no: pasa sin tocar', () => {
    for (const t of ['1234567890123452', '2721000000000004', '6011000000000004']) {
      expect(pasaLuhn(t), t).toBe(true)
      expect(ocultarTarjetas(`RECIBO ${t}`), t).toBe(`RECIBO ${t}`)
    }
  })
  it('la tarjeta en un movimiento de código 99, sin «TARJ» en el texto, se tapa', () => {
    const n43 = escribirNorma43([{ entidad: '0182', oficina: '0937', cuenta: '0200000001', nombre: 'PRUEBA', desde: '2026-09-10', hasta: '2026-09-10', saldoInicialCent: 10000,
      movimientos: [{ fecha: '2026-09-10', importeCent: -990, comun: '99', propio: '956', concepto: 'COMERCIO INVENTADO 4111111111111111' }] }])
    const m = leerNorma43(n43).cuentas[0].movimientos[0]
    expect(m.conceptoComun).toBe('99')
    expect(m.conceptoBanco).not.toMatch(/TARJ/)
    expect(ocultarTarjetas(m.conceptoBanco)).toBe('COMERCIO INVENTADO ····1111')
  })
})

describe('ocultar: solo las 4 últimas', () => {
  it('la tarjeta, «····» y sus 4 últimas; la referencia que no pasa Luhn se queda', () => {
    expect(ocultarTarjetas('COMPRA TARJ 4111111111111111 MERCADO 123456789012345')).toBe('COMPRA TARJ ····1111 MERCADO 123456789012345')
    expect(ocultarTarjetas('5555555555554444')).toBe('····4444')
    expect(ocultarTarjetas(null)).toBeNull()
  })
  it('no toca tiras con cifras pegadas (más de 19) ni lo que ya está oculto', () => {
    expect(ocultarTarjetas('ES9121000418450200051332')).toBe('ES9121000418450200051332')
    expect(ocultarTarjetas('PAGO ····1111')).toBe('PAGO ····1111')
  })
  it('lo que queda lo sigue leyendo bien el resto: el concepto limpio y el motor (sus 4 últimas)', () => {
    const oculto = ocultarTarjetas('COMPRA TARJ 4111111111111111 MERCADO')
    expect(limpiarConcepto(oculto)).toContain('1111')
    expect(limpiarConcepto(oculto)).not.toMatch(/\d{13}/)
    expect(digitosTarjeta(oculto)).toContain('1111')
    // Antes, con el número entero, el motor no encontraba las 4 últimas.
    expect(digitosTarjeta('COMPRA TARJ 4111111111111111 MERCADO')).not.toContain('1111')
  })
})

describe('importar: a la base nunca llega una tarjeta entera, ni en la huella', () => {
  it('concepto, concepto limpio, referencias y huella, con las 4 últimas', async () => {
    const n43 = escribirNorma43([{ entidad: '0182', oficina: '0937', cuenta: '0200000001', nombre: 'PRUEBA', desde: '2026-09-10', hasta: '2026-09-10', saldoInicialCent: 10000,
      movimientos: [{ fecha: '2026-09-10', importeCent: -1250, comun: '12', ref2: '5555555555554444', concepto: 'COMPRA TARJ 4111111111111111 MERCADO' }] }])
    const e = leerNorma43(n43)
    expect(e.cuentas[0].movimientos[0].conceptoBanco).toContain('4111111111111111') // el lector lee lo que trae el fichero
    let enviado: Record<string, unknown> | null = null
    const bd: Bd = {
      tabla: () => { throw new Error('no se lee nada') },
      rpc: async <T,>(_n: string, args: Record<string, unknown>) => { enviado = args; return { repetido: false, nuevos: 1 } as T },
    }
    await crearBancos(bd).importar({ nombre: 'prueba.n43', sha256: 'x', contenido: { tipo: 'texto', texto: n43 } as never }, e, cuadrar(e), ['banco'])
    const todo = JSON.stringify(enviado)
    expect(todo).not.toMatch(/(?<!\d)\d{13,19}(?!\d)/)
    const m = (enviado!.p_movs as Record<string, string>[])[0]
    expect(m.concepto_banco).toBe('COMPRA TARJ ····1111 MERCADO')
    expect(m.ref2).toBe('····4444')
    expect(m.huella).toContain('····4444')
  })
})
