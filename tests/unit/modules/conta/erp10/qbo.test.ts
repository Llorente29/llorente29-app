// tests/unit/modules/conta/erp10/qbo.test.ts
//
// X33 · La contabilidad de QBO a ERP10. Lo que dice la pantalla (erp10/qbo.ts) y los asientos de GoCardless con las
// cuentas de QBO (_shared/cobro/asientos.ts, G05), como en su libro mayor. El cálculo de la base (conta_gc_asientos_
// preparar y el freno de la salida) lo prueba supabase/staging/sql/20261125_x33_qbo_a_erp10_prueba.sql, en ROLLBACK.
// Todo inventado (T11).

import { describe, expect, it } from 'vitest'
import { aAsientosGc, aFacturasFuera, enOrden, fraseDePreparar, notaFacturasFuera, quienLoCambio, resumenGc } from '@/modules/conta/erp10/qbo'
import { lineaErp10, type DatosLinea } from '@/modules/conta/erp10/salidaSola'
import {
  asientoDeLaDevolucion, asientoDelCobro, asientoDelIngreso, conceptoDelCobro, CUENTAS_DE_QBO, subcuentaDelCliente,
} from '../../../../../supabase/functions/_shared/cobro/asientos'

const cliente = { cuenta: subcuentaDelCliente(CUENTAS_DE_QBO, 101), nombre: 'CLIENTE DE PRUEBA X33 SL' }

describe('X33 · los asientos de GoCardless con las cuentas de QBO', () => {
  it('el cobro: 57200002 al debe, la 430 del cliente al haber, con «nº de factura-nombre» y el día del cobro', () => {
    const a = asientoDelCobro(CUENTAS_DE_QBO, cliente, '2026/1/0001', '2026-11-04', 6050)
    expect(a.parado).toEqual([])
    expect(a.fecha).toBe('2026-11-04')
    expect(a.lineas).toEqual([
      { cuenta: '57200002', concepto: '2026/1/0001-CLIENTE DE PRUEBA X33 SL', debeCent: 6050, haberCent: 0 },
      { cuenta: '43000101', concepto: '2026/1/0001-CLIENTE DE PRUEBA X33 SL', debeCent: 0, haberCent: 6050 },
    ])
  })

  it('la devolución deshace el cobro: la 430 al debe y la 57200002 al haber', () => {
    const a = asientoDeLaDevolucion(CUENTAS_DE_QBO, cliente, '2026/1/0001', '2026-11-12', 6050, true)
    expect(a.parado).toEqual([])
    expect(a.lineas.map((l) => [l.cuenta, l.debeCent, l.haberCent])).toEqual([['43000101', 6050, 0], ['57200002', 0, 6050]])
    expect(a.lineas[0].concepto).toBe(`Retrocedido ${conceptoDelCobro('2026/1/0001', cliente.nombre)}`)
  })

  it('el ingreso en el banco: 57200000 al debe y 57200002 al haber, por lo que llega', () => {
    const a = asientoDelIngreso(CUENTAS_DE_QBO, 15895, 'X33-LIQ-1', '2026-11-06',
      [{ tipo: 'payment_paid_out', importe: '16335', cobroId: 'PM1' }, { tipo: 'gocardless_fee', importe: '-440', cobroId: null }], new Set(['PM1']))
    expect(a.parado).toEqual([])
    expect(a.lineas.map((l) => [l.cuenta, l.debeCent, l.haberCent])).toEqual([['57200000', 15895, 0], ['57200002', 0, 15895]])
    // La comisión no va en un asiento del cobro: llega en la factura mensual de GoCardless (una recibida, a la 629).
    expect(a.comisionCent).toBe(440)
  })

  it('un cobro de cero no se contabiliza: se dice', () => {
    expect(asientoDelCobro(CUENTAS_DE_QBO, cliente, '2026/1/0001', '2026-11-04', 0).parado).toEqual(['El cobro tiene que ser mayor que cero'])
  })
})

describe('X33 · «Las facturas las emite Cegid: no se suben las de Sumied»', () => {
  it('encendido: dice cuántas no salen este mes (regla 7) y que los demás asientos salen', () => {
    const n = notaFacturasFuera(aFacturasFuera({ encendido: true, emitidas: 2, recibidas: 1 }))
    expect(n?.fuerte).toBe('Las facturas las emite Cegid: no se suben las de Sumied.')
    expect(n?.resto).toBe('Este mes no salen 2 facturas emitidas ni 1 factura recibida: las lleva Cegid. Los demás asientos salen como siempre.')
  })

  it('encendido sin facturas del mes: lo dice igual', () => {
    expect(notaFacturasFuera(aFacturasFuera({ encendido: true, emitidas: 0, recibidas: 0 }))?.resto)
      .toBe('Este mes no hay ninguna factura validada que dejar fuera. Los demás asientos salen como siempre.')
  })

  it('apagado: no hay nota', () => {
    expect(notaFacturasFuera(aFacturasFuera({ encendido: false, emitidas: 3 }))).toBeNull()
    expect(notaFacturasFuera(aFacturasFuera(null))).toBeNull()
  })

  it('quién y cuándo lo cambió, con el día de Madrid', () => {
    expect(quienLoCambio({ cambiadoEn: '2026-11-25T23:30:00Z', cambiadoPor: 'Persona de Prueba' })).toBe('Lo cambió Persona de Prueba el 26/11/2026.')
    expect(quienLoCambio({ cambiadoEn: null, cambiadoPor: 'Persona de Prueba' })).toBeNull()
  })
})

describe('X33 · los asientos de GoCardless del mes en la pantalla', () => {
  const del = aAsientosGc({
    por_preparar: 1,
    filas: [
      { clase: 'ingreso', gc_id: 'PO1', fecha: '2026-11-06', importe: 158.95, cuenta: '57200000', concepto: 'Ingreso de GoCardless X33-LIQ-1', pendiente: [], entry_id: 'e2', estado: 'propuesto' },
      { clase: 'cobro', gc_id: 'PM1', fecha: '2026-11-04', importe: 60.5, nombre: 'Uno', cuenta: '43000101', concepto: '2026/1/0001-Uno', pendiente: [], entry_id: 'e1', estado: 'validado', numero: '4/12' },
      { clase: 'cobro', gc_id: 'PM2', fecha: '2026-11-05', importe: 72.6, nombre: 'Dos', concepto: '—-Dos', pendiente: ['El cliente no tiene su 430', 'Falta el número de factura'], entry_id: null },
    ],
  })

  it('lo pendiente de revisar arriba, y después por día: nada se esconde', () => {
    expect(enOrden(del.filas).map((f) => f.gcId)).toEqual(['PM2', 'PM1', 'PO1'])
  })

  it('el resumen cuenta los preparados, los pendientes y lo que queda por preparar', () => {
    expect(resumenGc(del, 'noviembre de 2026')).toEqual({
      fuerte: 'Asientos de GoCardless de noviembre de 2026 · 4',
      resto: '2 preparados · 1 en «Pendiente de revisar» · 1 por preparar. Se preparan por revisar: no sale ninguno hasta que se valida.',
    })
  })

  it('una empresa sin nada de GoCardless no enseña nada', () => {
    expect(resumenGc(aAsientosGc({ por_preparar: 0, filas: [] }), 'noviembre de 2026')).toBeNull()
  })

  it('«Preparar» confirma con números (regla 8)', () => {
    expect(fraseDePreparar({ preparados: 3, ya_estaban: 0, pendientes: 1 })).toBe('3 preparados · 0 ya estaban · 1 en «Pendiente de revisar».')
    expect(fraseDePreparar({ preparados: 0, ya_estaban: 1, pendientes: 0 })).toBe('0 preparados · 1 ya estaba · 0 en «Pendiente de revisar».')
  })

  it('una fila rara no tumba la pantalla', () => {
    expect(aAsientosGc({ filas: [{ clase: 'otra', importe: 'x' }] }).filas[0]).toMatchObject({ clase: 'cobro', gcId: '', pendiente: [] })
  })
})

describe('X33 · con lo del X10 y del X31: ya está en ERP10 y nada sale dos veces', () => {
  const base: DatosLinea = { validado: true, fecha: '2026-11-04', envio: null, salida: { encendida: true, desde: '2026-11-01' }, conElExcel: null, pruebaHecha: true }

  it('un cobro que ya está en ERP10 (lo apuntó QBO) no se sube: espera a una persona en «Salida a ERP10»', () => {
    const l = lineaErp10({ ...base, envio: { estado: 'duda', serie: null, documento: null, motivo: 'Ya está en ERP10', intentos: 1, como: 'sola' } })
    expect(l?.tono).toBe('ambar')
    expect(l?.texto).toBe('No ha salido a ERP10: Ya está en ERP10. Dilo en «Salida a ERP10»: si es la misma, no se manda.')
    expect(l?.reintentar).toBe(false)
  })

  it('lo que ya ha entrado no vuelve a salir: dice su número de ERP10', () => {
    const l = lineaErp10({ ...base, envio: { estado: 'en_erp10', serie: '1', documento: 812, motivo: null, intentos: 1, como: 'a_mano' } })
    expect(l).toEqual({ tono: 'verde', texto: 'En ERP10 · asiento 812', reintentar: false, vigilar: false })
  })

  it('la primera de la empresa sale a mano, para probar; un asiento sin validar (lo que prepara el X33) no va', () => {
    expect(lineaErp10({ ...base, pruebaHecha: false })?.texto).toBe('Por salir a ERP10: la primera de la empresa sale a mano, desde «Salida a ERP10», para probar.')
    expect(lineaErp10({ ...base, validado: false })).toBeNull()
  })
})
