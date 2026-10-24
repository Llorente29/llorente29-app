// tests/unit/modules/conta/i01h/en-vivo.test.ts
//
// I01h · El 303 del periodo en curso (Julio, 21/10): calculado con lo que va de
// trimestre, «calculado hasta hoy, se cierra el 31/12», y la tarjeta en curso
// en vez de «Para revisar». Cifras inventadas.

import { describe, expect, it } from 'vitest'
import { enCurso, fechasPeriodo, fraseEnCurso, tarjeta, type ModeloTrimestre } from '@/modules/conta/impuestos/trimestre'

const m303 = (d: Partial<NonNullable<ModeloTrimestre['declaracion']>> | null): ModeloTrimestre => ({
  modelo: '303', nombre: 'IVA', cadencia: 'quarterly', periodo: '4T', no_toca: false, presentacion: '2027-01-30', domiciliacion: null,
  declaracion: d === null ? null : {
    id: 'd', cuenta: 'c', estado: 'draft', estado_texto: 'Borrador', resultado: 'to_pay', importe: 1409.12, presentada: null, presentada_por: null, por: null,
    csv: null, justificante: null, justificante_pdf: null, traido: null, expediente: null, presentador: null, casillas: [], ...d,
  },
})

describe('el periodo en curso', () => {
  it('las fechas de un trimestre y de un mes', () => {
    expect(fechasPeriodo(2026, '4T')).toEqual({ desde: '2026-10-01', hasta: '2026-12-31' })
    expect(fechasPeriodo(2026, '02')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
    expect(fechasPeriodo(2028, '02')?.hasta).toBe('2028-02-29')
    expect(fechasPeriodo(2026, '0A')).toBeNull()
  })
  it('en curso del primer día al último, los dos dentro', () => {
    const f = fechasPeriodo(2026, '4T')!
    expect(['2026-09-30', '2026-10-01', '2026-10-21', '2026-12-31', '2027-01-01'].map((d) => enCurso(f, d))).toEqual([false, true, true, true, false])
  })
  it('la frase, como la pidió Julio', () => {
    expect(fraseEnCurso('4T', '2026-10-21', '2026-12-31'))
      .toBe('Calculado hasta hoy (21/10/2026) con el libro de IVA de lo que va de trimestre. Se cierra el 31/12: hasta entonces cambia con cada factura.')
    expect(fraseEnCurso('10', '2026-10-21', '2026-10-31')).toContain('lo que va de mes. Se cierra el 31/10')
  })
})

describe('la tarjeta del 303', () => {
  it('en curso y calculado: «En curso · se cierra el 31/12», no «Para revisar»', () => {
    expect(tarjeta(m303({}), '2026-10-21', 2026).chip).toEqual({ tono: 'neutro', texto: 'En curso · se cierra el 31/12' })
  })
  it('acabado el trimestre, el mismo borrador vuelve a «Para revisar»', () => {
    expect(tarjeta(m303({}), '2027-01-02', 2026).chip.texto).toBe('Para revisar')
  })
  it('sin el ejercicio (quien no lo pasa), como antes', () => {
    expect(tarjeta(m303({}), '2026-10-21').chip.texto).toBe('Para revisar')
  })
})
