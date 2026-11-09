// GD · ¿La cuenta es de demostración? Lo dice accounts.is_demo (solo true; null o false, no).
import { describe, expect, it } from 'vitest'
import { esCuentaDemo } from '../../../../../src/modules/conta/cuenta/contratoCuenta'

describe('GD · esCuentaDemo', () => {
  it('solo con is_demo a true', () => {
    expect(esCuentaDemo({ is_demo: true })).toBe(true)
    expect(esCuentaDemo({ is_demo: false })).toBe(false)
    expect(esCuentaDemo({ is_demo: null })).toBe(false)
    expect(esCuentaDemo({ is_demo: 'true' })).toBe(false)
    expect(esCuentaDemo({})).toBe(false)
    expect(esCuentaDemo(null)).toBe(false)
  })
})
