// tests/unit/modules/conta/k10/buscarYContrapartida.test.ts
//
// K10 · El proveedor, también por su código (como en ERP10), y el aviso del inmovilizado en la
// contrapartida. El orden en que se propone la cuenta del pago (ficha, último pago, vacía) está en
// tests/unit/modules/conta/k06/pago.test.ts.
import { describe, expect, it } from 'vitest'
import { proveedoresQueEncajan } from '@/modules/conta/nucleo/recibida/buscarProveedor'
import { AVISO_INMOVILIZADO, avisoInmovilizado } from '@/modules/conta/nucleo/recibida/contrapartida'

const uno = { id: 'p1', nombre: 'Proveedor de Prueba Uno, S.L.', nif: 'B00000000' }
const dos = { id: 'p2', nombre: 'Plataforma de Prueba Ávila, S.L.', nif: 'A00000000' }
const tres = { id: 'p3', nombre: 'Sin Subcuenta de Prueba', nif: null }
const todos = [uno, dos, tres]
const codigos = new Map([['p1', '40000002'], ['p2', '40000020']])

describe('el proveedor, por su código', () => {
  it('el código entero lo encuentra a él solo', () => {
    expect(proveedoresQueEncajan('40000002', todos, codigos)).toEqual([uno])
  })
  it('con el punto que rellena ceros, «400.2», es el mismo', () => {
    expect(proveedoresQueEncajan('400.2', todos, codigos)).toEqual([uno])
  })
  it('las primeras cifras dan todos los que empiezan así', () => {
    expect(proveedoresQueEncajan('400000', todos, codigos).map((p) => p.id)).toEqual(['p1', 'p2'])
  })
  it('uno sin subcuenta no sale por cifras', () => {
    expect(proveedoresQueEncajan('400', todos, codigos)).not.toContain(tres)
  })
})

describe('el proveedor, por su nombre o su NIF, como antes', () => {
  it('por el nombre, sin mayúsculas ni acentos', () => {
    expect(proveedoresQueEncajan('avila', todos, codigos)).toEqual([dos])
  })
  it('por el NIF', () => {
    expect(proveedoresQueEncajan('A00000000', todos, codigos)).toEqual([dos])
  })
  it('sin escribir nada, todos', () => {
    expect(proveedoresQueEncajan('  ', todos, codigos)).toEqual(todos)
  })
})

describe('el aviso del inmovilizado en la contrapartida', () => {
  it('una línea al 21x lo da', () => {
    expect(avisoInmovilizado(['62800000', '21600000'])).toBe(AVISO_INMOVILIZADO)
    expect(AVISO_INMOVILIZADO).toBe('Va a inmovilizado: después dalo de alta en la ficha de bienes.')
  })
  it('al 6, a la 480 o a la 20x (intangible), no', () => {
    expect(avisoInmovilizado(['60000000', '48000000', '20600000'])).toBeNull()
  })
})
