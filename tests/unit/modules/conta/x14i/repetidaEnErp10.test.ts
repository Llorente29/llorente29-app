// tests/unit/modules/conta/x14i/repetidaEnErp10.test.ts
//
// X14i · «Repetida en ERP10» en la lista de emitidas: qué se hace con lo que contesta la base (repetidasDeLaBase). Las
// respuestas de error son las que da PostgREST de verdad: 42703 («column … does not exist») mientras la base no tiene la
// columna, y un 42501 de permisos, que no se esconde. Ids inventados (T11).

import { describe, expect, it } from 'vitest'
import { repetidasDeLaBase } from '@/modules/conta/lib/facturasVenta'

describe('repetidasDeLaBase', () => {
  it('con la columna: los ids de las marcadas', () => {
    expect(repetidasDeLaBase([{ id: 'a1' }, { id: 'a2' }], null)).toEqual(['a1', 'a2'])
  })
  it('sin ninguna marcada: ninguna', () => {
    expect(repetidasDeLaBase([], null)).toEqual([])
    expect(repetidasDeLaBase(null, null)).toEqual([])
  })
  it('antes de la 0710 (la base no tiene la columna): ninguna, sin romper la lista', () => {
    expect(repetidasDeLaBase(null, { code: '42703', message: 'column customer_invoice.import_repeated does not exist' })).toEqual([])
    expect(repetidasDeLaBase(null, { code: 'PGRST204', message: "Could not find the 'import_repeated' column" })).toEqual([])
  })
  it('otro error se dice, no se esconde (regla 8)', () => {
    expect(() => repetidasDeLaBase(null, { code: '42501', message: 'permission denied for table customer_invoice' }))
      .toThrow('No he podido leer las facturas repetidas en ERP10: permission denied for table customer_invoice')
  })
})
