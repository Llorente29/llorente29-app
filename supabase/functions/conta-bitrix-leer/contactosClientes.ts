// supabase/functions/conta-bitrix-leer/contactosClientes.ts
//
// G01c · Del adaptador de Bitrix24: un contacto de crm.contact.list, leído
// con su mapa (que es dato: lo confirma una persona en «Qué es cada campo ›
// Contactos»), a la ficha neutra del núcleo (_shared/crm/ficha.ts). Qué es
// cada contacto en Sumied lo decide el núcleo (_shared/crm/contactos.ts), sin
// saber de qué CRM viene. El mapa, de Julio (07/11): NIF = «NIF/NIE»;
// dirección = ADDRESS; cuota de referencia = «Tarifa Recurrente»; los
// contactos no tienen situación: «Tipo de cliente» es un dato de referencia.

import { nifComoLaBase } from '../_shared/crm/clientes.ts'
import { importeACent, normalizarNif, type FichaContactoCrm } from '../_shared/crm/ficha.ts'
import type { CampoMedido } from './mapa.ts'
import { esCampoSensible } from './sensibles.ts'

/** El mapa de contactos: es dato, se confirma en «Qué es cada campo» (pestaña Contactos). */
export interface MapaContactos {
  nif: string | null
  /** La dirección y, si los tiene, sus campos de código postal, población y provincia. */
  direccion: { calle: string; cp?: string | null; poblacion?: string | null; provincia?: string | null } | null
  /** La cuota de referencia («Tarifa Recurrente»): solo se enseña. */
  cuota: string | null
  /** «Tipo de cliente»: un dato de referencia, no la situación. */
  tipoCliente: string | null
  /** El texto de cada opción de «Tipo de cliente». */
  textosTipo?: Record<string, string>
  confirmado?: { quien: string | null; cuando: string } | null
}

/** Lo que no está en el contacto y se mira aparte (sus empresas, las negociaciones, GoCardless). */
export interface ExtrasDeContacto {
  empresas: readonly string[]
  conNegociacion: boolean
  gocardless: { nifs: ReadonlySet<string>; correos: ReadonlySet<string> }
}

/** La ficha de un contacto de Bitrix24: la neutra. */
export type FichaContacto = FichaContactoCrm

/** Lo que se pide a crm.contact.list con un mapa: el nombre, el correo, el teléfono, la empresa principal y los campos del mapa. */
export function camposDeContactoQueSePiden(mapa: MapaContactos): string[] {
  const d = mapa.direccion
  return [...new Set(['ID', 'NAME', 'SECOND_NAME', 'LAST_NAME', 'EMAIL', 'PHONE', 'COMPANY_ID', mapa.nif, d?.calle, d?.cp, d?.poblacion, d?.provincia, mapa.cuota, mapa.tipoCliente]
    .filter((x): x is string => !!x))]
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) { for (const x of v) { const t = texto(x); if (t) return t } return null }
  if (typeof v === 'object') return texto((v as { VALUE?: unknown }).VALUE)
  const t = String(v).trim()
  return t === '' ? null : t
}
const varios = (v: unknown): string[] => {
  const xs = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]
  return [...new Set(xs.map(texto).filter((x): x is string => !!x))]
}
const calle = (v: unknown) => { const t = texto(v); return t ? t.split('|')[0].replace(/\s+/g, ' ').trim() || null : null }
const conImporte = (t: string | null) => { const c = importeACent(t); return c !== null && c !== 0 }

/** Una fila de crm.contact.list → la ficha del contacto, con su mapa y lo que se mira aparte. */
export function leerContacto(fila: Record<string, unknown>, mapa: MapaContactos, x: ExtrasDeContacto): FichaContacto {
  const id = String(fila.ID ?? '')
  const nombre = [texto(fila.NAME), texto(fila.SECOND_NAME), texto(fila.LAST_NAME)].filter(Boolean).join(' ')
  const nifEnCrm = mapa.nif ? texto(fila[mapa.nif]) : null
  const nif = normalizarNif(nifEnCrm)
  const correos = varios(fila.EMAIL).map((c) => c.toLowerCase())
  const cuotaTexto = mapa.cuota ? texto(fila[mapa.cuota]) : null
  const tipoId = mapa.tipoCliente ? texto(fila[mapa.tipoCliente]) : null
  const nb = nifComoLaBase(nif)
  const empresaPrincipal = texto(fila.COMPANY_ID)
  const c = mapa.direccion ? calle(fila[mapa.direccion.calle]) : null
  const cp = mapa.direccion?.cp ? texto(fila[mapa.direccion.cp]) : null
  const poblacion = mapa.direccion?.poblacion ? texto(fila[mapa.direccion.poblacion]) : null
  const provincia = mapa.direccion?.provincia ? texto(fila[mapa.direccion.provincia]) : null
  return {
    tipoFicha: 'contacto', idExterno: id,
    nombre: nombre || `Contacto ${id} de Bitrix24`,
    nif, nifEnCrm, situacion: null, situacionTexto: null,
    tipoCliente: tipoId ? mapa.textosTipo?.[tipoId] ?? tipoId : null,
    empresas: [...new Set([...x.empresas.map(String), ...(empresaPrincipal ? [empresaPrincipal] : [])].filter((e) => e && e !== '0'))],
    correos, telefonos: varios(fila.PHONE),
    calle: c, cp, poblacion, provincia, direccionDe: c || cp || poblacion || provincia ? 'Dirección del contacto' : null, otrasDirecciones: [],
    servicios: [], formaPago: null, emisorSegunCrm: null,
    cuotasReferencia: cuotaTexto ? [{ etiqueta: 'Tarifa recurrente', importeCent: importeACent(cuotaTexto), texto: cuotaTexto }] : [],
    senales: {
      nif: !!nb,
      tarifa: conImporte(cuotaTexto),
      negociacion: x.conNegociacion,
      gocardless: (!!nb && x.gocardless.nifs.has(nb)) || correos.some((e) => x.gocardless.correos.has(e)),
    },
    datosDeCliente: conImporte(cuotaTexto),
    avisos: nombre ? [] : ['Sin nombre en Bitrix24.'],
  }
}

// ── La propuesta del mapa de contactos (la usan la lectura y la pantalla) ────

export interface EleccionContactos { nif: string | null; direccion: string | null; cuota: string | null; tipoCliente: string | null }

const normal = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const etiqueta = (m: Record<string, CampoMedido>, k: string) => [m[k]?.formLabel, m[k]?.listLabel, m[k]?.title].find((x) => x && x.trim())?.trim() ?? k

/**
 * Lo que se propone para los contactos (Julio, 07/11): NIF = «NIF/NIE»;
 * dirección = ADDRESS; cuota de referencia = «Tarifa Recurrente»; y «Tipo de
 * cliente» como dato de referencia (los contactos no tienen situación). Si el
 * mapa ya está guardado, lo de él.
 */
export function propuestaContactos(medidos: Record<string, CampoMedido>, guardado?: Partial<EleccionContactos> | null): EleccionContactos {
  const por = (re: RegExp) => Object.keys(medidos).find((k) => !esCampoSensible(medidos[k], k) && re.test(normal(etiqueta(medidos, k)))) ?? null
  const vale = (k: string | null | undefined) => (k && medidos[k] && !esCampoSensible(medidos[k], k) ? k : null)
  return {
    nif: vale(guardado?.nif) ?? por(/^nif ?\/ ?nie$/) ?? por(/\b(nif|dni|nie)\b/),
    direccion: vale(guardado?.direccion) ?? (medidos.ADDRESS ? 'ADDRESS' : null),
    cuota: vale(guardado?.cuota) ?? por(/^tarifa recurrente$/),
    tipoCliente: vale(guardado?.tipoCliente) ?? por(/^tipo de cliente$/),
  }
}

/** El mapa de contactos que se confirma (o con el que se cuenta antes de confirmarlo), con lo elegido. */
export function mapaContactosDe(e: EleccionContactos, medidos: Record<string, CampoMedido>, textos?: Record<string, string>): MapaContactos {
  const estandar = e.direccion === 'ADDRESS'
  const si = (k: string) => (medidos[k] ? k : null)
  const tipo = e.tipoCliente ? medidos[e.tipoCliente] : null
  const textosTipo = tipo?.items?.length ? Object.fromEntries(tipo.items.map((it) => [String(it.ID), it.VALUE])) : textos
  return {
    nif: e.nif,
    direccion: e.direccion ? { calle: e.direccion, ...(estandar ? { cp: si('ADDRESS_POSTAL_CODE'), poblacion: si('ADDRESS_CITY'), provincia: si('ADDRESS_PROVINCE') } : {}) } : null,
    cuota: e.cuota, tipoCliente: e.tipoCliente,
    ...(textosTipo ? { textosTipo } : {}),
  }
}
