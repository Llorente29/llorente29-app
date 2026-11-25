// tests/unit/modules/conta/q10/emitir.test.ts
//
// Q10 · Emitir por trozos: de diez en diez, seguidos, y si uno para se dice hasta dónde llegó y por qué (regla 8).
// La llamada a la base se simula: aquí nunca se emite nada (T6 · nunca emitir de verdad en una prueba).

import { describe, expect, it } from 'vitest'
import { emitirPorTrozos } from '@/modules/conta/gestoria/q10/emitir'
import type { AEmitir, Emitido } from '@/modules/conta/gestoria/q10/datos'

const facturas = (n: number): AEmitir[] => Array.from({ length: n }, (_, i) => ({ gc_id: `PM${i + 1}`, retencion_pct: 0, cuenta_cliente: null }))
/** Una base de mentira: numera seguido desde `desde` y para en el cobro que se le diga. */
function base(paraEn: string | null = null) {
  const llamadas: { desde: number; n: number }[] = []
  const llamar = async (desde: number, trozo: AEmitir[]): Promise<Emitido> => {
    llamadas.push({ desde, n: trozo.length })
    if (paraEn && trozo.some((x) => x.gc_id === paraEn)) throw new Error('La 3 · Cliente de Prueba no tiene NIF.')
    return { emitidas: trozo.map((x, i) => ({ gc_id: x.gc_id, numero: `2026/1/${desde + i}`, total: 121 })), siguiente: desde + trozo.length, frase: '' }
  }
  return { llamadas, llamar }
}

describe('Q10 · emitir por trozos', () => {
  it('204 facturas: 21 trozos de 10 (el último de 4), seguidos desde la 2745', async () => {
    const b = base()
    const avances: string[] = []
    const frase = await emitirPorTrozos(facturas(204), 2745, 'noviembre de 2026', b.llamar, (f) => avances.push(f))
    expect(b.llamadas).toHaveLength(21)
    expect(b.llamadas[0]).toEqual({ desde: 2745, n: 10 })
    expect(b.llamadas[20]).toEqual({ desde: 2945, n: 4 })
    expect(avances[1]).toBe('Emitiendo… 10 de 204')
    expect(frase).toBe('Emitidas 204 facturas de noviembre de 2026, con fecha de hoy: de la 2026/1/2745 a la 2026/1/2948. Todas atadas a su cobro.')
  })
  it('si un trozo para, lo de antes queda emitido y se dice hasta dónde y por qué', async () => {
    const b = base('PM23')
    await expect(emitirPorTrozos(facturas(30), 574, 'noviembre de 2026', b.llamar)).rejects.toThrow(
      'Emitidas 20 de 30 (de la 2026/1/574 a la 2026/1/593). Paró en la siguiente, sin emitirla: La 3 · Cliente de Prueba no tiene NIF.')
    expect(b.llamadas).toHaveLength(3)
  })
  it('si para el primero, ninguna', async () => {
    await expect(emitirPorTrozos(facturas(3), 574, 'noviembre de 2026', base('PM1').llamar)).rejects.toThrow('No se ha emitido ninguna: La 3 · Cliente de Prueba no tiene NIF.')
  })
  it('una sola', async () => {
    expect(await emitirPorTrozos(facturas(1), 574, 'noviembre de 2026', base().llamar)).toBe('Emitidas 1 factura de noviembre de 2026, con fecha de hoy: de la 2026/1/574 a la 2026/1/574. Todas atadas a su cobro.')
  })
})
