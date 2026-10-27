// tests/unit/modules/conta/fichaRecibidaFecha.test.ts
//
// V04 · Respuesta 7 · La ficha de la recibida («Lo que ha pasado») escribía
// «20/7»: el mismo Intl.DateTimeFormat que el diálogo de Reabrir, que en esta
// ICU da el mes sin el cero. Ahora diaDeHecho usa diaMesMadrid, el sitio único
// del #357, y las dos fechas salen iguales: «20/07».

import { describe, expect, it } from 'vitest'
import { diaDeHecho } from '@/modules/conta/documentos/fichaRecibida'
import { diaMesMadrid } from '@/modules/conta/lib/ivaPresentado'

describe('diaDeHecho: el día de la ficha de la recibida, siempre con dos cifras', () => {
  it('un mes de una cifra lleva su cero: «20/07», no «20/7»', () => {
    expect(diaDeHecho('2026-07-20T08:06:28+00:00')).toBe('20/07')
    expect(diaDeHecho('2026-01-05T10:00:00Z')).toBe('05/01')
  })

  it('es el día en Madrid: las 23:30 UTC del 30/09 ya son el 01/10', () => {
    expect(diaDeHecho('2026-09-30T23:30:00Z')).toBe('01/10')
  })

  it('dice lo mismo que diaMesMadrid (el de Impuestos), para cada mes del año', () => {
    for (let m = 1; m <= 12; m++) {
      const iso = `2026-${String(m).padStart(2, '0')}-15T12:00:00Z`
      expect(diaDeHecho(iso)).toBe(diaMesMadrid(iso))
      expect(diaDeHecho(iso)).toMatch(/^\d{2}\/\d{2}$/)
    }
  })

  it('lo que no es una fecha se queda con su día y su mes tal cual', () => {
    expect(diaDeHecho('2026-07-20 sin hora')).toBe('20/07')
  })
})
