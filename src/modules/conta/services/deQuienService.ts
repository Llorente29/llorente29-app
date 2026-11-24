// src/modules/conta/services/deQuienService.ts
//
// E03 · «¿De quién es esta factura?»: leer la pregunta, contestarla y pasar la
// factura a otra sociedad de la cuenta. Nombres de la base entre comillas
// (regla 40), de la 20261118T1833: conta_de_quien_es(p_invoice),
// conta_recibida_de_quien(p_invoice, p_respuesta, p_quien_nombre) y
// conta_recibida_pasar_a(p_invoice, p_company, p_quien_nombre).

import { rpc } from '@/modules/conta/services/bd'
import { deLaBase, type DeQuien, type RespuestaDeQuien } from '@/modules/conta/lib/deQuienEs'

/** A nombre de quién va una recibida y si hay que preguntarlo. */
export async function leerDeQuien(invoiceId: string): Promise<DeQuien> {
  return deLaBase(await rpc<unknown>('conta_de_quien_es', { p_invoice: invoiceId }))
}

/** Contestar. Devuelve la frase de lo hecho, con quién y cuándo (regla 8). */
export async function contestarDeQuien(invoiceId: string, respuesta: RespuestaDeQuien, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_recibida_de_quien', { p_invoice: invoiceId, p_respuesta: respuesta, p_quien_nombre: quien })
  return r.texto
}

/** Pasarla a la otra sociedad, con su PDF y su llegada. Devuelve la frase de lo hecho. */
export async function pasarALaOtra(invoiceId: string, companyId: string, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_recibida_pasar_a', { p_invoice: invoiceId, p_company: companyId, p_quien_nombre: quien })
  return r.texto
}
