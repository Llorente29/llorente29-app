// supabase/functions/conta-bitrix-leer/lectura.ts
//
// G01 · Tarea 3 (06/11/2026). Medir los campos del portal y leer sus empresas
// con el fetch que le pasen (en las pruebas, respuestas grabadas e
// inventadas: tests/unit/modules/conta/gestoria/lecturaBitrix.test.ts).
// Solo lee: crm.company.fields y crm.company.list. Nunca escribe en Bitrix24.

import { camposQueSePiden, leerEmpresa, leerTodas, type CampoMedido, type FichaBitrix, type MapaBitrix } from './mapa.ts'

export type Pedir = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export class FalloBitrix extends Error {}

/** https://<portal>/rest/<usuario>/<clave>/ → el nombre del portal (lo único que se enseña). Null si no es una dirección de webhook entrante. */
export function portalDe(url: string): string | null {
  const m = /^https:\/\/([A-Za-z0-9.-]+)\/rest\/[0-9]+\/[A-Za-z0-9]+\/?$/.exec(url.trim())
  return m ? m[1] : null
}

const metodo = (url: string, nombre: string) => `${url.trim().replace(/\/?$/, '/')}${nombre}.json`

async function llamar(pedir: Pedir, url: string, nombre: string, cuerpo: Record<string, unknown>) {
  const r = await pedir(metodo(url, nombre), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
  const datos = await r.json().catch(() => null) as { error?: string; error_description?: string } | null
  if (!r.ok && !datos?.error) throw new FalloBitrix(r.status === 401 || r.status === 403 ? 'Bitrix24 no acepta esa dirección (¿la clave del webhook ha cambiado?).' : `Bitrix24 ha contestado ${r.status}.`)
  if (datos?.error === 'NO_AUTH_FOUND' || datos?.error === 'INVALID_CREDENTIALS') throw new FalloBitrix('Bitrix24 no acepta esa dirección (¿la clave del webhook ha cambiado?).')
  return datos
}

/** crm.company.fields: lo que es cada campo del portal (también los propios UF_CRM_…). */
export async function medirCampos(pedir: Pedir, url: string): Promise<Record<string, CampoMedido>> {
  const r = await llamar(pedir, url, 'crm.company.fields', {}) as { result?: Record<string, CampoMedido>; error?: string; error_description?: string } | null
  if (r?.error) throw new FalloBitrix(`Bitrix24 ha contestado «${r.error}»${r.error_description ? `: ${r.error_description}` : ''}.`)
  if (!r?.result || typeof r.result !== 'object') throw new FalloBitrix('Bitrix24 no ha devuelto los campos de las empresas.')
  return r.result
}

/** Todas las empresas, de 50 en 50, una petición cada 500 ms, con solo los campos del mapa. */
export async function leerFichas(pedir: Pedir, url: string, mapa: MapaBitrix, esperar: (ms: number) => Promise<void>): Promise<{ fichas: FichaBitrix[]; total: number | null; peticiones: number }> {
  const select = camposQueSePiden(mapa)
  const r = await leerTodas((start) => llamar(pedir, url, 'crm.company.list', { select, order: { ID: 'ASC' }, start }), esperar)
  return { fichas: r.filas.map((f) => leerEmpresa(f, mapa)), total: r.total, peticiones: r.peticiones }
}

/** La frase de la lectura (regla 8). */
export function fraseDeBitrix(n: number, r: { nuevos: number; cambiados: number; iguales: number }, conectada = false): string {
  return `${conectada ? 'Conectado Bitrix24' : 'Leído Bitrix24'}: ${n} empresas (${r.nuevos} nuevas, ${r.cambiados} cambiadas, ${r.iguales} iguales).`
}
