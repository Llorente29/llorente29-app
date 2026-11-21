// tests/unit/modules/conta/k09/validar.test.ts
//
// K09 · Nunca se valida una recibida incompleta ni repetida (src/modules/conta/nucleo/recibida/validarSoloLoCompleto.ts):
// cada falta con su frase (las mismas que la base, conta_recibida_motivos), las formas de escribir el mismo número,
// la repetida (solo contra una ya contabilizada, y no si ya se dijo «No es la misma») y lo que se dice al pulsar Intro.
import { describe, expect, it } from 'vitest'
import { faltasParaValidar, laRepetida, mismoNumero, textoNoSeValida, textoRepetida } from '@/modules/conta/nucleo/recibida/validarSoloLoCompleto'

const completa = { proveedorId: 'p1', numero: 'FV26-018817', fecha: '2026-10-20', iva: [{ base: '100', tipo: '21', cuota: '21' }], gastos: [{ cuenta: '60000000', local: '', importe: '' }] }

describe('cada falta, con su frase', () => {
  it('completa: nada', () => expect(faltasParaValidar(completa)).toEqual([]))
  it('el proveedor', () => expect(faltasParaValidar({ ...completa, proveedorId: '' })).toEqual(['Falta el proveedor.']))
  it('el número', () => expect(faltasParaValidar({ ...completa, numero: '  ' })).toEqual(['Falta el número de la factura.']))
  it('la fecha', () => expect(faltasParaValidar({ ...completa, fecha: '' })).toEqual(['Falta la fecha de la factura.']))
  it('una base con su tipo', () => {
    expect(faltasParaValidar({ ...completa, iva: [{ base: '', tipo: '21', cuota: '' }] })).toEqual(['Falta la base con su tipo de IVA.'])
    expect(faltasParaValidar({ ...completa, iva: [{ base: '100', tipo: '', cuota: '' }] })).toEqual(['Falta la base con su tipo de IVA.'])
  })
  it('la cuenta de gasto, línea a línea', () => {
    expect(faltasParaValidar({ ...completa, gastos: [{ cuenta: '', local: '', importe: '' }] })).toEqual(['Falta la cuenta de gasto en la línea 1.'])
    expect(faltasParaValidar({ ...completa, gastos: [{ cuenta: '60000000', local: '', importe: '50' }, { cuenta: '', local: '', importe: '' }] })).toEqual(['Falta la cuenta de gasto en la línea 2.'])
  })
})

describe('el mismo número, se escriba como se escriba', () => {
  for (const [a, b] of [['FV26-018817', 'fv26 18817'], ['F-0012/26', 'F1226'], ['K09-001', 'k09 1'], ['2026/000123', '2026-123']]) {
    it(`«${a}» = «${b}»`, () => expect(mismoNumero(a, b)).toBe(true))
  }
  it('otro número no', () => expect(mismoNumero('FV26-018817', 'FV26-018818')).toBe(false))
  it('sin número no es el mismo que otro sin número', () => expect(mismoNumero('', ' ')).toBe(false))
})

describe('la repetida', () => {
  const otras = [
    { id: 'o1', numero: 'FV26-018817', proveedor: 'Frutas de Prueba', asiento: '2/1', validada: true },
    { id: 'o2', numero: 'FV26-000777', proveedor: 'Frutas de Prueba', asiento: '', validada: false },
  ]
  it('contra una ya contabilizada: cuál es', () => {
    const r = laRepetida({ id: 'yo', numero: 'fv26 18817', confirmada: false, otras })
    expect(r).toEqual({ id: 'o1', numero: 'FV26-018817', proveedor: 'Frutas de Prueba', asiento: '2/1' })
    expect(textoRepetida(r!)).toBe('Ya está la FV26-018817 de Frutas de Prueba, asiento 2/1.')
  })
  it('contra una por revisar, no (esa no está contabilizada)', () => expect(laRepetida({ id: 'yo', numero: 'FV26-777', confirmada: false, otras })).toBeNull())
  it('si ya se dijo «No es la misma», no', () => expect(laRepetida({ id: 'yo', numero: 'FV26-018817', confirmada: true, otras })).toBeNull())
})

describe('lo que se dice al pulsar Intro', () => {
  it('lo que falta y la repetida, guardada y sin validar', () => {
    expect(textoNoSeValida({ faltas: ['Falta la cuenta de gasto en la línea 1.'], repetida: { id: 'o1', numero: 'FV26-018817', proveedor: 'Frutas de Prueba', asiento: '2/1' }, guardada: true }))
      .toBe('Guardada, sin validar: Falta la cuenta de gasto en la línea 1 · Ya está la FV26-018817 de Frutas de Prueba, asiento 2/1: si no es la misma, dilo en «No es la misma». No paso a la siguiente.')
  })
  it('sin nada que decir: null (se valida)', () => expect(textoNoSeValida({ faltas: [], repetida: null, guardada: false })).toBeNull())
})
