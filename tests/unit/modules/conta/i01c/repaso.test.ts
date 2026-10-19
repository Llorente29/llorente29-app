// tests/unit/modules/conta/i01c/repaso.test.ts
//
// I01c · P1 · La lista de repaso de «Subir justificantes», en palabras, con los
// justificantes INVENTADOS de la empresa A (los mismos de la e2e) y los
// motivos tal como los escribe la 0260.

import { describe, expect, it } from 'vitest'
import { casillasEscritas, chipDe, lineaDe, pideDevolucion, resumenGuardado, tituloDe } from '@/modules/conta/impuestos/justificantes'

describe('cada fila en palabras', () => {
  it('el título y la línea: «IVA del trimestre · 3T 2025» · «modelo 303 · −1.761,96 € a compensar · presentado el 20/10/2025»', () => {
    const d = { modelo: '303', ejercicio: 2025, periodo: '3T', presentada: '2025-10-20T11:02:41', resultado: -1761.96 }
    expect([tituloDe(d), lineaDe(d)]).toEqual(['IVA del trimestre · 3T 2025', 'modelo 303 · −1.761,96 € a compensar · presentado el 20/10/2025'])
  })
  it('a ingresar, a cero, a devolver y sin leer', () => {
    expect(lineaDe({ modelo: '111', presentada: '2025-10-20T11:05:12', resultado: 1702.5 })).toBe('modelo 111 · 1.702,50 € a ingresar · presentado el 20/10/2025')
    expect(lineaDe({ modelo: '303', presentada: '2026-01-30T09:15:07', resultado: 0 })).toBe('modelo 303 · 0,00 € sale a cero · presentado el 30/01/2026')
    expect(lineaDe({ modelo: '303', presentada: '2026-01-30T09:15:07', resultado: -500 }, true)).toBe('modelo 303 · −500,00 € a devolver · presentado el 30/01/2026')
    expect(lineaDe({ modelo: '202', presentada: '2025-12-19T10:40:00', resultado: null })).toBe('modelo 202 · resultado sin leer · presentado el 19/12/2025')
  })
  it('el chip: Leído (nuevo o completa), Ya estaba, No se pudo leer', () => {
    expect([chipDe({ estado: 'nuevo' }), chipDe({ estado: 'completa' }), chipDe({ estado: 'ya_estaba' }), chipDe({ estado: 'error' }), chipDe(null)].map((c) => c.texto))
      .toEqual(['Leído', 'Leído', 'Ya estaba', 'No se pudo leer', 'No se pudo leer'])
  })
  it('compensar o devolver solo se pregunta en el 303 del último periodo que sale negativo', () => {
    expect([
      pideDevolucion({ modelo: '303', periodo: '4T', resultado: -10 }), pideDevolucion({ modelo: '303', periodo: '3T', resultado: -10 }),
      pideDevolucion({ modelo: '303', periodo: '4T', resultado: 10 }), pideDevolucion({ modelo: '303', periodo: '12', resultado: -1 }),
    ]).toEqual([true, false, false, true])
  })
})

describe('las casillas escritas a mano', () => {
  it('una por línea, como en el justificante', () => {
    expect(casillasEscritas('27 6.890,04\n[45] 8.652,00\n71: -1.761,96\n\n110 300\n46 −1761,96 €')).toEqual({
      ok: true, casillas: { '27': 6890.04, '45': 8652, '71': -1761.96, '110': 300, '46': -1761.96 },
    })
  })
  it('lo que no se entiende se dice, la primera línea', () => {
    expect(casillasEscritas('27 6.890,04\nresultado -1.761,96')).toEqual({ ok: false, linea: 'resultado -1.761,96' })
  })
})

describe('el resumen de lo guardado tiene contenido (regla 8)', () => {
  it('lo guardado y lo que no, con su porqué', () => {
    expect(resumenGuardado([
      { ok: true, titulo: 'IVA del trimestre · 3T 2025', mensaje: '…' },
      { ok: true, titulo: 'Retenciones · 3T 2025', mensaje: '…' },
      { ok: false, titulo: 'Alquiler · 3T 2025', mensaje: 'La fecha de presentación es futura: no puede estar presentado.' },
    ])).toBe('Guardados 2 justificantes: IVA del trimestre · 3T 2025, Retenciones · 3T 2025. 1 no se ha podido guardar: Alquiler · 3T 2025 (La fecha de presentación es futura: no puede estar presentado.).')
  })
})
