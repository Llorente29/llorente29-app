// L1a · PR 2. El cálculo de horas del registro de jornada, con los casos
// raros que pide el encargo: pausas, cambio de día, cambio de hora de octubre
// y jornada partida. Y lo que nunca puede hacer: inventar una salida.
import { describe, it, expect } from 'vitest'
import {
  armarTramos, jornadasPorDia, totalesJornada, horasYMinutos, diaCorto, fechaLarga, horaMadrid, diaMadrid, lunesDe,
  type MarcaJornada, type TipoMarca,
} from '../../../src/modules/personal/laboral/calculoJornada'

let n = 0
/** Una marca a una hora de Madrid («2026-10-23 18:58», con su desfase). */
const m = (tipo: TipoMarca, horaMadridConDesfase: string, extra: Partial<MarcaJornada> = {}): MarcaJornada =>
  ({ id: `m${++n}`, tipo, hora: new Date(horaMadridConDesfase).toISOString(), ...extra })

const AHORA = new Date('2026-11-05T12:00:00Z')

describe('una jornada con su pausa', () => {
  it('resta la pausa, y el total sale en horas y minutos', () => {
    const { tramos } = armarTramos([
      m('entrada', '2026-10-23T18:58:00+02:00'),
      m('pausa_inicio', '2026-10-23T21:30:00+02:00'),
      m('pausa_fin', '2026-10-23T21:50:00+02:00'),
      m('salida', '2026-10-24T00:04:00+02:00'),
    ], AHORA)
    expect(tramos).toHaveLength(1)
    expect(tramos[0].minutosPresencia).toBe(306)
    expect(tramos[0].minutosPausa).toBe(20)
    expect(tramos[0].minutosTrabajados).toBe(286)
    expect(horasYMinutos(tramos[0].minutosTrabajados)).toBe('4 h 46')
  })

  it('una pausa sin vuelta dura hasta la salida', () => {
    const { tramos } = armarTramos([
      m('entrada', '2026-10-20T09:00:00+02:00'),
      m('pausa_inicio', '2026-10-20T13:00:00+02:00'),
      m('salida', '2026-10-20T14:00:00+02:00'),
    ], AHORA)
    expect(tramos[0].minutosPausa).toBe(60)
    expect(tramos[0].minutosTrabajados).toBe(240)
  })
})

describe('el cambio de día', () => {
  it('la jornada que acaba pasada la medianoche es del día en que empezó', () => {
    const dias = jornadasPorDia([
      m('entrada', '2026-10-23T18:58:00+02:00'),
      m('salida', '2026-10-24T00:04:00+02:00'),
    ], '2026-10-23', '2026-10-24', AHORA)
    expect(dias.map(d => [d.dia, d.minutosTrabajados])).toEqual([['2026-10-23', 306], ['2026-10-24', 0]])
  })

  it('el día es el de Madrid, no el de UTC (las 00:30 del 24 son las 22:30 UTC del 23)', () => {
    expect(diaMadrid('2026-10-23T22:30:00Z')).toBe('2026-10-24')
    expect(horaMadrid('2026-10-23T22:30:00Z')).toBe('00:30')
  })
})

describe('el cambio de hora de octubre (25/10/2026, a las 03:00 vuelven a ser las 02:00)', () => {
  it('la noche del cambio dura una hora más, y así se cuenta', () => {
    // De las 22:00 del 24 (verano, +02:00) a las 06:00 del 25 (invierno, +01:00): 9 horas, no 8.
    const { tramos } = armarTramos([
      m('entrada', '2026-10-24T22:00:00+02:00'),
      m('salida', '2026-10-25T06:00:00+01:00'),
    ], AHORA)
    expect(tramos[0].minutosTrabajados).toBe(540)
    expect(horaMadrid(tramos[0].salida!)).toBe('06:00')
  })
})

describe('la jornada partida', () => {
  it('dos tramos el mismo día: constan los dos y suman', () => {
    const dias = jornadasPorDia([
      m('entrada', '2026-10-20T10:00:00+02:00'),
      m('salida', '2026-10-20T14:00:00+02:00'),
      m('entrada', '2026-10-20T19:00:00+02:00'),
      m('salida', '2026-10-20T23:30:00+02:00'),
    ], '2026-10-20', '2026-10-20', AHORA)
    expect(dias[0].tramos).toHaveLength(2)
    expect(dias[0].minutosTrabajados).toBe(8 * 60 + 30)
  })
})

describe('lo que no se inventa', () => {
  it('una entrada sin salida antes de la siguiente entrada no suma, y se dice', () => {
    const { tramos } = armarTramos([
      m('entrada', '2026-10-20T09:00:00+02:00'),
      m('entrada', '2026-10-21T09:00:00+02:00'),
      m('salida', '2026-10-21T17:00:00+02:00'),
    ], AHORA)
    expect(tramos.map(t => [t.estado, t.minutosTrabajados])).toEqual([['sin_salida', 0], ['cerrado', 480]])
  })

  it('la última entrada: abierta si es de hoy, sin salida si lleva más de un día', () => {
    expect(armarTramos([m('entrada', '2026-11-05T09:00:00+01:00')], AHORA).tramos[0].estado).toBe('abierto')
    expect(armarTramos([m('entrada', '2026-11-03T09:00:00+01:00')], AHORA).tramos[0].estado).toBe('sin_salida')
  })

  it('una jornada de más de 12 h se marca', () => {
    const { tramos } = armarTramos([m('entrada', '2026-10-20T08:00:00+02:00'), m('salida', '2026-10-20T20:30:00+02:00')], AHORA)
    expect(tramos[0].larga).toBe(true)
  })

  it('una marca anulada no cuenta', () => {
    const { tramos } = armarTramos([
      m('entrada', '2026-10-20T09:00:00+02:00'),
      m('salida', '2026-10-20T10:00:00+02:00', { anulada: true }),
      m('salida', '2026-10-20T17:00:00+02:00'),
    ], AHORA)
    expect(tramos[0].minutosTrabajados).toBe(480)
  })

  it('una salida sin entrada no se cuela en ningún tramo', () => {
    const r = armarTramos([m('salida', '2026-10-20T17:00:00+02:00')], AHORA)
    expect(r.tramos).toEqual([])
    expect(r.salidasSueltas).toHaveLength(1)
  })
})

describe('ordinarias y extra, por semana frente al contrato', () => {
  it('lo que pasa de la jornada de la semana es extra', () => {
    // 30 h a la semana; del lunes 19 al domingo 25 de octubre, 5 días de 6 h 30 = 32 h 30.
    const marcas = ['19', '20', '21', '22', '23'].flatMap(d => [
      m('entrada', `2026-10-${d}T10:00:00+02:00`), m('salida', `2026-10-${d}T16:30:00+02:00`)])
    const t = totalesJornada(jornadasPorDia(marcas, '2026-10-19', '2026-10-25', AHORA), 30)
    expect(t.minutosTrabajados).toBe(32 * 60 + 30)
    expect(t.minutosOrdinarios).toBe(30 * 60)
    expect(t.minutosExtra).toBe(150)
    expect(t.diasTrabajados).toBe(5)
  })

  it('una semana cogida a medias cuenta la parte de sus días', () => {
    // Del jueves 1 al domingo 4 de octubre: 4 días de 7 → 40 h × 4/7 = 22 h 51.
    const t = totalesJornada(jornadasPorDia([], '2026-10-01', '2026-10-04', AHORA), 40)
    expect(t.semanas).toHaveLength(1)
    expect(t.minutosContrato).toBe(Math.round(40 * 60 * 4 / 7))
  })

  it('sin jornada en el contrato, todo es ordinario y la extra no se sabe', () => {
    const t = totalesJornada(jornadasPorDia([m('entrada', '2026-10-20T09:00:00+02:00'), m('salida', '2026-10-20T17:00:00+02:00')], '2026-10-20', '2026-10-20', AHORA), null)
    expect(t.minutosOrdinarios).toBe(480)
    expect(t.minutosExtra).toBeNull()
  })

  it('la semana empieza el lunes', () => {
    expect(lunesDe('2026-10-25')).toBe('2026-10-19')
    expect(lunesDe('2026-10-19')).toBe('2026-10-19')
  })
})

describe('se lee sin rodeos', () => {
  it('horas, días y fechas como en la maqueta', () => {
    expect(horasYMinutos(55)).toBe('0 h 55')
    expect(horasYMinutos(118 * 60)).toBe('118 h 00')
    expect(horasYMinutos(0)).toBe('0')
    // El 25/10/2026 (el del cambio de hora) es domingo: el 23, viernes. La
    // maqueta decía «Jue 23» con datos de ejemplo.
    expect(diaCorto('2026-10-23')).toBe('Vie 23')
    expect(diaCorto('2026-10-25')).toBe('Dom 25')
    expect(fechaLarga('2026-10-12')).toBe('12/10/2026')
  })
})
