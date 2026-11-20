// tests/e2e/conta/r07/facturaDelDia.ts
//
// R07 · Que una empresa del carril tenga la cuenta de «La factura del día va a». Desde la 0900 (el
// día en dos asientos), un día del TPV no se valida sin ella; las e2e que validan días (R05, R06,
// X08) la ponen antes. La cuenta es la 430 que ya se llama «contado» (la que propone Sumied) o, si
// no hay ninguna, una nueva «Clientes de contado». Antes de la 0810 (sin conta_tpv_factura_de) no
// hace nada.

import { STAGING_URL, anonKey, type Sesion } from '../sesion'

async function llamar(s: Sesion, nombre: string, args: Record<string, unknown>): Promise<{ ok: boolean; status: number; datos: unknown }> {
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const t = await r.text()
  return { ok: r.ok, status: r.status, datos: t ? JSON.parse(t) : null }
}

/** Devuelve la cuenta de la factura del día de la empresa (la que ya tenía o la que pone), o null si la base aún no la conoce. */
export async function asegurarFacturaDelDia(s: Sesion, empresa: string): Promise<string | null> {
  const de = await llamar(s, 'conta_tpv_factura_de', { p_company: empresa, p_mes: null })
  if (de.status === 404 || (!de.ok && /PGRST202|Could not find the function/.test(JSON.stringify(de.datos)))) return null
  if (!de.ok) throw new Error(`conta_tpv_factura_de: ${de.status} ${JSON.stringify(de.datos)}`)
  const d = de.datos as { factura: { cuenta: string } | null; propuesta: { cuenta: string } | null }
  if (d.factura) return d.factura.cuenta
  let cuenta = d.propuesta?.cuenta ?? null
  if (!cuenta) {
    const alta = await llamar(s, 'company_account_add', {
      p_company: empresa, p_hoja: '4300', p_nombre: 'Clientes de contado', p_plain_name: null, p_entity: null, p_entity_id: null, p_quien_nombre: 'Prueba e2e', p_source: 'manual',
    })
    if (!alta.ok) throw new Error(`company_account_add: ${alta.status} ${JSON.stringify(alta.datos)}`)
    cuenta = (alta.datos as { code: string }).code
  }
  const g = await llamar(s, 'conta_tpv_factura_guardar', { p_company: empresa, p_cuenta: cuenta, p_quien_nombre: 'Prueba e2e' })
  if (!g.ok) throw new Error(`conta_tpv_factura_guardar: ${g.status} ${JSON.stringify(g.datos)}`)
  return cuenta
}
