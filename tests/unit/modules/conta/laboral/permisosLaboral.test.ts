// tests/unit/modules/conta/laboral/permisosLaboral.test.ts
//
// N1 · PR 2 (02/11/2026) · La lista de quién tiene el permiso de Laboral en
// Equipo: el nombre, el permiso en palabras y quién se lo dio y cuándo. Los
// papeles son los que hay en user_profiles («admin» y «worker»); las personas,
// inventadas.

import { describe, expect, it } from 'vitest'
import { filasDePermiso, QUE_VE, type Perfil } from '../../../../../src/modules/conta/laboral/permisos/permisosLaboral'

const perfil = (user_id: string, role: string, employee_id: string | null, display_name: string | null = null, active = true): Perfil =>
  ({ user_id, role, employee_id, display_name, active })
const empleados = new Map([['e1', 'Persona Inventada Uno'], ['e2', 'Persona Inventada Dos'], ['e3', 'Persona Inventada Tres']])
const nombre = (id: string) => empleados.get(id)

describe('quién tiene el permiso de Laboral', () => {
  const perfiles = [
    perfil('u-admin', 'admin', 'e1'),
    perfil('u-dos', 'worker', 'e2'),
    perfil('u-tres', 'worker', null, 'Gestoría Inventada'),
    perfil('u-baja', 'admin', 'e3', null, false),
  ]

  it('los administradores primero, que lo tienen siempre; después a quien se lo dieron, con quién y cuándo (hora de Madrid)', () => {
    const f = filasDePermiso(perfiles, [
      { user_id: 'u-tres', dado_por: 'u-admin', dado_at: '2026-11-02T08:05:00Z' },
      { user_id: 'u-dos', dado_por: 'u-admin', dado_at: '2026-11-01T22:30:00Z' },
    ], nombre)
    expect(f.map((x) => [x.nombre, x.origen])).toEqual([
      ['Persona Inventada Uno', 'Lo tiene siempre, por ser administrador de la cuenta'],
      ['Gestoría Inventada', 'Se lo dio Persona Inventada Uno el 02/11/2026 a las 09:05'],
      ['Persona Inventada Dos', 'Se lo dio Persona Inventada Uno el 01/11/2026 a las 23:30'],
    ])
    expect(f.every((x) => x.permiso === QUE_VE)).toBe(true)
  })

  it('un administrador de baja no sale; uno que además tiene el permiso dado sale una vez', () => {
    const f = filasDePermiso(perfiles, [{ user_id: 'u-admin', dado_por: 'u-admin', dado_at: '2026-11-02T08:05:00Z' }], nombre)
    expect(f.map((x) => x.userId)).toEqual(['u-admin'])
  })

  it('lo que no se sabe se dice, no se inventa', () => {
    const f = filasDePermiso(perfiles, [{ user_id: 'u-fuera', dado_por: null, dado_at: '2026-11-02T08:05:00Z' }], nombre)
    expect(f[1]).toMatchObject({ nombre: 'Alguien que ya no está en la cuenta', origen: 'Se lo dio alguien que no consta el 02/11/2026 a las 09:05' })
  })
})
