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
