// G05 · nº 71 · «Que lo pasen de nuevo»: la petición y lo que contesta GoCardless
// (supabase/functions/_shared/cobro/gocardless.ts). Respuestas con la forma de la
// documentación de GoCardless (payments: retry); identificadores inventados.
import { describe, expect, it } from 'vitest'
import { leerReintento, peticionDeReintento } from '../../../../../../supabase/functions/_shared/cobro/gocardless'

describe('G05 · nº 71 · volver a pasar un recibo devuelto', () => {
  it('la petición solo lleva el motivo (recortado a lo que deja GoCardless)', () => {
    expect(peticionDeReintento('gestoria: Persona Prueba')).toEqual({ data: { metadata: { motivo: 'gestoria: Persona Prueba' } } })
    expect(peticionDeReintento('x'.repeat(600)).data.metadata.motivo).toHaveLength(500)
  })
  it('200 con el cobro: pasado, con su estado y su día de cargo', () => {
    expect(leerReintento(200, { payments: { id: 'PM000PRUEBA', status: 'pending_submission', charge_date: '2026-11-14' } }))
      .toEqual({ tipo: 'pasado', estado: 'pending_submission', cargoEl: '2026-11-14' })
  })
  it('con el mandato cancelado, lo dice y propone el enlace', () => {
    const r = leerReintento(422, { error: { type: 'invalid_state', errors: [{ reason: 'mandate_is_inactive', message: 'The mandate is not active' }] } })
    expect(r).toEqual({ tipo: 'no', frase: 'El mandato SEPA ya no está activo en GoCardless: no se puede volver a pasar. Mándale el enlace para pagar.' })
  })
  it('un cobro que ya no está devuelto: el mensaje de GoCardless, sin inventar', () => {
    const r = leerReintento(422, { error: { type: 'invalid_state', errors: [{ reason: 'invalid_state', message: 'Only failed payments can be retried' }] } })
    expect(r).toEqual({ tipo: 'no', frase: 'GoCardless no lo ha vuelto a pasar: Only failed payments can be retried.' })
  })
  it('solo lectura, o GoCardless caído: no se ha pasado, y se dice', () => {
    expect(leerReintento(403, { error: { errors: [{ reason: 'insufficient_permissions' }] } }).tipo).toBe('no')
    expect(leerReintento(503, null)).toEqual({ tipo: 'no', frase: 'GoCardless no ha contestado bien: no se ha vuelto a pasar. Inténtalo dentro de un rato.' })
  })
})
