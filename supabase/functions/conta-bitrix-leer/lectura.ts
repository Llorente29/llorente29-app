// supabase/functions/conta-bitrix-leer/lectura.ts
//
// G01 · Tarea 3 (06/11/2026). Medir los campos del portal y leer sus empresas
// con el fetch que le pasen (en las pruebas, respuestas grabadas e
// inventadas: tests/unit/modules/conta/gestoria/lecturaBitrix.test.ts).
// Solo lee: crm.company.fields y crm.company.list. Nunca escribe en Bitrix24.

import { camposQueSePiden, leerEmpresa, leerTodas, type CampoMedido, type FichaBitrix, type MapaBitrix } from './mapa.ts'
import { camposDelRecuento, contar, type GruposRecuento } from './recuento.ts'

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

/**
 * G01b · El recuento: los campos medidos y todas las fichas con solo los
 * campos a contar (de 50 en 50, una petición cada 500 ms). Solo lee. Si el
 * portal no tiene alguno de los campos, para y lo dice.
 */
export async function leerParaRecuento(pedir: Pedir, url: string, grupos: GruposRecuento, esperar: (ms: number) => Promise<void>, opcionesConfirmadas?: Record<string, string> | null) {
  const medidos = await medirCampos(pedir, url)
  const select = camposDelRecuento(grupos)
  const faltan = select.filter((c) => c !== 'ID' && !medidos[c])
  if (faltan.length) throw new FalloBitrix(`Este Bitrix24 no tiene estos campos: ${faltan.join(', ')}.`)
  const r = await leerTodas((start) => llamar(pedir, url, 'crm.company.list', { select, order: { ID: 'ASC' }, start }), esperar)
  return { ...contar(r.filas, grupos, medidos, opcionesConfirmadas), peticiones: r.peticiones }
}

/** La frase de la lectura (regla 8). */
export function fraseDeBitrix(n: number, r: { nuevos: number; cambiados: number; iguales: number }, conectada = false): string {
  return `${conectada ? 'Conectado Bitrix24' : 'Leído Bitrix24'}: ${n} empresas (${r.nuevos} nuevas, ${r.cambiados} cambiadas, ${r.iguales} iguales).`
}

/** Un número con el punto de los miles (1.437), también con cuatro cifras. */
export const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

export interface RepartoDeFichas {
  total: number
  activo: number; baja: number; moroso: number; solo_renta: number; sin_clasificar: number; sin_situacion: number
  conNif: number; conDireccion: number
}

/** G01b · Cuántas fichas quedan en cada situación, y con NIF y dirección (Julio, 07/11). */
export function repartoDe(fichas: readonly Pick<FichaBitrix, 'situacion' | 'nif' | 'calle'>[]): RepartoDeFichas {
  const r: RepartoDeFichas = { total: fichas.length, activo: 0, baja: 0, moroso: 0, solo_renta: 0, sin_clasificar: 0, sin_situacion: 0, conNif: 0, conDireccion: 0 }
  for (const f of fichas) {
    if (f.situacion) r[f.situacion]++
    else r.sin_situacion++
    if (f.nif) r.conNif++
    if (f.calle) r.conDireccion++
  }
  return r
}

/**
 * G01b · La frase del reparto: «1.437 fichas: 327 activas, 12 de baja, …».
 * Sin el mapa confirmado no hay situación que contar, y se dice por qué.
 */
export function fraseDelReparto(r: RepartoDeFichas, confirmado: boolean): string {
  const fichas = `${miles(r.total)} ${r.total === 1 ? 'ficha' : 'fichas'}`
  const nifDir = `Con NIF: ${miles(r.conNif)}; con dirección: ${miles(r.conDireccion)}.`
  if (!confirmado) return `${fichas}. La situación no se guarda hasta confirmar el mapa en «Qué es cada campo». ${nifDir}`
  const partes = [
    `${miles(r.activo)} ${r.activo === 1 ? 'activa' : 'activas'}`,
    `${miles(r.baja)} de baja`,
    `${miles(r.moroso)} ${r.moroso === 1 ? 'morosa' : 'morosas'}`,
    `${miles(r.solo_renta)} solo renta`,
    `${miles(r.sin_clasificar)} sin clasificar`,
    `${miles(r.sin_situacion)} sin situación en Bitrix24`,
  ]
  return `${fichas}: ${partes.join(', ')}. ${nifDir}`
}
