// G05 · Tarea 2 · El cobro de un recibo en GoCardless, sin red
// (supabase/functions/_shared/cobro/gocardless.ts). Respuestas con la forma de
// la documentación de GoCardless (09/11); identificadores inventados.
import { describe, expect, it } from 'vitest'
import {
  ESTADO_EN_PALABRAS, VERSION_GOCARDLESS, estadoDelRecibo, fraseDelCambio, leerRespuestaDeCobro, mandatoParaCobrar, peticionDeCobro, tocaDeshacerElCobro, tocaFacturar,
} from '../../../../../../supabase/functions/_shared/cobro/gocardless'
import type { Recibo } from '../../../../../../supabase/functions/_shared/cobro/recibo'

const recibo = (o: Partial<Recibo> = {}): Recibo => ({
  clave: 'recibo:empresa-1:cliente-1:2026-12', clienteId: 'cliente-1', empresaId: 'empresa-1', mes: '2026-12', lineas: [], totalCent: 14520,
  anteriorCent: 14520, cambios: [], igualQueElMesPasado: true, pideClic: null, parado: [], ...o,
})

describe('G05 · el cobro en GoCardless', () => {
  it('la petición: POST /payments en céntimos, con el mandato, la fecha de cargo y la clave del recibo para no repetir', () => {
    const p = peticionDeCobro(recibo(), 14520, 'MD000PRUEBA1', '2026-12-04', 'Gestoría')
    expect(p).toEqual({
      metodo: 'POST', ruta: '/payments',
      cabeceras: { 'Idempotency-Key': 'recibo:empresa-1:cliente-1:2026-12', 'GoCardless-Version': VERSION_GOCARDLESS },
      cuerpo: { payments: { amount: 14520, currency: 'EUR', charge_date: '2026-12-04', description: 'Gestoría · diciembre de 2026',
        metadata: { recibo: 'recibo:empresa-1:cliente-1:2026-12' }, links: { mandate: 'MD000PRUEBA1' } } },
    })
    expect(peticionDeCobro(recibo(), 14520, 'MD000PRUEBA1', null, 'Gestoría').cuerpo.payments).not.toHaveProperty('charge_date')
  })
  it('mejor no mandar que mandar mal: parado, a cero, sin mandato válido, otra cifra o fecha mal escrita', () => {
    expect(() => peticionDeCobro(recibo({ parado: ['Una línea sin precio: Gestión laboral'] }), 14520, 'MD000PRUEBA1', null, 'X')).toThrow('Una línea sin precio')
    expect(() => peticionDeCobro(recibo(), 0, 'MD000PRUEBA1', null, 'X')).toThrow('mayor que cero')
    expect(() => peticionDeCobro(recibo(), 145.2, 'MD000PRUEBA1', null, 'X')).toThrow('céntimos')
    expect(() => peticionDeCobro(recibo(), 14520, 'mandato', null, 'X')).toThrow('mandato')
    expect(() => peticionDeCobro(recibo(), 20000, 'MD000PRUEBA1', null, 'X')).toThrow('no es el del recibo')
    expect(() => peticionDeCobro(recibo(), 14520, 'MD000PRUEBA1', '04/12/2026', 'X')).toThrow('AAAA-MM-DD')
  })
  it('el mandato: cobra con activo, por firmar o en curso; no con cancelado, fallido o caducado', () => {
    expect(['active', 'pending_customer_approval', 'pending_submission', 'submitted'].map((x) => mandatoParaCobrar(x).vale)).toEqual([true, true, true, true])
    expect(mandatoParaCobrar('cancelled')).toEqual({ vale: false, porque: 'El mandato SEPA está cancelado: no se le puede cobrar' })
    expect(mandatoParaCobrar(null)).toEqual({ vale: false, porque: 'Sin mandato SEPA en GoCardless: no se le puede cobrar' })
  })
  it('lo que contesta GoCardless, en palabras de oficina', () => {
    expect(leerRespuestaDeCobro(201, { payments: { id: 'PM000PRUEBA1', status: 'pending_submission', charge_date: '2026-12-04' } }))
      .toEqual({ tipo: 'creado', cobroId: 'PM000PRUEBA1', estado: 'pending_submission', cargoEl: '2026-12-04' })
    // La misma clave otra vez: ya lo había creado; nunca un segundo cobro.
    expect(leerRespuestaDeCobro(409, { error: { type: 'invalid_state', errors: [{ reason: 'idempotent_creation_conflict', links: { conflicting_resource_id: 'PM000PRUEBA1' } }] } }))
      .toEqual({ tipo: 'ya_estaba', cobroId: 'PM000PRUEBA1' })
    expect(leerRespuestaDeCobro(403, { error: { type: 'invalid_api_usage', errors: [{ reason: 'insufficient_permissions' }] } }).tipo).toBe('solo_lectura')
    expect(leerRespuestaDeCobro(422, { error: { type: 'invalid_state', errors: [{ reason: 'mandate_is_inactive' }] } }).tipo).toBe('sin_mandato')
    expect(leerRespuestaDeCobro(500, { error: { type: 'gocardless', errors: [{ reason: 'internal_server_error' }] } }).tipo).toBe('reintentar')
    expect(leerRespuestaDeCobro(429, {}).tipo).toBe('reintentar')
    expect(leerRespuestaDeCobro(422, { error: { type: 'validation_failed', errors: [{ field: 'charge_date', message: 'must be on or after mandate\'s next_possible_charge_date' }] } }))
      .toEqual({ tipo: 'rechazado', frase: 'GoCardless no ha aceptado el cobro: charge_date: must be on or after mandate\'s next_possible_charge_date.' })
  })
  it('el estado del recibo y cuándo toca facturar: solo con el cobro confirmado', () => {
    expect([null, 'pending_submission', 'submitted', 'confirmed', 'paid_out', 'failed', 'charged_back', 'cancelled'].map((x) => estadoDelRecibo(x, false)))
      .toEqual(['preparado', 'enviado', 'en_el_banco', 'cobrado', 'cobrado', 'devuelto', 'retrocedido', 'cancelado'])
    expect(estadoDelRecibo('paid_out', true)).toBe('facturado')
    expect([tocaFacturar('submitted', false), tocaFacturar('confirmed', false), tocaFacturar('paid_out', true), tocaFacturar('failed', false)]).toEqual([false, true, false, false])
    expect([ESTADO_EN_PALABRAS.en_el_banco.texto, ESTADO_EN_PALABRAS.devuelto, ESTADO_EN_PALABRAS.retrocedido.texto]).toEqual(['En el banco', { texto: 'Devuelto', tono: 'mal' }, 'Retrocedido'])
    // Se deshace el cobro solo si ya estaba contabilizado: un devuelto antes de confirmarse no tenía asiento.
    expect([tocaDeshacerElCobro('charged_back', true), tocaDeshacerElCobro('failed', true), tocaDeshacerElCobro('failed', false), tocaDeshacerElCobro('paid_out', true)]).toEqual([true, true, false, false])
  })
  it('las frases del historial, sin palabras en inglés', () => {
    const x = { totalCent: 14520, mes: '2026-12' }
    expect(fraseDelCambio(x, 'devuelto')).toBe('Recibo de 145,20 € de diciembre de 2026 devuelto sin fondos: pasa a «Te deben» y no tiene factura.')
    expect(fraseDelCambio(x, 'retrocedido', true)).toBe('Recibo de 145,20 € de diciembre de 2026 retrocedido: el cliente lo reclamó a su banco. Se deshace el cobro y pasa a «Te deben»; la factura se queda.')
    expect(fraseDelCambio(x, 'devuelto', true)).toBe('Recibo de 145,20 € de diciembre de 2026 devuelto después de cobrarse: se deshace el cobro y pasa a «Te deben»; la factura se queda.')
    const todas = (['preparado', 'enviado', 'en_el_banco', 'cobrado', 'devuelto', 'retrocedido', 'cancelado', 'facturado'] as const).map((e) => fraseDelCambio(x, e)).join(' ')
    expect(todas).not.toMatch(/payment|payout|charge|idempot/i)
  })
})
