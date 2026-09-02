import { describe, it, expect } from 'vitest'
import { resumeEnCocina, duracion } from '@/modules/personal/home/resumeEnCocina'
import type { EstadoEmpleado } from '@/modules/personal/home/enCocinaAhora'

const AHORA = new Date('2026-09-02T12:38:00Z').getTime()   // 14:38 de Madrid

function emp(p: Partial<EstadoEmpleado>): EstadoEmpleado {
  return {
    empleadoId: 'x', nombre: 'Alguien', locationId: 'a', localNombre: 'Foodint Alcalá',
    estado: 'fuera', abiertaDesde: null, minutosHoy: 0, ...p,
  }
}

describe('duracion', () => {
  it('minutos sueltos, horas justas y horas con minutos', () => {
    expect(duracion(48)).toBe('48 min')
    expect(duracion(120)).toBe('2 h')
    expect(duracion(137)).toBe('2 h 17 min')
  })
})

describe('resumeEnCocina · el estado real del 02/09 a las 14:38', () => {
  const HOY = [
    emp({ nombre: 'Johanny Garzón Rodríguez ', estado: 'trabajando', abiertaDesde: '2026-09-02T10:21:00Z' }),
    emp({ nombre: 'Natacha del Valle Rondón ', estado: 'fuera' }),
    emp({ nombre: 'Pamela Guzman Velásquez', estado: 'fuera' }),
    emp({ nombre: 'Marlón Mafla Rivera', estado: 'sin_fichajes' }),
    emp({ nombre: 'KEILYMAR ARAUJO LOBO', locationId: 'c', localNombre: 'Foodint Carabanchel',
          estado: 'trabajando', abiertaDesde: '2026-09-02T10:40:51Z' }),
    emp({ nombre: 'Mirlenys Eloisa Castañeda', locationId: 'c', localNombre: 'Foodint Carabanchel',
          estado: 'fuera' }),
  ]

  it('cuenta dos dentro y los reparte por local', () => {
    const r = resumeEnCocina(HOY, AHORA)
    expect(r.dentro).toBe(2)
    expect(r.filas).toEqual([
      { etiqueta: 'Foodint Alcalá', valor: '1 de 4', tono: 'neutral' },
      { etiqueta: 'Foodint Carabanchel', valor: '1 de 2', tono: 'neutral' },
    ])
  })

  it('la nota dice quién lleva MÁS tiempo dentro', () => {
    expect(resumeEnCocina(HOY, AHORA).nota).toBe('Johanny lleva 2 h 17 min dentro')
  })

  // «No aparece» y «no hay nadie» se leen igual y significan cosas distintas.
  it('un local sin nadie dentro NO desaparece de la tarjeta', () => {
    const r = resumeEnCocina([
      emp({ estado: 'trabajando', abiertaDesde: '2026-09-02T10:00:00Z' }),
      emp({ locationId: 'c', localNombre: 'Foodint Carabanchel', estado: 'fuera' }),
    ], AHORA)
    expect(r.filas.map(f => f.etiqueta)).toContain('Foodint Carabanchel')
    expect(r.filas.find(f => f.etiqueta === 'Foodint Carabanchel')?.valor).toBe('nadie dentro')
  })

  it('nadie dentro en ningún sitio: cero, y sin nota inventada', () => {
    const r = resumeEnCocina([emp({}), emp({ estado: 'sin_fichajes' })], AHORA)
    expect(r.dentro).toBe(0)
    expect(r.nota).toBeUndefined()
  })

  // Un fallo al leer un estado bajaría el número sin explicar por qué.
  it('un estado que no se pudo leer se DICE, y manda sobre la otra nota', () => {
    const r = resumeEnCocina([
      emp({ estado: 'trabajando', abiertaDesde: '2026-09-02T10:00:00Z' }),
      emp({ estado: 'desconocido' }),
    ], AHORA)
    expect(r.dentro).toBe(1)
    expect(r.nota).toBe('No se ha podido leer el estado de 1 persona')
  })

  // El caso que la ventana de día se comía: turno de noche a caballo del día.
  it('quien entró ayer a las 22:00 y sigue dentro cuenta a las 00:30', () => {
    const medianoche = new Date('2026-09-02T22:30:00Z').getTime()   // 00:30 del 3 en Madrid
    const r = resumeEnCocina([
      emp({ nombre: 'Keilymar', estado: 'trabajando', abiertaDesde: '2026-09-02T20:00:00Z' }),
    ], medianoche)
    expect(r.dentro).toBe(1)
    expect(r.nota).toBe('Keilymar lleva 2 h 30 min dentro')
  })
})
