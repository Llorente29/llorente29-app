// src/modules/conta/services/apuntaSoloService.ts
//
// S01o · Las facturas que Sumied apunta solas (20261101T1731): leerlas, con su
// porqué y el motivo de las que no, y «Deshacer» una (la anula con su
// contraasiento y la devuelve a «Por revisar»). Y el interruptor «Apuntar solo
// lo seguro» de la empresa (D01, company_purchase_setting).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { deLaBase, type ApuntadasSolas } from '@/modules/conta/lib/apuntaSolo'

export async function leerApuntadasSolas(companyId: string): Promise<ApuntadasSolas> {
  return deLaBase(await rpc<unknown>('conta_apuntadas_solas', { p_company: companyId }))
}

/** Devuelve la frase de lo que ha hecho (regla 8): «Devuelta a «Por revisar»: … Su asiento queda anulado con su contraasiento.» */
export async function deshacerApuntadaSola(invoiceId: string, quien: string | null): Promise<string> {
  const r = await rpc<{ texto?: string }>('conta_apuntada_sola_deshacer', { p_invoice: invoiceId, p_quien_nombre: quien })
  return r?.texto ?? 'Devuelta a «Por revisar».'
}

export interface AjusteApuntarSolo { apuntarSolo: boolean; recibeMercancia: boolean; quien: string | null; cuando: string | null }

export async function leerAjusteApuntarSolo(accountId: string, companyId: string): Promise<AjusteApuntarSolo> {
  const { data, error } = await tabla('company_purchase_setting').select('post_safe_invoices, receives_goods, updated_by_name, updated_at')
    .eq('account_id', accountId).eq('company_id', companyId)
  if (error) throw new Error(mensaje('No se ha podido leer el ajuste de «Apuntar solo lo seguro»', error))
  const f = ((data ?? []) as Record<string, unknown>[])[0]
  return {
    apuntarSolo: f?.post_safe_invoices === true, recibeMercancia: f?.receives_goods === true,
    quien: typeof f?.updated_by_name === 'string' ? f.updated_by_name : null, cuando: typeof f?.updated_at === 'string' ? f.updated_at : null,
  }
}

/** Guarda el interruptor (conta_ajustes_compras_guardar, D01) sin tocar «recibe la mercancía». */
export async function guardarApuntarSolo(companyId: string, actual: AjusteApuntarSolo, encendido: boolean, quien: string | null): Promise<void> {
  await rpc('conta_ajustes_compras_guardar', { p_company: companyId, p_recibe: actual.recibeMercancia, p_apuntar_seguro: encendido, p_quien_nombre: quien })
}
