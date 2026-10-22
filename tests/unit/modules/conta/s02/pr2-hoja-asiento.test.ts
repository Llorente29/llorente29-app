// tests/unit/modules/conta/s02/pr2-hoja-asiento.test.ts
//
// S02 · PR 2 · El asiento a mano en la plantilla Hoja de líneas, sin pintar:
// el asiento dicho en palabras (solo lo que dicen las cuentas; a medias, nada),
// la búsqueda de F4 y el título de la emitida (Facturación › Nueva factura
// emitida). Las cuentas son del plan de Foodint (company_account, 22/10).

import { describe, expect, it } from 'vitest'
import { asientoEnPalabras, tipoDeAsiento, TIPOS_ASIENTO, type LineaEnPalabras } from '@/modules/conta/lib/tipoAsiento'
import { buscarCuentasHoja } from '@/modules/conta/diseno/plantillas'

const l = (codigo: string, nombre: string, debe: number, haber: number): LineaEnPalabras => ({ codigo, nombre, debe, haber })

describe('S02 · PR 2 · el asiento dicho en palabras', () => {
  it('un pago desde el banco a una cuenta', () => {
    expect(asientoEnPalabras([l('62100000', 'Arrendamientos', 1200, 0), l('57200001', 'Banco Ejemplo', 0, 1200)]))
      .toBe('Pagas 1.200,00 € desde Banco Ejemplo a Arrendamientos.')
  })
  it('un pago repartido (la cuota del préstamo): cuánto va a cada sitio', () => {
    expect(asientoEnPalabras([l('52000000', 'Préstamos a corto plazo', 812.45, 0), l('66230000', 'Intereses de préstamos', 96.3, 0), l('57200001', 'Banco Ejemplo', 0, 908.75)]))
      .toBe('Pagas 908,75 € desde Banco Ejemplo. De eso, 812,45 € a Préstamos a corto plazo y 96,30 € a Intereses de préstamos.')
  })
  it('un cobro en el banco', () => {
    expect(asientoEnPalabras([l('57200001', 'Banco Ejemplo', 191.51, 0), l('43000001', 'GLOVO', 0, 191.51)]))
      .toBe('Cobras 191,51 € en Banco Ejemplo, de GLOVO.')
    // De varias cuentas a la vez: cuánto de cada una.
    expect(asientoEnPalabras([l('57200001', 'Banco Ejemplo', 328.62, 0), l('43000001', 'GLOVO', 0, 191.51), l('43000002', 'Uber Eats', 0, 137.11)]))
      .toBe('Cobras 328,62 € en Banco Ejemplo: 191,51 € de GLOVO y 137,11 € de Uber Eats.')
  })
  it('la factura emitida: el cliente al debe; la venta y el IVA al haber', () => {
    expect(asientoEnPalabras([l('43000001', 'Comidas Ejemplo, S.L.', 121, 0), l('70000000', 'Ventas de mercaderías', 0, 100), l('47700000', 'IVA repercutido', 0, 21)]))
      .toBe('Facturas 121,00 € a Comidas Ejemplo, S.L.: 100,00 € de Ventas de mercaderías y 21,00 € de IVA repercutido.')
  })
  it('sin banco ni cliente, solo de dónde a dónde (no inventa si es un pago)', () => {
    expect(asientoEnPalabras([l('64000000', 'Sueldos y salarios', 1500, 0), l('46500000', 'Remuneraciones pendientes de pago', 0, 1500)]))
      .toBe('Pasas 1.500,00 € de Remuneraciones pendientes de pago a Sueldos y salarios.')
  })
  it('a medias no dice nada: sin cuadrar, sin cuenta, una sola línea o una línea con debe y haber', () => {
    expect(asientoEnPalabras([l('62100000', 'Arrendamientos', 1200, 0), l('57200001', 'Banco Ejemplo', 0, 1000)])).toBeNull()
    expect(asientoEnPalabras([l('', '', 1200, 0), l('57200001', 'Banco Ejemplo', 0, 1200)])).toBeNull()
    expect(asientoEnPalabras([l('62100000', 'Arrendamientos', 1200, 0)])).toBeNull()
    expect(asientoEnPalabras([l('62100000', 'Arrendamientos', 1200, 5), l('57200001', 'Banco Ejemplo', 0, 1195)])).toBeNull()
    expect(asientoEnPalabras([l('62100000', 'Arrendamientos', 0, 0), l('57200001', 'Banco Ejemplo', 0, 0)])).toBeNull()
  })
  it('las líneas vacías no cuentan; sin nombre, el número', () => {
    expect(asientoEnPalabras([l('', '', 0, 0), l('62100000', '', 10, 0), l('57200001', 'Banco Ejemplo', 0, 10)])).toBe('Pagas 10,00 € desde Banco Ejemplo a 62100000.')
  })
})

describe('S02 · PR 2 · F4 busca la cuenta', () => {
  const plan = [
    { codigo: '57200001', nombre: 'Banco Ejemplo ···0133' }, { codigo: '57000000', nombre: 'Caja, euros' },
    { codigo: '62100000', nombre: 'Arrendamientos y cánones' }, { codigo: '47700000', nombre: 'Hacienda Pública, IVA repercutido' },
  ]
  it('por número, las que empiezan así; por nombre, todas las palabras y sin acentos', () => {
    expect(buscarCuentasHoja(plan, '572').map((c) => c.codigo)).toEqual(['57200001'])
    expect(buscarCuentasHoja(plan, '57').map((c) => c.codigo)).toEqual(['57200001', '57000000'])
    expect(buscarCuentasHoja(plan, 'canones arrend').map((c) => c.codigo)).toEqual(['62100000'])
    expect(buscarCuentasHoja(plan, 'iva').map((c) => c.codigo)).toEqual(['47700000'])
    expect(buscarCuentasHoja(plan, 'nada que ver')).toEqual([])
    expect(buscarCuentasHoja(plan, '', 2)).toHaveLength(2)
  })
})

describe('S02 · PR 2 · la emitida vive en Facturación', () => {
  it('el título es el de la calle, «Nueva factura emitida», y sigue siendo la serie Ventas', () => {
    expect(TIPOS_ASIENTO.expedida.titulo).toBe('Nueva factura emitida')
    expect(tipoDeAsiento('expedida')?.serie).toBe(1)
    // Ya no dice «hasta que llegue Facturación»: ha llegado.
    expect(TIPOS_ASIENTO.expedida.ayuda).not.toMatch(/hasta que llegue/i)
  })
})
