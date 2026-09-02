// El día del negocio. Estas pruebas se corren en VARIOS husos a propósito
// (`TZ=... npx vitest`): el código se fija a Europe/Madrid, así que el
// resultado NO puede depender de dónde esté el navegador. Es justo el fallo
// que se coló el 02/09 en las pruebas del 86 — verdes en Madrid, rojas en UTC.

import { describe, it, expect } from 'vitest'
import {
  diaNatural, diasNaturalesEntre, diaDelNegocio, diaEspejo, diaAnterior,
  lunesDeLaSemana, semanasEntre,
} from '@/lib/fechas'

describe('diaNatural', () => {
  it('las 23:30 UTC del 1 son ya el día 2 en Madrid', () => {
    expect(diaNatural(new Date('2026-09-01T23:30:00Z'))).toBe('2026-09-02')
  })
  it('las 21:30 UTC del 1 siguen siendo el día 1', () => {
    expect(diaNatural(new Date('2026-09-01T21:30:00Z'))).toBe('2026-09-01')
  })
})

describe('diasNaturalesEntre', () => {
  it('el caso real del 86 en Alcalá: 28/08 12:17 → 02/09 = 5', () => {
    expect(diasNaturalesEntre(
      new Date('2026-08-28T10:17:23Z'), new Date('2026-09-02T08:25:18Z'))).toBe(5)
  })
  it('no depende de la hora: 00:05 y 23:55 del mismo día dan lo mismo', () => {
    const agotado = new Date('2026-08-28T10:17:23Z')
    expect(diasNaturalesEntre(agotado, new Date('2026-09-01T22:05:00Z'))).toBe(5)
    expect(diasNaturalesEntre(agotado, new Date('2026-09-02T21:55:00Z'))).toBe(5)
  })
  it('el cambio de hora de octubre no mete ni quita un día', () => {
    // La madrugada del 25/10/2026 España pasa a horario de invierno.
    expect(diasNaturalesEntre(
      new Date('2026-10-24T10:00:00Z'), new Date('2026-10-26T10:00:00Z'))).toBe(2)
  })
})

describe('diaDelNegocio', () => {
  it('un día normal empieza a las 22:00 UTC del día anterior (verano, UTC+2)', () => {
    const { desde, hasta, ymd } = diaDelNegocio(new Date('2026-09-02T08:25:00Z'))
    expect(ymd).toBe('2026-09-02')
    expect(desde.toISOString()).toBe('2026-09-01T22:00:00.000Z')
    expect(hasta.toISOString()).toBe('2026-09-02T22:00:00.000Z')
  })

  it('en invierno empieza a las 23:00 UTC (UTC+1)', () => {
    const { desde, hasta } = diaDelNegocio(new Date('2026-01-15T10:00:00Z'))
    expect(desde.toISOString()).toBe('2026-01-14T23:00:00.000Z')
    expect(hasta.toISOString()).toBe('2026-01-15T23:00:00.000Z')
  })

  // El día del cambio de hora dura 23 o 25 horas. Sumar «+24 h» lo parte mal.
  it('el día del cambio de hora de octubre dura 25 horas', () => {
    const { desde, hasta, ymd } = diaDelNegocio(new Date('2026-10-25T10:00:00Z'))
    expect(ymd).toBe('2026-10-25')
    expect((hasta.getTime() - desde.getTime()) / 3600_000).toBe(25)
  })

  it('el día del cambio de marzo dura 23 horas', () => {
    const { desde, hasta } = diaDelNegocio(new Date('2026-03-29T10:00:00Z'))
    expect((hasta.getTime() - desde.getTime()) / 3600_000).toBe(23)
  })

  it('el rango no deja huecos: el fin de un día es el principio del siguiente', () => {
    const hoy = diaDelNegocio(new Date('2026-09-02T08:25:00Z'))
    const manana = diaDelNegocio(new Date(hoy.hasta.getTime() + 3600_000))
    expect(manana.desde.getTime()).toBe(hoy.hasta.getTime())
  })
})

describe('diaEspejo y diaAnterior', () => {
  it('el espejo es el MISMO día de la semana, siete días antes', () => {
    // Miércoles 2 de septiembre de 2026.
    expect(diaEspejo(new Date('2026-09-02T08:00:00Z')).ymd).toBe('2026-08-26')
  })
  it('el espejo cruza el cambio de hora sin descuadrarse', () => {
    // 29/10 (invierno) mira al 22/10 (verano).
    expect(diaEspejo(new Date('2026-10-29T10:00:00Z')).ymd).toBe('2026-10-22')
  })
  it('«ayer» es el día natural anterior, no «hace 24 horas»', () => {
    expect(diaAnterior(new Date('2026-09-02T00:30:00Z')).ymd).toBe('2026-09-01')
  })
  it('«ayer» el día siguiente al cambio de hora sigue siendo el día anterior', () => {
    expect(diaAnterior(new Date('2026-10-26T10:00:00Z')).ymd).toBe('2026-10-25')
  })
})

describe('lunesDeLaSemana', () => {
  it('el miércoles 2/09/2026 pertenece a la semana del lunes 31/08', () => {
    expect(lunesDeLaSemana(new Date('2026-09-02T08:00:00Z'))).toBe('2026-08-31')
  })
  it('un lunes es su propio lunes', () => {
    expect(lunesDeLaSemana(new Date('2026-08-31T10:00:00Z'))).toBe('2026-08-31')
  })
  // El domingo cierra la semana, no abre la siguiente: si no, el cuadrante del
  // domingo por la noche sería el de la semana que aún no ha empezado.
  it('el domingo pertenece a la semana que termina', () => {
    expect(lunesDeLaSemana(new Date('2026-09-06T20:00:00Z'))).toBe('2026-08-31')
  })
  it('a las 23:30 UTC del domingo ya es lunes en Madrid: semana nueva', () => {
    expect(lunesDeLaSemana(new Date('2026-09-06T23:30:00Z'))).toBe('2026-09-07')
  })
})

describe('semanasEntre', () => {
  it('el caso real: Carabanchel publicó por última vez la semana del 3/08', () => {
    expect(semanasEntre('2026-08-03', '2026-08-31')).toBe(4)
  })
  it('cruzando el cambio de hora sigue contando semanas enteras', () => {
    expect(semanasEntre('2026-10-19', '2026-11-02')).toBe(2)
  })
})
