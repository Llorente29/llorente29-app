// L1a · PR 1. Fichar en el servidor: qué se manda a fichar(), qué se hace con
// cada respuesta y la cola de los fichajes hechos sin cobertura.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// En node no hay localStorage: uno mínimo, en memoria.
const almacen = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => { almacen.set(k, v) },
  removeItem: (k: string) => { almacen.delete(k) },
  clear: () => almacen.clear(),
})

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../../src/lib/supabase', () => ({ supabase: { rpc }, isSupabaseEnabled: true }))

import {
  esFalloDeRed, esFuncionQueNoExiste, ficharEnElServidor, prepararPinDeKiosko, corregirConMotivo,
  guardarFichajePendiente, fichajesPendientes, enviarFichajesPendientes, ultimoFichajeGuardado,
} from '../../../src/services/fichajeServidor'
import type { ClockEntry } from '../../../src/types'

const YO = '11111111-1111-1111-1111-111111111111'
const entrada = (extra: Partial<ClockEntry> = {}): ClockEntry =>
  ({ id: 'x', type: 'entrada', datetime: '2026-10-27T08:00:00.000Z', ...extra }) as ClockEntry

const respuesta = {
  id: 'e1', type: 'entrada', datetime: '2026-10-27T08:00:00Z', real_datetime: '2026-10-27T08:02:00Z',
  declarada: null, llegada: '2026-10-27T08:02:00Z', origen: 'movil', distancia_m: 40,
  dentro_del_radio: true, radio_m: 200, local: 'Centro', local_con_coordenadas: true,
}

beforeEach(() => {
  rpc.mockReset()
  localStorage.clear()
})

describe('qué es un fallo de red y qué no', () => {
  it('«Failed to fetch» sin código es la red', () => {
    expect(esFalloDeRed(new TypeError('Failed to fetch'))).toBe(true)
    expect(esFalloDeRed({ message: 'Load failed', code: null })).toBe(true)
  })
  // Un rechazo de la base trae código: se enseña, no se guarda para luego.
  it('un rechazo de la base no es la red, aunque el texto se parezca', () => {
    expect(esFalloDeRed({ message: 'FUERA_DE_ZONA', code: 'P0001' })).toBe(false)
    expect(esFalloDeRed({ message: 'timeout de algo', code: '57014' })).toBe(false)
  })
  it('la función que no existe es PGRST202', () => {
    expect(esFuncionQueNoExiste({ code: 'PGRST202', message: '' })).toBe(true)
    expect(esFuncionQueNoExiste({ code: '42501', message: 'NO_AUTORIZADO' })).toBe(false)
  })
})

describe('ficharEnElServidor', () => {
  it('manda lo que pide fichar_con_precision() y devuelve lo que se guardó', async () => {
    rpc.mockResolvedValue({ data: { ...respuesta, precision_m: 12, ubicacion_aproximada: false }, error: null })
    const r = await ficharEnElServidor(YO, entrada({ lat: 40.4, lng: -3.7, locationIdAtClock: 'L1', precisionM: 12 }))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('fichar_con_precision', expect.objectContaining({
      p_employee_id: YO, p_type: 'entrada', p_origen: 'movil', p_location_id: 'L1',
      p_lat: 40.4, p_lng: -3.7, p_hora_declarada: null, p_pin: null, p_precision_m: 12,
    }))
    if (r.tipo === 'guardado') {
      expect(r.guardado.precisionM).toBe(12)
      expect(r.guardado.ubicacionAproximada).toBe(false)
    }
    expect(r.tipo).toBe('guardado')
    if (r.tipo === 'guardado') {
      expect(r.guardado.distanciaM).toBe(40)
      expect(r.guardado.dentroDelRadio).toBe(true)
    }
    expect(ultimoFichajeGuardado(YO)?.id).toBe('e1')
  })

  // El PIN se usa una vez y se olvida: no se queda en memoria para el siguiente.
  it('la tablet manda el PIN una sola vez', async () => {
    rpc.mockResolvedValue({ data: { ...respuesta, origen: 'tablet' }, error: null })
    prepararPinDeKiosko(YO, '4321')
    await ficharEnElServidor(YO, entrada({ source: 'tablet' } as Partial<ClockEntry>))
    await ficharEnElServidor(YO, entrada({ source: 'tablet' } as Partial<ClockEntry>))
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_origen: 'tablet', p_pin: '4321' })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_origen: 'tablet', p_pin: null })
  })

  // L1a PR 3: una base sin la 1934 no tiene fichar_con_precision: ficha con fichar(), sin precisión.
  it('sin fichar_con_precision, ficha con fichar() y sin p_precision_m', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    rpc.mockResolvedValueOnce({ data: respuesta, error: null })
    const r = await ficharEnElServidor(YO, entrada({ precisionM: 1500 }))
    expect(r.tipo).toBe('guardado')
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['fichar_con_precision', 'fichar'])
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_precision_m')
  })

  it('con la base de antes (sin fichar) dice «sin-funcion»', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    expect((await ficharEnElServidor(YO, entrada())).tipo).toBe('sin-funcion')
  })

  it('un rechazo de la base vuelve como rechazo, con su motivo', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'FUERA_DE_ZONA', hint: 'Estás a 900 m.' } })
    const r = await ficharEnElServidor(YO, entrada())
    expect(r).toEqual({ tipo: 'rechazado', error: { code: 'P0001', message: 'FUERA_DE_ZONA', hint: 'Estás a 900 m.' } })
  })

  it('sin red vuelve como «sin-red»', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await ficharEnElServidor(YO, entrada())).tipo).toBe('sin-red')
  })
})

describe('la marca a mano es una corrección con motivo', () => {
  it('sin motivo no se manda', async () => {
    const e = await corregirConMotivo(YO, entrada({ motivo: '  ' } as Partial<ClockEntry>))
    expect(e?.message).toBe('MOTIVO_OBLIGATORIO')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('con motivo va a add_manual_clock_entry, sin forzar', async () => {
    rpc.mockResolvedValue({ data: 'id', error: null })
    expect(await corregirConMotivo(YO, entrada({ motivo: 'No fichó la entrada' } as Partial<ClockEntry>))).toBeNull()
    expect(rpc).toHaveBeenCalledWith('add_manual_clock_entry', expect.objectContaining({
      p_employee_id: YO, p_type: 'entrada', p_reason: 'No fichó la entrada', p_force: false,
    }))
  })
})

describe('sin cobertura: la cola del móvil', () => {
  it('se sube con la hora declarada y sale de la cola', async () => {
    guardarFichajePendiente(YO, entrada(), '2026-10-27T07:58:00.000Z')
    rpc.mockResolvedValue({ data: respuesta, error: null })
    expect(await enviarFichajesPendientes()).toEqual({ subidos: 1, quedan: 0 })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_hora_declarada: '2026-10-27T07:58:00.000Z' })
  })

  it('si sigue sin red, se queda y se para ahí', async () => {
    guardarFichajePendiente(YO, entrada(), '2026-10-27T07:58:00.000Z')
    guardarFichajePendiente(YO, entrada({ type: 'salida' }), '2026-10-27T15:00:00.000Z')
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await enviarFichajesPendientes()).toEqual({ subidos: 0, quedan: 2 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  // Regla 8: lo que el servidor no acepta no desaparece en silencio, se queda
  // con su motivo para enseñarlo, y no se reintenta solo.
  it('un rechazo se queda marcado con su motivo y no se reintenta', async () => {
    guardarFichajePendiente(YO, entrada(), '2026-10-20T07:58:00.000Z')
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'HORA_DECLARADA_ANTIGUA', hint: 'Han pasado más de 72 horas.' } })
    await enviarFichajesPendientes()
    expect(fichajesPendientes(YO)[0].rechazo).toBe('Han pasado más de 72 horas.')
    await enviarFichajesPendientes()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('con la base de antes no se sube sin su hora: se queda como rechazo', async () => {
    guardarFichajePendiente(YO, entrada(), '2026-10-27T07:58:00.000Z')
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: '' } })
    await enviarFichajesPendientes()
    expect(fichajesPendientes(YO)[0].rechazo).toMatch(/encargado/)
  })
})
