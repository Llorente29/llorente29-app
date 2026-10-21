// tests/unit/modules/conta/i01c/casillasModelos.test.ts
//
// I01c (Julio, 20/10, punto 4) · «Qué es» cada casilla, en palabras, contra la
// población real (regla 31): las casillas que traen los justificantes de
// Foodint de 2026, medidas en producción en solo lectura el 20/10 (solo los
// códigos, por cuenta, regla 9): 111 → 01 02 03 28 30; 115 → 01 02 03 05;
// 202 → 01 03. Y las del 303 presentado y calculado.

import { describe, expect, it } from 'vitest'
import { enPalabras303, queEsLaCasilla } from '@/modules/conta/impuestos/casillasModelos'

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

describe('el 303, en palabras (sin la fórmula del diseño de registro)', () => {
  it('quita la fórmula y el «· Cuota» final', () => {
    expect(enPalabras303('IVA Devengado · Total cuota devengada ( [152] + [167] + [03] + [155] + [06] )')).toBe('IVA Devengado · Total cuota devengada')
    expect(enPalabras303('IVA Deducible · Resultado régimen general ( [27] - [45] ) · Cuota')).toBe('IVA Deducible · Resultado régimen general')
    expect(enPalabras303('Cuotas a compensar de periodos previos pendientes para periodos posteriores ([110] - [78])')).toBe('Cuotas a compensar de periodos previos pendientes para periodos posteriores')
  })
  it('lo que no lleva fórmula queda igual', () => {
    expect(enPalabras303('% Atribuible a la Administración del Estado')).toBe('% Atribuible a la Administración del Estado')
  })
  it('ninguna casilla real del 303 se queda con corchetes ni vacía', () => {
    for (const c of ['27', '45', '46', '64', '65', '66', '69', '71', '78', '87', '110']) {
      const t = queEsLaCasilla('303', c)
      expect(t, c).toBeTruthy()
      expect(t, c).not.toMatch(/\[|\]|\(\s*$/)
    }
  })
})
