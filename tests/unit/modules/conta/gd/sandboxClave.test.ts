// GD · nº105 · El 403 al sembrar el sandbox: la clave de idempotencia (una cabecera HTTP, solo ASCII) llevaba el nombre de la
// suscripción con tildes del nº104, y la petición no llegaba a GoCardless. El nombre sigue con tildes en el cuerpo; la clave,
// en ASCII. Y un error dice su motivo, no solo el código. Con un GoCardless falso en memoria. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { claveIdempotencia, crearSiembra, motivoSinJson, PORTAL_DE_PRUEBAS } from '../../../../../supabase/functions/_shared/gd/siembra'

function gcFalso({ falloEn }: { falloEn?: string } = {}) {
  const cabeceras: string[] = []
  const nombres: string[] = []
  let n = 0
  const f = (async (u: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>
    if (h['Idempotency-Key']) cabeceras.push(h['Idempotency-Key'])
    const ruta = String(u).replace(/^https:\/\/[^/]+/, '').split('?')[0]
    const cuerpo = init?.body ? JSON.parse(String(init.body)) : {}
    const r = (status: number, j: unknown) => new Response(JSON.stringify(j), { status })
    if (falloEn && ruta === falloEn) return new Response('<html><body><h1>403 Forbidden</h1></body></html>', { status: 403, statusText: 'Forbidden' })
    if (init?.method === 'GET') return r(200, { [ruta.slice(1)]: [], meta: { cursors: {} } })
    if (ruta === '/customers') return r(201, { customers: { id: `CU${++n}` } })
    if (ruta === '/customer_bank_accounts') return r(201, { customer_bank_accounts: { id: `BA${++n}` } })
    if (ruta === '/mandates') return r(201, { mandates: { id: `MD${++n}` } })
    if (ruta === '/subscriptions') { nombres.push(cuerpo.subscriptions.name); return r(201, { subscriptions: { id: `SB${++n}` } }) }
    if (ruta === '/payments') return r(201, { payments: { id: `PM${++n}` } })
    return r(422, { error: { message: 'Ruta desconocida', type: 'invalid_api_usage', errors: [{ field: 'ruta', reason: 'desconocida', message: ruta }] } })
  }) as unknown as typeof fetch
  return { f, cabeceras, nombres }
}
const siembra = (f: typeof fetch) => crearSiembra({ b24Url: `https://${PORTAL_DE_PRUEBAS}/rest/1/abc123/`, gcToken: 'sandbox_token_de_prueba', decir: () => {}, fetch: f, pausaMs: 0 })

describe('GD · nº105 · el sandbox, sin el 403', () => {
  it('la clave de idempotencia, en ASCII; el nombre de la suscripción, con sus tildes', async () => {
    const g = gcFalso()
    await siembra(g.f).sembrarGoCardless()
    expect(g.cabeceras.length).toBeGreaterThan(50)
    for (const c of g.cabeceras) expect(c).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
    expect(g.nombres).toContain('Gestión laboral Adrián Molina Castro')
    expect(g.nombres).toContain('Impuesto de sociedades')
    expect(g.nombres.some((x) => x.startsWith('Gestoría mensual '))).toBe(true)
  })

  it('claveIdempotencia quita tildes y espacios; motivoSinJson, el texto de una página', () => {
    expect(claveIdempotencia('gd-1-3-Gestión laboral Adrián Molina Castro')).toBe('gd-1-3-Gestion-laboral-Adrian-Molina-Castro')
    expect(claveIdempotencia('x'.repeat(200))).toHaveLength(128)
    expect(motivoSinJson('<html><head><style>a{}</style></head><body><h1>403 Forbidden</h1></body></html>')).toBe('403 Forbidden')
    expect(motivoSinJson('')).toBe('sin cuerpo')
  })

  it('un error dice su motivo: el de GoCardless, o que la respuesta no es suya', async () => {
    await expect(siembra(gcFalso({ falloEn: '/subscriptions' }).f).sembrarGoCardless())
      .rejects.toThrow('GoCardless (sandbox) · POST /subscriptions: 403 · la respuesta no es de GoCardless (Forbidden): 403 Forbidden')
  })
})
