// src/modules/conta/impuestos/certificados.ts
//
// I01b · P4 · Certificados y accesos (tablero 10). Núcleo puro: lo que dice
// cada certificado, cada uso del registro y el aviso de caducidad (que también
// usa Inicio: solo a 30 días o a 7, encargo punto 7). Se prueba sin React
// (tests/unit/modules/conta/i01b/certificados.test.ts).

import { diaMesCorto } from '@/modules/conta/lib/formato'
import { periodoEnPalabras } from './calendario'

export interface Certificado {
  id: string; titular: string; nif_cola: string | null; tipo: 'legal_representative' | 'natural_person' | 'other'; emisor: string
  desde: string; caduca: string; estado: 'active' | 'expired' | 'removed'; almacen: 'vault' | 'kms'; custodia: string
  subido: string; subido_por: string | null; quitado: string | null; quitado_por: string | null
  probado: string | null; prueba: 'ok' | 'error' | null; prueba_mensaje: string | null
  presenta: boolean
  permisos: { persona: string; nombre: string; permiso: 'file' | 'view' }[]
}
export interface Uso {
  cuando: string; quien: string | null; accion: 'upload' | 'test' | 'file' | 'query' | 'receipt_pdf' | 'remove'; resultado: 'ok' | 'error' | 'denied'
  mensaje: string | null
  declaracion: null | { id: string; modelo: string; ejercicio: number; periodo: string; justificante_pdf: string | null }
}
export interface CertificadosVer {
  cuenta: string
  es_admin: boolean
  puede_subir: boolean
  por_que_no_subir: string | null
  presentador: {
    modo: 'company' | 'advisor'; certificado: string | null; asesoria: string | null; base: 'social_collaborator' | 'power_of_attorney' | null
    consentida_por: string | null; consentida_el: string | null; retirada_el: string | null; desde: string | null
  }
  certificados: Certificado[]
  usos: Uso[]
  personas: { id: string; nombre: string; papel: string }[]
}

const fecha = (iso: string) => `${diaMesCorto(iso)}/${iso.slice(0, 4)}`

/** «Certificado de representante de Empresa de ejemplo S.L. · válido hasta el 14/03/2027». */
export function lineaCertificado(c: Certificado): string {
  const tipo = c.tipo === 'legal_representative' ? 'Certificado de representante de' : c.tipo === 'natural_person' ? 'Certificado de persona física de' : 'Certificado de'
  if (c.estado === 'removed') return `${tipo} ${c.titular} · quitado el ${c.quitado ? fecha(c.quitado) : '—'}${c.quitado_por ? ` por ${c.quitado_por}` : ''}`
  return `${tipo} ${c.titular} · ${c.estado === 'expired' ? 'caducó' : 'válido hasta'} el ${fecha(c.caduca)}`
}

/** Los chips de debajo: si funciona (la última prueba), quién puede presentar y quién solo ver. */
export function chipsCertificado(c: Certificado): { tono: 'seguro' | 'falta' | 'neutro' | 'duda'; texto: string }[] {
  const out: { tono: 'seguro' | 'falta' | 'neutro' | 'duda'; texto: string }[] = []
  if (c.estado === 'active') {
    if (c.prueba === 'ok' && c.probado) out.push({ tono: 'seguro', texto: `Funciona · probado con Hacienda el ${diaMesCorto(c.probado)}` })
    else if (c.prueba === 'error' && c.probado) out.push({ tono: 'falta', texto: `No funcionó al probarlo el ${diaMesCorto(c.probado)}` })
    else out.push({ tono: 'duda', texto: 'Aún sin probar con Hacienda' })
  }
  const presentan = c.permisos.filter((p) => p.permiso === 'file').map((p) => p.nombre)
  const ven = c.permisos.filter((p) => p.permiso === 'view').map((p) => p.nombre)
  out.push({ tono: 'neutro', texto: `Pueden presentar: ${presentan.length ? presentan.join(', ') : 'los administradores'}` })
  if (ven.length) out.push({ tono: 'neutro', texto: `Solo ver: ${ven.join(', ')}` })
  return out
}

/** Qué se hizo, en una frase: «Presentó el IVA del 2.º trimestre (303)». */
export function textoUso(u: Uso): string {
  const d = u.declaracion
  const que = d ? `${d.modelo === '303' ? `el IVA del ${periodoEnPalabras(d.periodo)}` : `el ${d.modelo} del ${d.periodo}`} (${d.modelo})` : ''
  switch (u.accion) {
    case 'upload': return 'Subió el certificado'
    case 'test': return 'Prueba de conexión con Hacienda'
    case 'file': return d ? `Presentó ${que}` : 'Presentó una declaración'
    case 'query': return d ? `Comprobó con Hacienda ${que}` : 'Consultó a Hacienda'
    case 'receipt_pdf': return d ? `Bajó el justificante de ${que}` : 'Bajó un justificante'
    case 'remove': return 'Quitó el certificado'
  }
}

/** El resultado: «✓ correcta», el justificante, o lo que falló. */
export function resultadoUso(u: Uso): { tono: 'ok' | 'falta' | 'neutro'; texto: string; justificante: string | null } {
  if (u.resultado === 'denied') return { tono: 'falta', texto: `No se dejó: ${u.mensaje ?? '—'}`, justificante: null }
  if (u.resultado === 'error') return { tono: 'falta', texto: `✗ ${u.mensaje ?? 'falló'}`, justificante: null }
  if (u.accion === 'file' && u.declaracion?.justificante_pdf) return { tono: 'ok', texto: 'Justificante', justificante: u.declaracion.justificante_pdf }
  if (u.accion === 'test' || u.accion === 'query') return { tono: 'ok', texto: '✓ correcta', justificante: null }
  if (u.accion === 'upload' || u.accion === 'remove') return { tono: 'neutro', texto: '—', justificante: null }
  return { tono: 'ok', texto: '✓ hecho', justificante: null }
}

/**
 * El aviso de caducidad: SOLO a 30 días o a 7 (encargo, punto 7). Entre medias
 * y antes, nada; caducado, sí (ya no presenta). Interrumpe (Inicio): el umbral
 * filtra (regla 7, «dónde sí va un umbral»).
 */
export function avisoCaducidad(caduca: string, hoy: string): { tono: 'duda' | 'falta'; texto: string } | null {
  const dias = Math.round((Date.parse(caduca.slice(0, 10)) - Date.parse(hoy)) / 86_400_000)
  if (dias < 0) return { tono: 'falta', texto: `El certificado para presentar impuestos caducó el ${diaMesCorto(caduca)}: sube uno nuevo.` }
  if (dias <= 7) return { tono: 'falta', texto: `El certificado para presentar impuestos caduca el ${diaMesCorto(caduca)}, ${dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `dentro de ${dias} días`}.` }
  if (dias <= 30) return { tono: 'duda', texto: `El certificado para presentar impuestos caduca el ${diaMesCorto(caduca)}, dentro de ${dias} días.` }
  return null
}

/** «Mi asesoría, con su certificado»: la frase de debajo según esté o no. */
export function lineaAsesoria(p: CertificadosVer['presentador']): string {
  if (p.modo === 'advisor' && p.asesoria && !p.retirada_el) {
    const base = p.base === 'social_collaborator' ? 'como colaboradora social' : 'con un poder tuyo en Hacienda'
    return `Presenta ${p.asesoria}, ${base}${p.consentida_por ? `; lo permitió ${p.consentida_por}${p.consentida_el ? ` el ${diaMesCorto(p.consentida_el)}` : ''}` : ''}. Ella sube su certificado en su Sumied; tú no ves nada de él.`
  }
  return 'La asesoría presenta como colaborador social o con un poder tuyo en Hacienda. Ella sube su certificado en su Sumied; tú no ves nada de él.'
}
