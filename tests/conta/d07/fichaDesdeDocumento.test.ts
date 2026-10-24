// tests/conta/d07/fichaDesdeDocumento.test.ts
//
// D07b · La ficha del proveedor, completada desde el documento. Las
// direcciones tienen la FORMA de las que lee el lector de facturas en Foodint
// (medido el 23/10, solo lectura: «CALLE … Nº 14 PISO 1 PTA. A, 28015,
// Madrid, 28015 Madrid», «… , 28012 MADRID MADRID, 28012, …», la de Sant
// Cugat con «- (BARCELONA)»), con la calle y el número cambiados: son de
// riders, personas, y no van al repositorio.

import { describe, expect, it } from 'vitest'
import { completarFicha, enUnaFrase, partirDireccion } from '../../../src/modules/conta/lib/fichaDesdeDocumento'

const vacia = { nif: null, nombreFiscal: null, calle: null, codigoPostal: null, ciudad: null }

describe('D07b · partir la dirección leída', () => {
  it.each([
    ['CALLE INVENTADA Nº 14 PISO 1 PTA. A, 28015, Madrid, 28015 Madrid', 'CALLE INVENTADA Nº 14 PISO 1 PTA. A', '28015', 'Madrid'],
    ['CALLE FALSA Nº 81 PISO B PTA. 2 , 28012 MADRID MADRID, 28012, Madrid, 28012 Madrid', 'CALLE FALSA Nº 81 PISO B PTA. 2', '28012', 'MADRID'],
    ['CALLE DE PRUEBA, NUM 4 08195 SANT CUGAT DEL VALLÈS - (BARCELONA), 08195, Sant Cugat del Vallès, 08195 Sant Cugat del Vallès', 'CALLE DE PRUEBA, NUM 4', '08195', 'SANT CUGAT DEL VALLÈS'],
    ['Av inventada96, 28850, Torrejón de Ardoz, 28850 Torrejón de Ardoz', 'Av inventada96', '28850', 'Torrejón de Ardoz'],
    ['C. Inventada, 50, 28041, Madrid, 28041 Madrid', 'C. Inventada, 50', '28041', 'Madrid'],
    ['AVENIDA INVENTADA Nº 18 PISO 1, 07006, PALMA ILLES, 07006 PALMA ILLES', 'AVENIDA INVENTADA Nº 18 PISO 1', '07006', 'PALMA ILLES'],
  ])('%s', (d, calle, cp, ciudad) => {
    expect(partirDireccion(d)).toEqual({ calle, codigoPostal: cp, ciudad })
  })
  it('sin código postal: toda la dirección en la calle', () => {
    expect(partirDireccion('Calle Inventada 3')).toEqual({ calle: 'Calle Inventada 3', codigoPostal: null, ciudad: null })
    expect(partirDireccion(null)).toEqual({ calle: null, codigoPostal: null, ciudad: null })
  })
})

describe('D07b · lo que le falta a la ficha, del documento (Orange S11/0177416578)', () => {
  it('a una ficha sin NIF, nombre fiscal ni dirección: los tres, para guardar al validar', () => {
    const r = completarFicha(vacia, { nif: 'A82009812', nombre: 'Orange Espagne S.A.U.', direccion: 'Paseo Inventado 1, 28223, Pozuelo de Alarcón' })
    expect(r.proponer).toEqual({ taxId: 'A82009812', legalName: 'Orange Espagne S.A.U.', fiscalStreet: 'Paseo Inventado 1', fiscalPostalCode: '28223', fiscalCity: 'Pozuelo de Alarcón' })
    expect(r.contradice).toEqual([])
    expect(enUnaFrase(r.frases)).toBe('el NIF A82009812, el nombre fiscal «Orange Espagne S.A.U.» y la dirección «Paseo Inventado 1, 28223 Pozuelo de Alarcón»')
  })
  it('lo que ya tiene y coincide no se toca; lo que falta, sí (Orange tiene su NIF y nada más)', () => {
    const r = completarFicha({ ...vacia, nif: 'A82009812' }, { nif: 'A-82009812', nombre: 'Orange Espagne S.A.U.', direccion: null })
    expect(r.proponer).toEqual({ legalName: 'Orange Espagne S.A.U.' })
    expect(r.contradice).toEqual([])
  })
  it('si el documento contradice la ficha: se avisa y no se cambia nada', () => {
    const r = completarFicha({ nif: 'A82009812', nombreFiscal: 'Orange Espagne SA', calle: 'Paseo Inventado 1', codigoPostal: '28223', ciudad: 'Pozuelo de Alarcón' },
      { nif: 'B12345674', nombre: 'Otra Empresa SL', direccion: 'Calle Otra 2, 08001, Barcelona' })
    expect(r.proponer).toEqual({})
    expect(r.contradice).toEqual([
      'El NIF del documento (B12345674) no es el de su ficha (A82009812).',
      'El nombre del documento («Otra Empresa SL») no es el nombre fiscal de su ficha («Orange Espagne SA»).',
      'La dirección del documento (08001 Barcelona) no es la de su ficha (28223 Pozuelo de Alarcón).',
    ])
  })
  it('el mismo nombre con otra forma jurídica no contradice; el NIF leído mal en un carácter tampoco (eso lo dice el D06)', () => {
    const r = completarFicha({ ...vacia, nif: 'A82009812', nombreFiscal: 'ORANGE ESPAGNE, S.A.U.' }, { nif: 'A82009B12', nombre: 'Orange Espagne SAU', direccion: null })
    expect(r.contradice).toEqual([])
    expect(r.proponer).toEqual({})
  })
})
