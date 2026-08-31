// tests/unit/shell/atencion.test.ts
//
// La franja de atención tiene una regla que se rompe sola con el tiempo: la
// semana. `lunesDe` decide si un cuadrante en borrador es «de esta semana» o
// «de la que viene», y un fallo ahí hace que la franja avise de la semana
// equivocada o no avise de ninguna.

import { describe, it, expect } from 'vitest'
import { lunesDe } from '@/shell/home/atencionService'

describe('lunesDe — la semana empieza en lunes, no en domingo', () => {
  it('un lunes se devuelve a sí mismo', () => {
    expect(lunesDe(new Date(2026, 7, 31))).toBe('2026-08-31')   // lunes
  })

  it('un domingo pertenece a la semana que EMPIEZA seis días antes', () => {
    // El fallo clásico: getDay() da 0 al domingo, y sin corregirlo el domingo
    // salta a la semana siguiente. En un cuadrante eso es avisar del que no es.
    expect(lunesDe(new Date(2026, 8, 6))).toBe('2026-08-31')    // domingo
  })

  it('el martes siguiente ya es otra semana', () => {
    expect(lunesDe(new Date(2026, 8, 1))).toBe('2026-08-31')
    expect(lunesDe(new Date(2026, 8, 7))).toBe('2026-09-07')
  })

  it('cruza el cambio de mes sin perderse', () => {
    expect(lunesDe(new Date(2026, 8, 2))).toBe('2026-08-31')
  })

  it('la semana siguiente son exactamente siete días después', () => {
    const hoy = new Date(2026, 7, 31)
    const sig = lunesDe(new Date(hoy.getTime() + 7 * 86_400_000))
    expect(sig).toBe('2026-09-07')
  })

  it('no depende de la hora del día', () => {
    expect(lunesDe(new Date(2026, 8, 2, 23, 59))).toBe(lunesDe(new Date(2026, 8, 2, 0, 1)))
  })
})
