// supabase/functions/conta-gocardless-leer/lectura.ts
//
// G01 · Tarea 3 (06/11/2026). Leer una cuenta de GoCardless entera, con el
// fetch que le pasen (en las pruebas, respuestas grabadas e inventadas:
// tests/unit/modules/conta/gestoria/lecturaGocardless.test.ts). Solo GET.

import {
  BASES, cabeceras, casarMotivos, desdeHaceMeses, leerCliente, leerCobro, leerCuentaAbono, leerMandato, leerSuscripcion, leerTodo, urlDePagina,
  type ClienteGc, type CobroGc, type CuentaAbonoGc, type Entorno, type MandatoGc, type Recurso, type SuscripcionGc,
} from './lector.ts'

export type Pedir = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface DatosGc {
  clientes: ClienteGc[]
  mandatos: MandatoGc[]
  suscripciones: SuscripcionGc[]
  cobros: CobroGc[]
  abonos: CuentaAbonoGc[]
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

/** Todo lo que se lee de una cuenta: clientes, mandatos, suscripciones, cobros de 6 meses con su motivo y la cuenta de abono. */
export async function leerCuentaGc(pedir: Pedir, entorno: Entorno, token: string, hoy: string): Promise<DatosGc> {
  const desde = desdeHaceMeses(hoy, 6)
  const [rc, rm, rs, rp, re, ra] = await Promise.all([
    pedirRecurso(pedir, entorno, token, 'customers'),
    pedirRecurso(pedir, entorno, token, 'mandates'),
    pedirRecurso(pedir, entorno, token, 'subscriptions'),
    pedirRecurso(pedir, entorno, token, 'payments', { 'charge_date[gte]': desde }),
    pedirRecurso(pedir, entorno, token, 'events', { resource_type: 'payments', 'created_at[gte]': `${desde}T00:00:00Z` }),
    pedirRecurso(pedir, entorno, token, 'creditor_bank_accounts'),
  ])
  return {
    clientes: rc.map(leerCliente),
    mandatos: rm.map(leerMandato),
    suscripciones: rs.map(leerSuscripcion),
    cobros: casarMotivos(rp.map(leerCobro), re),
    abonos: ra.map(leerCuentaAbono).filter((a) => a.activa),
    desde,
  }
}
