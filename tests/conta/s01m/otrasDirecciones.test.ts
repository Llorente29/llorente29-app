// tests/conta/s01m/otrasDirecciones.test.ts
// S01m · Las otras direcciones que se escriben, una por línea, sin vacías ni repetidas.
import { describe, expect, it } from 'vitest'
import { direccionesDeTexto } from '@/modules/conta/services/otrasDireccionesService'

describe('S01m · otras direcciones de un local', () => {
  it('una por línea, sin vacías ni repetidas (sin mirar mayúsculas), como se escriben', () => {
    expect(direccionesDeTexto('Avenida Vieja de Prueba, 106\n\n  avenida vieja de prueba, 106 \nCalle Inventada 12')).toEqual(['Avenida Vieja de Prueba, 106', 'Calle Inventada 12'])
    expect(direccionesDeTexto('   \n')).toEqual([])
  })
})
