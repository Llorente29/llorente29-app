// Las fechas de un día a otro (lib/proponer.ts), que usa el corte en Tu empresa.
//
// S01 · PR 3 (entrega 5): el rango de «Proponer lo pendiente», su pregunta del
// corte y su tanda de días se fueron con el botón; sus pruebas, con ellos.

import { describe, expect, it } from 'vitest'
import { diaSiguiente, diaAnterior } from '@/modules/conta/lib/proponer'

describe('de un día a otro', () => {
  it('diaAnterior y diaSiguiente cruzan meses y años', () => {
    expect(diaAnterior('2026-10-01')).toBe('2026-09-30')
    expect(diaSiguiente('2026-12-31')).toBe('2027-01-01')
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28')
  })
})
