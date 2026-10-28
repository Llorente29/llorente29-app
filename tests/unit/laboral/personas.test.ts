// W08 (28/10). Registro de jornada abría con la primera persona por nombre, y en
// producción era una de baja. Abre con la primera activa; las de baja, al final.
import { describe, it, expect } from 'vitest'
import { ordenarPersonas, personaPorDefecto } from '../../../src/modules/personal/laboral/personas'

const p = (id: string, name: string, active: boolean) => ({ id, name, active })

describe('las personas de Registro de jornada', () => {
  // Como en producción: la primera por nombre está de baja.
  const lista = [p('m', 'Marcos', true), p('f', 'Fabiola', false), p('a', 'Ana', true), p('b', 'Beatriz', false), p('c', 'Carlos', true)]

  it('abre con la primera activa, no con la primera por nombre', () => {
    expect(personaPorDefecto(lista)).toBe('a')
    expect(personaPorDefecto([p('f', 'Fabiola', false), p('z', 'Zoe', true)])).toBe('z')
  })

  it('las activas por nombre, y las de baja al final, también por nombre', () => {
    expect(ordenarPersonas(lista).map((x) => x.id)).toEqual(['a', 'c', 'm', 'b', 'f'])
  })

  it('con acentos, como el resto de Folvy; sin nadie activo, la primera; sin nadie, vacío', () => {
    expect(ordenarPersonas([p('2', 'Óscar', true), p('1', 'Olga', true)]).map((x) => x.id)).toEqual(['1', '2'])
    expect(personaPorDefecto([p('f', 'Fabiola', false)])).toBe('f')
    expect(personaPorDefecto([])).toBe('')
  })
})
