// G05 · Tarea 2 · El número de las facturas de cada emisor
// (supabase/functions/_shared/cobro/numeracion.ts): QBO numera «año/serie/número»
// (2026/1/2740) y Sumied sigue desde el último; en la demo, 2026/1/141.
import { describe, expect, it } from 'vitest'
import { FORMATO_QBO, fallosDelFormato, leerNumero, numeroDeFactura, siguienteNumero } from '../../../../../../supabase/functions/_shared/cobro/numeracion'

describe('G05 · la numeración de cada emisor', () => {
  it('el formato de QBO: año/serie/número, sin ceros', () => {
    expect(numeroDeFactura(FORMATO_QBO, 2026, '1', 2740)).toBe('2026/1/2740')
    expect(numeroDeFactura('{serie}-{aa}/{número:6}', 2026, 'F', 123)).toBe('F-26/000123')
  })
  it('sigue desde un número dado: en la demo, la primera es la 2026/1/141; en un año nuevo vuelve al 1', () => {
    const n = { formato: FORMATO_QBO, serie: '1', ultimo: 140, anio: 2026 }
    expect(siguienteNumero(n, 2026)).toEqual({ anio: 2026, numero: 141, texto: '2026/1/141' })
    expect(siguienteNumero(n, 2027)).toEqual({ anio: 2027, numero: 1, texto: '2027/1/1' })
  })
  it('lee el último número de Cegid con la misma plantilla, para poner el contador el día del cambio', () => {
    expect(leerNumero(FORMATO_QBO, '2026/1/2740')).toEqual({ anio: 2026, serie: '1', numero: 2740 })
    expect(leerNumero('{serie}-{aa}/{número:6}', 'F-26/000123')).toEqual({ anio: 2026, serie: 'F', numero: 123 })
    expect(leerNumero(FORMATO_QBO, '2740')).toBeNull()
  })
  it('una plantilla sin número, sin año o con piezas que no existen no vale', () => {
    expect(fallosDelFormato(FORMATO_QBO)).toEqual([])
    expect(fallosDelFormato('{serie}/{número}')).toEqual(['Falta el año ({año} o {aa}): el número sigue dentro de cada año'])
    expect(fallosDelFormato('{año}/{serie}')).toEqual(['Falta el número: {número}'])
    expect(fallosDelFormato('{año}/{mes}/{número}')).toEqual(['No sé qué es {mes}'])
    expect(() => numeroDeFactura(FORMATO_QBO, 2026, '1', 0)).toThrow('mayor que cero')
  })
})
