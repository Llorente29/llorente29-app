// S01d · «Validar y siguiente»: solo hacia delante, y la tarjeta de fin de cuenta (tablero 4).
import { describe, expect, it } from 'vitest'
import { finDeCuenta, nombreConCuenta, siguienteTras } from '@/modules/conta/lib/validarBanco'

describe('validar y siguiente', () => {
  it('pasa al siguiente de la misma lista; al acabar, a ninguno (nunca al anterior ni a otro banco)', () => {
    expect(siguienteTras(['a', 'b', 'c'], 'a')).toBe('b')
    expect(siguienteTras(['a', 'b', 'c'], 'c')).toBeNull()
  })
  it('el nombre con las cuatro últimas de la cuenta', () => {
    expect(nombreConCuenta({ nombre: 'Banco de prueba', iban: 'ES00 0000 0000 0000 0000 6536' })).toBe('Banco de prueba ·6536')
    expect(nombreConCuenta({ nombre: 'Caja', iban: null })).toBe('Caja')
  })
  it('la tarjeta del tablero 4: lo validado, lo que queda y con cuál seguir', () => {
    const f = finDeCuenta('Banco ·6536', [3312, 3310, 3311, 3313, 3314, 3315, 3316, 3317, 3318],
      [{ id: 'x', nombre: 'Banco ·0133', n: 3 }, { id: 'y', nombre: 'Banco ·4525', n: 12 }, { id: 'z', nombre: 'Caja', n: 0 }])
    expect(f).toEqual({
      titulo: 'Has terminado Banco ·6536', chip: 'Banco ·6536 al día',
      texto: 'Validados 9 movimientos (asientos 3310 a 3318). Quedan 12 por validar en Banco ·4525 y 3 en Banco ·0133.',
      seguir: { id: 'y', nombre: 'Banco ·4525' },
    })
  })
  it('sin nada en los demás bancos, lo dice y no ofrece seguir', () => {
    expect(finDeCuenta('Banco ·6536', [7], [])).toMatchObject({ texto: 'Validado 1 movimiento (asiento 7). No queda nada por validar en ningún banco.', seguir: null })
  })
})
