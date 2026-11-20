// tests/unit/modules/conta/erp10/conexion.test.ts — X10b · Las frases de sacar a ERP10 por la
// conexión: antes (qué va a entrar y que no se borra) y después (con los números de ERP10).
// Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { loQueHaEntrado, queVaAEntrar } from '@/modules/conta/erp10/conexion'

describe('antes de escribir', () => {
  it('el mes: cuántas, y que no se puede borrar', () => {
    expect(queVaAEntrar({ recibidas: 84, emitidas: 0, mes: 'octubre de 2026' })).toBe('Van a entrar en ERP10: 84 facturas recibidas de octubre de 2026. Si algo sale mal, se corrige a mano en ERP10: Sumied no puede borrarlo.')
    expect(queVaAEntrar({ recibidas: 1, emitidas: 0, mes: 'octubre de 2026' })).toContain('1 factura recibida de')
    expect(queVaAEntrar({ recibidas: 84, emitidas: 12, mes: 'octubre de 2026' })).toContain('Van a entrar en ERP10: 84 facturas recibidas y 12 emitidas de octubre de 2026.')
    expect(queVaAEntrar({ recibidas: 0, emitidas: 1, mes: 'octubre de 2026' })).toContain('1 factura emitida de')
  })
  it('la de prueba: cuál', () => {
    expect(queVaAEntrar({ recibidas: 1, emitidas: 0, mes: 'octubre de 2026', prueba: { clase: 'recibida', numero: 'F-0001', tercero: 'Proveedor Inventado', total: 12100 } }))
      .toBe('Va a entrar en ERP10 una sola factura recibida de octubre de 2026, para probar: la F-0001 de Proveedor Inventado (121,00 €). Si algo sale mal, se corrige a mano en ERP10: Sumied no puede borrarlo.')
  })
})

describe('después', () => {
  it('lo que ha entrado, con sus números y sus PDF; lo enlazado y lo que no ha podido, con su porqué', () => {
    const r = loQueHaEntrado([
      { numero: 'F-1', estado: 'en_erp10', serie: '2', documento: 100, pdf: 'subido' },
      { numero: 'F-2', estado: 'en_erp10', serie: '2', documento: 101, pdf: 'subido' },
      { numero: 'F-3', estado: 'en_erp10', serie: '2', documento: 50, enlazada: true, pdf: 'subido' },
      { numero: 'F-4', estado: 'no_pudo', porque: 'Lleva retención, y cómo la guarda ERP10 por aquí no está medido. Sácala con el Excel.' },
    ], 'octubre de 2026')
    expect(r).toEqual({
      bien: false,
      texto: 'Han entrado en ERP10 2 facturas recibidas de octubre de 2026 (2/100, 2/101), con sus PDF. 1 ya estaba en ERP10 (2/50): se ha enlazado, sin meter otra. 1 no ha podido: F-4, Lleva retención, y cómo la guarda ERP10 por aquí no está medido. Sácala con el Excel.',
    })
  })
  it('X10d · con asientos', () => {
    expect(loQueHaEntrado([
      { numero: 'F-1', clase: 'recibida', estado: 'en_erp10', serie: '2', documento: 100, pdf: 'subido' },
      { numero: '4/7', clase: 'asiento', estado: 'en_erp10', serie: '1', documento: 5000, pdf: null },
    ], 'octubre de 2026').texto).toBe('Han entrado en ERP10 1 factura recibida y 1 asiento de octubre de 2026 (2/100, 1/5000), con su PDF.')
    expect(queVaAEntrar({ recibidas: 3, emitidas: 2, asientos: 5, mes: 'octubre de 2026' })).toContain('Van a entrar en ERP10: 3 facturas recibidas, 2 emitidas y 5 asientos de octubre de 2026.')
    expect(queVaAEntrar({ recibidas: 0, emitidas: 0, asientos: 1, mes: 'octubre de 2026', prueba: { clase: 'asiento', numero: '4/7', tercero: 'Pago inventado', total: 10000 } }))
      .toBe('Va a entrar en ERP10 un solo asiento de octubre de 2026, para probar: el 4/7 de Sumied, Pago inventado (100,00 €). Si algo sale mal, se corrige a mano en ERP10: Sumied no puede borrarlo.')
  })
  it('X10c · recibidas y emitidas juntas', () => {
    expect(loQueHaEntrado([
      { numero: 'F-1', clase: 'recibida', estado: 'en_erp10', serie: '2', documento: 100, pdf: null },
      { numero: 'V-1', clase: 'emitida', estado: 'en_erp10', serie: '1', documento: 200, pdf: null },
    ], 'octubre de 2026').texto).toBe('Han entrado en ERP10 1 factura recibida y 1 emitida de octubre de 2026 (2/100, 1/200).')
  })
  it('una sola, con su PDF; y el PDF que no sube se dice', () => {
    expect(loQueHaEntrado([{ numero: 'F-1', estado: 'en_erp10', serie: '2', documento: 100, pdf: 'subido' }], 'octubre de 2026'))
      .toEqual({ bien: true, texto: 'Han entrado en ERP10 1 factura recibida de octubre de 2026 (2/100), con su PDF.' })
    expect(loQueHaEntrado([{ numero: 'F-1', estado: 'en_erp10', serie: '2', documento: 100, pdf: 'fallo', porque: 'ERP10 no ha guardado el PDF (500): x' }], 'octubre de 2026').texto)
      .toBe('Han entrado en ERP10 1 factura recibida de octubre de 2026 (2/100). El PDF de la F-1 no ha subido (ERP10 no ha guardado el PDF (500): x): súbelo a mano en ERP10.')
  })
})

// X10e · Los días del TPV: lo que se dice antes (con cuántos, y el de prueba) y después (el cobro aparte cuenta con su día).
describe('X10e · los días del TPV por la conexión', () => {
  it('antes: cuántos, y el primero de prueba con su fecha y su rango', () => {
    expect(queVaAEntrar({ recibidas: 0, emitidas: 1, dias: 3, mes: 'octubre de 2026' })).toBe('Van a entrar en ERP10: 1 factura emitida y 3 días del TPV de octubre de 2026. Si algo sale mal, se corrige a mano en ERP10: Sumied no puede borrarlo.')
    expect(queVaAEntrar({ recibidas: 0, emitidas: 0, mes: 'octubre de 2026', prueba: { clase: 'dia', numero: '5001-5048', tercero: 'el día 05/10', total: 55000 } }))
      .toBe('Va a entrar en ERP10 un solo día del TPV de octubre de 2026, para probar: el día 05/10, las facturas 5001-5048 (550,00 €), con su factura del día y su cobro. Si algo sale mal, se corrige a mano en ERP10: Sumied no puede borrarlo.')
  })
  it('después: un día de un asiento (con los dos números) y uno de dos (su cobro, con su día); el cobro que falla, con su porqué', () => {
    expect(loQueHaEntrado([
      { numero: '5001-5048', clase: 'dia', estado: 'en_erp10', serie: '1', documento: 1000, cobro: { serie: '1', documento: 5000 } },
      { numero: '6001-6040', clase: 'dia', estado: 'en_erp10', serie: '1', documento: 1001 },
      { numero: '1/92', clase: 'asiento', cobroDe: 'd-2', estado: 'en_erp10', serie: '1', documento: 5001 },
    ], 'octubre de 2026')).toEqual({ bien: true, texto: 'Han entrado en ERP10 2 días del TPV de octubre de 2026 (1/1000 a 1/5001).' })
    expect(loQueHaEntrado([{ numero: '1/92', clase: 'asiento', cobroDe: 'd-2', estado: 'no_pudo', porque: 'Su cobro: ERP10 no ha dado de alta el asiento (500): x' }], 'octubre de 2026').texto)
      .toBe('1 no ha podido: 1/92, Su cobro: ERP10 no ha dado de alta el asiento (500): x.')
  })
})
