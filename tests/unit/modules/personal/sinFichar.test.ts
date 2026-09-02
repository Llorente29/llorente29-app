import { describe, it, expect } from 'vitest'
import { cruzaTurnosConFichajes } from '@/modules/personal/home/sinFichar'
import type { Ambito } from '@/modules/personal/home/enCocinaAhora'

const AMBITO: Ambito = {
  locales: new Map([['a', 'Foodint Alcalá'], ['c', 'Foodint Carabanchel']]),
  plantilla: [
    { id: 'e1', name: 'Johanny Garzón', location_id: 'a' },
    { id: 'e2', name: 'Marlón Mafla', location_id: 'a' },
    { id: 'e3', name: 'KEILYMAR ARAUJO', location_id: 'c' },
  ],
}
// «1.- Mañana» 12:30 y «Noche cena» 19:45, los turnos reales de Alcalá.
const TURNOS = [
  { id: 'manana', start_time: '12:30:00' },
  { id: 'noche', start_time: '19:45:00' },
]
const MIERCOLES = 2
const min = (h: number, m = 0) => h * 60 + m

describe('cruzaTurnosConFichajes', () => {
  const cells = { manana: { '2': ['e1', 'e3'] }, noche: { '2': ['e2'] } }

  it('a las 13:00 falta quien tenía turno a las 12:30 y no ha fichado', () => {
    const r = cruzaTurnosConFichajes(cells, TURNOS, MIERCOLES, AMBITO, new Set(['e3']), min(13))
    expect(r.map(x => x.empleadoId)).toEqual(['e1'])
    expect(r[0]).toMatchObject({ entradaPrevista: '12:30', minutosDeRetraso: 30, local: 'Foodint Alcalá' })
  })

  // Alguien con turno a las 19:45 no está «sin fichar» a las 10 de la mañana:
  // está en su casa.
  it('a las 10:00 no falta nadie: a nadie le toca todavía', () => {
    expect(cruzaTurnosConFichajes(cells, TURNOS, MIERCOLES, AMBITO, new Set(), min(10))).toEqual([])
  })

  // Fichar dos minutos tarde no es una ausencia, es el metro. Sin margen, la
  // tarjeta gritaría todos los días a las 12:30 en punto.
  it('dentro del margen de cortesía no cuenta', () => {
    expect(cruzaTurnosConFichajes(cells, TURNOS, MIERCOLES, AMBITO, new Set(), min(12, 40))).toEqual([])
    expect(cruzaTurnosConFichajes(cells, TURNOS, MIERCOLES, AMBITO, new Set(), min(12, 46))
      .map(x => x.empleadoId)).toEqual(['e1', 'e3'])
  })

  it('quien ya fichó no aparece', () => {
    const r = cruzaTurnosConFichajes(cells, TURNOS, MIERCOLES, AMBITO, new Set(['e1', 'e3']), min(13))
    expect(r).toEqual([])
  })

  it('el que más lleva esperándose va arriba', () => {
    const dos = { manana: { '2': ['e1'] }, noche: { '2': ['e2'] } }
    const r = cruzaTurnosConFichajes(dos, TURNOS, MIERCOLES, AMBITO, new Set(), min(20, 30))
    expect(r.map(x => x.empleadoId)).toEqual(['e1', 'e2'])
  })

  // Con dos turnos el mismo día manda el más temprano: es la hora a la que se
  // le espera.
  it('con dos turnos, se cuenta desde el más temprano', () => {
    const dobles = { manana: { '2': ['e1'] }, noche: { '2': ['e1'] } }
    const r = cruzaTurnosConFichajes(dobles, TURNOS, MIERCOLES, AMBITO, new Set(), min(13))
    expect(r).toHaveLength(1)
    expect(r[0].entradaPrevista).toBe('12:30')
  })

  it('otro día del cuadrante no cuenta', () => {
    expect(cruzaTurnosConFichajes({ manana: { '3': ['e1'] } }, TURNOS, MIERCOLES, AMBITO, new Set(), min(13))).toEqual([])
  })

  // Una baja o alguien de otro local no es un hueco de este local.
  it('un empleado que no está en el ámbito no genera aviso', () => {
    const r = cruzaTurnosConFichajes({ manana: { '2': ['fantasma'] } }, TURNOS, MIERCOLES, AMBITO, new Set(), min(13))
    expect(r).toEqual([])
  })

  it('un turno que ya no existe no rompe', () => {
    expect(cruzaTurnosConFichajes({ borrado: { '2': ['e1'] } }, TURNOS, MIERCOLES, AMBITO, new Set(), min(13))).toEqual([])
  })

  it('sin cuadrante, ninguno y no una excepción', () => {
    expect(cruzaTurnosConFichajes(null, TURNOS, MIERCOLES, AMBITO, new Set(), min(13))).toEqual([])
  })
})
