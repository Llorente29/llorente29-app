// G05 · nº 55 · Cambiar de cuenta desde el portal: lo puro de conta-cobro
// («cambiar_cuenta», _shared/cobro/gocardless.ts). Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { leerCancelacion, leerMandatoNuevo, mandatosACancelar } from '../../../../../../supabase/functions/_shared/cobro/gocardless'

describe('G05 · nº 55 · cambiar de cuenta', () => {
  it('se cancelan los vivos del cliente de GoCardless de antes y del de ahora, menos el nuevo', () => {
    const g = [
      { gcId: 'MD1', gcCliente: 'CU1', estado: 'active' }, { gcId: 'MD2', gcCliente: 'CU1', estado: 'cancelled' },
      { gcId: 'MD3', gcCliente: 'CU2', estado: 'pending_submission' }, { gcId: 'MDN', gcCliente: 'CU2', estado: 'active' },
      { gcId: 'MD4', gcCliente: 'CU9', estado: 'active' },
    ]
    expect(mandatosACancelar(g, 'CU1', 'CU2', 'MDN')).toEqual(['MD1', 'MD3'])
    expect(mandatosACancelar(g, null, 'CU2', 'MDN')).toEqual(['MD3'])
  })

  it('la nueva tiene que estar activa en GoCardless; si no, la vieja no se cancela', () => {
    expect(leerMandatoNuevo({ mandates: { id: 'MDN', status: 'active', links: { customer: 'CU2' } } })).toEqual({ vale: true, cliente: 'CU2' })
    expect(leerMandatoNuevo({ mandates: { id: 'MDN', status: 'pending_submission', links: { customer: 'CU2' } } }))
      .toEqual({ vale: false, porque: 'La domiciliación nueva aún no está activa en GoCardless (pending_submission): la vieja no se cancela todavía.' })
    expect(leerMandatoNuevo({ error: { message: 'not found' } })).toEqual({ vale: false, porque: 'GoCardless no ha devuelto ese mandato.' })
  })

  it('cancelar: hecho, ya cancelado (no es un fallo) o el error de GoCardless', () => {
    expect(leerCancelacion(200, { mandates: { status: 'cancelled' } })).toEqual({ cancelado: true })
    expect(leerCancelacion(422, { error: { message: 'x', errors: [{ reason: 'mandate_already_cancelled' }] } })).toEqual({ cancelado: true })
    expect(leerCancelacion(422, { error: { message: 'Mandate is consumed', errors: [{ reason: 'cancellation_failed' }] } })).toEqual({ cancelado: false, porque: 'Mandate is consumed' })
  })
})
