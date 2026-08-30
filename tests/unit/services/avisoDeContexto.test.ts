import { describe, it, expect } from 'vitest'
import {
  avisoDeContexto, duracionLarga, cuando,
  AVISO_REENTRADA_MIN, AVISO_JORNADA_LARGA_MIN,
  type EstadoFichajeVivo,
} from '../../../src/services/fichajeKiosko'

// El aviso de contexto es la última pantalla antes de escribir un fichaje: si
// salta de más se convierte en fricción diaria y la gente aprende a confirmar
// sin leer. Los umbrales están medidos sobre 90 días reales de producción
// (397 entradas, 395 jornadas cerradas); estas pruebas los fijan.

const T = (iso: string) => new Date(iso).getTime()
const dentro = (desdeIso: string): EstadoFichajeVivo =>
  ({ estado: 'trabajando', since: desdeIso, abiertaDesde: desdeIso })
const fuera = (ultimoIso: string): EstadoFichajeVivo =>
  ({ estado: 'fuera', since: ultimoIso, abiertaDesde: null })

describe('avisoDeContexto · el día normal no molesta a nadie', () => {
  it('entrada a las 09:00 tras la salida de ayer: sin aviso', () => {
    const ahora = new Date('2026-08-20T09:00:00')
    expect(avisoDeContexto('entrada', fuera('2026-08-19T17:00:00'), ahora)).toBeNull()
  })

  it('día partido de Camichi (salida 16:45 → entrada 19:45): sin aviso', () => {
    // El motivo de que el umbral sean 2 h y no 6: a 6 h esto avisaría a diario.
    const ahora = new Date('2026-08-20T19:45:00')
    expect(avisoDeContexto('entrada', fuera('2026-08-20T16:45:00'), ahora)).toBeNull()
    const gap = (T('2026-08-20T19:45:00') - T('2026-08-20T16:45:00')) / 60000
    expect(gap).toBeGreaterThan(AVISO_REENTRADA_MIN)
  })

  it('salida normal de una jornada de 8 h: sin aviso', () => {
    const ahora = new Date('2026-08-20T17:00:00')
    expect(avisoDeContexto('salida', dentro('2026-08-20T09:00:00'), ahora)).toBeNull()
  })

  it('salida de un turno largo REAL de 11 h 30: sin aviso', () => {
    // La franja 11-12 h son 26 jornadas de las ocho personas en 90 días: es un
    // turno de verdad, no una anomalía. A 10,5 h esto habría avisado.
    const ahora = new Date('2026-08-20T20:30:00')
    expect(avisoDeContexto('salida', dentro('2026-08-20T09:00:00'), ahora)).toBeNull()
  })
})

describe('avisoDeContexto · entrada sospechosa', () => {
  it('entrada a las 00:15 (hora de cierre): avisa y NO ofrece la salida', () => {
    // El caso de Mirlenys. La BBDD también dice que está fuera, así que escribir
    // una salida crearía una huérfana: se explica en vez de ofrecerla.
    const ahora = new Date('2026-08-21T00:15:00')
    const a = avisoDeContexto('entrada', fuera('2026-08-20T19:48:00'), ahora)
    expect(a).not.toBeNull()
    expect(a!.accion).toBe('entrada')
    expect(a!.alternativa).toBeNull()
    expect(a!.texto).toContain('00:15')
    expect(a!.texto).toContain('ayer a las 19:48')
  })

  it('entrada a las 23:10 y a las 04:30: dentro de la franja rara', () => {
    expect(avisoDeContexto('entrada', fuera('2026-08-20T15:00:00'), new Date('2026-08-20T23:10:00'))).not.toBeNull()
    expect(avisoDeContexto('entrada', fuera('2026-08-20T15:00:00'), new Date('2026-08-21T04:30:00'))).not.toBeNull()
  })

  it('entrada a las 22:30 y a las 05:30: fuera de la franja, sin aviso', () => {
    expect(avisoDeContexto('entrada', fuera('2026-08-20T15:00:00'), new Date('2026-08-20T22:30:00'))).toBeNull()
    expect(avisoDeContexto('entrada', fuera('2026-08-20T15:00:00'), new Date('2026-08-21T05:30:00'))).toBeNull()
  })

  it('reentrada 40 min después de salir: avisa', () => {
    const ahora = new Date('2026-08-20T17:25:00')
    const a = avisoDeContexto('entrada', fuera('2026-08-20T16:45:00'), ahora)
    expect(a).not.toBeNull()
    expect(a!.titulo).toBe('Vuelves a entrar muy pronto')
  })

  it('la BBDD dice que ya está DENTRO: avisa y ofrece la SALIDA a un toque', () => {
    const ahora = new Date('2026-08-20T14:00:00')
    const a = avisoDeContexto('entrada', dentro('2026-08-20T09:00:00'), ahora)
    expect(a).not.toBeNull()
    expect(a!.accion).toBe('entrada')
    expect(a!.alternativa).toBe('salida')
    expect(a!.texto).toContain('hoy a las 09:00')
  })

  it('sin ningún fichaje anterior a hora rara: avisa sin inventarse una salida', () => {
    const ahora = new Date('2026-08-21T02:00:00')
    const a = avisoDeContexto('entrada', { estado: 'sin_fichajes', since: null, abiertaDesde: null }, ahora)
    expect(a!.texto).toContain('No tienes ningún fichaje anterior')
  })
})

describe('avisoDeContexto · salida sospechosa', () => {
  it('salida sin jornada abierta: avisa y ofrece la ENTRADA a un toque', () => {
    const ahora = new Date('2026-08-20T09:05:00')
    const a = avisoDeContexto('salida', fuera('2026-08-19T22:00:00'), ahora)
    expect(a).not.toBeNull()
    expect(a!.accion).toBe('salida')
    expect(a!.alternativa).toBe('entrada')
  })

  it('cierra una jornada de 15 h 54 min: avisa con la duración y la hora', () => {
    // El ejemplo del encargo: 00:15 → 16:09 del mismo día.
    const ahora = new Date('2026-08-20T16:09:00')
    const a = avisoDeContexto('salida', dentro('2026-08-20T00:15:00'), ahora)
    expect(a).not.toBeNull()
    expect(a!.titulo).toBe('Jornada muy larga')
    expect(a!.alternativa).toBeNull()
    expect(a!.texto).toContain('15 h 54 min')
    expect(a!.texto).toContain('hoy a las 00:15')
  })

  it('la jornada que cruza medianoche dice "ayer", no "hoy"', () => {
    const a = avisoDeContexto('salida', dentro('2026-08-20T20:00:00'), new Date('2026-08-21T11:54:00'))
    expect(a!.texto).toContain('15 h 54 min')
    expect(a!.texto).toContain('ayer a las 20:00')
  })

  it('el umbral de jornada larga son 12 h justas', () => {
    expect(AVISO_JORNADA_LARGA_MIN).toBe(720)
    const inicio = '2026-08-20T08:00:00'
    expect(avisoDeContexto('salida', dentro(inicio), new Date('2026-08-20T19:59:00'))).toBeNull()
    expect(avisoDeContexto('salida', dentro(inicio), new Date('2026-08-20T20:00:00'))).not.toBeNull()
  })
})

describe('formato para humanos', () => {
  it('duracionLarga', () => {
    expect(duracionLarga(954)).toBe('15 h 54 min')
    expect(duracionLarga(720)).toBe('12 h')
    expect(duracionLarga(45)).toBe('45 min')
  })

  it('cuando', () => {
    const hoy = new Date('2026-08-21T16:00:00')
    expect(cuando(new Date('2026-08-21T09:00:00'), hoy)).toBe('hoy a las 09:00')
    expect(cuando(new Date('2026-08-20T00:15:00'), hoy)).toBe('ayer a las 00:15')
    expect(cuando(new Date('2026-08-17T22:00:00'), hoy)).toBe('el 17/08 a las 22:00')
  })
})
