// G05 · nº 76 · Solo las liquidaciones de GoCardless de los clientes de ahora
// (supabase/functions/conta-gocardless-leer/liquidaciones.ts). Los cuatro casos
// que se midieron en la Gestoría Demo el 10/11, con identificadores inventados.
import { describe, expect, it } from 'vitest'
import { leerCuentaGc } from '../../../../../../supabase/functions/conta-gocardless-leer/lectura'
import { liquidacionesDeClientes, pagosDePartidas } from '../../../../../../supabase/functions/conta-gocardless-leer/liquidaciones'
import type { ClienteGc, CobroGc, MandatoGc, PayoutGc } from '../../../../../../supabase/functions/conta-gocardless-leer/lector'

const po = (id: string, cent: number): PayoutGc => ({ id, estado: 'paid', llegada: '2026-11-10', importeCent: cent, comisionCent: null, moneda: 'EUR', referencia: null })
const pago = (id: string, mandatoId: string | null, payoutId: string | null) => ({ id, mandatoId, payoutId, suscripcionId: null } as unknown as CobroGc)
const mandato = (id: string, clienteId: string | null) => ({ id, clienteId } as unknown as MandatoGc)
const cliente = (id: string) => ({ id } as unknown as ClienteGc)

// Hoy en la cuenta: dos clientes (el de un recibo y el de la última siembra).
const clientes = [cliente('CU_RECIBO'), cliente('CU_SIEMBRA_HOY')]
const mandatos = [mandato('MD_RECIBO', 'CU_RECIBO'), mandato('MD_SIEMBRA_HOY', 'CU_SIEMBRA_HOY'), mandato('MD_VIEJO', 'CU_BORRADO')]
const payouts = [po('PO_RECIBO', 14228), po('PO_SIEMBRA_HOY', 5896), po('PO_VIEJO', 5896), po('PO_SIN_PAGOS', 7868), po('PO_RECLAMADO', 14277)]
const cobros = [pago('PM_RECIBO', 'MD_RECIBO', 'PO_RECIBO'), pago('PM_SIEMBRA_HOY', 'MD_SIEMBRA_HOY', 'PO_SIEMBRA_HOY'), pago('PM_VIEJO', 'MD_VIEJO', 'PO_VIEJO'),
  // El reclamado sí se leyó, pero sin su liquidación: la dicen sus partidas.
  pago('PM_RECLAMADO', 'MD_RECIBO', null)]

describe('G05 · nº 76 · las liquidaciones que entran', () => {
  it('entran las de los clientes de ahora (también el de la última siembra y el pago reclamado); fuera las de clientes borrados y las que no son de nadie', () => {
    const partidas = new Map([['PO_SIN_PAGOS', ['PM_BORRADO']], ['PO_RECLAMADO', ['PM_RECLAMADO']]])
    const mandatoDePago = new Map<string, string | null>([['PM_BORRADO', 'MD_VIEJO']])
    const r = liquidacionesDeClientes({ payouts, cobros, mandatos, clientes }, partidas, mandatoDePago)
    expect(r.quedan.map((x) => x.id)).toEqual(['PO_RECIBO', 'PO_SIEMBRA_HOY', 'PO_RECLAMADO'])
    expect(r.fuera).toEqual([
      { id: 'PO_VIEJO', porque: 'sus pagos son de clientes que ya no están en GoCardless' },
      { id: 'PO_SIN_PAGOS', porque: 'sus pagos son de clientes que ya no están en GoCardless' },
    ])
  })
  it('una liquidación de la que no se sabe ningún pago no entra', () => {
    const r = liquidacionesDeClientes({ payouts: [po('PO_X', 100)], cobros: [], mandatos, clientes }, new Map([['PO_X', []]]), new Map())
    expect(r.fuera).toEqual([{ id: 'PO_X', porque: 'no se sabe de qué pagos es' }])
  })
  it('basta un pago de un cliente de ahora para que entre la liquidación entera', () => {
    const r = liquidacionesDeClientes({ payouts: [po('PO_MIXTA', 100)], cobros: [pago('PM_A', 'MD_VIEJO', 'PO_MIXTA'), pago('PM_B', 'MD_RECIBO', 'PO_MIXTA')], mandatos, clientes }, new Map(), new Map())
    expect(r.quedan.map((x) => x.id)).toEqual(['PO_MIXTA'])
  })
  it('las partidas: los pagos que nombran, una vez cada uno', () => {
    expect(pagosDePartidas([{ type: 'payment_paid_out', links: { payment: 'PM_1' } }, { type: 'gocardless_fee', links: { payment: 'PM_1' } }, { type: 'refund', links: {} }]))
      .toEqual(['PM_1'])
  })
})

describe('G05 · nº 76 · la lectura entera', () => {
  // Una cuenta del sandbox inventada: un cliente de ahora con su cobro liquidado, y una liquidación de la siembra
  // anterior que ningún cobro leído nombra (su cliente ya no está): la lectura pide sus partidas y su pago.
  const respuestas: Record<string, unknown> = {
    customers: { customers: [{ id: 'CU_AHORA', given_name: 'Cliente', family_name: 'Prueba' }] },
    mandates: { mandates: [{ id: 'MD_AHORA', status: 'active', links: { customer: 'CU_AHORA' } }, { id: 'MD_VIEJO', status: 'cancelled', links: { customer: 'CU_BORRADO' } }] },
    subscriptions: { subscriptions: [] },
    payments: { payments: [{ id: 'PM_AHORA', status: 'paid_out', amount: 14520, currency: 'EUR', charge_date: '2026-11-10', links: { mandate: 'MD_AHORA', payout: 'PO_AHORA' } }] },
    events: { events: [] }, creditor_bank_accounts: { creditor_bank_accounts: [] }, customer_bank_accounts: { customer_bank_accounts: [] },
    payouts: { payouts: [{ id: 'PO_AHORA', status: 'paid', amount: 14228, currency: 'EUR', arrival_date: '2026-11-12' }, { id: 'PO_VIEJO', status: 'paid', amount: 7868, currency: 'EUR', arrival_date: '2026-11-10' }] },
    payout_items: { payout_items: [{ type: 'payment_paid_out', amount: '80.00', links: { payment: 'PM_VIEJO' } }] },
    'payments/PM_VIEJO': { payments: { id: 'PM_VIEJO', links: { mandate: 'MD_VIEJO' } } },
  }
  const pedidas: string[] = []
  const pedir = async (url: string) => {
    pedidas.push(url)
    const ruta = new URL(url).pathname.slice(1)
    const cuerpo = respuestas[ruta]
    return { ok: cuerpo !== undefined, status: cuerpo === undefined ? 404 : 200, json: async () => cuerpo ?? { error: { message: 'no' } } }
  }
  it('guarda la liquidación del cliente de ahora y deja fuera la de la siembra anterior, después de mirar sus partidas', async () => {
    const d = await leerCuentaGc(pedir, 'pruebas', 'token', '2026-11-10')
    expect(d.payouts.map((x) => x.id)).toEqual(['PO_AHORA'])
    expect(d.payoutsFuera).toEqual([{ id: 'PO_VIEJO', porque: 'sus pagos son de clientes que ya no están en GoCardless' }])
    expect(pedidas.some((u) => u.includes('/payout_items') && u.includes('payout=PO_VIEJO'))).toBe(true)
    expect(pedidas.filter((u) => u.includes('/payout_items'))).toHaveLength(1)
  })
  it('si GoCardless no da las partidas, la liquidación entra como antes (no hay con qué decir que no es de nadie)', async () => {
    const sin = { ...respuestas }; delete sin.payout_items
    const d = await leerCuentaGc(async (url) => { const c = sin[new URL(url).pathname.slice(1)]; return { ok: c !== undefined, status: c ? 200 : 500, json: async () => c ?? {} } }, 'pruebas', 'token', '2026-11-10')
    expect(d.payouts.map((x) => x.id)).toEqual(['PO_AHORA', 'PO_VIEJO'])
    expect(d.payoutsFuera).toEqual([])
  })
})

describe('G05 · nº 79 · el cobro liquidado y después reclamado sabe su liquidación', () => {
  it('si llega sin liquidación (links.payout) pero una liquidación lo lleva en sus partidas, se la pone; la liquidación entra', async () => {
    const respuestas: Record<string, unknown> = {
      customers: { customers: [{ id: 'CU_AHORA' }] },
      mandates: { mandates: [{ id: 'MD_AHORA', status: 'active', links: { customer: 'CU_AHORA' } }] },
      subscriptions: { subscriptions: [] },
      payments: { payments: [{ id: 'PM_RECLAMADO', status: 'charged_back', amount: 14500, currency: 'EUR', charge_date: '2026-11-12', links: { mandate: 'MD_AHORA' } }] },
      events: { events: [] }, creditor_bank_accounts: { creditor_bank_accounts: [] }, customer_bank_accounts: { customer_bank_accounts: [] },
      payouts: { payouts: [{ id: 'PO_RECLAMADO', status: 'paid', amount: 14277, currency: 'EUR', arrival_date: '2026-11-10' }] },
      payout_items: { payout_items: [{ type: 'payment_paid_out', amount: '145.00', links: { payment: 'PM_RECLAMADO' } }, { type: 'gocardless_fee', amount: '-2.23', links: { payment: 'PM_RECLAMADO' } }] },
    }
    const pedir = async (url: string) => { const c = respuestas[new URL(url).pathname.slice(1)]; return { ok: c !== undefined, status: c ? 200 : 404, json: async () => c ?? {} } }
    const d = await leerCuentaGc(pedir, 'pruebas', 'token', '2026-11-10')
    expect(d.cobros.map((c) => [c.id, c.estado, c.payoutId])).toEqual([['PM_RECLAMADO', 'charged_back', 'PO_RECLAMADO']])
    expect(d.payouts.map((x) => x.id)).toEqual(['PO_RECLAMADO'])
  })
})
