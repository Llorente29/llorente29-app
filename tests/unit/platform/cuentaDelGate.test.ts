// tests/unit/platform/cuentaDelGate.test.ts
//
// DM1 · PR 1b (30/10/2026). De qué cuenta lee el gate: la abierta según la base
// para todos; la elegida en el selector para el superadministrador.

import { describe, it, expect } from 'vitest'
import { cuentaDelGate } from '@/platform/feature-gate/cuentaDelGate'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const INTERNO = '00000000-0000-0000-0000-000000000001'

describe('cuentaDelGate', () => {
  it('con una persona en dos empresas, la abierta según la base, diga lo que diga el navegador', () => {
    expect(cuentaDelGate({ esPlataforma: false, elegida: B, deLaBase: A })).toBe(A)
  })
  it('al cambiar de empresa en la base, la nueva', () => {
    expect(cuentaDelGate({ esPlataforma: false, elegida: A, deLaBase: B })).toBe(B)
  })
  it('el superadministrador, la que gestiona y no la de su perfil (Folvy Interno)', () => {
    expect(cuentaDelGate({ esPlataforma: true, elegida: A, deLaBase: INTERNO })).toBe(A)
  })
  it('el superadministrador sin ninguna elegida, la de la base', () => {
    expect(cuentaDelGate({ esPlataforma: true, elegida: null, deLaBase: INTERNO })).toBe(INTERNO)
  })
  it('sin cuenta en la base y sin ser superadministrador, ninguna', () => {
    expect(cuentaDelGate({ esPlataforma: false, elegida: A, deLaBase: null })).toBeNull()
  })
})
