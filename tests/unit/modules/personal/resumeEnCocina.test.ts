import { describe, it, expect } from 'vitest'
import { resumeEnCocina, duracion } from '@/modules/personal/home/resumeEnCocina'
import { primeraEntradaPrevista, type EstadoEmpleado } from '@/modules/personal/home/enCocinaAhora'

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
    const r = resumeEnCocina(HOY, { consolidado: true })
    expect(r.dentro).toBe(2)
    expect(r.filas).toEqual([
      { etiqueta: 'Foodint Alcalá', valor: '1 de 4', tono: 'neutral' },
      { etiqueta: 'Foodint Carabanchel', valor: '1 de 2', tono: 'neutral' },
    ])
  })

  // La maqueta manda: la fila de contexto es quién cerró ayer.
  it('la fila de contexto es «Ayer cerró», con nombre y hora', () => {
    const r = resumeEnCocina(HOY, { consolidado: true, ayerCerro: { nombre: 'Pamela', hora: '00:15' } })
    expect(r.filas.at(-1)).toEqual({ etiqueta: 'Ayer cerró', valor: 'Pamela · 00:15', tono: 'neutral' })
  })

  it('la cifra lleva denominador: «2 de 6»', () => {
    const r = resumeEnCocina(HOY, { consolidado: true })
    expect([r.dentro, r.total]).toEqual([2, 6])
  })

  // El desglose por local no está en la maqueta: solo en consolidado.
  it('con un local seleccionado no se pinta el desglose por local', () => {
    const r = resumeEnCocina(HOY, { consolidado: false })
    expect(r.filas.filter(f => f.etiqueta.startsWith('Foodint'))).toEqual([])
  })

  // «No aparece» y «no hay nadie» se leen igual y significan cosas distintas.
  it('un local sin nadie dentro NO desaparece de la tarjeta', () => {
    const r = resumeEnCocina([
      emp({ estado: 'trabajando', abiertaDesde: '2026-09-02T10:00:00Z' }),
      emp({ locationId: 'c', localNombre: 'Foodint Carabanchel', estado: 'fuera' }),
    ], { consolidado: true })
    expect(r.filas.map(f => f.etiqueta)).toContain('Foodint Carabanchel')
    expect(r.filas.find(f => f.etiqueta === 'Foodint Carabanchel')?.valor).toBe('nadie dentro')
  })

  // El estado vacío de la maqueta: la primera entrada prevista, del cuadrante.
  it('sin nadie dentro, la nota da la primera entrada prevista', () => {
    const r = resumeEnCocina([emp({}), emp({ estado: 'sin_fichajes' })],
      { consolidado: true, primeraEntradaPrevista: '12:30' })
    expect(r.dentro).toBe(0)
    expect(r.nota).toBe('Sin fichajes aún hoy · primera entrada prevista a las 12:30')
  })

  // Sin turno previsto no se inventa una hora: se dice que no la hay.
  it('sin cuadrante que consultar, se dice que no hay turno previsto', () => {
    const r = resumeEnCocina([emp({})], { consolidado: true, primeraEntradaPrevista: null })
    expect(r.nota).toBe('Sin fichajes aún hoy · no hay turno previsto en el cuadrante')
  })

  // Un fallo al leer un estado bajaría el número sin explicar por qué.
  it('un estado que no se pudo leer se DICE, y manda sobre la otra nota', () => {
    const r = resumeEnCocina([
      emp({ estado: 'trabajando', abiertaDesde: '2026-09-02T10:00:00Z' }),
      emp({ estado: 'desconocido' }),
    ], { consolidado: true })
    expect(r.dentro).toBe(1)
    expect(r.nota).toBe('No se ha podido leer el estado de 1 persona')
  })

  // El caso que la ventana de día se comía: turno de noche a caballo del día.
  it('quien entró ayer a las 22:00 y sigue dentro cuenta a las 00:30', () => {
    const r = resumeEnCocina([
      emp({ nombre: 'Keilymar', estado: 'trabajando', abiertaDesde: '2026-09-02T20:00:00Z' }),
    ], { consolidado: true })
    expect(r.dentro).toBe(1)
    // Y NO sale el estado vacío: hay alguien dentro.
    expect(r.nota).toBeUndefined()
  })
})

describe('primeraEntradaPrevista · la forma real de schedules.cells', () => {
  // `{ turnoId: { díaIndex: [empleadoId…] } }` — el TURNO fuera y los empleados
  // dentro. Leerlo del revés casi cuesta una alarma falsa por 226 referencias
  // «rotas» que no lo estaban: eran empleados donde se buscaban turnos.
  const TURNOS = [
    { id: 'manana', start_time: '12:30:00' },
    { id: 'tarde', start_time: '16:45:00' },
    { id: 'noche', start_time: '19:45:00' },
  ]

  it('coge el turno más temprano CON alguien asignado ese día', () => {
    expect(primeraEntradaPrevista({
      manana: { '2': ['emp1'] },
      tarde: { '2': ['emp2'] },
    }, TURNOS, 2)).toBe('12:30')
  })

  // Un turno sin nadie es una casilla vacía, no una entrada prevista.
  it('ignora el turno que no tiene a nadie asignado', () => {
    expect(primeraEntradaPrevista({
      manana: { '2': [] },
      tarde: { '2': ['emp2'] },
    }, TURNOS, 2)).toBe('16:45')
  })

  it('otro día distinto no cuenta', () => {
    expect(primeraEntradaPrevista({ manana: { '3': ['emp1'] } }, TURNOS, 2)).toBeNull()
  })

  it('un turno que ya no existe no rompe ni inventa hora', () => {
    expect(primeraEntradaPrevista({ borrado: { '2': ['emp1'] } }, TURNOS, 2)).toBeNull()
  })

  it('sin cuadrante, null y no una excepción', () => {
    expect(primeraEntradaPrevista(null, TURNOS, 2)).toBeNull()
  })
})
