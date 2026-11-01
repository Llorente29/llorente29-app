// supabase/functions/_shared/revolut/pago.ts
//
// B01 Revolut · PR 2b · REVOLUT COMO BANCO CON EL QUE SE PAGA (ProveedorPago).
// Sin Deno: la red entra por `fetch` y el token de acceso, de quien llama.
//
// De la especificación oficial (revolut-openapi, business.json, 30/10/2026):
//   · POST /account-name-validation (EUR: iban, recipient_country,
//     recipient_currency, company_name) → result_code matched | close_match |
//     not_matched | cannot_be_checked | temporarily_unavailable;
//   · GET /counterparties?iban= y POST /counterparty (profile_type business,
//     company_name, bank_country, currency EUR, iban);
//   · POST /pay (request_id, máx. 40, idempotente dos semanas; account_id,
//     receiver {counterparty_id, account_id}, amount, currency, reference ≤ 140,
//     name_validation_id) → {id, state}. Un request_id repetido da 400 con el
//     código 3020: entonces el pago ya existe y se lee con
//     GET /transaction/{request_id}?id_type=request_id;
//   · los estados: created, pending, completed, declined, failed, reverted.
// Con el permiso PAY (lo pide «Activar pagos»). Lo que solo está en las guías
// se confirma en el sandbox y va al parte.

import { FalloRevolut, direcciones, type EntornoRevolut } from './cliente.ts'
import { ibanLimpio, paisDelIban, type EstadoBanco, type PagoAlBanco, type ProveedorPago, type Titular } from '../pagos/proveedorPago.ts'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

interface Transaccion { id: string; state: string; completed_at?: string; reason_code?: string; request_id?: string }
interface Beneficiario { id: string; name: string; state?: string; accounts?: { id: string; iban?: string; currency?: string }[] }

/**
 * El motivo de Revolut, en palabras normales. La especificación no da la lista
 * de reason_code (es un texto libre): las traducciones se añaden aquí con los
 * que se vean en el sandbox, uno a uno. Mientras no haya traducción, el suyo
 * entre comillas, para preguntárselo a Revolut.
 */
const MOTIVOS: Record<string, string> = {}
export function motivoEnPalabras(codigo: string | undefined | null): string {
  const c = (codigo ?? '').trim()
  if (!c) return 'Revolut no ha dicho por qué.'
  return MOTIVOS[c.toLowerCase()] ?? `Revolut dice «${c.slice(0, 120)}». Pregúntale a Revolut con este motivo.`
}

/** Un estado de Revolut, en el de Sumied. */
export function estadoDe(t: Transaccion): EstadoBanco {
  switch (t.state) {
    case 'completed': return { estado: 'pagada', bancoId: t.id, at: t.completed_at ?? new Date().toISOString() }
    case 'created': return { estado: 'enviada', bancoId: t.id }
    case 'pending': return { estado: 'esperando_banco', bancoId: t.id }
    case 'reverted': return { estado: 'devuelta', bancoId: t.id, porque: motivoEnPalabras(t.reason_code) }
    default: return { estado: 'rechazada', bancoId: t.id, porque: motivoEnPalabras(t.reason_code) }
  }
}

export function proveedorPagoRevolut(f: Fetch, e: EntornoRevolut, acceso: string): ProveedorPago {
  const api = direcciones(e).api
  const pedir = async <T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<{ ok: boolean; status: number; json: T }> => {
    const r = await f(`${api}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${acceso}`, Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    })
    let json: T = {} as T
    try { json = await r.json() as T } catch { /* sin cuerpo */ }
    return { ok: r.ok, status: r.status, json }
  }
  const fallo = (status: number, b: { code?: unknown; message?: string }, que: string) =>
    new FalloRevolut(status, b?.code != null ? String(b.code) : null, `${que}${b?.message ? ` Revolut dice: «${String(b.message).slice(0, 200)}».` : ''}`)

  async function beneficiarioDe(nombre: string, iban: string): Promise<{ counterparty: string; cuenta: string }> {
    const q = new URLSearchParams({ iban })
    const lista = await pedir<Beneficiario[]>('GET', `/counterparties?${q}`)
    if (lista.ok && Array.isArray(lista.json)) {
      for (const b of lista.json) {
        const c = b.state !== 'deleted' && b.accounts?.find((a) => ibanLimpio(a.iban ?? '') === iban && (a.currency ?? 'EUR') === 'EUR')
        if (c) return { counterparty: b.id, cuenta: c.id }
      }
    }
    const nuevo = await pedir<Beneficiario & { code?: unknown; message?: string }>('POST', '/counterparty', {
      profile_type: 'business', company_name: nombre.slice(0, 80), bank_country: paisDelIban(iban), currency: 'EUR', iban,
    })
    if (!nuevo.ok) throw fallo(nuevo.status, nuevo.json, 'Revolut no ha aceptado al proveedor como beneficiario.')
    const cuenta = nuevo.json.accounts?.find((a) => ibanLimpio(a.iban ?? '') === iban) ?? nuevo.json.accounts?.[0]
    if (!cuenta) throw new FalloRevolut(nuevo.status, null, 'Revolut ha creado el beneficiario sin su cuenta.')
    return { counterparty: nuevo.json.id, cuenta: cuenta.id }
  }

  return {
    id: 'revolut',
    nombre: 'Revolut',
    async comprobarTitular({ beneficiario, iban }): Promise<Titular> {
      const i = ibanLimpio(iban)
      const r = await pedir<{ result_code?: string; company_name?: string; code?: unknown; message?: string }>('POST', '/account-name-validation', {
        iban: i, recipient_country: paisDelIban(i), recipient_currency: 'EUR', company_name: beneficiario.slice(0, 140),
      })
      if (!r.ok) {
        if (r.status === 429) return { resultado: 'ahora_no', porque: 'Revolut pide esperar un poco antes de volver a comprobarlo.' }
        return { resultado: 'no_se_puede', porque: 'Revolut no ha podido comprobar el titular de este IBAN.' }
      }
      switch (r.json.result_code) {
        case 'matched': return { resultado: 'coincide' }
        case 'close_match': return { resultado: 'se_parece', nombreReal: r.json.company_name ?? '' }
        case 'not_matched': return { resultado: 'no_coincide' }
        case 'temporarily_unavailable': return { resultado: 'ahora_no', porque: 'El banco del proveedor no contesta ahora. Vuelve a intentarlo en un rato.' }
        default: return { resultado: 'no_se_puede', porque: 'El banco del proveedor no deja comprobar el titular.' }
      }
    },
    async pagar(p: PagoAlBanco): Promise<EstadoBanco> {
      const iban = ibanLimpio(p.iban)
      const b = await beneficiarioDe(p.beneficiario, iban)
      const r = await pedir<Transaccion & { code?: unknown; message?: string }>('POST', '/pay', {
        request_id: p.requestId, account_id: p.cuentaOrigen, receiver: { counterparty_id: b.counterparty, account_id: b.cuenta },
        amount: Math.round(p.importe * 100) / 100, currency: 'EUR', reference: p.concepto.slice(0, 140),
      })
      if (r.ok && r.json.id) return estadoDe(r.json)
      // El mismo request_id ya estaba: el pago existe; se lee, no se repite.
      if (r.status === 400 && String(r.json?.code) === '3020') return this.estado(p.requestId, true)
      throw fallo(r.status, r.json, r.status === 403 ? 'Revolut no deja pagar con el permiso que tiene Sumied: pulsa «Activar pagos».' : 'Revolut no ha aceptado el pago.')
    },
    async estado(id: string, porRequestId = false): Promise<EstadoBanco> {
      const r = await pedir<Transaccion & { code?: unknown; message?: string }>('GET', `/transaction/${encodeURIComponent(id)}${porRequestId ? '?id_type=request_id' : ''}`)
      if (!r.ok) throw fallo(r.status, r.json, 'Revolut no ha dicho cómo va el pago.')
      return estadoDe(r.json)
    },
  } as ProveedorPago & { estado(id: string, porRequestId?: boolean): Promise<EstadoBanco> }
}
