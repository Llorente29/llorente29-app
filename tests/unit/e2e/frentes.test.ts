// tests/unit/e2e/frentes.test.ts
//
// Usuarios de prueba por frente (C06, respuesta 2): el ayudante de sesión de
// las e2e traduce los cuatro correos de siempre a los del frente. Los correos
// son los de verdad de las semillas (seed_c01_staging, seed_c00_encargado_prueba,
// seed_c00_cuenta_c_sin_empresa) y los que crea seed_e2e_frentes_staging.sql.

import { describe, it, expect } from 'vitest'
import { correoDelFrente, frenteDe } from '../../e2e/conta/sesion'

const DE_SIEMPRE = ['a.admin@prueba.folvy.test', 'b.admin@prueba.folvy.test', 'a.encargado@prueba.folvy.test', 'c.admin@prueba.folvy.test']

describe('usuarios de prueba por frente', () => {
  it('sin frente, los de siempre, sin tocar', () => {
    for (const c of DE_SIEMPRE) expect(correoDelFrente(c, null)).toBe(c)
  })

  it('con frente, los que crea la semilla (parte local + .frente-<f>)', () => {
    expect(DE_SIEMPRE.map((c) => correoDelFrente(c, 'b'))).toEqual([
      'a.admin.frente-b@prueba.folvy.test', 'b.admin.frente-b@prueba.folvy.test',
      'a.encargado.frente-b@prueba.folvy.test', 'c.admin.frente-b@prueba.folvy.test',
    ])
  })

  it('el frente: a, b, c o nada; cualquier otra cosa es un error, no los de siempre', () => {
    expect(frenteDe(undefined)).toBeNull()
    expect(frenteDe('')).toBeNull()
    expect(frenteDe(' C ')).toBe('c')
    expect(() => frenteDe('d')).toThrow(/a, b, c o nada/)
  })
})
