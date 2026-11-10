// supabase/functions/conta-gocardless-leer/liquidaciones.ts
//
// G05 · nº 76 (10/11/2026) · SOLO LAS LIQUIDACIONES DE LOS CLIENTES DE AHORA.
// GoCardless guarda para siempre los pagos y las liquidaciones (payouts) de
// clientes que ya no están en la cuenta: en el sandbox, los cobros sueltos de
// cada siembra de la demo, aunque se cancelen sus mandatos y se borren sus
// clientes. La lectura los traía cada vez y llegaban al banco como ingresos que
// no son de nadie (16 en la Gestoría Demo el 10/11).
//
// La regla: una liquidación entra si al menos uno de sus pagos es de un mandato
// cuyo cliente está HOY en la cuenta de GoCardless (el de esta misma lectura).
// Un pago de un cliente de ahora entra siempre, aunque después se devuelva o se
// reclame (el dinero llegó al banco y se casa así). Los pagos de una
// liquidación salen de los cobros leídos (links.payout) y, si ninguno la nombra,
// de sus partidas (payout_items), que la lectura pide aparte.
// Puro. Lo prueba tests/unit/modules/conta/gestoria/g05/liquidaciones.test.ts.

import type { ClienteGc, CobroGc, MandatoGc, PayoutGc } from './lector.ts'

export interface Fuera { id: string; porque: string }

export function liquidacionesDeClientes(
  d: { payouts: PayoutGc[]; cobros: CobroGc[]; mandatos: MandatoGc[]; clientes: ClienteGc[] },
  /** Las partidas de las liquidaciones que ningún cobro leído nombra: liquidación → pagos. */
  partidas: ReadonlyMap<string, readonly string[]>,
  /** El mandato de los pagos de esas partidas que no están entre los cobros leídos. */
  mandatoDePago: ReadonlyMap<string, string | null>,
): { quedan: PayoutGc[]; fuera: Fuera[] } {
  const ahora = new Set(d.clientes.map((c) => c.id))
  const clienteDe = new Map(d.mandatos.map((m) => [m.id, m.clienteId]))
  const mandatoDe = new Map(d.cobros.map((c) => [c.id, c.mandatoId]))
  const pagosDe = new Map<string, string[]>()
  for (const c of d.cobros) if (c.payoutId) pagosDe.set(c.payoutId, [...(pagosDe.get(c.payoutId) ?? []), c.id])
  const deAhora = (pago: string) => {
    const m = mandatoDe.has(pago) ? mandatoDe.get(pago) : mandatoDePago.get(pago)
    const cl = m ? clienteDe.get(m) : null
    return !!cl && ahora.has(cl)
  }
  const quedan: PayoutGc[] = []
  const fuera: Fuera[] = []
  for (const o of d.payouts) {
    const pagos = [...new Set([...(pagosDe.get(o.id) ?? []), ...(partidas.get(o.id) ?? [])])]
    if (pagos.some(deAhora)) quedan.push(o)
    else fuera.push({ id: o.id, porque: pagos.length ? 'sus pagos son de clientes que ya no están en GoCardless' : 'no se sabe de qué pagos es' })
  }
  return { quedan, fuera }
}

/** Los pagos de las partidas de una liquidación (payout_items: los cobrados y los devueltos). */
export function pagosDePartidas(items: readonly Record<string, unknown>[]): string[] {
  const out = new Set<string>()
  for (const it of items) {
    const p = (it.links as { payment?: unknown } | undefined)?.payment
    if (typeof p === 'string' && p) out.add(p)
  }
  return [...out]
}
