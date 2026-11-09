// G01 · Respuestas GRABADAS e INVENTADAS de la API de GoCardless (T11: ningún
// dato real). La forma es la de la documentación oficial
// (https://developer.gocardless.com/api-reference): cada lista con su
// «meta.cursors.after». Un cliente con 7 líneas, otro de la cuenta de B, uno
// sin ficha en Bitrix24, un mandato por firmar, un cliente que falla a menudo,
// una laboral sin nombre y una anual.
const pag = (recurso: string, filas: unknown[], after: string | null = null) => ({ [recurso]: filas, meta: { cursors: { before: null, after }, limit: 500 } })

export const CLIENTES_1 = pag('customers', [
  { id: 'CU001', company_name: 'CLIENTE PRUEBA UNO, S.L.', email: 'uno@prueba.test', metadata: { nif: 'B00000001' }, created_at: '2025-01-10T10:00:00Z' },
  { id: 'CU002', company_name: 'CLIENTE PRUEBA DOS', email: 'dos@prueba.test', metadata: {}, created_at: '2025-02-10T10:00:00Z' },
], 'CU002')
export const CLIENTES_2 = pag('customers', [
  { id: 'CU003', given_name: 'Persona', family_name: 'Sin Ficha', email: 'sinficha@prueba.test', metadata: { nif: 'B00000009' }, created_at: '2025-03-10T10:00:00Z' },
])
export const MANDATOS = pag('mandates', [
  { id: 'MD001', status: 'active', reference: 'PRUEBA-001', scheme: 'sepa_core', created_at: '2025-01-11T10:00:00Z', links: { customer: 'CU001', customer_bank_account: 'BA001' } },
  { id: 'MD002', status: 'active', reference: 'PRUEBA-002', scheme: 'sepa_core', created_at: '2025-02-11T10:00:00Z', links: { customer: 'CU002', customer_bank_account: 'BA002' } },
  { id: 'MD003', status: 'pending_customer_approval', reference: 'PRUEBA-003', scheme: 'sepa_core', created_at: '2026-11-01T10:00:00Z', links: { customer: 'CU003', customer_bank_account: 'BA003' } },
])
const sus = (id: string, name: string, amount: number, mandate: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, amount, currency: 'EUR', interval_unit: 'monthly', interval: 1, status: 'active', start_date: '2026-01-05', links: { mandate }, ...extra })
export const SUSCRIPCIONES = pag('subscriptions', [
  sus('SB001', 'GESTORIA MENSUAL', 9075, 'MD001'),
  sus('SB002', 'GESTORIA MENSUAL SOCIEDAD PRUEBA DOS, S.L.', 6050, 'MD001'),
  sus('SB003', 'GESTION LABORAL EMPLEADO UNO PRUEBA', 2420, 'MD001'),
  sus('SB004', 'GESTION LABORAL EMPLEADO DOS PRUEBA', 2420, 'MD001'),
  sus('SB005', 'GESTION LABORAL EMPLEADO TRES PRUEBA', 2420, 'MD001'),
  sus('SB006', 'GESTION LABORAL EMPLEADO CUATRO PRUEBA', 3025, 'MD001'),
  sus('SB007', 'SERVICIOS MENSUALES DE PRUEBA', 1500, 'MD001'),
  sus('SB008', 'GESTION LABORAL', 2420, 'MD002'),
  sus('SB009', 'VIGILANCIA DE PRUEBA', 60500, 'MD002', { interval_unit: 'yearly' }),
  sus('SB010', 'GESTORIA MENSUAL', 9075, 'MD002', { status: 'cancelled' }),
])
export const COBROS = pag('payments', [
  { id: 'PM001', status: 'paid_out', charge_date: '2026-10-05', amount: 9075, currency: 'EUR', links: { mandate: 'MD001', subscription: 'SB001', payout: 'PO001' } },
  { id: 'PM002', status: 'failed', charge_date: '2026-08-05', amount: 9075, currency: 'EUR', links: { mandate: 'MD002', subscription: 'SB010' } },
  { id: 'PM003', status: 'failed', charge_date: '2026-09-05', amount: 9075, currency: 'EUR', links: { mandate: 'MD002', subscription: 'SB010' } },
  { id: 'PM004', status: 'charged_back', charge_date: '2026-10-05', amount: 9075, currency: 'EUR', links: { mandate: 'MD002', subscription: 'SB010' } },
])
export const EVENTOS = pag('events', [
  { id: 'EV001', resource_type: 'payments', action: 'failed', created_at: '2026-08-06T10:00:00Z', links: { payment: 'PM002' }, details: { cause: 'insufficient_funds', description: 'La cuenta no tenía saldo.' } },
])
export const ABONOS = pag('creditor_bank_accounts', [
  { id: 'BA900', bank_name: 'BANCO DE PRUEBA', account_holder_name: 'EMISOR PRUEBA ALFA', account_number_ending: '34', currency: 'EUR', enabled: true },
])

// G05 · Las cuentas de los clientes: solo los últimos dígitos, el país y el banco (inventados).
export const CUENTAS_CLIENTE = pag('customer_bank_accounts', [
  { id: 'BA001', account_number_ending: '21', country_code: 'ES', bank_name: 'BANCO DE PRUEBA', currency: 'EUR', enabled: true },
  { id: 'BA002', account_number_ending: '07', country_code: 'ES', bank_name: 'OTRO BANCO DE PRUEBA', currency: 'EUR', enabled: true },
])

// G05 · nº 43 · El pago de GoCardless al banco que lleva el PM001: llega el 7/10, neto (sin su comisión).
export const PAYOUTS = pag('payouts', [
  { id: 'PO001', status: 'paid', arrival_date: '2026-10-07', amount: 8975, deducted_fees: 100, currency: 'EUR', reference: 'PRUEBA-PO001' },
])

/** Un fetch falso: contesta por ruta y cursor, y apunta lo que se pidió. */
export function fetchGrabado(pedidas: string[] = []) {
  return async (url: string, init: { headers: Record<string, string> }) => {
    pedidas.push(url)
    const u = new URL(url)
    const r = u.pathname.slice(1)
    const after = u.searchParams.get('after')
    const tabla: Record<string, unknown> = {
      customers: after === 'CU002' ? CLIENTES_2 : CLIENTES_1, mandates: MANDATOS, subscriptions: SUSCRIPCIONES,
      payments: COBROS, events: EVENTOS, creditor_bank_accounts: ABONOS, customer_bank_accounts: CUENTAS_CLIENTE, payouts: PAYOUTS, creditors: pag('creditors', [{ id: 'CR001' }]),
    }
    if (init.headers.Authorization !== 'Bearer token-de-prueba') return { ok: false, status: 401, json: async () => ({ error: { message: 'Invalid token' } }) }
    if (!(r in tabla)) return { ok: false, status: 404, json: async () => ({ error: { message: 'No existe' } }) }
    return { ok: true, status: 200, json: async () => tabla[r] }
  }
}
