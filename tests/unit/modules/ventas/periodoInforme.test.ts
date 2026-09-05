// El periodo y su espejo. La pieza del §2 del encargo del generador.
//
// POR QUE ESTAS PRUEBAS EXISTEN. Comparar un periodo A MEDIAS contra uno
// ENTERO inventa una caida todos los dias: el lunes por la mañana diria -90 %
// sin que pasara nada. El espejo de un periodo parcial se RECORTA a lo que
// lleva corrido el actual.
//
// Las fechas son las de la maqueta, no inventadas: el caso que Julio publico es
// 31/08 00:00 -> 06/09 00:21 contra 24/08 00:00 -> 30/08 00:21.
//
// Y `ahora` se pasa como argumento a proposito: una verificacion con ventana
// relativa NO SE REPRODUCE, y esa regla la pagamos el 06/09 con 25,57 € de
// diferencia entre dos medidas del mismo «ultimos 30 dias».

import { describe, it, expect } from 'vitest'
import {
  resuelvePeriodo, periodoPersonalizado, etiquetaDelEspejo,
} from '../../../../src/modules/ventas/services/periodoInforme'

/** 'YYYY-MM-DD HH:MM' en hora de Madrid, para leer las aserciones de un vistazo. */
const madrid = (d: Date) =>
  d.toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 16)

const dura = (v: { desde: Date; hasta: Date }) => v.hasta.getTime() - v.desde.getTime()

describe('esta_semana — el caso literal de la maqueta', () => {
  // Domingo 06/09/2026 a las 00:21 de Madrid = 05/09 22:21 UTC.
  const ahora = new Date('2026-09-05T22:21:00Z')
  const p = resuelvePeriodo('esta_semana', ahora)

  it('el actual va del lunes 31/08 00:00 a ahora', () => {
    expect(madrid(p.actual.desde)).toBe('2026-08-31 00:00')
    expect(madrid(p.actual.hasta)).toBe('2026-09-06 00:21')
  })

  it('el espejo va del lunes anterior a SU misma hora, no a la semana entera', () => {
    expect(madrid(p.espejo.desde)).toBe('2026-08-24 00:00')
    expect(madrid(p.espejo.hasta)).toBe('2026-08-30 00:21')
  })

  it('las dos ventanas duran EXACTAMENTE lo mismo', () => {
    expect(dura(p.actual)).toBe(dura(p.espejo))
  })

  it('se declara parcial, y el rotulo dice lo que se ha comparado', () => {
    expect(p.parcial).toBe(true)
    expect(etiquetaDelEspejo(p)).toContain('mismo tramo')
  })
})

describe('semana_pasada — periodo completo', () => {
  // Cualquier momento del domingo 06/09: la semana pasada es 31/08 -> 06/09?
  // No: `lunesDeLaSemana` mete el domingo en la semana que ACABA, asi que el
  // 06/09 pertenece a la semana del 31/08, y la anterior es la del 24/08.
  const p = resuelvePeriodo('semana_pasada', new Date('2026-09-05T22:21:00Z'))

  it('mide la semana 24/08 -> 31/08 entera', () => {
    expect(madrid(p.actual.desde)).toBe('2026-08-24 00:00')
    expect(madrid(p.actual.hasta)).toBe('2026-08-31 00:00')
  })

  it('su espejo es la semana 17/08 -> 24/08 entera', () => {
    expect(madrid(p.espejo.desde)).toBe('2026-08-17 00:00')
    expect(madrid(p.espejo.hasta)).toBe('2026-08-24 00:00')
  })

  it('no es parcial y las dos duran 7 dias', () => {
    expect(p.parcial).toBe(false)
    expect(dura(p.actual)).toBe(7 * 86_400_000)
    expect(dura(p.espejo)).toBe(7 * 86_400_000)
  })
})

// EL CAMBIO DE HORA. La semana del 19/10 al 26/10/2026 dura 169 h porque España
// atrasa el reloj la madrugada del 25. Restar 7x24 h la desplazaria una hora.
describe('la semana del cambio de hora se construye por calendario', () => {
  const p = resuelvePeriodo('semana_pasada', new Date('2026-10-27T10:00:00Z'))

  it('la semana del cambio empieza y acaba en lunes 00:00 de Madrid', () => {
    expect(madrid(p.actual.desde)).toBe('2026-10-19 00:00')
    expect(madrid(p.actual.hasta)).toBe('2026-10-26 00:00')
  })

  it('y dura 169 h de verdad, no 168', () => {
    expect(dura(p.actual)).toBe(169 * 3600_000)
  })

  it('su espejo dura 168 h: una hora de diferencia, la que la frontera admite', () => {
    expect(dura(p.espejo)).toBe(168 * 3600_000)
    expect(Math.abs(dura(p.actual) - dura(p.espejo))).toBe(3600_000)
  })
})

describe('mes_pasado — se declara calendario porque los meses no duran igual', () => {
  const p = resuelvePeriodo('mes_pasado', new Date('2026-09-05T22:21:00Z'))

  it('agosto entero contra julio entero', () => {
    expect(madrid(p.actual.desde)).toBe('2026-08-01 00:00')
    expect(madrid(p.actual.hasta)).toBe('2026-09-01 00:00')
    expect(madrid(p.espejo.desde)).toBe('2026-07-01 00:00')
    expect(madrid(p.espejo.hasta)).toBe('2026-08-01 00:00')
  })

  it('lleva la marca de calendario: si no, la frontera abortaria con razon', () => {
    expect(p.calendario).toBe(true)
  })
})

describe('ayer', () => {
  const p = resuelvePeriodo('ayer', new Date('2026-09-05T22:21:00Z'))
  it('el 05/09 entero contra el 04/09 entero', () => {
    expect(madrid(p.actual.desde)).toBe('2026-09-05 00:00')
    expect(madrid(p.actual.hasta)).toBe('2026-09-06 00:00')
    expect(madrid(p.espejo.desde)).toBe('2026-09-04 00:00')
    expect(madrid(p.espejo.hasta)).toBe('2026-09-05 00:00')
  })
})

describe('personalizado', () => {
  const p = periodoPersonalizado(
    new Date('2026-08-24T00:00:00Z'), new Date('2026-08-31T00:00:00Z'))
  it('su espejo es el trozo inmediatamente anterior, de la misma duracion', () => {
    expect(dura(p.actual)).toBe(dura(p.espejo))
    expect(p.espejo.hasta.getTime()).toBe(p.actual.desde.getTime())
  })
})

// NINGUN periodo puede devolver un espejo que se solape con el actual: la
// frontera SQL lo rechaza, y aqui se comprueba antes de llegar.
describe('ningun periodo solapa su espejo', () => {
  it.each(['hoy', 'ayer', 'esta_semana', 'semana_pasada', 'este_mes', 'mes_pasado'] as const)(
    '%s', clave => {
      const p = resuelvePeriodo(clave, new Date('2026-09-05T22:21:00Z'))
      expect(p.espejo.hasta.getTime()).toBeLessThanOrEqual(p.actual.desde.getTime())
      expect(p.actual.hasta.getTime()).toBeGreaterThan(p.actual.desde.getTime())
      expect(p.espejo.hasta.getTime()).toBeGreaterThan(p.espejo.desde.getTime())
    })
})
