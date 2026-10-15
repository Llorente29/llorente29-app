// tests/unit/modules/conta/excelBbvaB01.test.ts
//
// B01 · El Excel «Histórico» de BBVA (15/10). El primer fichero de verdad de
// Foodint no se leía («No encuentro la fila de títulos»): la fecha se llama
// «F. CONTABLE». Este ejemplo es INVENTADO, pero copia su forma exacta (la que
// Julio pasó, sin un dato real): hoja única «Historico», datos desde la columna
// C, cabecera en pares etiqueta (C) / valor (F) en las filas 7–14, títulos en
// la 16, movimientos desde la 17 del más reciente al más antiguo, fechas como
// texto, CÓDIGO de cinco cifras, IMPORTE y SALDO como números con formato
// #,##0.00, y la tarjeta ya enmascarada por el banco en OBSERVACIONES. Se
// construye un .xlsx de verdad y se lee como lo lee abrirExtracto
// (src/modules/conta/services/bancosService.ts).

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { ibanDesdeCcc } from '@/modules/conta/lib/norma43'
import { cuadrar } from '@/modules/conta/lib/extractoBanco'
import { leerFicheroBanco } from '@/modules/conta/lib/fuentesBanco'
import { reconocerBanco } from '@/modules/conta/lib/lectorCsvBanco'
import { partirCsv } from '@/modules/conta/lib/importarPlan'
import { digitosTarjeta } from '@/modules/conta/lib/conciliacion'

const IBAN = ibanDesdeCcc('0182', '9001', '0200000099') // inventado, con sus dígitos de control buenos
const TITULOS = ['F. CONTABLE', 'F. VALOR', 'CÓDIGO', 'CONCEPTO', 'BENEFICIARIO/ORDENANTE', 'OBSERVACIONES', 'IMPORTE', 'SALDO', 'DIVISA', 'OFICINA', 'REMESA']

// Del más antiguo al más reciente; el fichero los da al revés. Dos el mismo día (el 03).
const MOVS = [
  { f: '01/10/2026', codigo: '00956', concepto: 'PAGO CON TARJETA', ben: '', obs: '************1234 COMERCIO INVENTADO', imp: -12.5 },
  { f: '02/10/2026', codigo: '00163', concepto: 'TRANSFERENCIA RECIBIDA', ben: 'PLATAFORMA NORTE SL', obs: 'LIQUIDACION SEMANA 39 REF 12345678901234', imp: 850 },
  { f: '03/10/2026', codigo: '00007', concepto: 'TRASPASO', ben: 'EMPRESA INVENTADA SL', obs: 'EMPRESA INVENTADA SL', imp: -300 },
  { f: '03/10/2026', codigo: '00925', concepto: 'ADEUDO DOMICILIADO', ben: '', obs: 'SUMINISTROS DEL NORTE 1234567890123456', imp: -64.3 },
  { f: '06/10/2026', codigo: '00956', concepto: 'PAGO CON TARJETA', ben: '', obs: '************1234 OTRO COMERCIO', imp: -7.2 },
]
const SALDO_INICIAL = 1000

function libroBbva(): ArrayBuffer {
  const ws: XLSX.WorkSheet = {}
  XLSX.utils.sheet_add_aoa(ws, [
    ['Titular', '', '', 'EMPRESA INVENTADA SL '],
    ['Cuenta', '', '', IBAN],
    ['Divisa', '', '', 'EUR '],
    ['Banco', '', '', 'BBVA '],
    ['Fecha', '', '', '15/10/2026 Hora 11:00 '],
    ['Importe', '', '', 'Todos '],
    ['Periodo', '', '', '01/10/2026-06/10/2026'],
    ['Filtros', '', '', ''],
  ], { origin: 'C7' })
  XLSX.utils.sheet_add_aoa(ws, [TITULOS], { origin: 'C16' })
  let saldo = SALDO_INICIAL
  const filas = MOVS.map((m, i) => { saldo = Math.round((saldo + m.imp) * 100) / 100; return [m.f, m.f, m.codigo, m.concepto, m.ben, m.obs, m.imp, saldo, 'EUR', '0937', `ES0182${String(i + 1).padStart(18, '0')}`] })
  XLSX.utils.sheet_add_aoa(ws, filas.reverse(), { origin: 'C17' })
  for (let r = 17; r < 17 + MOVS.length; r++) for (const c of ['I', 'J']) ws[`${c}${r}`].z = '#,##0.00'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Historico')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** Lo mismo que hace abrirExtracto con un .xlsx. */
function filasDe(bytes: ArrayBuffer): string[][] {
  const libro = XLSX.read(bytes, { type: 'array', cellDates: false })
  const hoja = libro.Sheets[libro.SheetNames.find((h) => (libro.Sheets[h]['!ref'] ?? '') !== '') ?? libro.SheetNames[0]]
  return (XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '' }) as unknown[][]).map((r) => r.map((c) => String(c ?? '')))
}

describe('el Excel «Histórico» de BBVA, con su forma de verdad', () => {
  const filas = filasDe(libroBbva())
  const e = leerFicheroBanco({ filas }, partirCsv)
  const c = e.cuentas[0]

  it('lo reconoce como BBVA (por el IBAN de la cabecera) y encuentra los títulos', () => {
    expect(filas.some((f) => f.includes('F. CONTABLE'))).toBe(true)
    expect(reconocerBanco(filas)).toBe('bbva')
    expect(e.formato).toBe('csv:bbva')
    expect(c.iban).toBe(IBAN)
    expect(c.titular).toBe('EMPRESA INVENTADA SL')
  })
  it('los pone en orden (también los dos del mismo día) y cuadra con la cadena de saldos', () => {
    expect(c.movimientos.map((m) => m.importeCent)).toEqual([-1250, 85000, -30000, -6430, -720])
    expect(c.desde).toBe('2026-10-01')
    expect(c.hasta).toBe('2026-10-06')
    expect(c.saldoInicialCent).toBe(100000)
    expect(c.saldoFinalCent).toBe(100000 - 1250 + 85000 - 30000 - 6430 - 720)
    expect(cuadrar(e).ok).toBe(true)
  })
  it('CÓDIGO es el concepto propio; REMESA, la referencia de la huella; sin código común', () => {
    expect(c.movimientos.map((m) => m.conceptoPropio)).toEqual(['00956', '00163', '00007', '00925', '00956'])
    expect(c.movimientos[0].referencia1).toBe('ES0182000000000000000001')
    expect(new Set(c.movimientos.map((m) => m.referencia1)).size).toBe(MOVS.length)
    expect(c.movimientos.every((m) => m.conceptoComun === null)).toBe(true)
  })
  it('el concepto: la etiqueta, a quién (BENEFICIARIO/ORDENANTE) y las observaciones, sin repetir', () => {
    expect(c.movimientos[1].conceptoBanco).toBe('TRANSFERENCIA RECIBIDA · PLATAFORMA NORTE SL · LIQUIDACION SEMANA 39 REF 12345678901234')
    expect(c.movimientos[2].conceptoBanco).toBe('TRASPASO · EMPRESA INVENTADA SL')
    expect(c.movimientos[0].conceptoBanco).toBe('PAGO CON TARJETA · ************1234 COMERCIO INVENTADO')
  })
  it('la tarjeta, ya enmascarada por el banco, la reconoce el motor por sus 4 últimas', () => {
    expect(digitosTarjeta(c.movimientos[0].conceptoBanco)).toContain('1234')
  })
})
