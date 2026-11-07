// supabase/functions/conta-bitrix-leer/lectura.ts
//
// G01 · Tarea 3 (06/11/2026). Medir los campos del portal y leer sus empresas
// con el fetch que le pasen (en las pruebas, respuestas grabadas e
// inventadas: tests/unit/modules/conta/gestoria/lecturaBitrix.test.ts).
// Solo lee: crm.company.fields y crm.company.list. Nunca escribe en Bitrix24.

import { ESPERA_MS, camposQueSePiden, leerEmpresa, leerTodas, type CampoMedido, type FichaBitrix, type MapaBitrix } from './mapa.ts'
import { camposDelRecuento, camposSensiblesDe, contar, type GruposRecuento } from './recuento.ts'
import { nifComoLaBase } from '../_shared/crm/clientes.ts'
import type { FichaContactoCrm } from '../_shared/crm/ficha.ts'
import { esCampoSensible } from './sensibles.ts'
import { camposDeContactoQueSePiden, leerContacto, mapaContactosDe, propuestaContactos, type MapaContactos } from './contactosClientes.ts'
import { camposDeContactos, contactosDeNegociaciones, contarContactos, empresasDeItems, estadosAPedir, paginaDeItems } from './contactos.ts'

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
export async function medirCampos(pedir: Pedir, url: string, de: 'company' | 'contact' = 'company'): Promise<Record<string, CampoMedido>> {
  const r = await llamar(pedir, url, `crm.${de}.fields`, {}) as { result?: Record<string, CampoMedido>; error?: string; error_description?: string } | null
  if (r?.error) throw new FalloBitrix(`Bitrix24 ha contestado «${r.error}»${r.error_description ? `: ${r.error_description}` : ''}.`)
  if (!r?.result || typeof r.result !== 'object') throw new FalloBitrix(`Bitrix24 no ha devuelto los campos de ${de === 'company' ? 'las empresas' : 'los contactos'}.`)
  return r.result
}

/**
 * Todas las empresas, de 50 en 50, una petición cada 500 ms, con solo los
 * campos del mapa. G01b · Antes, los campos del portal: uno con una contraseña
 * o un certificado (clientes.ts · esCampoSensible) no se pide nunca, aunque
 * esté en el mapa por error; se quita y se dice cuál («bloqueados»).
 */
export async function leerFichas(pedir: Pedir, url: string, mapa: MapaBitrix, esperar: (ms: number) => Promise<void>): Promise<{ fichas: FichaBitrix[]; total: number | null; peticiones: number; bloqueados: string[] }> {
  const medidos = await medirCampos(pedir, url)
  const pedidos = camposQueSePiden(mapa)
  const bloqueados = pedidos.filter((c) => esCampoSensible(medidos[c], c))
  const select = pedidos.filter((c) => !bloqueados.includes(c))
  await esperar(ESPERA_MS)
  const r = await leerTodas((start) => llamar(pedir, url, 'crm.company.list', { select, order: { ID: 'ASC' }, start }), esperar)
  return { fichas: r.filas.map((f) => leerEmpresa(f, mapa)), total: r.total, peticiones: r.peticiones + 1,
    bloqueados: bloqueados.map((c) => [medidos[c]?.formLabel, medidos[c]?.listLabel, medidos[c]?.title].find((x) => x && x.trim())?.trim() ?? c) }
}

/**
 * G01b · El recuento: los campos medidos y todas las fichas con solo los
 * campos a contar (de 50 en 50, una petición cada 500 ms). Solo lee. Si el
 * portal no tiene alguno de los campos, para y lo dice.
 */
export async function leerParaRecuento(pedir: Pedir, url: string, grupos: GruposRecuento, esperar: (ms: number) => Promise<void>, opcionesConfirmadas?: Record<string, string> | null,
  gocardless: { nifs: ReadonlySet<string>; correos: ReadonlySet<string> } = { nifs: new Set(), correos: new Set() }) {
  const medidos = await medirCampos(pedir, url)
  const select = camposDelRecuento(grupos)
  const faltan = select.filter((c) => c !== 'ID' && !medidos[c])
  if (faltan.length) throw new FalloBitrix(`Este Bitrix24 no tiene estos campos: ${faltan.join(', ')}.`)
  // G01b · Un campo con una contraseña o un certificado no se cuenta nunca.
  const sensibles = camposSensiblesDe(select, medidos)
  if (sensibles.length) throw new FalloBitrix(`Estos campos guardan contraseñas o certificados y no se leen nunca: ${sensibles.join(', ')}.`)
  const r = await leerTodas((start) => llamar(pedir, url, 'crm.company.list', { select, order: { ID: 'ASC' }, start }), esperar)
  const base = contar(r.filas, grupos, medidos, opcionesConfirmadas)
  if (!grupos.contactos) return { ...base, peticiones: r.peticiones }
  // G01c · Los contactos: sus campos (etiqueta y tipo) y cada contacto con solo los candidatos.
  let peticiones = r.peticiones
  const otra = async <T>(f: () => Promise<T>) => { await esperar(ESPERA_MS); peticiones++; return f() }
  const deContacto = await otra(() => medirCampos(pedir, url, 'contact'))
  await esperar(ESPERA_MS)
  const rc = await leerTodas((start) => llamar(pedir, url, 'crm.contact.list', { select: camposDeContactos(deContacto), order: { ID: 'ASC' }, start }), esperar)
  peticiones += rc.peticiones
  // El enlace con la empresa: crm.contact.list no trae COMPANY_IDS (documentación oficial); crm.item.list sí (companyIds).
  await esperar(ESPERA_MS)
  const ri = await leerTodas(async (start) => paginaDeItems(await llamar(pedir, url, 'crm.item.list', { entityTypeId: 3, select: ['id', 'companyIds'], order: { id: 'ASC' }, start })), esperar)
  peticiones += ri.peticiones
  // Las negociaciones: crm.deal.list no trae CONTACT_IDS; crm.item.list (entityTypeId = 2) sí (contactIds).
  await esperar(ESPERA_MS)
  const rn = await leerTodas(async (start) => paginaDeItems(await llamar(pedir, url, 'crm.item.list', { entityTypeId: 2, select: ['id', 'contactIds'], order: { id: 'ASC' }, start })), esperar)
  peticiones += rn.peticiones
  // Los textos de las listas de tipo crm_status (el tipo de contacto…).
  const estados: Record<string, Record<string, string>> = {}
  for (const e of estadosAPedir(deContacto)) {
    const st = await otra(() => llamar(pedir, url, 'crm.status.list', { filter: { ENTITY_ID: e.entidad } })) as { result?: { STATUS_ID: string; NAME: string }[] } | null
    estados[e.codigo] = Object.fromEntries((st?.result ?? []).map((x) => [String(x.STATUS_ID), String(x.NAME)]))
  }
  const nifDeEmpresa = new Map<string, string>()
  if (grupos.repetidos) for (const f of r.filas) { const n = nifComoLaBase(f[grupos.repetidos.nif]); if (n) nifDeEmpresa.set(String(f.ID), n) }
  const contactos = contarContactos(rc.filas, deContacto, {
    empresasDe: empresasDeItems(ri.filas), conNegociacion: contactosDeNegociaciones(rn.filas), nifDeEmpresa, gocardless, estados,
  })
  return { ...base, contactos, peticiones }
}

/**
 * G01c · Los contactos de Bitrix24, a fichas neutras: sus campos medidos
 * (crm.contact.fields), cada contacto con solo los campos del mapa
 * (crm.contact.list), sus empresas (crm.item.list, companyIds: crm.contact.list
 * no trae COMPANY_IDS, según la documentación oficial), las negociaciones
 * (crm.item.list de negociaciones, contactIds) y los textos de «Tipo de
 * cliente» si es de tipo crm_status (crm.status.list). Sin el mapa confirmado,
 * con el que se propone (para decir cuántos hay de cada antes de confirmar).
 * Solo lee.
 */
export async function leerContactos(pedir: Pedir, url: string, guardado: MapaContactos | null, esperar: (ms: number) => Promise<void>,
  gocardless: { nifs: ReadonlySet<string>; correos: ReadonlySet<string> }): Promise<{ medidos: Record<string, CampoMedido>; mapa: MapaContactos | null; contactos: FichaContactoCrm[]; peticiones: number }> {
  let peticiones = 0
  const otra = async <T>(f: () => Promise<T>) => { await esperar(ESPERA_MS); peticiones++; return f() }
  const medidos = await otra(() => medirCampos(pedir, url, 'contact'))
  const base = guardado?.confirmado ? guardado : mapaContactosDe(propuestaContactos(medidos, guardado ? { nif: guardado.nif, direccion: guardado.direccion?.calle ?? null, cuota: guardado.cuota, tipoCliente: guardado.tipoCliente } : null), medidos)
  if (!base.nif && !base.direccion && !base.cuota) return { medidos, mapa: null, contactos: [], peticiones }
  // Un campo con una contraseña, un certificado o el IBAN no se pide nunca, aunque esté en el mapa por error.
  const select = camposDeContactoQueSePiden(base).filter((c) => c === 'ID' || (medidos[c] && !esCampoSensible(medidos[c], c)))
  await esperar(ESPERA_MS)
  const rc = await leerTodas((start) => llamar(pedir, url, 'crm.contact.list', { select, order: { ID: 'ASC' }, start }), esperar)
  peticiones += rc.peticiones
  await esperar(ESPERA_MS)
  const ri = await leerTodas(async (start) => paginaDeItems(await llamar(pedir, url, 'crm.item.list', { entityTypeId: 3, select: ['id', 'companyIds'], order: { id: 'ASC' }, start })), esperar)
  peticiones += ri.peticiones
  await esperar(ESPERA_MS)
  const rn = await leerTodas(async (start) => paginaDeItems(await llamar(pedir, url, 'crm.item.list', { entityTypeId: 2, select: ['id', 'contactIds'], order: { id: 'ASC' }, start })), esperar)
  peticiones += rn.peticiones
  let textos = base.textosTipo
  const tipo = base.tipoCliente ? medidos[base.tipoCliente] as (CampoMedido & { statusType?: string }) | undefined : undefined
  if (!textos && tipo?.type === 'crm_status' && tipo.statusType) {
    const st = await otra(() => llamar(pedir, url, 'crm.status.list', { filter: { ENTITY_ID: tipo.statusType } })) as { result?: { STATUS_ID: string; NAME: string }[] } | null
    textos = Object.fromEntries((st?.result ?? []).map((x) => [String(x.STATUS_ID), String(x.NAME)]))
  }
  const mapa: MapaContactos = { ...base, ...(textos ? { textosTipo: textos } : {}) }
  const empresasDe = empresasDeItems(ri.filas)
  const conNegociacion = contactosDeNegociaciones(rn.filas)
  const contactos = rc.filas.map((f) => leerContacto(f, mapa, { empresas: empresasDe.get(String(f.ID)) ?? [], conNegociacion: conNegociacion.has(String(f.ID)), gocardless }))
  return { medidos, mapa, contactos, peticiones }
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
