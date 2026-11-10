// G05 · nº 77, punto 2 · El motivo de un cobro devuelto en palabras de oficina
// (supabase/functions/conta-gocardless-leer/motivo.ts). Las descripciones son las
// que dio GoCardless de verdad (medidas en producción el 10/11, solo los textos,
// sin datos de nadie): regla 31, la población real.
import { describe, expect, it } from 'vitest'
import { motivoEnPalabras } from '../../../../../../supabase/functions/conta-gocardless-leer/motivo'
import { casarMotivos, type CobroGc } from '../../../../../../supabase/functions/conta-gocardless-leer/lector'

describe('G05 · nº 77 · el motivo del devuelto', () => {
  it('por su código, lo primero', () => {
    expect(motivoEnPalabras('insufficient_funds', 'whatever')).toBe('Sin saldo en la cuenta')
    expect(motivoEnPalabras('authorisation_disputed', null)).toBe('El cliente lo reclamó a su banco: dice que no lo autorizó')
  })
  it('sin código, por las descripciones que da GoCardless', () => {
    const reales: [string, string][] = [
      ["The customer's account had insufficient funds to make this payment.", 'Sin saldo en la cuenta'],
      ['The payment failed but the reason for the failure was not provided, usually for regulatory reasons.', 'El banco lo ha devuelto sin decir por qué'],
      ["This payment was charged back by the customer's bank, because the customer disputed authorising the transaction.", 'El cliente lo reclamó a su banco: dice que no lo autorizó'],
      ["This payment was charged back by the customer's bank at the customer's request within the 8 week cool-off period.", 'El cliente lo reclamó a su banco (en las 8 semanas que tiene para hacerlo)'],
      ['This payment was cancelled at your request.', 'Cancelado antes de cobrarse'],
      ["This payment failed because the payer's account was blocked.", 'La cuenta está bloqueada'],
      ['The bank account for this payment has been closed. The mandate will also be cancelled.', 'La cuenta está cerrada'],
      ['The customer cancelled their mandate at their bank.', 'El cliente canceló la domiciliación en su banco'],
    ]
    for (const [en, es] of reales) expect(motivoEnPalabras(null, en)).toBe(es)
  })
  it('lo que no se conoce no sale en inglés; sin nada, nada', () => {
    expect(motivoEnPalabras('algo_nuevo', 'Something new happened.')).toBe('El banco lo ha devuelto')
    expect(motivoEnPalabras(null, null)).toBeNull()
  })
  it('la lectura lo deja en el cobro, con su código, del último evento', () => {
    const c = { id: 'PM_PRUEBA', estado: 'failed', fecha: null, importeCent: 100, moneda: 'EUR', mandatoId: null, suscripcionId: null, payoutId: null, motivo: null } as CobroGc
    const [r] = casarMotivos([c], [
      { resource_type: 'payments', action: 'failed', created_at: '2026-11-10T08:00:00Z', links: { payment: 'PM_PRUEBA' }, details: { cause: 'refer_to_payer', description: 'x' } },
      { resource_type: 'payments', action: 'failed', created_at: '2026-11-10T09:00:00Z', links: { payment: 'PM_PRUEBA' }, details: { cause: 'insufficient_funds', description: "The customer's account had insufficient funds to make this payment." } },
    ])
    expect([r.causa, r.motivoEs, r.motivo]).toEqual(['insufficient_funds', 'Sin saldo en la cuenta', "The customer's account had insufficient funds to make this payment."])
  })
})
