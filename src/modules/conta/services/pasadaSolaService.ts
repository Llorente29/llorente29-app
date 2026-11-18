// src/modules/conta/services/pasadaSolaService.ts
//
// E04 · La factura de otra sociedad del grupo se pasa sola: la línea verde de su
// ficha, «Deshacer» y cuántas ha pasado a una sociedad (Inicio). Nombres de la
// base entre comillas (regla 40), de la 20261118T1950: conta_pasada_sola(p_invoice),
// conta_recibida_devolver(p_invoice, p_quien_nombre) y
// conta_pasadas_solas(p_company, p_desde).

import { rpc } from '@/modules/conta/services/bd'

export interface PasadaSola { desde: string; texto: string; cuando: string | null }

/** Si Sumied pasó sola esta recibida a su sociedad (y sigue ahí): de dónde vino y por qué. Null si no. */
export async function leerPasadaSola(invoiceId: string): Promise<PasadaSola | null> {
  const r = await rpc<{ desde?: string; texto?: string; cuando?: string } | null>('conta_pasada_sola', { p_invoice: invoiceId })
  return r && typeof r.texto === 'string' ? { desde: r.desde ?? '', texto: r.texto, cuando: r.cuando ?? null } : null
}

/** «Deshacer»: la devuelve a la sociedad de la que vino y ya no se mueve. Devuelve la frase de lo hecho (regla 8). */
export async function devolverPasadaSola(invoiceId: string, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_recibida_devolver', { p_invoice: invoiceId, p_quien_nombre: quien })
  return r.texto
}

/** Las que ha pasado sola a esta sociedad desde esa hora (y siguen en ella). */
export async function pasadasSolas(companyId: string, desde: string): Promise<{ n: number; ids: string[] }> {
  const r = await rpc<{ n?: number; ids?: string[] }>('conta_pasadas_solas', { p_company: companyId, p_desde: desde })
  return { n: Number(r?.n ?? 0), ids: Array.isArray(r?.ids) ? r.ids.map(String) : [] }
}
