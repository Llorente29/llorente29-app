// GD · nº62 · En el sandbox, los mandatos de la demo nacen firmados («Successful») salvo dos, que se quedan
// «por firmar» para que el aviso salga sin dominar. Talleres Ruiz y Librería El Faro, firmados.
// Se mide con la siembra de verdad y un fetch falso: qué given_name lleva cada cliente al crearse. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { resumen } from '../../../../../supabase/functions/_shared/gd/datos'
import { crearSiembra, PORTAL_DE_PRUEBAS } from '../../../../../supabase/functions/_shared/gd/siembra'

describe('GD · nº62 · los mandatos de la demo, firmados salvo dos', () => {
  it('solo dos por firmar, y no son Talleres Ruiz ni Librería El Faro', () => {
    const r = resumen()
    expect(r.porFirmar).toEqual(['Ferretería El Clavo, S.L.', 'Pastelería Dulce Hogar, S.L.'])
    expect(r.escenarios).toEqual(['Successful: Clínica Dental Sonrisas, S.L.', 'Fickle: Veterinaria Cuatro Patas, S.L.', 'Penniless: Electricidad Voltio, S.L.'])
  })

  it('la siembra crea a cada cliente con su given_name: Successful, salvo los dos por firmar y los de escenario', async () => {
    const creados: { empresa: string; given: string }[] = []
    let n = 0
    const f = (async (_u: string, init?: RequestInit) => {
      const cuerpo = init?.body ? JSON.parse(String(init.body)) : {}
      if (cuerpo.customers) creados.push({ empresa: cuerpo.customers.company_name, given: cuerpo.customers.given_name })
      const id = `X${++n}`
      return new Response(JSON.stringify({ customers: { id }, customer_bank_accounts: { id }, mandates: { id }, subscriptions: { id }, payments: { id } }), { status: 201 })
    }) as unknown as typeof fetch
    await crearSiembra({ b24Url: `https://${PORTAL_DE_PRUEBAS}/rest/1/abc123/`, gcToken: 'sandbox_prueba', decir: () => {}, fetch: f }).sembrarGoCardless()
    const de = (empresa: string) => creados.find((c) => c.empresa === empresa)?.given
    expect(de('Talleres Ruiz, S.L.')).toBe('Successful')
    expect(de('Librería El Faro, S.L.')).toBe('Successful')
    expect(de('Ferretería El Clavo, S.L.')).toBe('Ernesto')
    expect(de('Pastelería Dulce Hogar, S.L.')).toBe('Elisa')
    const sinFirmar = creados.filter((c) => !['Successful', 'Penniless', 'Fickle'].includes(c.given))
    expect(sinFirmar.map((c) => c.empresa)).toEqual(['Ferretería El Clavo, S.L.', 'Pastelería Dulce Hogar, S.L.'])
  })
})
