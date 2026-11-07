// supabase/functions/conta-bitrix-leer/contactos.ts
//
// G01c · El recuento de los CONTACTOS de Bitrix24, para decidir con números
// qué contacto es cliente (Julio, 07/11). Puro: recibe los campos medidos con
// crm.contact.fields, los contactos de crm.contact.list (solo los campos
// candidatos), sus empresas enlazadas, las negociaciones y lo de GoCardless, y
// devuelve SOLO números y etiquetas de campos (ni nombres, ni NIF, ni correos).
//
// El enlace con la empresa (documentación oficial de Bitrix24, b24restdocs,
// 07/11): «COMPANY_IDS … In the methods crm.contact.list and crm.contact.get
// this field is not present». Se lee en bloque con crm.item.list
// (entityTypeId = 3, campo companyIds). El recuento #4 dijo «0 con empresa»
// porque esperaba COMPANY_IDS de crm.contact.list.
//
// Hechos de Julio (07/11):
//   · Un cliente es una empresa, o un contacto sin empresa; un contacto con
//     empresa es persona de contacto de todas sus empresas.
//   · Un contacto con empresa y con situación o cuota propias sale en
//     «Pendiente de revisar»; aquí se cuentan.
//   · Los contactos no tienen «Situación del Cliente»: se miden sus listas
//     («Tipo de cliente» y las de cliente, tipo, servicio o campaña) y las
//     señales de cliente (NIF, Tarifa Recurrente, negociación, GoCardless).
//     Hasta que Julio decida, ningún contacto se guarda como cliente.

import { nifComoLaBase, tipoDeNif } from '../_shared/crm/clientes.ts'
import { esCampoSensible } from './sensibles.ts'
import { type CampoMedido } from './mapa.ts'

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
export const etiquetaDe = (m: Record<string, CampoMedido>, codigo: string) => {
  const c = m[codigo]
  return [c?.formLabel, c?.listLabel, c?.title].find((x) => x && x.trim())?.trim() ?? codigo
}

/** Un RIF de Venezuela: J, V, E, G o P y 9 cifras (sin guiones). */
export const esRif = (n: string) => /^[JVEGP][0-9]{9}$/.test(n)

type ConEstado = CampoMedido & { statusType?: string }

/** Los campos que pueden ser cada cosa, por su etiqueta y su tipo (nunca uno de los que no se leen). */
export function candidatosDeContacto(m: Record<string, CampoMedido>) {
  const campos = Object.keys(m).filter((k) => !esCampoSensible(m[k], k))
  const et = (k: string) => sinTildes(etiquetaDe(m, k))
  const tipo = (k: string) => m[k]?.type ?? ''
  const esLista = (k: string) => (m[k]?.items?.length ?? 0) > 0 || (tipo(k) === 'crm_status' && !!(m[k] as ConEstado).statusType)
  return {
    nif: campos.filter((k) => /\b(NIF|CIF|DNI|NIE|RIF|PASAPORTE|DOCUMENTO DE IDENTIDAD)\b/.test(et(k)) && !['file', 'date', 'datetime', 'enumeration', 'boolean'].includes(tipo(k))),
    situacion: campos.filter((k) => (m[k]?.items?.length ?? 0) > 0 && /^(SITUACION|ESTADO)\b|SITUACION DEL CLIENTE/.test(et(k))),
    direccion: campos.filter((k) => tipo(k) === 'address' || k === 'ADDRESS' || (k.startsWith('UF_CRM_') && /\b(DIRECCION|DOMICILIO|CALLE)\b/.test(et(k)) && tipo(k) === 'string')),
    cuotas: campos.filter((k) => /\b(CUOTA|TARIFA)\b/.test(et(k)) && ['money', 'double', 'integer', 'string'].includes(tipo(k))),
    /** Las listas que pueden decir si es cliente: «Tipo de cliente», el tipo de contacto, y las de cliente, tipo, servicio o campaña. */
    listas: campos.filter((k) => esLista(k) && (k === 'TYPE_ID' || /\b(CLIENTE|CLIENTES|TIPO|SERVICIO|SERVICIOS|CAMPANA|CAMPANAS)\b/.test(et(k)))),
    /** La «Tarifa Recurrente» (por su etiqueta). */
    tarifa: campos.filter((k) => /\bTARIFA RECURRENTE\b/.test(et(k))),
  }
}

/** Lo que se pide a crm.contact.list: el id, la empresa principal, el correo y los candidatos. */
export function camposDeContactos(m: Record<string, CampoMedido>): string[] {
  const c = candidatosDeContacto(m)
  return ['ID', ...new Set([...(m.COMPANY_ID ? ['COMPANY_ID'] : []), ...(m.EMAIL ? ['EMAIL'] : []),
    ...c.nif, ...c.situacion, ...c.direccion, ...c.cuotas, ...c.listas, ...c.tarifa])]
}

/** Las listas de tipo crm_status y su «statusType» (sus opciones se piden con crm.status.list). */
export const estadosAPedir = (m: Record<string, CampoMedido>) =>
  candidatosDeContacto(m).listas.filter((k) => m[k]?.type === 'crm_status').map((k) => ({ codigo: k, entidad: String((m[k] as ConEstado).statusType) }))

const tieneAlgo = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.some(tieneAlgo)
  if (v === null || v === undefined || typeof v === 'object') return false
  const t = String(v).split('|')[0].trim()
  return t !== '' && t !== '0'
}
const correosDe = (v: unknown): string[] => {
  const xs = Array.isArray(v) ? v : v ? [v] : []
  return xs.map((x) => (x && typeof x === 'object' ? (x as { VALUE?: unknown }).VALUE : x)).filter((x) => typeof x === 'string' && x.trim())
    .map((x) => String(x).trim().toLowerCase())
}

export interface Candidato { codigo: string; etiqueta: string; tipo: string; conAlgo: number; conAlgoSinEmpresa: number }
export interface Lista { codigo: string; etiqueta: string; opciones: { texto: string; sinEmpresa: number; conEmpresa: number }[]; vaciasSinEmpresa: number; vaciasConEmpresa: number }

export interface ExtrasContactos {
  /** Las empresas enlazadas de cada contacto (crm.item.list, companyIds). */
  empresasDe: ReadonlyMap<string, readonly string[]>
  /** Los contactos que salen en alguna negociación (crm.item.list de negociaciones, contactIds). */
  conNegociacion: ReadonlySet<string>
  /** El NIF de cada empresa (como lo compara la base). */
  nifDeEmpresa: ReadonlyMap<string, string>
  /** Los clientes de GoCardless ya leídos en Sumied: sus NIF y sus correos. */
  gocardless: { nifs: ReadonlySet<string>; correos: ReadonlySet<string> }
  /** Los textos de las opciones de las listas crm_status (crm.status.list): código del campo → id → texto. */
  estados: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export interface ResultadoContactos {
  total: number
  conEmpresa: number
  sinEmpresa: number
  conVariasEmpresas: number
  /** De dónde sale el enlace con la empresa. */
  enlace: string
  /** Contactos con empresa principal (COMPANY_ID) pero sin enlace en companyIds, y al revés: para ver si cuadran. */
  soloEmpresaPrincipal: number
  campos: { codigo: string; etiqueta: string; tipo: string }[]
  bloqueados: number
  candidatos: { nif: Candidato[]; situacion: Candidato[]; direccion: Candidato[]; cuotas: Candidato[] }
  listas: Lista[]
  nif: {
    codigo: string; etiqueta: string
    sinEmpresaConNif: number
    porTipo: { DNI: number; NIE: number; CIF: number; RIF: number; otro: number }
    repetidosEntreContactos: { nifs: number; contactos: number }
  } | null
  /** Los contactos sin empresa: cuántos tienen cada señal de cliente, alguna y ninguna. */
  senalesSinEmpresa: { nif: number; tarifaRecurrente: number; negociacion: number; gocardless: number; alguna: number; ninguna: number }
  /** Los contactos con el NIF de una empresa: cuántos están enlazados a esa empresa, a otra, o a ninguna. */
  nifDeUnaEmpresa: { contactos: number; enlazadosAEsaEmpresa: number; enlazadosAOtra: number; sinEnlace: number }
  conEmpresaYDatosDeCliente: number
}

const mejor = (cs: Candidato[]) => [...cs].sort((a, b) => b.conAlgo - a.conAlgo)[0] ?? null

export function contarContactos(filas: readonly Record<string, unknown>[], m: Record<string, CampoMedido>, x: ExtrasContactos): ResultadoContactos {
  const c = candidatosDeContacto(m)
  const id = (f: Record<string, unknown>) => String(f.ID ?? '')
  const principal = (f: Record<string, unknown>) => { const v = String(f.COMPANY_ID ?? '').trim(); return v && v !== '0' ? v : null }
  const empresas = (f: Record<string, unknown>) => {
    const e = (x.empresasDe.get(id(f)) ?? []).map(String).filter((v) => v && v !== '0')
    const p = principal(f)
    return [...new Set(p ? [...e, p] : e)]
  }
  const conEmp = (f: Record<string, unknown>) => empresas(f).length > 0
  const candidato = (k: string): Candidato => ({ codigo: k, etiqueta: etiquetaDe(m, k), tipo: m[k]?.type ?? '',
    conAlgo: filas.filter((f) => tieneAlgo(f[k])).length, conAlgoSinEmpresa: filas.filter((f) => !conEmp(f) && tieneAlgo(f[k])).length })

  const listas: Lista[] = c.listas.map((k) => {
    const textos: Record<string, string> = m[k]?.items?.length
      ? Object.fromEntries(m[k]!.items!.map((it) => [String(it.ID), it.VALUE])) : { ...(x.estados[k] ?? {}) }
    const opciones = new Map(Object.entries(textos).map(([oid, texto]) => [oid, { texto, sinEmpresa: 0, conEmpresa: 0 }]))
    let vaciasSinEmpresa = 0, vaciasConEmpresa = 0
    for (const f of filas) {
      const vs = (Array.isArray(f[k]) ? f[k] as unknown[] : [f[k]]).map((v) => String(v ?? '').trim()).filter(Boolean)
      if (!vs.length) { if (conEmp(f)) vaciasConEmpresa++; else vaciasSinEmpresa++; continue }
      for (const v of vs) {
        const o = opciones.get(v) ?? { texto: `(opción ${v} sin texto)`, sinEmpresa: 0, conEmpresa: 0 }
        if (conEmp(f)) o.conEmpresa++; else o.sinEmpresa++
        opciones.set(v, o)
      }
    }
    return { codigo: k, etiqueta: etiquetaDe(m, k), opciones: [...opciones.values()], vaciasSinEmpresa, vaciasConEmpresa }
  })

  const cand = { nif: c.nif.map(candidato), situacion: c.situacion.map(candidato), direccion: c.direccion.map(candidato), cuotas: c.cuotas.map(candidato) }
  const nifC = mejor(cand.nif)
  const nifDe = (f: Record<string, unknown>) => (nifC ? nifComoLaBase(f[nifC.codigo]) : null)

  const r: ResultadoContactos = {
    total: filas.length, conEmpresa: filas.filter(conEmp).length, sinEmpresa: filas.filter((f) => !conEmp(f)).length,
    conVariasEmpresas: filas.filter((f) => empresas(f).length > 1).length,
    enlace: 'companyIds (crm.item.list) y COMPANY_ID',
    soloEmpresaPrincipal: filas.filter((f) => principal(f) && !(x.empresasDe.get(id(f)) ?? []).length).length,
    campos: Object.keys(m).filter((k) => !esCampoSensible(m[k], k)).map((k) => ({ codigo: k, etiqueta: etiquetaDe(m, k), tipo: m[k]?.type ?? '' }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es')),
    bloqueados: Object.keys(m).filter((k) => esCampoSensible(m[k], k)).length,
    candidatos: cand, listas, nif: null,
    senalesSinEmpresa: { nif: 0, tarifaRecurrente: 0, negociacion: 0, gocardless: 0, alguna: 0, ninguna: 0 },
    nifDeUnaEmpresa: { contactos: 0, enlazadosAEsaEmpresa: 0, enlazadosAOtra: 0, sinEnlace: 0 },
    conEmpresaYDatosDeCliente: 0,
  }

  if (nifC) {
    const porNif = new Map<string, number>()
    const porTipo = { DNI: 0, NIE: 0, CIF: 0, RIF: 0, otro: 0 }
    let sinEmpresaConNif = 0
    for (const f of filas) {
      if (conEmp(f)) continue
      const n = nifDe(f)
      if (!n) continue
      sinEmpresaConNif++
      porNif.set(n, (porNif.get(n) ?? 0) + 1)
      porTipo[tipoDeNif(n)]++
    }
    const rep = [...porNif.values()].filter((v) => v > 1)
    r.nif = { codigo: nifC.codigo, etiqueta: nifC.etiqueta, sinEmpresaConNif, porTipo,
      repetidosEntreContactos: { nifs: rep.length, contactos: rep.reduce((a, b) => a + b, 0) } }
  }

  // Las señales de cliente de los contactos sin empresa.
  const empresasPorNif = new Map<string, string[]>()
  for (const [e, n] of x.nifDeEmpresa) empresasPorNif.set(n, [...(empresasPorNif.get(n) ?? []), e])
  for (const f of filas) {
    const n = nifDe(f)
    // Los que tienen el NIF de una empresa: ¿están enlazados a ella?
    if (n && empresasPorNif.has(n)) {
      r.nifDeUnaEmpresa.contactos++
      const suyas = empresasPorNif.get(n)!
      const enl = empresas(f)
      if (enl.some((e) => suyas.includes(e))) r.nifDeUnaEmpresa.enlazadosAEsaEmpresa++
      else if (enl.length) r.nifDeUnaEmpresa.enlazadosAOtra++
      else r.nifDeUnaEmpresa.sinEnlace++
    }
    if (conEmp(f)) {
      if (c.situacion.some((k) => tieneAlgo(f[k])) || c.cuotas.some((k) => tieneAlgo(f[k]))) r.conEmpresaYDatosDeCliente++
      continue
    }
    const s = {
      nif: !!n,
      tarifaRecurrente: c.tarifa.some((k) => tieneAlgo(f[k])),
      negociacion: x.conNegociacion.has(id(f)),
      gocardless: (!!n && x.gocardless.nifs.has(n)) || correosDe(f.EMAIL).some((e) => x.gocardless.correos.has(e)),
    }
    for (const [k, v] of Object.entries(s)) if (v) r.senalesSinEmpresa[k as keyof typeof s]++
    if (Object.values(s).some(Boolean)) r.senalesSinEmpresa.alguna++
    else r.senalesSinEmpresa.ninguna++
  }
  return r
}

/** Una página de crm.item.list ({ result: { items }, next, total }) como la de los métodos de antes ({ result: [...] }). */
export function paginaDeItems(r: unknown): unknown {
  const o = r as { result?: { items?: unknown[] }; next?: unknown; total?: unknown; error?: unknown; error_description?: unknown } | null
  if (!o || o.error) return o
  return { result: o.result?.items ?? null, next: o.next, total: o.total }
}

/** De los ítems de crm.item.list de contactos (id, companyIds): contacto → empresas. */
export function empresasDeItems(items: readonly Record<string, unknown>[]): Map<string, string[]> {
  return new Map(items.map((i) => [String(i.id), (Array.isArray(i.companyIds) ? i.companyIds : []).map(String)]))
}

/** De los ítems de crm.item.list de negociaciones (contactIds): los contactos que salen en alguna. */
export function contactosDeNegociaciones(items: readonly Record<string, unknown>[]): Set<string> {
  return new Set(items.flatMap((i) => (Array.isArray(i.contactIds) ? i.contactIds : []).map(String)))
}
