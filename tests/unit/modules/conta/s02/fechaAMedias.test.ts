// S01p·18 · 2 · El filtro de fechas de Asientos «no filtraba» (Julio, 12/11: con
// 04/10–04/10 enseñaba asientos del 10/11 y el 11/11). Escrita sin año, la fecha
// se quedaba a medias en silencio y el filtro no se ponía. Al salir del campo,
// se completa con el año; si sigue a medias, el campo lo dice. Y con la fecha
// entera, el filtro deja fuera lo de otro día (lib de la tabla densa).

import { describe, expect, it } from 'vitest'
import { completarAnio, deTexto, fechaAMedias, fechaMal } from '@/modules/conta/ui/fecha/fecha'
import { cumpleFiltros, type CampoFiltro } from '@/modules/conta/ui/tabla/tablaDensa'

const CAMPOS: CampoFiltro[] = [{ id: 'desde', etiqueta: 'Desde', tipo: 'desde' }, { id: 'hasta', etiqueta: 'Hasta', tipo: 'hasta' }]

describe('S01p·18 · 2 · la fecha a medias del filtro', () => {
  it('«04/10» sin año no es una fecha: antes se quedaba así y el filtro no se ponía', () => {
    expect(deTexto('04/10')).toBeNull()
    expect(fechaMal('04/10')).toBe(false)
    expect(fechaAMedias('04/10')).toBe(true)
  })
  it('al salir, se completa con el año', () => {
    expect(completarAnio('04/10', 2026)).toBe('2026-10-04')
    expect(completarAnio('4/10/', 2026)).toBe('2026-10-04')
    expect(completarAnio('31/02', 2026)).toBeNull()
    expect(completarAnio('04/10/2026', 2026)).toBeNull() // ya es entera: no se toca
    expect(completarAnio('04', 2026)).toBeNull()
  })
  it('con 04/10–04/10, lo del 10/11 y el 11/11 queda fuera; lo del 04/10, dentro', () => {
    const v = { desde: '2026-10-04', hasta: '2026-10-04' }
    expect(cumpleFiltros(CAMPOS, v, { fecha: '2026-11-10' })).toBe(false)
    expect(cumpleFiltros(CAMPOS, v, { fecha: '2026-11-11' })).toBe(false)
    expect(cumpleFiltros(CAMPOS, v, { fecha: '2026-10-04' })).toBe(true)
  })
})
