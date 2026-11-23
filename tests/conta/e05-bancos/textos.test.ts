// tests/conta/e05-bancos/textos.test.ts
//
// E05 · Lo que dice «Deshacer» y la línea de estado de los bancos. Datos inventados.
// X28: «Confirmar los N» y «Escribir uno a mano» se fueron con la pantalla de E05 y R08 (el ⊕ otro movimiento de
// Tesorería lo prueba tests/conta/x28-tesoreria).
import { describe, expect, it, vi } from 'vitest'

const bd = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/modules/conta/services/bd', () => ({ rpc: bd.rpc }))
vi.mock('@/modules/conta/services/bancosService', () => ({ bancos: {} }))

import { textoDeshecho } from '@/modules/conta/nucleo/bancos/conciliar'
import { frasesDeEstado } from '@/modules/conta/nucleo/estado'

describe('E05 · «Deshacer» dice lo que ha hecho la base con el asiento', () => {
  it('con la frase de bank_deshacer', () => {
    expect(textoDeshecho('Agua Ejemplo', 'su asiento propuesto se quita')).toBe('Deshecho: el movimiento de Agua Ejemplo vuelve a estar por conciliar, y su asiento propuesto se quita.')
    expect(textoDeshecho('Comisión', 'el asiento enlazado se queda como estaba')).toBe('Deshecho: el movimiento de Comisión vuelve a estar por conciliar, y el asiento enlazado se queda como estaba.')
  })
})

describe('E05 · «Bancos cuadrados» en la línea de estado', () => {
  const rutas = { recibidas: '/r', bancos: '/b', asientos: '/a' }
  const de = (x: { cuadran: number; de: number } | null) => frasesDeEstado({}, rutas, x).find((f) => f.id === 'cuadrados') ?? null
  it('todos cuadran: en verde', () => expect(de({ cuadran: 2, de: 2 })).toMatchObject({ tono: 'bien', fuerte: 'Bancos cuadrados', resto: 'con su extracto' }))
  it('alguno no: cuántos, en ámbar', () => {
    expect(de({ cuadran: 1, de: 3 })).toMatchObject({ tono: 'mira', fuerte: '2 de 3 bancos', resto: 'no cuadran con su extracto' })
    expect(de({ cuadran: 1, de: 2 })).toMatchObject({ tono: 'mira', fuerte: '1 de 2 bancos', resto: 'no cuadra con su extracto' })
    expect(de({ cuadran: 0, de: 1 })).toMatchObject({ tono: 'mira', fuerte: 'El banco', resto: 'no cuadra con su extracto' })
  })
  it('sin contar, o sin ningún banco con extracto: no sale (no se pinta lo que no se sabe)', () => {
    expect(de(null)).toBeNull()
    expect(de({ cuadran: 0, de: 0 })).toBeNull()
  })
})
