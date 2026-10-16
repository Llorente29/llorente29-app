// tests/unit/modules/reparto/instruccionesCatcher.test.ts
//
// R03 · El código de Uber, al principio de orderInstructions de Catcher.
import { describe, expect, it } from 'vitest'
import { instruccionesParaCatcher } from '../../../../supabase/functions/catcher-dispatch/instrucciones'

describe('instruccionesParaCatcher', () => {
  it('con código: «Tel. centralita <tel> + código <código>» delante de la nota', () => {
    expect(instruccionesParaCatcher('Llamar al timbre', '+34900000000', '12345678'))
      .toBe('Tel. centralita +34900000000 + código 12345678 · Llamar al timbre')
  })
  it('con código y sin nota', () => {
    expect(instruccionesParaCatcher(null, '+34900000000', '12345678')).toBe('Tel. centralita +34900000000 + código 12345678')
  })
  it('sin código: la nota como hoy', () => {
    expect(instruccionesParaCatcher('Llamar al timbre', '600000000', null)).toBe('Llamar al timbre')
    expect(instruccionesParaCatcher(null, null, '  ')).toBe('')
  })
})
