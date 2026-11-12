// supabase/functions/conta-bitrix-leer/lectura.ts
//
// G01 · Tarea 3 (06/11/2026). Medir los campos del portal y leer sus empresas
// con el fetch que le pasen (en las pruebas, respuestas grabadas e
// inventadas: tests/unit/modules/conta/gestoria/lecturaBitrix.test.ts).
// Solo lee: crm.company.fields y crm.company.list. Nunca escribe en Bitrix24.

import { ESPERA_MS, camposQueSePiden, leerEmpresa, leerTodas, type CampoMedido, type FichaBitrix, type MapaBitrix } from './mapa.ts'
import { camposDelRecuento, camposSensiblesDe, contar, type GruposRecuento } from './recuento.ts'
import { nifComoLaBase, nifsQueUnen } from '../_shared/crm/clientes.ts'
import type { FichaContactoCrm } from '../_shared/crm/ficha.ts'
import { repartirContactos, resumenDeContactos, type ResumenContactos } from '../_shared/crm/contactos.ts'
import { esCampoSensible } from './sensibles.ts'
import { camposDeContactoQueSePiden, leerContacto, mapaContactosDe, propuestaContactos, type MapaContactos } from './contactosClientes.ts'
import { planDeFichaBitrix } from '../_shared/avisos/lecturaDeFicha.ts'
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
  const select = conResponsable(pedidos.filter((c) => !bloqueados.includes(c)), medidos)
  await esperar(ESPERA_MS)
  const r = await leerTodas((start) => llamar(pedir, url, 'crm.company.list', { select, order: { ID: 'ASC' }, start }), esperar)
  const fichas = r.filas.map((f) => leerEmpresa(f, mapa))
  const extra = await ponerResponsables(pedir, url, fichas, r.filas, esperar)
  return { fichas, total: r.total, peticiones: r.peticiones + 1 + extra,
    bloqueados: bloqueados.map((c) => [medidos[c]?.formLabel, medidos[c]?.listLabel, medidos[c]?.title].find((x) => x && x.trim())?.trim() ?? c) }
}

/**
 * G01b · El recuento: los campos medidos y todas las fichas con solo los
 * campos a contar (de 50 en 50, una petición cada 500 ms). Solo lee. Si el
 * portal no tiene alguno de los campos, para y lo dice.
 */
export async function leerParaRecuento(pedir: Pedir, url: string, grupos: GruposRecuento, esperar: (ms: number) => Promise<void>, opcionesConfirmadas?: Record<string, string> | null,
  gocardless: { nifs: ReadonlySet<string>; correos: ReadonlySet<string> } = { nifs: new Set(), correos: new Set() }, mapaContactos: MapaContactos | null = null) {
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
  // G01c · Con los campos del mapa con el que lee la lectura, para contar el reparto con su misma regla.
  const conElQueSeLee = mapaConElQueSeLee(deContacto, mapaContactos)
  const pedidos = [...new Set([...camposDeContactos(deContacto), ...(conElQueSeLee ? camposDeContactoQueSePiden(conElQueSeLee) : [])])]
    .filter((c) => c === 'ID' || (deContacto[c] && !esCampoSensible(deContacto[c], c)))
  const rc = await leerTodas((start) => llamar(pedir, url, 'crm.contact.list', { select: pedidos, order: { ID: 'ASC' }, start }), esperar)
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
  const empresasDe = empresasDeItems(ri.filas)
  const conNegociacion = contactosDeNegociaciones(rn.filas)
  const contactos = contarContactos(rc.filas, deContacto, { empresasDe, conNegociacion, nifDeEmpresa, gocardless, estados })
  // G01c (Julio, 07/11) · Y el reparto con la regla de la lectura (_shared/crm/contactos.ts · repartirContactos): los mismos números.
  let reparto: ResumenContactos | null = null
  if (conElQueSeLee) {
    const fichas = rc.filas.map((f) => leerContacto(f, conElQueSeLee, { empresas: empresasDe.get(String(f.ID)) ?? [], conNegociacion: conNegociacion.has(String(f.ID)), gocardless }))
    const nifs = nifsQueUnen([...nifDeEmpresa.values()], fichas.map((c) => c.nif))
    reparto = resumenDeContactos(fichas, repartirContactos(fichas, nifs, 'Bitrix24'), nifs)
  }
  return { ...base, contactos: { ...contactos, reparto }, peticiones }
}

/**
 * G01c · El mapa de contactos con el que se leen (y se cuentan): el confirmado
 * o, sin confirmar, el que se propone. Lo usan la lectura y el recuento, así
 * los dos dicen lo mismo. Null si no hay nada que leer.
 */
export function mapaConElQueSeLee(medidos: Record<string, CampoMedido>, guardado: MapaContactos | null): MapaContactos | null {
  const base = guardado?.confirmado ? guardado
    : mapaContactosDe(propuestaContactos(medidos, guardado ? { nif: guardado.nif, direccion: guardado.direccion?.calle ?? null, cuota: guardado.cuota, tipoCliente: guardado.tipoCliente } : null), medidos)
  return base.nif || base.direccion || base.cuota ? base : null
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
  const base = mapaConElQueSeLee(medidos, guardado)
  if (!base) return { medidos, mapa: null, contactos: [], peticiones }
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

// ── G01d · Una ficha suelta, para los avisos al instante ─────────────────────
//
// Lo mismo que la lectura entera (leerFichas, leerContactos): los mismos
// campos, sin los sensibles, y la misma conversión a ficha neutra; solo que de
// UNA ficha, con un filtro por su id (_shared/avisos/lecturaDeFicha.ts). Las
// negociaciones de un contacto no se piden (Julio, 08/11): se toman de lo que
// guardó la última lectura entera; las nuevas entran con la de la noche.
// Null: la ficha ya no está en el CRM (se ha borrado entre el aviso y ahora).


export async function leerEmpresaSuelta(pedir: Pedir, url: string, mapa: MapaBitrix, id: string): Promise<{ ficha: FichaBitrix | null; bloqueados: string[] }> {
  const medidos = await medirCampos(pedir, url)
  const pedidos = camposQueSePiden(mapa)
  const bloqueados = pedidos.filter((c) => esCampoSensible(medidos[c], c))
  const select = conResponsable(pedidos.filter((c) => !bloqueados.includes(c)), medidos)
  const plan = planDeFichaBitrix({ tipo: 'leer_ficha', crm: 'bitrix24', tipoFicha: 'empresa', idExterno: id, claves: [] }, { empresa: select, contacto: [] })
  if (plan.tipo !== 'leer') return { ficha: null, bloqueados }
  const r = await llamar(pedir, url, plan.peticiones[0].metodo, plan.peticiones[0].cuerpo) as { result?: Record<string, unknown>[]; error?: string } | null
  if (r?.error) throw new FalloBitrix(`Bitrix24 ha contestado «${r.error}».`)
  const fila = (r?.result ?? []).find((f) => String(f.ID) === id)
  if (!fila) return { ficha: null, bloqueados }
  const ficha = leerEmpresa(fila, mapa)
  // nº 24 · También aquí: si no, la lectura suelta de un aviso dejaría la ficha sin su responsable.
  await ponerResponsables(pedir, url, [ficha], [fila], async () => {})
  return { ficha, bloqueados }
}

/** nº 24 · El responsable de la ficha (ASSIGNED_BY_ID), si el portal lo tiene: se pide además de los campos del mapa. */
export function conResponsable(select: string[], medidos: Record<string, CampoMedido>): string[] {
  return medidos.ASSIGNED_BY_ID && !select.includes('ASSIGNED_BY_ID') ? [...select, 'ASSIGNED_BY_ID'] : select
}

/**
 * nº 24 (Code 3, 7) · Quién lleva a cada cliente: el ASSIGNED_BY_ID de su ficha
 * con su nombre y su correo, de user.get (una petición por persona, una cada
 * 500 ms; suelen ser pocas). Si el webhook no puede leer usuarios (le falta el
 * permiso «user»), se queda el id, sin nombre ni correo, y se dice una vez en
 * los avisos de la primera ficha. Devuelve cuántas peticiones ha hecho.
 */
export async function ponerResponsables(pedir: Pedir, url: string, fichas: FichaBitrix[], filas: Record<string, unknown>[],
  esperar: (ms: number) => Promise<void>): Promise<number> {
  const ids = filas.map((f) => idDeResponsable(f.ASSIGNED_BY_ID))
  const distintos = [...new Set(ids.filter((x): x is string => !!x))]
  const quien = new Map<string, { nombre: string | null; correo: string | null }>()
  let peticiones = 0
  let sinPermiso: string | null = null
  for (const id of distintos) {
    await esperar(ESPERA_MS)
    peticiones++
    const r = await llamar(pedir, url, 'user.get', { FILTER: { ID: id } }) as { result?: Record<string, unknown>[]; error?: string; error_description?: string } | null
    if (r?.error) { sinPermiso = r.error_description || r.error; break }
    const u = (r?.result ?? []).find((x) => String(x.ID) === id)
    if (u) quien.set(id, datosDeUsuario(u))
  }
  fichas.forEach((f, i) => {
    const id = ids[i]
    f.responsable = id ? { idExterno: id, ...(quien.get(id) ?? { nombre: null, correo: null }) } : null
  })
  if (sinPermiso && fichas.length) fichas[0].avisos.push(`No se ha podido leer quién lleva a cada cliente (user.get: ${sinPermiso}). Dale al webhook el permiso «Usuarios».`)
  return peticiones
}

const idDeResponsable = (x: unknown) => (typeof x === 'string' || typeof x === 'number') && /^[0-9]{1,18}$/.test(String(x)) && String(x) !== '0' ? String(x) : null

/** Lo que Bitrix24 enseña cuando un usuario no tiene nombre: no es un nombre (nº 29). */
const SIN_NOMBRE = new Set(['sin título', 'sin titulo', 'untitled'])

/** El nombre («Nombre Apellidos») y el correo de un usuario de Bitrix24 (user.get).
 *  Sin nombre, null: ni «Sin título» ni el login en su lugar (el portal no dice «Te lleva: Sin título»). */
export function datosDeUsuario(u: Record<string, unknown>): { nombre: string | null; correo: string | null } {
  const texto = (x: unknown) => (typeof x === 'string' && x.trim() && !SIN_NOMBRE.has(x.trim().toLowerCase()) ? x.trim() : null)
  const nombre = [texto(u.NAME), texto(u.LAST_NAME)].filter(Boolean).join(' ')
  const correo = texto(u.EMAIL)
  return { nombre: nombre || null, correo: correo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ? correo.toLowerCase() : null }
}

export async function leerContactoSuelto(pedir: Pedir, url: string, guardado: MapaContactos | null, id: string,
  extras: { conNegociacion: boolean; gocardless: { nifs: ReadonlySet<string>; correos: ReadonlySet<string> } }): Promise<{ ficha: FichaContactoCrm | null; mapa: MapaContactos | null }> {
  const medidos = await medirCampos(pedir, url, 'contact')
  const base = mapaConElQueSeLee(medidos, guardado)
  if (!base) return { ficha: null, mapa: null }
  const select = camposDeContactoQueSePiden(base).filter((c) => c === 'ID' || (medidos[c] && !esCampoSensible(medidos[c], c)))
  const plan = planDeFichaBitrix({ tipo: 'leer_ficha', crm: 'bitrix24', tipoFicha: 'contacto', idExterno: id, claves: [] }, { empresa: [], contacto: select })
  if (plan.tipo !== 'leer') return { ficha: null, mapa: base }
  const rc = await llamar(pedir, url, plan.peticiones[0].metodo, plan.peticiones[0].cuerpo) as { result?: Record<string, unknown>[]; error?: string } | null
  if (rc?.error) throw new FalloBitrix(`Bitrix24 ha contestado «${rc.error}».`)
  const fila = (rc?.result ?? []).find((f) => String(f.ID) === id)
  if (!fila) return { ficha: null, mapa: base }
  const ri = paginaDeItems(await llamar(pedir, url, plan.peticiones[1].metodo, plan.peticiones[1].cuerpo)) as { result?: Record<string, unknown>[] | null } | null
  const empresas = empresasDeItems(ri?.result ?? []).get(id) ?? []
  // Los textos de «Tipo de cliente», los guardados con el mapa (los de la lectura entera); sin ellos, el código tal cual.
  return { ficha: leerContacto(fila, base, { empresas, conNegociacion: extras.conNegociacion, gocardless: extras.gocardless }), mapa: base }
}
