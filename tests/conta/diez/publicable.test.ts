// El filtro del lector de Diez contra todos los formatos (Julio, 12/10: «antes
// de la próxima lectura, el filtro del lector se prueba contra todos los
// formatos: IBAN con y sin espacios, NIF, NIE y CIF»).
//
// Todos los datos son INVENTADOS o los ejemplos públicos de manual (el IBAN
// ES91 2100 0418 4502 0005 1332 es el de los ejemplos del Banco de España). La
// población real —los 781 nombres de subcuenta de Diez— no puede entrar en un
// repositorio público; contra ella se mide en cada lectura (el informe dice
// cuántos nombres ha tocado el filtro) y la salida entera vuelve a pasar por
// limpiar() antes de escribirse.

import { describe, expect, it } from 'vitest'
import { limpiar, nombrePublicable } from '../../../scripts/conta/diez/publicable.mjs'

const tapa = (texto: string, marca: string) => {
  const r = limpiar(texto)
  expect(r, texto).toContain(marca)
  // Ni una cifra del dato puede sobrevivir.
  expect(r.replace(/\[[A-ZÚ]+\]/g, ''), texto).not.toMatch(/\d{3,}/)
}

describe('IBAN', () => {
  it.each([
    'ES9121000418450200051332',
    'ES91 2100 0418 4502 0005 1332',
    'ES91-2100-0418-4502-0005-1332',
    'es91 2100 0418 4502 0005 1332',
    'es9121000418450200051332',
    'IBAN ES91 2100 0418 4502 0005 1332',
    'BANCO X ES91 2100 0418 4502 0005 1332 CTA',
    'DE89 3704 0044 0532 0130 00',
    'FR1420041010050500013M02606',
    'PT50 0002 0123 1234 5678 9015 4',
  ])('%s', (t) => tapa(t, '[IBAN]'))

  it('el número de cuenta sin el ES (CCC, 20 cifras) también', () => {
    tapa('2100 0418 4502 0005 1332', '[NÚMERO]')
    tapa('2100-0418-45-0200051332', '[NÚMERO]')
    tapa('21000418450200051332', '[NÚMERO]')
  })

  it('los dos del run 10, con su forma (cuenta de banco con el IBAN en el nombre)', () => {
    // Forma de los dos nombres que se publicaron, con un IBAN de manual.
    expect(limpiar('BBVA ES91 2100 0418 4502 0005 1332')).toBe('BBVA [IBAN]')
    expect(limpiar('BBVA CTA ES9121000418450200051332')).toBe('BBVA CTA [IBAN]')
  })
})

describe('NIF de persona (DNI)', () => {
  it.each([
    '12345678Z',
    '12345678z',
    '12345678-Z',
    '12345678 Z',
    '12.345.678-Z',
    '12.345.678Z',
    '1234567L', // siete cifras (el cero de delante comido)
    'ES12345678Z', // NIF-IVA
    'NIF: 12345678Z',
    'JUAN PEREZ 12345678Z',
  ])('%s', (t) => tapa(t, '[NIF]'))
})

describe('NIE', () => {
  it.each([
    'X1234567L',
    'x1234567l',
    'X-1234567-L',
    'X 1234567 L',
    'Y0000000Z',
    'Z7654321A',
    'ESX1234567L',
  ])('%s', (t) => tapa(t, '[NIF]'))
})

describe('CIF', () => {
  it.each([
    'B12345678', // control con cifra
    'b12345678',
    'B-12345678',
    'B 1234567 8',
    'B-12.345.678',
    'Q2826000H', // control con letra (organismo público)
    'P2807900B',
    'A08000143',
    'ESB12345678', // NIF-IVA de sociedad
    'ES B12345678',
    'PROVEEDOR SL B12345678',
  ])('%s', (t) => tapa(t, '[NIF]'))
})

describe('importes y teléfonos', () => {
  it.each([
    ['1.234,56', '[IMPORTE]'],
    ['234,56', '[IMPORTE]'],
    ['1234 €', '[IMPORTE]'],
    ['€ 1.234', '[IMPORTE]'],
    ['600 123 456', '[NÚMERO]'],
    ['912345678', '[NÚMERO]'],
  ])('%s', (t, marca) => tapa(t, marca))
})

describe('lo que NO se tapa (el informe tiene que seguir siendo útil)', () => {
  it.each([
    '57200003', // código de subcuenta
    'Subcuenta 57200003',
    '62900000 Otros servicios',
    'Caja 1',
    'Amortización acumulada inmovilizado material',
    'Hacienda Pública, acreedora por IVA',
    'Mobiliario cocina 2024',
    '202301–202609',
    '- Ejercicio 2026: 200; 7227 asientos',
    '| 2026-09 | 200 | 1418 | 1418 | 8 |  |',
    '| 2026 | 7223 | 19483 | 1: 1234 · 2: 2852 · 4: 3134 · 9: 3 | 0 |',
    'caduca a los 1209599 s · tipo: bearer', // 7 cifras y una letra suelta: segundos
    '12345678 a 31/12', // código seguido de «a» en minúscula
    '- Peticiones: 341 · 39475 KB · 1255 s de espera de red',
    'TipoAsiento: {"0":7580,"1":2277,"2":5069}',
    'Subcuentas: 781 · por grupo (primer dígito): {"1":76,"2":105}',
  ])('%s', (t) => expect(limpiar(t)).toBe(t))
})

describe('nombrePublicable', () => {
  it('tercero (40, 41, 43, 44): nunca el nombre', () => {
    for (const c of ['40000001', '41000002', '43000003', '44000004'])
      expect(nombrePublicable(c, 'PROVEEDOR DE PRUEBA SL')).toBe('*(tercero: no se publica)*')
  })
  it('banco (57): nunca el nombre, aunque no lleve IBAN', () => {
    expect(nombrePublicable('57200001', 'Banco de prueba')).toBe('*(cuenta de banco: no se publica)*')
  })
  it('el resto: limpio y sin romper la tabla', () => {
    expect(nombrePublicable('62900000', 'Gastos | varios')).toBe('Gastos / varios')
    expect(nombrePublicable('21600000', 'Equipo con factura de B12345678')).toBe('Equipo con factura de [NIF]')
  })
})
