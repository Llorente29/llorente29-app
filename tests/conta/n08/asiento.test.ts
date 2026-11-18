// tests/conta/n08/asiento.test.ts
//
// N08 · Lo que decide la ficha del asiento del núcleo (src/modules/conta/lib/asientoNucleo.ts).
// El plan, el del ejemplo de ERP10 (tests/conta/fixtures/importar/erp10, inventado: T11), leído
// con el lector del N04: la población de verdad de una empresa que viene de ERP10 (regla 31).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { abrirExcel, leerCarga } from '@/modules/conta/lib/traer'
import { atajoDeSubcuenta, conConceptoDeCabecera, cuadrarLaUltima, lineaNueva, siguienteCasilla, siguienteTipo, totales } from '@/modules/conta/lib/asientoNucleo'
import { problemasMano, type LineaMano } from '@/modules/conta/lib/diario'

const fichero = readFileSync('tests/conta/fixtures/importar/erp10/plan_de_cuentas.xlsx')
const carga = leerCarga([abrirExcel('plan_de_cuentas.xlsx', fichero.buffer.slice(fichero.byteOffset, fichero.byteOffset + fichero.byteLength) as ArrayBuffer)]) as unknown as
  { plan: { subcuentas: { codigo: string; nombre: string }[] } }
const PLAN = carga.plan.subcuentas.map((s) => ({ code: s.codigo, nombre: s.nombre }))
const L = (cuenta: string, debe = '', haber = '', concepto = 'Alquiler de octubre'): LineaMano => ({ cuenta, debe, haber, concepto, localId: 'l1', comun: false })

describe('el atajo de la subcuenta, como ERP10', () => {
  it('el plan del ejemplo tiene sus 16 subcuentas de 8 cifras', () => {
    expect(PLAN).toHaveLength(16)
    expect(PLAN.every((c) => /^\d{8}$/.test(c.code))).toBe(true)
  })
  it('«5721» da la 57200001: parte después de la cuenta de mayor y rellena con ceros', () => {
    expect(atajoDeSubcuenta('5721', 8, PLAN).codigo).toBe('57200001')
  })
  it('«572.1» también, y «400.2» da la 40000002', () => {
    expect(atajoDeSubcuenta('572.1', 8, PLAN).codigo).toBe('57200001')
    expect(atajoDeSubcuenta('400.2', 8, PLAN).codigo).toBe('40000002')
  })
  it('las ocho cifras, esa subcuenta; una que no está en el plan, ninguna', () => {
    expect(atajoDeSubcuenta('62100000', 8, PLAN).codigo).toBe('62100000')
    expect(atajoDeSubcuenta('62900000', 8, PLAN).codigo).toBeNull()
    expect(atajoDeSubcuenta('629.1', 8, PLAN).codigo).toBeNull()
  })
  it('parte del nombre: si es de una sola, esa; si no, las que encajan para elegir con F4', () => {
    expect(atajoDeSubcuenta('banco', 8, PLAN).codigo).toBe('57200001')
    expect(atajoDeSubcuenta('Arrendamientos', 8, PLAN).codigo).toBe('62100000')
    const p = atajoDeSubcuenta('proveedor', 8, PLAN)
    expect(p.codigo).toBeNull()
    expect(p.candidatas.map((c) => c.code)).toEqual(['40000000', '40000001', '40000002'])
  })
  it('pocas cifras: si solo empieza así una, esa («472» → 47200000); si varias, para elegir («400»)', () => {
    expect(atajoDeSubcuenta('472', 8, PLAN).codigo).toBe('47200000')
    expect(atajoDeSubcuenta('400', 8, PLAN).candidatas).toHaveLength(3)
  })
})

describe('el concepto y el local pasan solos', () => {
  it('la línea nueva lleva el concepto de la cabecera y el local de la de arriba', () => {
    const n = lineaNueva('Alquiler de octubre', { ...L('62100000', '1000'), localId: 'l2' }, 'l1')
    expect(n).toMatchObject({ concepto: 'Alquiler de octubre', localId: 'l2', cuenta: '', debe: '', haber: '' })
    expect(lineaNueva('Alquiler', null, 'l1')).toMatchObject({ concepto: 'Alquiler', localId: 'l1', comun: false })
  })
  it('si la de arriba cambió su concepto, la nueva lleva el de arriba', () => {
    expect(lineaNueva('Alquiler', L('47200000', '210', '', 'IVA del alquiler'), null).concepto).toBe('IVA del alquiler')
  })
  it('cambiar el concepto de la cabecera cambia el de las líneas que lo llevaban, no el de las cambiadas a mano', () => {
    const r = conConceptoDeCabecera([L('62100000', '1000', '', 'Alquiler'), L('47200000', '210', '', 'IVA del alquiler'), L('57200001', '', '', '')], 'Alquiler', 'Alquiler de noviembre')
    expect(r.map((l) => l.concepto)).toEqual(['Alquiler de noviembre', 'IVA del alquiler', 'Alquiler de noviembre'])
  })
})

describe('la última línea cuadra sola', () => {
  it('tres líneas: la tercera, con subcuenta y sin importe, pone en el haber lo que falta', () => {
    const r = cuadrarLaUltima([L('62100000', '1.000,00'), L('47200000', '210,00'), L('57200001')])
    expect(r.rellena).toBe('haber')
    expect(r.lineas[2].haber).toBe('1210,00')
    expect(totales(r.lineas)).toMatchObject({ debe: 1210, haber: 1210, descuadre: 0, cuadra: true })
    // Y lo que guarda la pantalla de hoy lo da por bueno: la misma validación.
    expect(problemasMano('Alquiler de octubre', '2026-11-18', r.lineas, new Set(PLAN.map((c) => c.code)))).toEqual([])
  })
  it('si sobra haber, al debe', () => {
    const r = cuadrarLaUltima([L('57200001', '', '550'), L('43000001')])
    expect(r).toMatchObject({ rellena: 'debe' })
    expect(r.lineas[1].debe).toBe('550,00')
  })
  it('no toca si la última ya tiene importe, si no tiene subcuenta o si ya cuadra', () => {
    expect(cuadrarLaUltima([L('62100000', '100'), L('57200001', '', '90')]).rellena).toBeNull()
    expect(cuadrarLaUltima([L('62100000', '100'), L('')]).rellena).toBeNull()
    expect(cuadrarLaUltima([L('62100000', '100'), L('57200001', '', '100'), L('47200000')]).rellena).toBeNull()
  })
  it('los céntimos no se pierden: 0,10 + 0,20 cuadra con 0,30', () => {
    const r = cuadrarLaUltima([L('62100000', '0,10'), L('62100000', '0,20'), L('57200001')])
    expect(r.lineas[2].haber).toBe('0,30')
    expect(totales(r.lineas).cuadra).toBe(true)
  })
})

describe('los totales, como ERP10', () => {
  it('total debe, total haber y descuadre', () => {
    expect(totales([L('62100000', '1.000,00'), L('57200001', '', '990')])).toMatchObject({ debe: 1000, haber: 990, descuadre: 10, cuadra: false })
  })
  it('sin importes no cuadra (no hay nada que validar)', () => {
    expect(totales([L('62100000'), L('57200001')]).cuadra).toBe(false)
  })
})

describe('el teclado', () => {
  it('Intro: subcuenta → concepto → debe → haber → la subcuenta de la siguiente', () => {
    const l = L('62100000')
    expect(siguienteCasilla(0, 'subcuenta', 2, l)).toEqual({ fila: 0, casilla: 'concepto', nuevaLinea: false })
    expect(siguienteCasilla(0, 'concepto', 2, l)).toEqual({ fila: 0, casilla: 'debe', nuevaLinea: false })
    expect(siguienteCasilla(0, 'debe', 2, l)).toEqual({ fila: 0, casilla: 'haber', nuevaLinea: false })
    expect(siguienteCasilla(0, 'haber', 2, l)).toEqual({ fila: 1, casilla: 'subcuenta', nuevaLinea: false })
  })
  it('con importe en el debe, Intro salta el haber; al final de la última, abre una línea', () => {
    expect(siguienteCasilla(1, 'debe', 2, L('62100000', '100'))).toEqual({ fila: 2, casilla: 'subcuenta', nuevaLinea: true })
  })
  it('F8: asiento → emitida → recibida → asiento; sin la emitida, a la recibida y lo dice', () => {
    expect(siguienteTipo('asiento', true)).toEqual({ tipo: 'emitida', frase: null })
    expect(siguienteTipo('emitida', true)).toEqual({ tipo: 'recibida', frase: null })
    expect(siguienteTipo('recibida', true)).toEqual({ tipo: 'asiento', frase: null })
    const sin = siguienteTipo('asiento', false)
    expect(sin.tipo).toBe('recibida')
    expect(sin.frase).toMatch(/emitida todavía no está/)
  })
})
