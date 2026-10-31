// tests/unit/multitenancy/cambiarDeEmpresaEnElAlta.test.ts
//
// DM1 (31/10/2026) · El alta no encierra: cuándo lleva «Cambiar de empresa».

import { describe, it, expect } from 'vitest'
import { saleCambiarDeEmpresa } from '@/modules/conta/lib/cambiarDeEmpresa'

describe('saleCambiarDeEmpresa', () => {
  it('con más de una empresa, sale', () => { expect(saleCambiarDeEmpresa(2, false)).toBe(true) })
  it('el superadministrador, siempre', () => { expect(saleCambiarDeEmpresa(1, true)).toBe(true); expect(saleCambiarDeEmpresa(0, true)).toBe(true) })
  it('con una sola y sin ser superadministrador, no: no hay adónde ir', () => { expect(saleCambiarDeEmpresa(1, false)).toBe(false) })
})
