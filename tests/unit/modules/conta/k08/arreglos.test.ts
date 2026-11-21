// tests/unit/modules/conta/k08/arreglos.test.ts
//
// K08 · Los cinco arreglos de la ficha que Julio vio grabando facturas de verdad (21/11):
//   1. el asiento con un proveedor recién dado de alta: «Será la 40000002 · Proveedores · …»;
//   2. ninguna frase de pantalla nombra funciones, tablas ni columnas;
//   3. la casilla «Proveedor» de una validada, con el nombre;
//   4. cada cuenta con su nombre guardado, nunca su explicación;
//   5. la barra de abajo: gris si espera la primera salida a ERP10; ámbar solo si algo ha fallado.
import { describe, expect, it } from 'vitest'
import { cuentaDelProveedorEnElAsiento } from '@/modules/conta/nucleo/recibida/proveedorEnAsiento'
import { textoCasillaProveedor } from '@/modules/conta/nucleo/recibida/contabilizada'
import { COMO_SE_GUARDA, SIN_LA_TANDA } from '@/modules/conta/documentos/fichaRecibida'
import { nombreDeUso } from '@/modules/conta/lib/diario'
import { fraseErp10Barra } from '@/modules/conta/erp10/salidaSola'

const TECNICO = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\(0\d{3}\)|\btanda [A-Z]\d+/

describe('1 · el asiento con un proveedor recién dado de alta', () => {
  const base = { proveedor: 'HEINEKEN ESPAÑA, S.A.', ocupados: new Set(['40000001']), digitos: 8 }
  it('sin su subcuenta: la siguiente libre de la 4000, con «Será la…»', () => {
    expect(cuentaDelProveedorEnElAsiento({ ...base, subcuenta: null, gasto: '60000000' }))
      .toEqual({ codigo: '40000002', nombre: 'Será la 40000002 · Proveedores · HEINEKEN ESPAÑA, S.A.', nueva: true })
  })
  it('un gasto que no es de compras: la 4100, «Acreedores»', () => {
    expect(cuentaDelProveedorEnElAsiento({ ...base, subcuenta: null, gasto: '62800000', ocupados: new Set() }))
      .toEqual({ codigo: '41000001', nombre: 'Será la 41000001 · Acreedores · HEINEKEN ESPAÑA, S.A.', nueva: true })
  })
  it('si ya la tiene (el alta del R14 la crea): la suya', () => {
    expect(cuentaDelProveedorEnElAsiento({ ...base, subcuenta: { codigo: '40000009', nombre: 'Proveedores · HEINEKEN ESPAÑA, S.A.' }, gasto: '60000000' }))
      .toEqual({ codigo: '40000009', nombre: 'Proveedores · HEINEKEN ESPAÑA, S.A.', nueva: false })
  })
  it('sin proveedor todavía: nada', () => {
    expect(cuentaDelProveedorEnElAsiento({ ...base, subcuenta: null, proveedor: null, gasto: null })).toBeNull()
  })
})

describe('2 · ninguna frase de pantalla nombra funciones, tablas ni columnas', () => {
  it('lo que se dice de lo que no se guarda', () => {
    for (const x of [...Object.values(COMO_SE_GUARDA), ...Object.values(SIN_LA_TANDA)]) {
      if ('falta' in x) expect(x.falta, x.falta).not.toMatch(TECNICO)
    }
  })
})

describe('3 · la casilla «Proveedor»', () => {
  it('validada o descartada: el nombre', () => {
    expect(textoCasillaProveedor({ soloLectura: true, subcuenta: '40000002', nombre: 'HEINEKEN ESPAÑA, S.A.' })).toBe('HEINEKEN ESPAÑA, S.A.')
  })
  it('por revisar: su subcuenta, como la maqueta; sin ella, el nombre', () => {
    expect(textoCasillaProveedor({ soloLectura: false, subcuenta: '40000002', nombre: 'HEINEKEN ESPAÑA, S.A.' })).toBe('40000002')
    expect(textoCasillaProveedor({ soloLectura: false, subcuenta: '', nombre: 'HEINEKEN ESPAÑA, S.A.' })).toBe('HEINEKEN ESPAÑA, S.A.')
  })
})

describe('4 · cada cuenta con su nombre guardado, nunca su explicación', () => {
  it('la 600: «Compras de mercaderías», no «Bebidas y producto que vendes tal cual»', () => {
    expect(nombreDeUso({ kind: 'template', name: 'Compras de mercaderías', plainName: 'Bebidas y producto que vendes tal cual.' })).toBe('Compras de mercaderías')
  })
})

describe('5 · la barra de abajo y ERP10', () => {
  it('esperando la primera salida: en gris, «Mandarla»', () => {
    expect(fraseErp10Barra({ atascados: 1, salida: { encendida: true }, pruebaHecha: false }))
      .toEqual({ tono: 'gris', fuerte: 'Esperando la primera salida a ERP10', resto: '· Mandarla' })
  })
  it('con la salida apagada: en gris', () => {
    expect(fraseErp10Barra({ atascados: 3, salida: { encendida: false }, pruebaHecha: false })?.tono).toBe('gris')
  })
  it('ámbar solo si algo ha fallado de verdad (encendida y con la primera hecha)', () => {
    expect(fraseErp10Barra({ atascados: 1, salida: { encendida: true }, pruebaHecha: true }))
      .toEqual({ tono: 'mira', fuerte: '1 asiento', resto: 'lleva más de una hora sin salir a ERP10' })
  })
  it('nada atascado: nada', () => {
    expect(fraseErp10Barra({ atascados: 0, salida: { encendida: true }, pruebaHecha: false })).toBeNull()
  })
})
