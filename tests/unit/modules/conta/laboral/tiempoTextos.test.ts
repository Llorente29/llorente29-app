// tests/unit/modules/conta/laboral/tiempoTextos.test.ts
//
// N1 · PR 3 (02/11/2026) · Las cuentas de «Tiempo y turnos» (maquetas 10 y
// 10b). Las celdas del cuadrante tienen la forma de `schedules.cells` (plantilla
// → día 0..6 → personas); las horas, en UTC como las guarda la base y leídas
// en Madrid (regla 4). Personas y turnos, inventados.

import { describe, expect, it } from 'vitest'
import {
  avisoSinSalida, diasDeLaSemana, diasSinSalida, filasDeLaSemana, lunesConDesplazamiento, mesConAnio, minutosPorMes, resumenDelMes,
  textoBolsa, textoSemana, turnosDeLaSemana, ultimosMeses,
} from '../../../../../src/modules/conta/laboral/ficha/tiempo/tiempoTextos'
import type { Schedule, ShiftTemplate } from '../../../../../src/types/scheduler'
import type { MarcaJornada } from '../../../../../src/modules/personal/laboral/calculoJornada'

const plantilla = (id: string, label: string, start_time: string, end_time: string) => ({ id, label, start_time, end_time } as ShiftTemplate)
const cuadrante = (status: 'draft' | 'published'): Schedule => ({
  id: 's', location_id: 'l', week_start: '2026-10-26', status, coverage_overrides: {},
  cells: { manana: { 0: ['yo', 'otra'], 1: ['yo'], 3: ['yo'] }, tarde: { 4: ['yo'], 5: ['yo'], 6: ['otra'] } },
})
const PLANTILLAS = [plantilla('manana', 'Mañana', '09:00:00', '17:00:00'), plantilla('tarde', 'Tarde', '12:00', '20:00')]

// En UTC: octubre es horario de verano hasta el 25; del 26 en adelante, Madrid = UTC+1.
const m = (id: string, tipo: MarcaJornada['tipo'], hora: string): MarcaJornada => ({ id, tipo, hora })
const MARCAS: MarcaJornada[] = [
  m('1', 'entrada', '2026-10-26T07:58:00Z'), m('2', 'salida', '2026-10-26T16:04:00Z'),
  m('3', 'entrada', '2026-10-27T08:02:00Z'), m('4', 'salida', '2026-10-27T16:00:00Z'),
  m('5', 'entrada', '2026-10-29T08:01:00Z'),
  m('6', 'entrada', '2026-10-30T10:55:00Z'), m('7', 'salida', '2026-10-30T19:12:00Z'),
]
const AHORA = new Date('2026-11-02T10:00:00Z')

describe('el turno de cada día sale del cuadrante publicado', () => {
  it('cada día con su turno, de lunes a domingo; libre si no tiene', () => {
    const t = turnosDeLaSemana(cuadrante('published'), PLANTILLAS, 'yo')!
    expect(Object.values(t).map((x) => x.map((y) => `${y.inicio}–${y.fin}`).join(','))).toEqual(['09:00–17:00', '09:00–17:00', '', '09:00–17:00', '12:00–20:00', '12:00–20:00', ''])
  })
  it('sin publicar no se sabe: null, nunca «libre»', () => {
    expect(turnosDeLaSemana(cuadrante('draft'), PLANTILLAS, 'yo')).toBeNull()
    expect(turnosDeLaSemana(null, PLANTILLAS, 'yo')).toBeNull()
  })
  it('una plantilla borrada se dice', () => {
    expect(turnosDeLaSemana(cuadrante('published'), [], 'yo')!['2026-10-26'][0].nombre).toBe('turno borrado')
  })
})

describe('la semana: turno, lo fichado y las horas (en Madrid)', () => {
  const filas = filasDeLaSemana('2026-10-26', MARCAS, turnosDeLaSemana(cuadrante('published'), PLANTILLAS, 'yo'), AHORA)
  it('como la maqueta 10', () => {
    expect(filas.map((f) => [f.diaTexto, f.fichado, f.horas])).toEqual([
      ['Lun 26', '08:58 – 17:04', '8 h 06'],
      ['Mar 27', '09:02 – 17:00', '7 h 58'],
      ['Mié 28', '—', '—'],
      ['Jue 29', '09:01 – sin salida', '?'],
      ['Vie 30', '11:55 – 20:12', '8 h 17'],
      ['Sáb 31', '—', '—'],
      ['Dom 1', '—', '—'],
    ])
    expect(filas.filter((f) => f.sinSalida).map((f) => f.dia)).toEqual(['2026-10-29'])
  })
  it('el aviso dice el día y a qué hora acababa su turno', () => {
    expect(avisoSinSalida('2026-10-29', filas[3].turnos)).toBe('El jueves 29 no fichó la salida. Su turno acababa a las 17:00.')
    expect(avisoSinSalida('2026-10-29', null)).toBe('El jueves 29 no fichó la salida.')
  })
})

describe('el mes y los registros', () => {
  it('lo trabajado del mes hasta hoy y los días sin salida', () => {
    const r = resumenDelMes(MARCAS, '2026-10-31', new Date('2026-10-31T22:00:00Z'))
    expect(r.minutosTrabajados).toBe(8 * 60 + 6 + 7 * 60 + 58 + 8 * 60 + 17)
    expect(r.sinSalida).toEqual(['2026-10-29'])
  })
  it('por corregir: este mes y el anterior (el 1 de noviembre avisa del 29 de octubre, como la maqueta)', () => {
    expect(diasSinSalida(MARCAS, '2026-10-01', '2026-11-01', AHORA)).toEqual(['2026-10-29'])
    expect(diasSinSalida(MARCAS, '2026-11-01', '2026-11-01', AHORA)).toEqual([])
  })
  it('los tres últimos meses y sus horas', () => {
    expect(ultimosMeses('2026-11-02', 3)).toEqual(['2026-11', '2026-10', '2026-09'])
    expect(minutosPorMes(MARCAS, ['2026-11', '2026-10'], AHORA)).toEqual({ '2026-11': 0, '2026-10': 1461 })
    expect(mesConAnio('2026-10')).toBe('Octubre 2026')
  })
})

describe('fechas y bolsa', () => {
  it('las semanas', () => {
    expect(lunesConDesplazamiento('2026-11-02', 0)).toBe('2026-11-02')
    expect(lunesConDesplazamiento('2026-11-01', 0)).toBe('2026-10-26')
    expect(lunesConDesplazamiento('2026-11-02', -1)).toBe('2026-10-26')
    expect(diasDeLaSemana('2026-10-26')[6]).toBe('2026-11-01')
    expect(textoSemana('2026-10-26')).toBe('del 26 de octubre al 1 de noviembre')
  })
  it('la bolsa en horas y minutos, con su signo', () => {
    expect(textoBolsa(3.3333)).toBe('+3 h 20')
    expect(textoBolsa(-1.0833)).toBe('−1 h 05')
    expect(textoBolsa(0.001)).toBe('0')
  })
})
