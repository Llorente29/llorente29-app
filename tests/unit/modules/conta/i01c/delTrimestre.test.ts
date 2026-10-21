// tests/unit/modules/conta/i01c/delTrimestre.test.ts
//
// I01c · «Facturas del trimestre» abre Libros con ?periodo=3T: el trimestre
// pedido dentro del ejercicio elegido; lo que no es un trimestre, nada (y el
// libro abre en el suyo de siempre).

import { describe, expect, it } from 'vitest'
import { delTrimestre, periodosDelEjercicio } from '@/modules/conta/libros/contexto'

describe('delTrimestre', () => {
  const ps = periodosDelEjercicio('2026-01-01', '2026-12-31')
  it('el pedido, por su nombre', () => {
    expect(delTrimestre(ps, '3T')).toMatchObject({ id: '3T 2026', desde: '2026-07-01', hasta: '2026-09-30' })
    expect(delTrimestre(ps, '1T')?.id).toBe('1T 2026')
  })
  it('sin pedido, o con otra cosa, nada', () => {
    expect([null, '', '5T', 'año', '3T 2026', '3t'].map((p) => delTrimestre(ps, p))).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })
})
