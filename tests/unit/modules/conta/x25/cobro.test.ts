// tests/unit/modules/conta/x25/cobro.test.ts — X25 · La «Cuenta de cobro» de la ficha del cliente: el orden en que se
// propone en «Cómo se cobra» de la emitida, y el NIF repetido de la ficha del proveedor con quién lo tiene (para
// «Abrirlo»). Subcuentas y NIF inventados (T11).

import { describe, expect, it } from 'vitest'
import { propuestaDelCobro } from '@/modules/conta/nucleo/emitida/asiento'
import { nifRepetidoDe } from '@/modules/conta/lib/validacionesFicha'

describe('X25 · la cuenta del cobro que se propone', () => {
  it('1 · la de su ficha, aunque tenga banco y último cobro', () => {
    expect(propuestaDelCobro({ deLaFicha: '43000091', banco: '57200001', ultimo: '57200002' })).toEqual({ cuenta: '43000091', origen: 'De su ficha' })
  })
  it('2 · sin ella, lo de antes, igual: el banco de su ficha', () => {
    expect(propuestaDelCobro({ deLaFicha: null, banco: '57200001', ultimo: '57200002' })).toEqual({ cuenta: '57200001', origen: 'De su ficha' })
  })
  it('3 · sin banco en su ficha, la de su último cobro', () => {
    expect(propuestaDelCobro({ deLaFicha: ' ', banco: null, ultimo: '55100001' })).toEqual({ cuenta: '55100001', origen: 'La del último cobro' })
  })
  it('4 · sin ninguna, vacía: pendiente de cobrar', () => {
    expect(propuestaDelCobro({ deLaFicha: null, banco: null, ultimo: null })).toEqual({ cuenta: '', origen: null })
  })
})

describe('X25 · el NIF repetido de la ficha del proveedor, con quién lo tiene', () => {
  const otros = [{ id: 'p-1', name: 'Frutas Inventadas', taxId: 'B00000000' }, { id: 'p-2', name: 'Sin NIF', taxId: null }]
  it('con guion o sin él, es el mismo (la clave de la base); el propio no cuenta', () => {
    expect(nifRepetidoDe({ id: 'p-9', taxId: 'B-00000000' }, otros)?.id).toBe('p-1')
    expect(nifRepetidoDe({ id: 'p-1', taxId: 'B00000000' }, otros)).toBeNull()
    expect(nifRepetidoDe({ id: 'p-9', taxId: 'J00000000' }, otros)).toBeNull()
    expect(nifRepetidoDe({ id: 'p-9', taxId: null }, otros)).toBeNull()
  })
})
