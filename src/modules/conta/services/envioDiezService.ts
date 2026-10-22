// src/modules/conta/services/envioDiezService.ts
//
// C07 · Todo asiento de Sumied a Diez (Julio, 22/10): el interruptor «Enviar a
// Diez» de la empresa y el envío de cada asiento, sea del tipo que sea.
//
// Nombres dentro de cadenas (regla 40), los que crea la 20261201T0450:
// conta_diez_envio_empresa (company_id, account_id, enviar, desde,
// cambiado_por_nombre, cambiado_en), conta_diez_envio_poner, y
// external_send.next_try_at; y los de antes: external_send (entry_id, status,
// ext_series, ext_number, attempts, last_error, document_status, account_id),
// journal_entry (id, account_id, status, voided_by_entry_id).

import { useCallback, useEffect, useState } from 'react'
import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { EnvioAsiento } from '@/modules/conta/lib/enDiez'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export interface EnvioEmpresa { encendido: boolean; desde: string | null; cambiadoPor: string | null; cambiadoEn: string | null }
const APAGADO: EnvioEmpresa = { encendido: false, desde: null, cambiadoPor: null, cambiadoEn: null }

/** «Enviar a Diez» de la empresa. Sin fila (o sin la 0450 en la base), apagado: no se habla de Diez. */
export async function leerEnvioEmpresa(accountId: string, companyId: string): Promise<EnvioEmpresa> {
  const { data, error } = await tabla('conta_diez_envio_empresa').select('enviar, desde, cambiado_por_nombre, cambiado_en')
    .eq('account_id', accountId).eq('company_id', companyId).maybeSingle()
  // Sin la tabla (42P01, una base sin la 0450): apagado, como hasta hoy sin interruptor.
  if (error) {
    if ((error as { code?: string }).code === '42P01' || /does not exist|could not find the table/i.test(error.message)) return APAGADO
    throw new Error(mensaje('No se ha podido leer si se envía a Diez', error))
  }
  const f = data as Fila | null
  return f ? { encendido: f.enviar === true, desde: s(f.desde), cambiadoPor: s(f.cambiado_por_nombre), cambiadoEn: s(f.cambiado_en) } : APAGADO
}

/** Enciende o apaga, y dice qué ha hecho (regla 8). */
export async function ponerEnvioEmpresa(companyId: string, encender: boolean, quien: string | null): Promise<{ encendido: boolean; texto: string }> {
  const r = await rpc<{ enviar: boolean; texto: string }>('conta_diez_envio_poner', { p_company: companyId, p_enviar: encender, p_quien_nombre: quien })
  return { encendido: r.enviar === true, texto: String(r.texto) }
}

/** El interruptor, en una pantalla (cargando: aún no se sabe, y no se pinta nada de Diez). */
export function useEnvioDiez(accountId: string | null | undefined, companyId: string | null | undefined): { envio: EnvioEmpresa | null; error: string | null; recargar: () => void } {
  const [envio, setEnvio] = useState<EnvioEmpresa | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  useEffect(() => {
    let vivo = true
    // Sin cuenta o empresa, apagado (en una promesa, como lo demás: nada de setState en el cuerpo del efecto).
    const leer = accountId && companyId ? leerEnvioEmpresa(accountId, companyId) : Promise.resolve(APAGADO)
    leer.then((x) => { if (vivo) { setEnvio(x); setError(null) } }, (e: unknown) => { if (vivo) { setEnvio(APAGADO); setError(e instanceof Error ? e.message : String(e)) } })
    return () => { vivo = false }
  }, [accountId, companyId, vuelta])
  return { envio, error, recargar }
}

export const aEnvioAsiento = (f: Fila): EnvioAsiento => ({
  status: String(f.status) as EnvioAsiento['status'], serie: s(f.ext_series), numero: f.ext_number == null ? null : Number(f.ext_number),
  intentos: Number(f.attempts ?? 0), error: s(f.last_error), documento: (s(f.document_status) as EnvioAsiento['documento']) ?? null, siguiente: s(f.next_try_at),
})

/**
 * El envío de cada asiento (el no rechazado) y, de los anulados, el de su
 * contraasiento. `anulados`: id del anulado → id de su contraasiento.
 */
export async function leerEnviosDiez(accountId: string, ids: readonly string[], anulados: ReadonlyMap<string, string> = new Map()): Promise<{ envios: Map<string, EnvioAsiento>; contras: Map<string, EnvioAsiento> }> {
  const envios = new Map<string, EnvioAsiento>()
  const contras = new Map<string, EnvioAsiento>()
  const todos = [...new Set([...ids, ...anulados.values()])]
  const deContra = new Map([...anulados].map(([a, c]) => [c, a]))
  for (let i = 0; i < todos.length; i += 200) {
    const t = todos.slice(i, i + 200)
    const { data, error } = await tabla('external_send').select('entry_id, status, ext_series, ext_number, attempts, last_error, document_status, next_try_at')
      .eq('account_id', accountId).neq('status', 'rechazado').in('entry_id', t)
    if (error) throw new Error(mensaje('No se han podido leer los envíos a Diez', error))
    for (const f of (data ?? []) as Fila[]) {
      const id = String(f.entry_id)
      const e = aEnvioAsiento(f)
      if (ids.includes(id)) envios.set(id, e)
      const anulado = deContra.get(id)
      if (anulado) contras.set(anulado, e)
    }
  }
  return { envios, contras }
}

/** ¿Está encendido «Enviar a Diez» en la empresa de este asiento? */
export async function encendidoDelAsiento(entryId: string): Promise<boolean> {
  const { data, error } = await tabla('journal_entry').select('account_id, company_id').eq('id', entryId).maybeSingle()
  if (error || !data) return false
  const f = data as Fila
  return (await leerEnvioEmpresa(String(f.account_id), String(f.company_id)).catch(() => APAGADO)).encendido
}
