// supabase/functions/conta-bitrix-leer/contactos.ts
//
// G01c · Tarea 2 (07/11/2026) · El recuento de los CONTACTOS de Bitrix24,
// para decidir el mapa de contactos con números (Julio). Puro: recibe los
// campos medidos con crm.contact.fields, los contactos de crm.contact.list
// (solo los campos candidatos) y los NIF de las empresas, y devuelve SOLO
// números y etiquetas de campos (ni nombres, ni NIF, ni direcciones).
//
// Hechos de Julio (07/11):
//   · Un cliente es una empresa, o un contacto sin empresa. Un contacto con
//     empresa es persona de contacto de esa empresa (de todas, si tiene
//     varias), no otro cliente.
//   · Un contacto con empresa y con situación o cuota propias no es cliente
//     automáticamente: sale en «Pendiente de revisar» («Contacto con empresa
//     y con datos de cliente»). Aquí se cuentan.
//   · Los RIF de Venezuela (J, V, E, G o P y 9 cifras) son identificador
//     fiscal extranjero; los demás sin formato, sin NIF.
// Nada se supone: los candidatos salen de la etiqueta y el tipo de cada campo,
// se enseñan todos con su relleno, y el mapa se confirma después.

import { esCampoSensible, nifComoLaBase, tipoDeNif } from './clientes.ts'
import { situacionDeTexto, type CampoMedido } from './mapa.ts'

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
export const etiquetaDe = (m: Record<string, CampoMedido>, codigo: string) => {
  const c = m[codigo]
  return [c?.formLabel, c?.listLabel, c?.title].find((x) => x && x.trim())?.trim() ?? codigo
}

/** Un RIF de Venezuela: J, V, E, G o P y 9 cifras (sin guiones). */
export const esRif = (n: string) => /^[JVEGP][0-9]{9}$/.test(n)

/** Los campos que pueden ser cada cosa, por su etiqueta y su tipo (nunca uno de los que no se leen). */
export function candidatosDeContacto(m: Record<string, CampoMedido>) {
  const campos = Object.keys(m).filter((k) => !esCampoSensible(m[k], k))
  const et = (k: string) => sinTildes(etiquetaDe(m, k))
  const tipo = (k: string) => m[k]?.type ?? ''
  return {
    nif: campos.filter((k) => /\b(NIF|CIF|DNI|NIE|RIF|PASAPORTE|DOCUMENTO DE IDENTIDAD)\b/.test(et(k)) && !['file', 'date', 'datetime', 'enumeration', 'boolean'].includes(tipo(k))),
    situacion: campos.filter((k) => (m[k]?.items?.length ?? 0) > 0 && /^(SITUACION|ESTADO)\b|SITUACION DEL CLIENTE/.test(et(k))),
    direccion: campos.filter((k) => tipo(k) === 'address' || k === 'ADDRESS' || (k.startsWith('UF_CRM_') && /\b(DIRECCION|DOMICILIO|CALLE)\b/.test(et(k)) && tipo(k) === 'string')),
    cuotas: campos.filter((k) => /\b(CUOTA|TARIFA)\b/.test(et(k)) && ['money', 'double', 'integer', 'string'].includes(tipo(k))),
  }
}

/** El campo del enlace con la empresa: COMPANY_IDS (varias) si el portal lo tiene; si no, COMPANY_ID. */
export const campoEnlace = (m: Record<string, CampoMedido>): 'COMPANY_IDS' | 'COMPANY_ID' | null =>
  m.COMPANY_IDS ? 'COMPANY_IDS' : m.COMPANY_ID ? 'COMPANY_ID' : null

/** Lo que se pide a crm.contact.list: el id, el enlace y los candidatos. */
export function camposDeContactos(m: Record<string, CampoMedido>): string[] {
  const c = candidatosDeContacto(m)
  const enlace = campoEnlace(m)
  return ['ID', ...new Set([...(enlace ? [enlace] : []), ...c.nif, ...c.situacion, ...c.direccion, ...c.cuotas])]
}

const tieneAlgo = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.some(tieneAlgo)
  if (v === null || v === undefined || typeof v === 'object') return false
  const t = String(v).split('|')[0].trim()
  return t !== '' && t !== '0'
}
const empresasDe = (f: Record<string, unknown>, enlace: string | null): string[] => {
  if (!enlace) return []
  const v = f[enlace]
  const xs = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]
  return [...new Set(xs.map((x) => String(x).trim()).filter((x) => x && x !== '0'))]
}

export interface Candidato { codigo: string; etiqueta: string; tipo: string; conAlgo: number; conAlgoSinEmpresa: number }
export interface ResultadoContactos {
  total: number
  conEmpresa: number
  sinEmpresa: number
  conVariasEmpresas: number
  enlace: 'COMPANY_IDS' | 'COMPANY_ID' | null
  /** Todos los campos de contacto del portal (etiqueta y tipo), menos los que no se leen nunca. */
  campos: { codigo: string; etiqueta: string; tipo: string }[]
  /** Cuántos campos no se leen nunca (contraseñas, certificados, IBAN). */
  bloqueados: number
  candidatos: { nif: Candidato[]; situacion: Candidato[]; direccion: Candidato[]; cuotas: Candidato[] }
  /** La situación, con el candidato que más relleno tiene: cada opción, sin empresa y con empresa. */
  situacion: { codigo: string; etiqueta: string; opciones: { texto: string; propuesta: string; sinEmpresa: number; conEmpresa: number }[]; vaciasSinEmpresa: number; vaciasConEmpresa: number } | null
  /** El NIF, con el candidato que más relleno tiene. */
  nif: {
    codigo: string; etiqueta: string
    sinEmpresaConNif: number
    porTipo: { DNI: number; NIE: number; CIF: number; RIF: number; otro: number }
    /** Entre contactos sin empresa: NIF que salen en más de uno y cuántos contactos suman. */
    repetidosEntreContactos: { nifs: number; contactos: number }
    /** Contactos sin empresa cuyo NIF ya es el de una empresa. */
    conNifDeUnaEmpresa: { nifs: number; contactos: number }
  } | null
  /** Contactos con empresa y con situación o cuota propias: a «Pendiente de revisar». */
  conEmpresaYDatosDeCliente: number
}

const mejor = (cs: Candidato[]) => [...cs].sort((a, b) => b.conAlgo - a.conAlgo)[0] ?? null

export function contarContactos(
  filas: readonly Record<string, unknown>[], m: Record<string, CampoMedido>, nifsDeEmpresas: ReadonlySet<string>,
): ResultadoContactos {
  const c = candidatosDeContacto(m)
  const enlace = campoEnlace(m)
  const conEmp = (f: Record<string, unknown>) => empresasDe(f, enlace).length > 0
  const candidato = (k: string): Candidato => ({ codigo: k, etiqueta: etiquetaDe(m, k), tipo: m[k]?.type ?? '',
    conAlgo: filas.filter((f) => tieneAlgo(f[k])).length, conAlgoSinEmpresa: filas.filter((f) => !conEmp(f) && tieneAlgo(f[k])).length })
  const cand = { nif: c.nif.map(candidato), situacion: c.situacion.map(candidato), direccion: c.direccion.map(candidato), cuotas: c.cuotas.map(candidato) }

  const r: ResultadoContactos = {
    total: filas.length, conEmpresa: filas.filter(conEmp).length, sinEmpresa: filas.filter((f) => !conEmp(f)).length,
    conVariasEmpresas: filas.filter((f) => empresasDe(f, enlace).length > 1).length, enlace,
    campos: Object.keys(m).filter((k) => !esCampoSensible(m[k], k)).map((k) => ({ codigo: k, etiqueta: etiquetaDe(m, k), tipo: m[k]?.type ?? '' }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es')),
    bloqueados: Object.keys(m).filter((k) => esCampoSensible(m[k], k)).length,
    candidatos: cand, situacion: null, nif: null, conEmpresaYDatosDeCliente: 0,
  }

  const sit = mejor(cand.situacion)
  if (sit) {
    const items = m[sit.codigo]?.items ?? []
    const opciones = items.map((it) => ({ id: String(it.ID), texto: it.VALUE, propuesta: situacionDeTexto(it.VALUE) as string, sinEmpresa: 0, conEmpresa: 0 }))
    let vaciasSinEmpresa = 0, vaciasConEmpresa = 0
    for (const f of filas) {
      const v = f[sit.codigo]
      const id = String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()
      const o = opciones.find((x) => x.id === id)
      if (!o) { if (conEmp(f)) vaciasConEmpresa++; else vaciasSinEmpresa++; continue }
      if (conEmp(f)) o.conEmpresa++; else o.sinEmpresa++
    }
    r.situacion = { codigo: sit.codigo, etiqueta: sit.etiqueta, opciones: opciones.map((o) => ({ texto: o.texto, propuesta: o.propuesta, sinEmpresa: o.sinEmpresa, conEmpresa: o.conEmpresa })), vaciasSinEmpresa, vaciasConEmpresa }
  }

  const nifC = mejor(cand.nif)
  if (nifC) {
    const porNif = new Map<string, number>()
    const porTipo = { DNI: 0, NIE: 0, CIF: 0, RIF: 0, otro: 0 }
    let sinEmpresaConNif = 0
    for (const f of filas) {
      if (conEmp(f)) continue
      const n = nifComoLaBase(f[nifC.codigo])
      if (!n) continue
      sinEmpresaConNif++
      porNif.set(n, (porNif.get(n) ?? 0) + 1)
      const t = tipoDeNif(n)
      if (t === 'otro' && esRif(n)) porTipo.RIF++
      else porTipo[t]++
    }
    const rep = [...porNif.values()].filter((x) => x > 1)
    const deEmpresa = [...porNif.entries()].filter(([n]) => nifsDeEmpresas.has(n))
    r.nif = { codigo: nifC.codigo, etiqueta: nifC.etiqueta, sinEmpresaConNif, porTipo,
      repetidosEntreContactos: { nifs: rep.length, contactos: rep.reduce((a, b) => a + b, 0) },
      conNifDeUnaEmpresa: { nifs: deEmpresa.length, contactos: deEmpresa.reduce((a, [, x]) => a + x, 0) } }
  }

  // Con empresa y con datos de cliente: situación (cualquiera de los candidatos) o una cuota con importe.
  r.conEmpresaYDatosDeCliente = filas.filter((f) => conEmp(f)
    && (c.situacion.some((k) => tieneAlgo(f[k])) || c.cuotas.some((k) => tieneAlgo(f[k])))).length
  return r
}
