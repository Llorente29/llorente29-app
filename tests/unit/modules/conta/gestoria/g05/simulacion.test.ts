// G05 · nº 71, punto 4 · Las devoluciones de punta a punta en el sandbox: la
// petición a los «scenario simulators» de GoCardless y lo que contestan
// (supabase/functions/_shared/cobro/gocardless.ts). Identificadores inventados.
import { describe, expect, it } from 'vitest'
import { SIMULACIONES, leerSimulacion, peticionDeSimulacion } from '../../../../../../supabase/functions/_shared/cobro/gocardless'

describe('G05 · nº 71 · simular en el sandbox lo que haría el banco', () => {
  it('cada simulación, con su escenario de GoCardless y el cobro del recibo', () => {
    expect(Object.fromEntries(Object.entries(SIMULACIONES).map(([k, v]) => [k, v.gc]))).toEqual({
      sin_fondos: 'payment_failed', reclamado: 'payment_charged_back', tarde: 'payment_late_failure', cobrado: 'payment_paid_out',
    })
    expect(peticionDeSimulacion('sin_fondos', 'PM000PRUEBA952')).toEqual({
      ruta: '/scenario_simulators/payment_failed/actions/run', cuerpo: { data: { links: { resource: 'PM000PRUEBA952' } } },
    })
  })
  it('lo que no es una simulación o no tiene cobro, no se pide', () => {
    expect(peticionDeSimulacion('mandate_cancelled', 'PM000PRUEBA952')).toEqual({ porque: 'Eso no se simula: sin_fondos, reclamado, tarde, cobrado.' })
    expect(peticionDeSimulacion('sin_fondos', '')).toEqual({ porque: 'Ese recibo no tiene un cobro de GoCardless.' })
    expect(peticionDeSimulacion('sin_fondos', 'PM../../mandates')).toEqual({ porque: 'Ese recibo no tiene un cobro de GoCardless.' })
  })
  it('lo que contesta GoCardless, en palabras de oficina', () => {
    expect(leerSimulacion(200, { scenario_simulators: { id: 'payment_failed' } }, 'sin_fondos')).toEqual({ hecho: true,
      frase: 'Simulado en el sandbox: devuelto por el banco antes de cobrarse (sin fondos). GoCardless lo procesa en unos segundos; pulsa «Leer GoCardless» para verlo en Sumied.' })
    expect(leerSimulacion(422, { error: { errors: [{ message: 'Payment must be pending_submission' }] } }, 'reclamado'))
      .toEqual({ hecho: false, frase: 'GoCardless no lo ha simulado: Payment must be pending_submission.' })
  })
})
