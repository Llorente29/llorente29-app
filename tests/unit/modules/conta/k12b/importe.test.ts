// tests/unit/modules/conta/k12b/importe.test.ts
//
// K12b · La casilla de un importe de las piezas comunes: el punto y la coma valen como decimal (el punto del teclado
// numérico, como en ERP10), y al salir se enseña en formato español: 1.849,56. Importes inventados.
import { describe, expect, it } from 'vitest'
import { formatoImporte, importeVisto, leerImporte } from '@/modules/conta/nucleo/piezas/logica'
import { aLineas, apunteVacio, subirLinea, totalesDe } from '@/modules/conta/nucleo/asiento/asientoGeneral'

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
  it('con un solo punto y sin coma, el punto es el decimal (el del teclado numérico)', () => {
    expect(leerImporte('12.345')).toBe(12.345)
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
    expect(['1849.56', '1849,56', '1.849,56', '1849', '63.6', '0,1', '1234567.891'].map(importeVisto))
      .toEqual(['1.849,56', '1.849,56', '1.849,56', '1.849,00', '63,60', '0,10', '1.234.567,89'])
    expect(formatoImporte(-12.5)).toBe('-12,50')
    expect(formatoImporte(-0.001)).toBe('0,00')
  })
  it('vacío o lo que no es un importe, tal cual (para que se vea y se corrija)', () => {
    expect(importeVisto('')).toBe('')
    expect(importeVisto('doce')).toBe('doce')
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
