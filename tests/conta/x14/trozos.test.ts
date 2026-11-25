// tests/conta/x14/trozos.test.ts
//
// X14 · Respuesta 1, punto 1: lo leído de ERP10 entra en prueba por trozos (conta_traer_cargar y conta_traer_seguir), sin
// pasar del corte de la sesión, con lo que lleva en palabras («Trayendo 2024: asientos 2.100 de 4.425»). La base, simulada.
// Datos inventados (T11).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { base, llamadas, cola } = vi.hoisted(() => {
  const llamadas: { nombre: string; args: Record<string, unknown> }[] = []
  const cola: { respuestas: Record<string, unknown>[] } = { respuestas: [] }
  const base = {
    rpc: vi.fn(async (nombre: string, args: Record<string, unknown>) => {
      llamadas.push({ nombre, args })
      const r = cola.respuestas.shift()
      if (!r) throw new Error('sin respuesta')
      return r
    }),
  }
  return { base, llamadas, cola }
})
vi.mock('@/modules/conta/services/bd', () => ({ tabla: () => ({}), mensaje: (x: string) => x, rpc: base.rpc, hayBase: () => undefined }))
vi.mock('@/lib/supabase', () => ({ supabase: null }))

import { seguirCarga, traer, type AvanceCarga } from '@/modules/conta/services/traerService'
import { fraseMetiendo, pastillaUnBoton, type EntradaUnBoton } from '@/modules/conta/lib/traer/unBoton'
import type { DatosDeLaCarga } from '@/modules/conta/lib/traer'

const av = (a: number, f: number) => ({ asientos: { hechos: a, de: 4425 }, facturas: { hechos: f, de: 2124 } })
beforeEach(() => { llamadas.length = 0; cola.respuestas = []; base.rpc.mockClear() })

describe('lo que lleva, en palabras', () => {
  it('«Trayendo 2024: asientos 2.100 de 4.425»; después, las facturas; sin avance, que está entrando', () => {
    expect(fraseMetiendo({ ejercicio: '2024', ...av(2100, 0) })).toBe('Trayendo 2024: asientos 2.100 de 4.425')
    expect(fraseMetiendo({ ejercicio: '2024', ...av(4425, 300) })).toBe('Trayendo 2024: facturas 300 de 2.124')
    expect(fraseMetiendo({ ejercicio: '2025', asientos: { hechos: 4100, de: 8260 }, facturas: { hechos: 0, de: 10 } })).toBe('Trayendo 2025: asientos 4.100 de 8.260')
    expect(fraseMetiendo({ ejercicio: null, ...av(4425, 2124) })).toBe('Trayendo: acabando')
    expect(fraseMetiendo(null)).toBe('Leído de ERP10. Ahora entra en prueba en Sumied.')
  })
  it('arriba, en la pastilla, mientras entra', () => {
    const e: EntradaUnBoton = { lector: null, carga: null, enPrueba: null, antes: null, parado: 'x', meter: { estado: 'metiendo', avance: { ejercicio: '2024', ...av(1137, 0) } } }
    expect(pastillaUnBoton(e)).toEqual({ texto: 'Trayendo 2024: asientos 1.137 de 4.425', tono: 'azul' })
    expect(pastillaUnBoton({ ...e, meter: { estado: 'metiendo' } })).toEqual({ texto: 'Leído · metiéndolo en prueba', tono: 'azul' })
  })
})

describe('entrar por trozos', () => {
  const datos = { version: 1 } as unknown as DatosDeLaCarga
  it('cargar y, mientras no acabe, seguir; diciendo lo que lleva; al final, el texto de la base', async () => {
    cola.respuestas = [
      { carga: 'c1', acabado: false, ...av(1137, 0) },
      { carga: 'c1', acabado: false, ...av(2323, 0) },
      { carga: 'c1', acabado: false, ...av(4425, 1873) },
      { carga: 'c1', acabado: true, texto: 'Traído en prueba: 4425 asientos…', cuentas: { asientos: 4425 }, ...av(4425, 2124) },
    ]
    const vistos: AvanceCarga[] = []
    const r = await traer('empresa', '2024', datos, 'Quien', (a) => vistos.push(a))
    expect(llamadas.map((x) => x.nombre)).toEqual(['conta_traer_cargar', 'conta_traer_seguir', 'conta_traer_seguir', 'conta_traer_seguir'])
    expect(llamadas.slice(1).every((x) => x.args.p_carga === 'c1')).toBe(true)
    expect(vistos.map((a) => a.asientos.hechos)).toEqual([1137, 2323, 4425, 4425])
    expect(r).toEqual({ carga: 'c1', texto: 'Traído en prueba: 4425 asientos…', cuentas: { asientos: 4425 } })
  })
  it('una base de antes (sin «acabado»): ya entró entera, no se sigue', async () => {
    cola.respuestas = [{ carga: 'c2', texto: 'Traído en prueba: 3 asientos…', cuentas: { asientos: 3 } }]
    expect(await traer('empresa', '2024', datos, null)).toEqual({ carga: 'c2', texto: 'Traído en prueba: 3 asientos…', cuentas: { asientos: 3 } })
    expect(llamadas.map((x) => x.nombre)).toEqual(['conta_traer_cargar'])
  })
  it('una carga a medias se sigue sola hasta el final', async () => {
    cola.respuestas = [{ carga: 'c3', acabado: false, ...av(3000, 0) }, { carga: 'c3', acabado: true, texto: 'Traído en prueba…', ...av(4425, 2124) }]
    expect((await seguirCarga('c3')).texto).toBe('Traído en prueba…')
    expect(llamadas.map((x) => [x.nombre, x.args.p_carga])).toEqual([['conta_traer_seguir', 'c3'], ['conta_traer_seguir', 'c3']])
  })
  it('si la base dice que no (p. ej., otra carga a medias), llega su frase, tal cual', async () => {
    base.rpc.mockImplementationOnce(async () => { throw new Error('Hay una carga de esta empresa a medias, del 24/11: sigue con ella o deshazla antes de traer otra.') })
    await expect(traer('empresa', '2024', datos, null)).rejects.toThrow(/a medias/)
  })
})
