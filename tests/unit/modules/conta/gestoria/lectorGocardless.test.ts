// G01 · Tarea 2. El lector de GoCardless: direcciones de cada entorno, la
// cabecera de la versión, la paginación por cursor y lo que se guarda.
// Todo inventado (T11): ids de prueba, nombres de prueba, IBAN del banco 9999.
import { describe, expect, it } from 'vitest'
import {
  abonoContraTesoreria, alMesCent, cabeceras, casarMotivos, desdeHaceMeses, leerCliente, leerCobro,
  leerCuentaAbono, leerMandato, leerSuscripcion, leerTodo, urlDePagina,
} from '../../../../../supabase/functions/conta-gocardless-leer/lector'

describe('G01 · lector de GoCardless', () => {
  it('real y pruebas (sandbox) van a su dirección, con límite y cursor', () => {
    expect(urlDePagina('real', 'mandates')).toBe('https://api.gocardless.com/mandates?limit=500')
    expect(urlDePagina('pruebas', 'payments', { 'charge_date[gte]': '2026-05-01' }, 'PM000002'))
      .toBe('https://api-sandbox.gocardless.com/payments?limit=500&charge_date%5Bgte%5D=2026-05-01&after=PM000002')
  })

  it('lleva la cabecera de la versión y el token', () => {
    expect(cabeceras('token-de-prueba')).toEqual({
      Authorization: 'Bearer token-de-prueba', 'GoCardless-Version': '2015-07-06', Accept: 'application/json',
    })
  })

  it('lee todas las páginas siguiendo el cursor', async () => {
    const paginas: Record<string, unknown> = {
      inicio: { customers: [{ id: 'CU1' }, { id: 'CU2' }], meta: { cursors: { after: 'CU2' } } },
      CU2: { customers: [{ id: 'CU3' }], meta: { cursors: { after: null } } },
    }
    const pedidas: (string | null)[] = []
    const filas = await leerTodo<{ id: string }>('customers', async (d) => { pedidas.push(d); return paginas[d ?? 'inicio'] })
    expect(filas.map((f) => f.id)).toEqual(['CU1', 'CU2', 'CU3'])
    expect(pedidas).toEqual([null, 'CU2'])
  })

  it('para si GoCardless repite el cursor (no lee en bucle)', async () => {
    await expect(leerTodo('customers', async () => ({ customers: [], meta: { cursors: { after: 'X' } } })))
      .rejects.toThrow(/repite el cursor/)
  })

  it('el NIF sale de los metadatos; el nombre, de la empresa o de la persona', () => {
    expect(leerCliente({ id: 'CU1', company_name: 'CLIENTE PRUEBA UNO, S.L.', email: 'Uno@Prueba.TEST', metadata: { NIF: 'es b-00000001' } }))
      .toMatchObject({ nombre: 'CLIENTE PRUEBA UNO, S.L.', correo: 'uno@prueba.test', nif: 'B00000001' })
    expect(leerCliente({ id: 'CU2', given_name: 'Persona', family_name: 'De Prueba', metadata: {} }))
      .toMatchObject({ nombre: 'Persona De Prueba', nif: null, correo: null })
  })

  it('G04 · el siguiente cobro de una suscripción: el más próximo de upcoming_payments', () => {
    const base = { id: 'SB9', name: 'GESTORIA MENSUAL', amount: 6050, currency: 'EUR', interval_unit: 'monthly', interval: 1, status: 'active', links: { mandate: 'MD9' } }
    expect(leerSuscripcion({ ...base, upcoming_payments: [{ charge_date: '2027-01-04', amount: 6050 }, { charge_date: '2026-12-04', amount: 6050 }] }).proximoCobro)
      .toEqual({ fecha: '2026-12-04', importeCent: 6050 })
    expect(leerSuscripcion(base).proximoCobro).toBeNull()
    expect(leerSuscripcion({ ...base, upcoming_payments: [{ amount: 100 }] }).proximoCobro).toBeNull()
  })

  it('mandato, suscripción y cobro, con sus enlaces', () => {
    expect(leerMandato({ id: 'MD1', status: 'active', reference: 'REF-1', scheme: 'sepa_core', links: { customer: 'CU1', customer_bank_account: 'BA1' } }))
      .toMatchObject({ id: 'MD1', estado: 'active', clienteId: 'CU1', esquema: 'sepa_core' })
    expect(leerSuscripcion({ id: 'SB1', name: 'GESTORIA MENSUAL', amount: 9075, currency: 'EUR', interval_unit: 'monthly', interval: 1, status: 'active', links: { mandate: 'MD1' } }))
      .toMatchObject({ importeCent: 9075, intervalo: 'monthly', cada: 1, mandatoId: 'MD1' })
    expect(leerCobro({ id: 'PM1', status: 'failed', charge_date: '2026-10-05', amount: 9075, currency: 'EUR', links: { mandate: 'MD1', subscription: 'SB1' } }))
      .toMatchObject({ estado: 'failed', fecha: '2026-10-05', suscripcionId: 'SB1', motivo: null })
  })

  it('al mes: la anual entre 12, la trimestral entre 3, la semanal por 52/12', () => {
    expect(alMesCent({ importeCent: 9075, intervalo: 'monthly', cada: 1 })).toBe(9075)
    expect(alMesCent({ importeCent: 60500, intervalo: 'yearly', cada: 1 })).toBe(5042)
    expect(alMesCent({ importeCent: 3000, intervalo: 'monthly', cada: 3 })).toBe(1000)
    expect(alMesCent({ importeCent: 1200, intervalo: 'weekly', cada: 1 })).toBe(5200)
    expect(alMesCent({ importeCent: 1, intervalo: 'daily', cada: 1 })).toBeNull()
  })

  it('el motivo de cada cobro fallido sale de su último evento', () => {
    const cobros = [leerCobro({ id: 'PM1', status: 'failed' }), leerCobro({ id: 'PM2', status: 'paid_out' })]
    const eventos = [
      { resource_type: 'payments', action: 'failed', created_at: '2026-10-05T10:00:00Z', links: { payment: 'PM1' }, details: { cause: 'insufficient_funds' } },
      { resource_type: 'payments', action: 'failed', created_at: '2026-10-06T10:00:00Z', links: { payment: 'PM1' }, details: { description: 'Fondos insuficientes en la cuenta.' } },
    ]
    expect(casarMotivos(cobros, eventos).map((c) => c.motivo)).toEqual(['Fondos insuficientes en la cuenta.', null])
  })

  it('los cobros de los últimos 6 meses: desde el día 1 de hace 6 meses', () => {
    expect(desdeHaceMeses('2026-11-06', 6)).toBe('2026-05-01')
    expect(desdeHaceMeses('2026-03-15', 6)).toBe('2025-09-01')
  })

  it('el banco de abono, contra las cuentas del emisor en Sumied (solo se ve el final)', () => {
    const abono = leerCuentaAbono({ id: 'BA9', bank_name: 'BANCO DE PRUEBA', account_number_ending: '34', enabled: true })
    const tesoreria = [
      { id: 't1', nombre: 'Banco de prueba · principal', iban: 'ES00 9999 0000 0000 0000 0034' },
      { id: 't2', nombre: 'Banco de prueba · otra', iban: 'ES0099990000000000000099' },
    ]
    expect(abonoContraTesoreria(abono, tesoreria)).toEqual({ coincide: true, tesoreriaId: 't1', nombre: 'Banco de prueba · principal' })
    expect(abonoContraTesoreria({ ...abono, terminaEn: '77' }, tesoreria))
      .toEqual({ coincide: false, porque: 'GoCardless abona en una cuenta de BANCO DE PRUEBA que termina en 77, y ninguna cuenta del emisor en Sumied termina así.' })
  })
})
