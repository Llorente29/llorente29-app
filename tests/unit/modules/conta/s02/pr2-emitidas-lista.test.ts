// tests/unit/modules/conta/s02/pr2-emitidas-lista.test.ts
//
// S02 · PR 2 · Facturación › Facturas emitidas, sin pintar: de las anotaciones
// del libro de expedidas a las facturas, las pestañas que suman «Todas», el
// buscador, el orden, el pie (las anuladas no suman) y la lectura mes a mes.
// Regla 31: la población tiene la forma de la de producción (vat_book_entry,
// book = 'issued', leída el 22/10): 1.196 F1 de plataforma sin NIF, 38 F1 con
// NIF, 65 F4 (resúmenes de tiques del día, sin número) y 18 F2; todas con
// calificación S1 y con total = base + cuota.

import { describe, expect, it } from 'vitest'
import type { AnotacionLibro } from '@/modules/conta/lib/libroRegistro'
import {
  casaConBusqueda, facturasDeAnotaciones, filasEmitidas, filtrarSinPestana, filtrosEmitidas, mesesDeLaVentana, pestanasEmitidas, totalesEmitidas,
} from '@/modules/conta/facturacion/emitidas'
import { sumanTodas } from '@/modules/conta/diseno/plantillas'

const anot = (o: Partial<AnotacionLibro> & { id: string; entryId: string }): AnotacionLibro => ({
  book: 'issued', invoiceType: 'F1', series: '1', number: 'GLV655858-20260930', numberTo: null, documentsCount: 1,
  issueDate: '2026-09-30', operationDate: null, receivedDate: null, receivedNumber: null, partyId: null,
  counterpartTaxId: null, counterpartIdType: null, counterpartCountry: null, counterpartName: 'GLOVO', operationKey: '01',
  qualification: 'S1', exemptCause: null, taxBase: 174.1, taxRate: 10, taxAmount: 17.41, surchargeRate: null, surchargeAmount: null,
  total: 191.51, deductibleAmount: null, deductibleLater: false, reverseCharge: false, investmentGood: false, withholdingRate: null,
  withholdingAmount: null, activityCode: null, activityType: null, activityIae: null, correctsRef: null, sourceType: 'migrated', sourceId: null,
  voidedAt: null, deducidaEn: null, deducidaPorque: null, ...o,
} as AnotacionLibro)

const POBLACION: AnotacionLibro[] = [
  anot({ id: '1', entryId: 'e1' }),
  anot({ id: '2', entryId: 'e2', number: 'GLV655851-20260930', taxBase: 124.65, taxAmount: 12.46, total: 137.11 }),
  anot({ id: '3', entryId: 'e3', number: 'A-12', counterpartName: 'Comidas Ejemplo, S.L.', counterpartTaxId: 'B12345678', issueDate: '2026-10-02', taxBase: 1000, taxAmount: 100, total: 1100 }),
  anot({ id: '4', entryId: 'e4', invoiceType: 'F4', series: null, number: null, documentsCount: 18, issueDate: '2026-10-21', counterpartName: 'VENTAS A CONSUMIDOR FINAL', taxBase: 348.8, taxAmount: 34.86, total: 383.66, sourceType: 'sales_day' }),
  anot({ id: '5', entryId: 'e5', invoiceType: 'F2', series: null, number: null, issueDate: '2026-10-21', counterpartName: 'VENTAS A CONSUMIDOR FINAL', taxBase: 16.26, taxAmount: 1.63, total: 17.89, sourceType: 'sales_day' }),
  // Una anulada (se compensa con su contraasiento): sale, con su chip, y no suma.
  anot({ id: '6', entryId: 'e6', number: 'A-13', counterpartName: 'Comidas Ejemplo, S.L.', counterpartTaxId: 'B12345678', issueDate: '2026-10-05', taxBase: 50, taxAmount: 5, total: 55, voidedAt: '2026-10-06T10:00:00Z' }),
]

describe('S02 · PR 2 · de las anotaciones a las facturas emitidas', () => {
  const fs = facturasDeAnotaciones(POBLACION)

  it('una factura por anotación; el número es serie-número y el resumen de tiques dice cuántos', () => {
    expect(fs).toHaveLength(6)
    const glovo = fs.find((f) => f.entryId === 'e1')!
    expect(glovo).toMatchObject({ numero: '1-GLV655858-20260930', cliente: 'GLOVO', base: 174.1, iva: 17.41, total: 191.51, tipo: 'F1 · factura' })
    expect(fs.find((f) => f.entryId === 'e4')).toMatchObject({ numero: null, tipo: 'F4 · resumen de tiques · 18 tiques' })
  })

  it('el estado: lo que le falta para un requerimiento, como en el libro; la anulada, anulada', () => {
    const estado = Object.fromEntries(fs.map((f) => [f.entryId, f.estado]))
    // GLOVO sin NIF: le falta el NIF del destinatario; el F4 sin número, su número y su rango.
    expect(estado).toEqual({ e1: 'por-completar', e2: 'por-completar', e3: 'vigente', e4: 'por-completar', e5: 'por-completar', e6: 'anulada' })
    expect(fs.find((f) => f.entryId === 'e1')!.falta).toEqual(['NIF del destinatario'])
  })

  it('una factura con dos tipos de IVA (dos anotaciones del mismo asiento y número) es UNA, con lo suyo sumado', () => {
    const dos = facturasDeAnotaciones([
      anot({ id: 'x1', entryId: 'ex', number: 'A-20', counterpartTaxId: 'B12345678', taxBase: 100, taxRate: 10, taxAmount: 10, total: 110 }),
      anot({ id: 'x2', entryId: 'ex', number: 'A-20', counterpartTaxId: 'B12345678', taxBase: 50, taxRate: 21, taxAmount: 10.5, total: 60.5 }),
      anot({ id: 'r', entryId: 'er', book: 'received' }),
    ])
    expect(dos).toHaveLength(1)
    expect(dos[0]).toMatchObject({ base: 150, iva: 20.5, total: 170.5 })
  })

  it('sin total en la base, el total es base + cuota + recargo (al céntimo)', () => {
    const [f] = facturasDeAnotaciones([anot({ id: 'y', entryId: 'ey', taxBase: 0.1, taxAmount: 0.2, surchargeAmount: 0.01, total: null })])
    expect(f.total).toBe(0.31)
  })

  it('las pestañas suman «Todas» y cada factura está en una sola', () => {
    const p = pestanasEmitidas(fs)
    expect(sumanTodas(p)).toBe(true)
    expect(p.map((x) => [x.id, x.n])).toEqual([['todas', 6], ['vigente', 1], ['por-completar', 4], ['anulada', 1]])
    // Sin anuladas ni por completar, esas pestañas no salen; «Emitidas» sí, aunque cuente 0.
    expect(pestanasEmitidas([]).map((x) => x.id)).toEqual(['todas', 'vigente'])
  })

  it('el pie: las anuladas se cuentan aparte y no suman', () => {
    expect(totalesEmitidas(fs)).toEqual({ n: 5, anuladas: 1, base: 1663.81, iva: 166.36, total: 1830.17 })
  })

  it('el buscador: cliente sin acentos, NIF, número o importe como se escribe', () => {
    const glovo = fs.find((f) => f.entryId === 'e1')!
    expect(casaConBusqueda(glovo, 'glovo')).toBe(true)
    expect(casaConBusqueda(glovo, '191,51')).toBe(true)
    expect(casaConBusqueda(glovo, '191.51')).toBe(true)
    expect(casaConBusqueda(glovo, '191')).toBe(true)
    expect(casaConBusqueda(glovo, '191,50')).toBe(false)
    expect(casaConBusqueda(fs.find((f) => f.entryId === 'e3')!, 'comidas b1234')).toBe(true)
    expect(casaConBusqueda(fs.find((f) => f.entryId === 'e3')!, '1.100,00')).toBe(true)
    expect(filtrarSinPestana(fs, { q: 'consumidor', mes: '' }).map((f) => f.entryId).sort()).toEqual(['e4', 'e5'])
  })

  it('los filtros salen de la dirección; lo desconocido, el de serie (todas, por fecha de más nueva a más vieja)', () => {
    expect(filtrosEmitidas(new URLSearchParams('ver=anulada&q=glovo&mes=2026-09&orden=total'))).toEqual({ pestana: 'anulada', q: 'glovo', mes: '2026-09', orden: { columna: 'total', sentido: 'asc' } })
    expect(filtrosEmitidas(new URLSearchParams('ver=otra&mes=sept&orden=-borrar'))).toEqual({ pestana: 'todas', q: '', mes: '', orden: { columna: 'fecha', sentido: 'desc' } })
  })

  it('las filas: pestaña, mes y orden', () => {
    const f = filtrosEmitidas(new URLSearchParams(''))
    expect(filasEmitidas(fs, f).map((x) => x.fecha)).toEqual(['2026-10-21', '2026-10-21', '2026-10-05', '2026-10-02', '2026-09-30', '2026-09-30'])
    expect(filasEmitidas(fs, { ...f, pestana: 'vigente' }).map((x) => x.entryId)).toEqual(['e3'])
    expect(filasEmitidas(fs, { ...f, mes: '2026-09' }).map((x) => x.entryId)).toEqual(['e1', 'e2'])
    expect(filasEmitidas(fs, { ...f, orden: { columna: 'total', sentido: 'desc' } })[0].entryId).toBe('e3')
  })
})

describe('S02 · PR 2 · la lectura, mes a mes (por debajo del tope de filas de la base)', () => {
  it('los últimos 12 meses son 12 lecturas, cada una de su mes entero', () => {
    const m = mesesDeLaVentana('2025-11-01', '2026-10-31')
    expect(m).toHaveLength(12)
    expect(m[0]).toEqual({ desde: '2025-11-01', hasta: '2025-11-30' })
    expect(m[3]).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
    expect(m[11]).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' })
  })
  it('un mes es una lectura; una ventana que no empieza el día 1 se respeta', () => {
    expect(mesesDeLaVentana('2026-10-01', '2026-10-31')).toEqual([{ desde: '2026-10-01', hasta: '2026-10-31' }])
    expect(mesesDeLaVentana('2026-09-15', '2026-10-10')).toEqual([{ desde: '2026-09-15', hasta: '2026-09-30' }, { desde: '2026-10-01', hasta: '2026-10-10' }])
  })
})
