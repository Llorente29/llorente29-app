// tests/unit/modules/conta/i01c/casillasModelos.test.ts
//
// I01c (Julio, 20/10, punto 4) · «Qué es» cada casilla, en palabras, contra la
// población real (regla 31): las casillas que traen los justificantes de
// Foodint de 2026, medidas en producción en solo lectura el 20/10 (solo los
// códigos, por cuenta, regla 9): 111 → 01 02 03 28 30; 115 → 01 02 03 05;
// 202 → 01 03. Y las del 303 presentado y calculado.

import { describe, expect, it } from 'vitest'
import { queEsLaCasilla } from '@/modules/conta/impuestos/casillasModelos'

const REALES: Record<string, string[]> = {
  '111': ['01', '02', '03', '28', '30'],
  '115': ['01', '02', '03', '05'],
  '202': ['01', '03'],
  '303': ['27', '45', '46', '64', '65', '66', '69', '71', '78', '87', '110'],
}

describe('qué es cada casilla', () => {
  it('todas las que traen de verdad los justificantes tienen su «qué es»', () => {
    const sin = Object.entries(REALES).flatMap(([m, cs]) => cs.filter((c) => !queEsLaCasilla(m, c)).map((c) => `${m}[${c}]`))
    expect(sin).toEqual([])
  })
  it('el 115, con las palabras de Julio', () => {
    expect(['01', '02', '03', '05'].map((c) => queEsLaCasilla('115', c))).toEqual([
      'Número de arrendadores', 'Base de las retenciones (alquileres pagados)', 'Retenciones practicadas', 'Resultado a ingresar',
    ])
  })
  it('el 111: las nóminas, el total y el resultado (impreso oficial)', () => {
    expect(queEsLaCasilla('111', '01')).toBe('Nóminas en dinero · número de perceptores')
    expect(queEsLaCasilla('111', '28')).toBe('Suma de retenciones e ingresos a cuenta')
    expect(queEsLaCasilla('111', '30')).toBe('Resultado a ingresar')
  })
  it('el 202 (numeración de 2025): base, y lo que se ingresa', () => {
    expect(queEsLaCasilla('202', '01')).toBe('Base del pago fraccionado (modalidad del artículo 40.2)')
    expect(queEsLaCasilla('202', '03')).toBe('A ingresar (modalidad del artículo 40.2)')
  })
  it('acepta la casilla de una cifra («5» es la [05]); lo que no está en el impreso, null (sin inventar)', () => {
    expect(queEsLaCasilla('115', '5')).toBe('Resultado a ingresar')
    expect(queEsLaCasilla('115', '99')).toBeNull()
    expect(queEsLaCasilla('390', '01')).toBeNull()
  })
})
