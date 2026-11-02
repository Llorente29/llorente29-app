// B01 Revolut · PR 2b · Revolut como banco con el que se paga, con un Revolut
// simulado que contesta como dice la especificación oficial (business.json):
// el titular (VoP), el beneficiario (se reutiliza o se crea), el pago con su
// request_id (y el 3020 de un request_id repetido: se lee, no se repite), el
// permiso que falta y los seis estados.
import { describe, expect, it } from 'vitest'
import { estadoDe, motivoEnPalabras, proveedorPagoRevolut } from '../../../../../supabase/functions/_shared/revolut/pago.ts'

const IBAN = 'ES2999990000000000001234'
type Llamada = { metodo: string; ruta: string; cuerpo: Record<string, unknown> | null }

function revolutSimulado(respuestas: Record<string, (c: Llamada) => [number, unknown]>) {
  const llamadas: Llamada[] = []
  const f = async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const c: Llamada = { metodo: init?.method ?? 'GET', ruta: u.pathname.replace('/api/1.0', '') + u.search, cuerpo: init?.body ? JSON.parse(String(init.body)) : null }
    llamadas.push(c)
    const clave = Object.keys(respuestas).find((k) => `${c.metodo} ${c.ruta}`.startsWith(k))
    const [status, json] = clave ? respuestas[clave](c) : [404, { message: 'no está' }]
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { f, llamadas }
}
const pago = { requestId: '11111111-2222-4333-8444-555555555555', cuentaOrigen: 'cuenta-eur', beneficiario: 'Suministros Prueba S.L.', iban: 'ES29 9999 0000 0000 0000 1234', importe: 1028.5, concepto: 'A-2026/0412' }

describe('el titular (VoP)', () => {
  it('cada resultado de Revolut, en el de Sumied', async () => {
    const casos: [number, unknown, string][] = [
      [200, { result_code: 'matched', company_name: 'Suministros Prueba S.L.' }, 'coincide'],
      [200, { result_code: 'close_match', company_name: 'Suministros Prueba Sociedad Limitada' }, 'se_parece'],
      [200, { result_code: 'not_matched', company_name: 'Suministros Prueba S.L.' }, 'no_coincide'],
      [200, { result_code: 'cannot_be_checked' }, 'no_se_puede'],
      [200, { result_code: 'temporarily_unavailable' }, 'ahora_no'],
      [429, { message: 'Too many' }, 'ahora_no'],
      [400, { message: 'bad' }, 'no_se_puede'],
    ]
    for (const [status, json, esperado] of casos) {
      const { f, llamadas } = revolutSimulado({ 'POST /account-name-validation': () => [status, json] })
      const t = await proveedorPagoRevolut(f, 'sandbox', 'tok').comprobarTitular({ beneficiario: pago.beneficiario, iban: pago.iban })
      expect(t.resultado, JSON.stringify(json)).toBe(esperado)
      expect(llamadas[0].cuerpo).toEqual({ iban: IBAN, recipient_country: 'ES', recipient_currency: 'EUR', company_name: pago.beneficiario })
    }
    const { f } = revolutSimulado({ 'POST /account-name-validation': () => [200, { result_code: 'close_match', company_name: 'Suministros Prueba Sociedad Limitada' }] })
    expect(await proveedorPagoRevolut(f, 'sandbox', 'tok').comprobarTitular({ beneficiario: 'x', iban: IBAN })).toEqual({ resultado: 'se_parece', nombreReal: 'Suministros Prueba Sociedad Limitada' })
  })
})

describe('pagar', () => {
  it('reutiliza el beneficiario que ya tiene ese IBAN y manda el pago con su request_id', async () => {
    const { f, llamadas } = revolutSimulado({
      'GET /counterparties': () => [200, [{ id: 'cp-otro', name: 'Otro', accounts: [{ id: 'a0', iban: 'ES9699990000000000007788', currency: 'EUR' }] },
                                          { id: 'cp-1', name: 'Suministros', accounts: [{ id: 'a1', iban: IBAN, currency: 'EUR' }] }]],
      'POST /pay': () => [200, { id: 'tx-1', state: 'pending', created_at: '2026-11-01T10:00:00Z' }],
    })
    const r = await proveedorPagoRevolut(f, 'sandbox', 'tok').pagar(pago)
    expect(r).toEqual({ estado: 'esperando_banco', bancoId: 'tx-1' })
    expect(llamadas.map((l) => `${l.metodo} ${l.ruta.split('?')[0]}`)).toEqual(['GET /counterparties', 'POST /pay'])
    expect(llamadas[1].cuerpo).toEqual({ request_id: pago.requestId, account_id: 'cuenta-eur', receiver: { counterparty_id: 'cp-1', account_id: 'a1' }, amount: 1028.5, currency: 'EUR', reference: 'A-2026/0412' })
  })

  it('sin beneficiario, lo crea como empresa, en euros y con el IBAN limpio', async () => {
    const { f, llamadas } = revolutSimulado({
      'GET /counterparties': () => [200, []],
      'POST /counterparty': () => [200, { id: 'cp-nuevo', name: 'Suministros', state: 'created', accounts: [{ id: 'a-nuevo', iban: IBAN, currency: 'EUR' }] }],
      'POST /pay': () => [200, { id: 'tx-2', state: 'completed', completed_at: '2026-11-01T10:00:05Z' }],
    })
    expect(await proveedorPagoRevolut(f, 'sandbox', 'tok').pagar(pago)).toEqual({ estado: 'pagada', bancoId: 'tx-2', at: '2026-11-01T10:00:05Z' })
    expect(llamadas[1].cuerpo).toEqual({ profile_type: 'business', company_name: pago.beneficiario, bank_country: 'ES', currency: 'EUR', iban: IBAN })
  })

  it('un request_id repetido (3020): el pago ya existe; se lee y no se manda otro', async () => {
    const { f, llamadas } = revolutSimulado({
      'GET /counterparties': () => [200, [{ id: 'cp-1', name: 'S', accounts: [{ id: 'a1', iban: IBAN, currency: 'EUR' }] }]],
      'POST /pay': () => [400, { code: 3020, message: `Duplicate request: ${pago.requestId}` }],
      'GET /transaction/': () => [200, { id: 'tx-1', state: 'completed', completed_at: '2026-11-01T09:00:00Z' }],
    })
    expect(await proveedorPagoRevolut(f, 'sandbox', 'tok').pagar(pago)).toEqual({ estado: 'pagada', bancoId: 'tx-1', at: '2026-11-01T09:00:00Z' })
    expect(llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/pay')).toHaveLength(1)
    expect(llamadas.at(-1)?.ruta).toBe(`/transaction/${pago.requestId}?id_type=request_id`)
  })

  it('sin el permiso de pagar (403): lo dice, con «Activar pagos»', async () => {
    const { f } = revolutSimulado({ 'GET /counterparties': () => [200, [{ id: 'cp', name: 'S', accounts: [{ id: 'a', iban: IBAN }] }]], 'POST /pay': () => [403, { message: 'Forbidden' }] })
    await expect(proveedorPagoRevolut(f, 'sandbox', 'tok').pagar(pago)).rejects.toThrow(/Activar pagos/)
  })

  it('el sandbox en staging, producción solo con «produccion»', async () => {
    const urls: string[] = []
    const f = async (u: string) => { urls.push(u); return new Response(JSON.stringify({ result_code: 'matched' }), { status: 200 }) }
    await proveedorPagoRevolut(f, 'sandbox', 't').comprobarTitular({ beneficiario: 'x', iban: IBAN })
    await proveedorPagoRevolut(f, 'produccion', 't').comprobarTitular({ beneficiario: 'x', iban: IBAN })
    expect(urls[0]).toMatch(/^https:\/\/sandbox-b2b\.revolut\.com\//)
    expect(urls[1]).toMatch(/^https:\/\/b2b\.revolut\.com\//)
  })
})

describe('los estados', () => {
  it('los seis de Revolut', () => {
    expect(estadoDe({ id: 't', state: 'created' }).estado).toBe('enviada')
    expect(estadoDe({ id: 't', state: 'pending' }).estado).toBe('esperando_banco')
    expect(estadoDe({ id: 't', state: 'completed', completed_at: 'x' })).toEqual({ estado: 'pagada', bancoId: 't', at: 'x' })
    expect(estadoDe({ id: 't', state: 'declined', reason_code: 'algo_raro' })).toEqual({ estado: 'rechazada', bancoId: 't', porque: 'Revolut dice «algo_raro». Pregúntale a Revolut con este motivo.' })
    expect(estadoDe({ id: 't', state: 'failed' }).estado).toBe('rechazada')
    expect(estadoDe({ id: 't', state: 'reverted' }).estado).toBe('devuelta')
    expect(motivoEnPalabras(null)).toBe('Revolut no ha dicho por qué.')
  })
})
