// tests/conta/x31-erp10/dudas.test.ts
//
// X31 · 2 · Lo que la pantalla dice de lo que ya está en ERP10 (src/modules/conta/erp10/dudas.ts, y la duda en la línea de la
// ficha, la lista de hoy y el resumen de la salida). Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { botones, deLaFila, diferenciaCent, queEs, sePuedeLaMisma, textoBoton, textoYaEsta, totales } from '@/modules/conta/erp10/dudas'
import { lineaErp10, listaDeHoy } from '@/modules/conta/erp10/salidaSola'
import { loQueHaEntrado } from '@/modules/conta/erp10/conexion'

const fila = (duda: Record<string, unknown>, je: Record<string, unknown> | null = { series: 'C', number: 12, concept: 'Proveedor Inventado, S.L.', entry_date: '2026-11-05' }) =>
  ({ id: 'envio-1', entry_id: 'asiento-1', clase: 'recibida', duda, motivo: 'Ya está en ERP10 (asiento 51).', journal_entry: je })

describe('una factura que ya está en ERP10', () => {
  const d = deLaFila(fila({ que: 'factura', ejercicio: '2026', serie: '2', documento: 51, cuantos: 1, numero: 'F-0007', totalErp10Cent: 12000, totalSumiedCent: 12100 }))!
  it('de la fila de la base: su número de ERP10, el de la factura, su concepto y los dos totales', () => {
    expect(d).toMatchObject({ envioId: 'envio-1', entryId: 'asiento-1', que: 'factura', documento: 51, numero: 'F-0007', concepto: 'Proveedor Inventado, S.L.', totalErp10Cent: 12000, totalSumiedCent: 12100 })
    expect(queEs(d)).toBe('La factura F-0007 · Proveedor Inventado, S.L.')
    expect(textoYaEsta(d)).toBe('Ya está en ERP10 (asiento 51)')
  })
  it('otro total: los dos, uno al lado del otro, y la diferencia (Sumied menos ERP10)', () => {
    expect(diferenciaCent(d)).toBe(100)
    expect(totales(d)).toEqual({ sumied: '121,00 €', erp10: '120,00 €', diferencia: '+1,00 €' })
    expect(totales({ totalErp10Cent: 12100, totalSumiedCent: 12000 })?.diferencia).toBe('−1,00 €')
  })
  it('«Es la misma» no se puede sin mirar la diferencia; con el mismo total, sí', () => {
    expect(sePuedeLaMisma(d, false)).toBe(false)
    expect(sePuedeLaMisma(d, true)).toBe(true)
    expect(sePuedeLaMisma({ totalErp10Cent: 12100, totalSumiedCent: 12100 }, false)).toBe(true)
    expect(totales({ totalErp10Cent: 12100, totalSumiedCent: 12100 })?.diferencia).toBeNull()
  })
  it('un solo botón, «Es la misma, no la mandes» (ERP10 no admite otra con el mismo número del mismo tercero)', () => {
    expect(botones(d).map((b) => textoBoton(d, b))).toEqual(['Es la misma, no la mandes'])
  })
})

describe('un asiento que ya está en ERP10', () => {
  const d = deLaFila(fila({ que: 'asiento', ejercicio: '2026', serie: '1', documento: 61, cuantos: 2, fecha: '2026-11-05' }, { series: '3', number: 1, concept: 'Pago inventado', entry_date: '2026-11-05' }))!
  it('los dos botones, sin totales, y cuántos más encajan', () => {
    expect(botones(d).map((b) => textoBoton(d, b))).toEqual(['Es el mismo, no lo mandes', 'Es otro, mándalo'])
    expect(totales(d)).toBeNull()
    expect(sePuedeLaMisma(d, false)).toBe(true)
    expect(textoYaEsta(d)).toBe('Ya está en ERP10 (asiento 61) y 1 más que encajan')
    expect(queEs(d)).toBe('El asiento 3/1 del 05/11 · Pago inventado')
  })
  it('una fila sin duda, o sin número de ERP10, no se enseña (no hay nada que decidir)', () => {
    expect(deLaFila({ id: 'x', entry_id: 'y', duda: null })).toBeNull()
    expect(deLaFila({ id: 'x', entry_id: 'y', duda: { que: 'asiento' } })).toBeNull()
  })
})

describe('la duda en la ficha, en la lista de hoy y en lo que dice la salida', () => {
  it('la ficha: en ámbar, sin «Volver a intentarlo» y sin vigilar (espera a una persona)', () => {
    const l = lineaErp10({ validado: true, fecha: '2026-11-05', salida: { encendida: true, desde: '2026-11-01' }, conElExcel: null, pruebaHecha: true,
      envio: { estado: 'duda', serie: null, documento: null, motivo: 'Ya está en ERP10 (asiento 51).', intentos: 1, como: 'sola' } })
    expect(l).toEqual({ tono: 'ambar', texto: 'No ha salido a ERP10: Ya está en ERP10 (asiento 51). Dilo en «Salida a ERP10»: si es la misma, no se manda.', reintentar: false, vigilar: false })
  })
  it('la lista de hoy: arriba y en ámbar, con lo que encontró', () => {
    const xs = listaDeHoy([
      { entryId: 'a', numero: 'C/1', concepto: '', estado: 'en_erp10', documento: 50, motivo: null, intentos: 1, como: 'sola', cuando: '2026-11-24T09:00:00Z' },
      { entryId: 'b', numero: 'C/2', concepto: '', estado: 'duda', documento: null, motivo: 'Ya está en ERP10 (asiento 51).', intentos: 1, como: 'sola', cuando: '2026-11-24T08:00:00Z' },
    ])
    expect(xs.map((x) => [x.entryId, x.tono, x.estado])).toEqual([['b', 'ambar', 'Ya está en ERP10 (asiento 51)'], ['a', 'verde', 'En ERP10 · asiento 50']])
  })
  it('lo que dice la salida: no se ha mandado, y dónde decidirlo; no sale «bien»', () => {
    const r = loQueHaEntrado([{ numero: 'F-0007', estado: 'duda', porque: 'Ya está en ERP10 (asiento 51).' }], 'noviembre de 2026')
    expect(r).toEqual({ texto: '1 ya estaba en ERP10 y no se ha mandado (F-0007: Ya está en ERP10 (asiento 51)): míralo en «Ya está en ERP10».', bien: false })
  })
})
