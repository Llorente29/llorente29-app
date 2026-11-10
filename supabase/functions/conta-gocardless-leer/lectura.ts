// supabase/functions/conta-gocardless-leer/lectura.ts
//
// G01 · Tarea 3 (06/11/2026). Leer una cuenta de GoCardless entera, con el
// fetch que le pasen (en las pruebas, respuestas grabadas e inventadas:
// tests/unit/modules/conta/gestoria/lecturaGocardless.test.ts). Solo GET.

import {
  BASES, cabeceras, casarMotivos, desdeHaceMeses, leerCliente, leerCobro, leerCuentaAbono, leerCuentaCliente, leerMandato, leerPayout, leerSuscripcion, leerTodo, urlDePagina,
  type ClienteGc, type CobroGc, type CuentaAbonoGc, type CuentaClienteGc, type Entorno, type MandatoGc, type PayoutGc, type Recurso, type SuscripcionGc,
} from './lector.ts'
import { liquidacionesDeClientes, pagosDePartidas, type Fuera } from './liquidaciones.ts'

export type Pedir = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface DatosGc {
  clientes: ClienteGc[]
  mandatos: MandatoGc[]
  suscripciones: SuscripcionGc[]
  cobros: CobroGc[]
  abonos: CuentaAbonoGc[]
  /** G05 · Las cuentas de los clientes (lo justo para enmascararlas: los últimos dígitos, el país y el banco). */
  cuentasCliente: CuentaClienteGc[]
  /** G05 · nº 43 · Los pagos de GoCardless al banco (payouts) de los mismos 6 meses: día de llegada y neto. */
  payouts: PayoutGc[]
  /** nº 76 · Las liquidaciones leídas que no son de ningún cliente de ahora (no se guardan). */
  payoutsFuera?: Fuera[]
  /** Desde cuándo se han leído los cobros (el día 1 de hace 6 meses). */
  desde: string
}

export class FalloGc extends Error {}

/** Un recurso entero, página a página. Un 401 o 403 dice que el token no vale. */
export async function pedirRecurso(pedir: Pedir, entorno: Entorno, token: string, recurso: Recurso, filtros: Record<string, string> = {}) {
  return await leerTodo<Record<string, unknown>>(recurso, async (despues) => {
    const r = await pedir(urlDePagina(entorno, recurso, filtros, despues), { headers: cabeceras(token) })
    const cuerpo = await r.json().catch(() => null)
    if (!r.ok) {
      const msg = (cuerpo as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${r.status}`
      throw new FalloGc(r.status === 401 || r.status === 403 ? `GoCardless no acepta el token (${msg}).` : `GoCardless ha contestado: ${msg}.`)
    }
    return cuerpo
  })
}

/** Antes de guardar un token: ¿lo acepta GoCardless en ese entorno? Una sola lectura (/creditors). */
export async function comprobarToken(pedir: Pedir, entorno: Entorno, token: string): Promise<{ ok: true } | { ok: false; porque: string }> {
  const r = await pedir(`${BASES[entorno]}/creditors?limit=1`, { headers: cabeceras(token) })
  if (r.ok) return { ok: true }
  const donde = entorno === 'real' ? 'la cuenta real' : 'pruebas (el sandbox)'
  return { ok: false, porque: r.status === 401 || r.status === 403 ? `GoCardless no acepta ese token en ${donde}.` : `GoCardless ha contestado ${r.status} en ${donde}.` }
}

/** Todo lo que se lee de una cuenta: clientes, mandatos, suscripciones, cobros de 6 meses con su motivo y su pago al banco, los payouts y la cuenta de abono. */
export async function leerCuentaGc(pedir: Pedir, entorno: Entorno, token: string, hoy: string): Promise<DatosGc> {
  const desde = desdeHaceMeses(hoy, 6)
  const [rc, rm, rs, rp, re, ra, rb, ro] = await Promise.all([
    pedirRecurso(pedir, entorno, token, 'customers'),
    pedirRecurso(pedir, entorno, token, 'mandates'),
    pedirRecurso(pedir, entorno, token, 'subscriptions'),
    pedirRecurso(pedir, entorno, token, 'payments', { 'charge_date[gte]': desde }),
    pedirRecurso(pedir, entorno, token, 'events', { resource_type: 'payments', 'created_at[gte]': `${desde}T00:00:00Z` }),
    pedirRecurso(pedir, entorno, token, 'creditor_bank_accounts'),
    pedirRecurso(pedir, entorno, token, 'customer_bank_accounts'),
    pedirRecurso(pedir, entorno, token, 'payouts', { 'created_at[gte]': `${desde}T00:00:00Z` }),
  ])
  const clientes = rc.map(leerCliente)
  const mandatos = rm.map(leerMandato)
  const cobros = casarMotivos(rp.map(leerCobro), re)
  const payouts = ro.map(leerPayout)
  // nº 76 · De las liquidaciones que ningún cobro leído nombra, sus partidas y, de los pagos que no se han leído, su mandato.
  const nombradas = new Set(cobros.map((c) => c.payoutId).filter(Boolean))
  const leidos = new Set(cobros.map((c) => c.id))
  const partidas = new Map<string, string[]>()
  const mandatoDePago = new Map<string, string | null>()
  const sinSaber = new Set<string>()
  for (const o of payouts.filter((x) => !nombradas.has(x.id)).slice(0, 100)) {
    try {
      const pagos = pagosDePartidas(await pedirRecurso(pedir, entorno, token, 'payout_items', { payout: o.id }))
      partidas.set(o.id, pagos)
      for (const p of pagos.filter((x) => !leidos.has(x) && !mandatoDePago.has(x))) {
        const r = await pedir(`${BASES[entorno]}/payments/${encodeURIComponent(p)}`, { headers: cabeceras(token) })
        const j = r.ok ? await r.json().catch(() => null) as { payments?: { links?: { mandate?: string } } } | null : null
        mandatoDePago.set(p, j?.payments?.links?.mandate ?? null)
      }
    } catch {
      // Si GoCardless no da sus partidas, no hay con qué decir que no es de nadie: entra, como antes.
      sinSaber.add(o.id)
    }
  }
  const reparto = liquidacionesDeClientes({ payouts, cobros, mandatos, clientes }, partidas, mandatoDePago)
  const quedan = payouts.filter((x) => sinSaber.has(x.id) || reparto.quedan.includes(x))
  const fuera = reparto.fuera.filter((f) => !sinSaber.has(f.id))
  return {
    clientes,
    mandatos,
    suscripciones: rs.map(leerSuscripcion),
    cobros,
    abonos: ra.map(leerCuentaAbono).filter((a) => a.activa),
    cuentasCliente: rb.map(leerCuentaCliente),
    payouts: quedan,
    payoutsFuera: fuera,
    desde,
  }
}
