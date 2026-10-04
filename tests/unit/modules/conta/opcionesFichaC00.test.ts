// tests/unit/modules/conta/opcionesFichaC00.test.ts
//
// C00, tarea 7: lo que la ficha de proveedor lee de las tablas generales.
// Contra las filas de serie REALES (regla 31): datos/filas-serie-c00.json es
// la copia de staging-conta del 03/10/2026, sin tocar.

import { describe, expect, it } from 'vitest'
import filasReales from './datos/filas-serie-c00.json'
import {
  casillasIva, construirOpciones, formasDelDesplegable, nombreFormaPago, type FilasFicha,
} from '@/modules/conta/lib/opcionesFicha'
import { PAYMENT_METHOD_LABEL } from '@/modules/conta/types'

const filas = filasReales as FilasFicha
const HOY = '2026-10-03'
const id = (nombre: string) => filas.impuestos.find((t) => t.name === nombre)!.id
const nada = new Set<string>()

describe('la ficha lee de las tablas generales', () => {
  it('península: el IVA que se puede poner hoy, sin el tratamiento de UE ni la inversión', () => {
    const o = construirOpciones(filas, nada, 'peninsula_baleares', HOY, null)
    expect(o.tiposIva.map((t) => t.valor)).toEqual([0, 4, 10, 21])
    expect(o.tiposIva.find((t) => t.valor === 0)?.nombre).toBe('Exento o 0 %')
    // El 5 % que tenía el C01 escrito en la pantalla no está vigente: no se ofrece.
    expect(o.tiposIva.some((t) => t.valor === 5)).toBe(false)
  })

  it('el 2 % de los alimentos básicos solo se ofrece dentro de su vigencia (RDL 4/2024)', () => {
    expect(construirOpciones(filas, nada, 'peninsula_baleares', '2024-11-15', null).tiposIva.map((t) => t.valor)).toEqual([0, 2, 4, 10, 21])
    expect(construirOpciones(filas, nada, 'peninsula_baleares', '2025-01-01', null).tiposIva.map((t) => t.valor)).toEqual([0, 4, 10, 21])
  })

  it('Canarias: el IGIC, no el IVA', () => {
    const o = construirOpciones(filas, nada, 'canarias', HOY, null)
    expect(o.tiposIva.map((t) => t.valor)).toEqual([0, 3, 5, 7, 9.5, 15, 20])
  })

  it('retenciones vigentes; si dos filas dan el mismo porcentaje, salen las dos en el nombre', () => {
    const o = construirOpciones(filas, nada, 'peninsula_baleares', HOY, null)
    expect(o.retenciones.map((r) => r.valor)).toEqual([7, 15, 19, 35])
    expect(o.retenciones.find((r) => r.valor === 19)?.nombre).toBe('Alquiler de local · Intereses y dividendos')
  })

  it('formas de pago y plazos; el de dos vencimientos no cabe todavía en la ficha (D6)', () => {
    const o = construirOpciones(filas, nada, 'peninsula_baleares', HOY, null)
    expect(o.formasPago).toEqual([
      { valor: 'transfer', nombre: 'Transferencia' }, { valor: 'direct_debit', nombre: 'Domiciliación' },
      { valor: 'card', nombre: 'Tarjeta' }, { valor: 'cash', nombre: 'Efectivo' },
    ])
    expect(o.plazos).toEqual([{ valor: 0, nombre: 'Al contado' }, { valor: 30, nombre: '30 días' }, { valor: 60, nombre: '60 días' }])
  })

  it('lo que la empresa ocultó no se ofrece al elegir…', () => {
    const ocultas = new Set([id('IVA reducido'), filas.formasPago[0].id])
    const o = construirOpciones(filas, ocultas, 'peninsula_baleares', HOY, null)
    expect(o.tiposIva.map((t) => t.valor)).toEqual([0, 4, 21])
    expect(o.formasPago.map((f) => f.valor)).toEqual(['direct_debit', 'card', 'cash'])
  })

  it('…pero lo que el proveedor ya tiene guardado sale siempre, y dice por qué (regla 30)', () => {
    const o = construirOpciones(filas, new Set([id('IVA reducido'), filas.formasPago[0].id]), 'peninsula_baleares', HOY, null)
    expect(casillasIva(o, [5, 10, 21])).toEqual([
      { valor: 0, nombre: 'Exento o 0 %', ofrecida: true },
      { valor: 4, nombre: 'IVA superreducido', ofrecida: true },
      { valor: 5, nombre: null, ofrecida: false },
      { valor: 10, nombre: null, ofrecida: false },
      { valor: 21, nombre: 'IVA general', ofrecida: true },
    ])
    const formas = formasDelDesplegable(o, 'transfer', PAYMENT_METHOD_LABEL)
    expect(formas.find((f) => f.valor === 'transfer')).toEqual({ valor: 'transfer', nombre: 'Transferencia', ofrecida: false })
  })

  it('una forma propia del mismo tipo que otra: se ofrece la primera, porque la ficha guarda el tipo', () => {
    const propia = { id: 'propia', name: 'Transferencia BBVA', kind: 'transfer', sortOrder: 5 }
    const o = construirOpciones({ ...filas, formasPago: [...filas.formasPago, propia] }, nada, 'peninsula_baleares', HOY, null)
    expect(o.formasPago.filter((f) => f.valor === 'transfer')).toEqual([{ valor: 'transfer', nombre: 'Transferencia BBVA' }])
    expect(nombreFormaPago(o, 'transfer', PAYMENT_METHOD_LABEL)).toBe('Transferencia BBVA')
    expect(nombreFormaPago(null, 'transfer', PAYMENT_METHOD_LABEL)).toBe('Transferencia')
  })
})
