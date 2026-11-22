// tests/unit/modules/conta/k12b/importe.test.ts
//
// K12b · La casilla de un importe de las piezas comunes: el punto y la coma valen como decimal (el punto del teclado
// numérico, como en ERP10), y al salir se enseña en formato español: 1.849,56. Importes inventados.
import { describe, expect, it } from 'vitest'
import { MOTIVO_IMPORTE_DUDOSO, formatoImporte, importeDudoso, importeVisto, leerImporte } from '@/modules/conta/nucleo/piezas/logica'
import { aLineas, apunteVacio, porQueNoSeGraba, problemasDeLaLinea, subirLinea, totalesDe } from '@/modules/conta/nucleo/asiento/asientoGeneral'

describe('leer un importe', () => {
  it('el punto y la coma valen como decimal', () => {
    expect(leerImporte('1849.56')).toBe(1849.56)
    expect(leerImporte('1849,56')).toBe(1849.56)
    expect(leerImporte('63.6')).toBe(63.6)
    expect(leerImporte('.5')).toBe(0.5)
  })
  it('con coma, los puntos son de miles; sin coma y con varios puntos, también', () => {
    expect(leerImporte('1.849,56')).toBe(1849.56)
    expect(leerImporte('1.234.567')).toBe(1234567)
    expect(leerImporte('1.234.567,8')).toBe(1234567.8)
  })
  it('con una o dos cifras tras el punto o la coma, decimal', () => {
    expect(leerImporte('12.3')).toBe(12.3)
    expect(leerImporte('12.34')).toBe(12.34)
    expect(leerImporte('12,3')).toBe(12.3)
  })
  it('vacío es cero; lo que no es un importe, NaN', () => {
    expect(leerImporte('')).toBe(0)
    expect(leerImporte(' 12,50 € ')).toBe(12.5)
    expect(Number.isNaN(leerImporte('doce'))).toBe(true)
    expect(Number.isNaN(leerImporte('1,2,3'))).toBe(true)
  })
})

describe('enseñar un importe', () => {
  it('siempre en formato español: miles con punto, dos decimales con coma', () => {
    expect(['1849.56', '1849,56', '1.849,56', '1849', '63.6', '0,1', '1.234.567'].map(importeVisto))
      .toEqual(['1.849,56', '1.849,56', '1.849,56', '1.849,00', '63,60', '0,10', '1.234.567,00'])
    expect(formatoImporte(-12.5)).toBe('-12,50')
    expect(formatoImporte(-0.001)).toBe('0,00')
  })
  it('vacío o lo que no es un importe, tal cual (para que se vea y se corrija)', () => {
    expect(importeVisto('')).toBe('')
    expect(importeVisto('doce')).toBe('doce')
  })
})

describe('un importe dudoso: más de dos cifras tras el punto o la coma', () => {
  it('«1.234», «12.345», «1,234» o «1.234,567» son dudosos: ni se redondean ni se dan por buenos', () => {
    for (const t of ['1.234', '12.345', '1,234', '1.234,567', '0.125']) {
      expect(importeDudoso(t), t).toBe(true)
      expect(Number.isNaN(leerImporte(t)), t).toBe(true)
      expect(importeVisto(t), t).toBe(t)
    }
  })
  it('no lo son: hasta dos cifras tras el decimal, sin decimal, o varios puntos de miles', () => {
    for (const t of ['1234', '1,23', '1.2', '1.234,56', '1.234.567', '', 'doce']) expect(importeDudoso(t), t).toBe(false)
  })
  it('su motivo, el que sale al pasar el ratón', () => {
    expect(MOTIVO_IMPORTE_DUDOSO).toBe('¿Miles o decimales? Escribe 1234 o 1,23')
  })
  it('en el asiento general, una línea con un importe dudoso no sube y el asiento no se guarda', () => {
    const linea = { ...apunteVacio('Factura de prueba'), cuentaId: 'g', codigo: '62800001', debe: '1.234' }
    expect(problemasDeLaLinea(linea)).toEqual(['un importe que sea un número'])
    const otra = { ...apunteVacio('Factura de prueba'), cuentaId: 'b', codigo: '57200001', haber: '1.234' }
    expect(porQueNoSeGraba({ fecha: '2026-11-12', concepto: 'Prueba' }, [linea, otra])).toContain('apuntes')
  })
})

describe('en el asiento general', () => {
  it('una línea escrita con punto decimal sube en formato español y cuenta igual', () => {
    const r = subirLinea([], { ...apunteVacio('Factura de prueba'), cuentaId: 'g', codigo: '62800001', debe: '1849.56' }, null)
    expect(r.apuntes[0].debe).toBe('1.849,56')
    expect(r.nueva.haber).toBe('1.849,56')
    expect(totalesDe(r.apuntes).debe).toBe(1849.56)
    expect(aLineas(r.apuntes)[0].debe).toBe(1849.56)
  })
})
