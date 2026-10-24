// tests/unit/modules/conta/i01b/avisosInicio.test.ts
//
// I01b · P5 · Los avisos de impuestos de Inicio. Las filas son las de octubre
// de Foodint (sus modelos y los plazos reales del 3T de 2026: domiciliado el
// 15/10, presentar el 20/10); el certificado y los importes, de mentira.

import { describe, expect, it } from 'vitest'
import { avisosInicio } from '@/modules/conta/impuestos/avisosInicio'
import type { Calendario, FilaCalendario } from '@/modules/conta/impuestos/calendario'

const fila = (modelo: string, o: Partial<FilaCalendario> = {}): FilaCalendario => ({
  obligacion: modelo, modelo, nombre: modelo, cadencia: 'quarterly', ejercicio: 2026, periodo: '3T', presentacion: '2026-10-20',
  domiciliacion: '2026-10-15', provisional: null, atrasado: false, domicilia: false, cuenta_final: null, se_calcula: modelo === '303', declaracion: null, ...o,
})
const cal = (o: Partial<Calendario>): Calendario => ({
  hoy: '2026-10-10', ventana: '2026-10-01', desde: '2026-10-01', puede_gestionar: true, filas: [], siguiente: [],
  presentados: { ano: 2026, desde: null, vencidos: 0, presentados: 0, en_plazo: 0, contabilizados: 0 },
  modelos: [], no_presenta: [], se_pueden_anadir: [], certificado: null, pagos_sin_llegar: [], ...o,
})

describe('el plazo que toca', () => {
  it('sin domiciliar, el de presentar; domiciliado, el de domiciliar', () => {
    const a = avisosInicio(cal({ filas: [fila('303'), fila('111', { domicilia: true })] }), 'medio')
    expect(a.map((x) => [x.titulo, x.apoyo, x.tono])).toEqual([
      ['IVA del trimestre · 3.er trimestre', 'Presentarlo hasta el 20/10, dentro de 10 días.', 'neutro'],
      ['Retenciones de nóminas y profesionales · 3.er trimestre', 'Domiciliado: presentarlo hasta el 15/10, dentro de 5 días. Se calculará aquí pronto.', 'duda'],
    ])
    expect(a[0].a).toBe('/conta/impuestos/iva/2026/3T')
  })
  it('lo presentado no avisa; lo que está a más de 15 días, tampoco; lo pasado, en rojo', () => {
    const presentado = fila('303', { declaracion: { id: 'r', estado: 'filed', estado_texto: '', resultado: 'to_pay', importe: 1, anterior: null, no_hace_falta: null, presentada: null, por: 'outside', errores: 0, avisos: 0, aviso: null, cuadra: true } })
    expect(avisosInicio(cal({ filas: [presentado] }), 'medio')).toEqual([])
    expect(avisosInicio(cal({ hoy: '2026-10-01', filas: [fila('303', { presentacion: '2026-10-20' })] }), 'medio')).toEqual([])
    expect(avisosInicio(cal({ hoy: '2026-10-21', filas: [fila('303', { atrasado: true })] }), 'medio')[0]).toMatchObject({ apoyo: 'Se pasó el plazo: era hasta el 20/10.', tono: 'falta' })
  })
  it('en experto, el código', () => {
    expect(avisosInicio(cal({ filas: [fila('303')] }), 'experto')[0].titulo).toBe('303 · 3T')
  })
})

describe('el certificado y el cargo que no llega', () => {
  it('el certificado solo a 30 días o a 7', () => {
    expect(avisosInicio(cal({ certificado: { titular: 'X', caduca: '2026-12-31T00:00:00Z' } }), 'medio')).toEqual([])
    expect(avisosInicio(cal({ certificado: { titular: 'X', caduca: '2026-11-09T00:00:00Z' } }), 'medio')[0]).toMatchObject({ clave: 'certificado', tono: 'duda', a: '/conta/impuestos/certificados' })
  })
  it('el cargo de lo presentado a pagar que no ha llegado al banco', () => {
    const a = avisosInicio(cal({ pagos_sin_llegar: [{ declaracion: 'r', modelo: '303', ejercicio: 2026, periodo: '3T', importe: 6360, plazo: '2026-10-20', domicilia: true }] }), 'medio')
    expect(a[0]).toMatchObject({ titulo: 'IVA del 3.er trimestre de 2026', apoyo: 'El cargo domiciliado de 6.360,00 € no ha llegado al banco: el plazo era el 20/10. Cásalo cuando llegue.', tono: 'duda' })
  })
})
