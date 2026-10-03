// NIF, NIE y CIF españoles — C01 §5.1.
//
// Cada caso lleva su ORIGEN. Dos tipos:
//   · casos de referencia publicados (o calculados a mano con el algoritmo
//     oficial, con la cuenta escrita al lado para que se pueda repetir);
//   · la POBLACIÓN REAL: los 5 NIF de proveedores de Foodint (01/10/2026).
//     Son NIF de empresa, públicos. Regla 31: los datos de verdad son los que
//     pueden llevar la contraria.
import { describe, it, expect } from 'vitest'
import { validarNifEs, normalizarNif, tipoEntidadPorNif } from '@/modules/conta/lib/nif'

describe('NIF de persona física (Orden INT/2058/2008: letra = TRWAGMYFPDXBNJZSQVHLCKE[n mod 23])', () => {
  it('12345678Z es válido: 12345678 mod 23 = 14 → Z', () => {
    expect(validarNifEs('12345678Z')).toEqual({ ok: true, tipo: 'nif', normalizado: '12345678Z' })
  })
  it('acepta minúsculas, espacios y guiones', () => {
    expect(validarNifEs(' 12345678-z ').ok).toBe(true)
  })
  it('12345678A no: la letra no corresponde', () => {
    const r = validarNifEs('12345678A')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toMatch(/letra no corresponde/)
  })
})

describe('NIE (X=0, Y=1, Z=2 y la misma letra que el NIF)', () => {
  it('X1234567L: 01234567 mod 23 = 19 → L', () => expect(validarNifEs('X1234567L').ok).toBe(true))
  it('Y1234567X: 11234567 mod 23 = 10 → X', () => expect(validarNifEs('Y1234567X').ok).toBe(true))
  it('Z1234567R: 21234567 mod 23 = 1 → R', () => expect(validarNifEs('Z1234567R').ok).toBe(true))
  it('X1234567A no', () => expect(validarNifEs('X1234567A').ok).toBe(false))
})

describe('NIF de persona jurídica / CIF (Orden EHA/451/2008, art. 3)', () => {
  it('Q2826000H (AEAT): pares 8+6+0=14, impares 4+4+0+0=8, C=22, control 8 → H (letra obligatoria en Q)', () => {
    expect(validarNifEs('Q2826000H')).toEqual({ ok: true, tipo: 'cif', normalizado: 'Q2826000H' })
  })
  it('Q2826000 con dígito 8 no: un organismo (Q) lleva LETRA de control', () => {
    expect(validarNifEs('Q28260008').ok).toBe(false)
  })
  it('control equivocado se rechaza con mensaje claro', () => {
    const r = validarNifEs('B87123791')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toMatch(/control no cuadra/)
  })

  // POBLACIÓN REAL: los cinco NIF de proveedores de Foodint, tal como están
  // escritos en la base (con y sin guion). Los cinco tienen que pasar.
  it.each([
    ['AMIRSA HOSTELERIA, S.L.', 'B87123790'],
    ['BODEGA DE VALLECAS S.L', 'B-72646904'],
    ['EUROPASTRY, S.A.', 'A-58695032'],
    ['MAKRO DISTRIBUCION MAYORISTA SA', 'A28647451'],
    ['PRODUCTOS LÁCTEOS TGT, S.A.', 'A-28310761'],
  ])('%s (%s) es un NIF de empresa válido', (_n, nif) => {
    const r = validarNifEs(nif)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.tipo).toBe('cif')
  })
})

describe('forma', () => {
  it('vacío, corto o raro se dice en lenguaje normal', () => {
    expect(validarNifEs('')).toEqual({ ok: false, motivo: 'Escribe el NIF.' })
    expect(validarNifEs('1234')).toEqual({ ok: false, motivo: 'Un NIF español tiene 9 caracteres.' })
    expect(validarNifEs('I1234567A').ok).toBe(false)
  })
  it('un «ES» delante (NIF-IVA español) se quita', () => {
    expect(normalizarNif('ES B87123790')).toBe('B87123790')
  })
  it('sociedad o autónomo, por la forma del NIF', () => {
    expect(tipoEntidadPorNif('B87123790')).toBe('company')
    expect(tipoEntidadPorNif('12345678Z')).toBe('self_employed')
    expect(tipoEntidadPorNif('X1234567L')).toBe('self_employed')
  })
})
