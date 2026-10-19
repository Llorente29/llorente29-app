// src/modules/conta/impuestos/despacho/despacho.ts
//
// P01 · «Impuestos de tus clientes» (maqueta_despacho.png): lo que se decide
// sin red. Lo que llega es conta_despacho_trimestre (20261123T0100); aquí se
// decide el color de cada chip, qué deja ver cada filtro, qué entra en un lote
// y cómo se dice todo en palabras de oficina.
//
//   · Regla 7: un filtro lo enciende la persona; con todos apagados se ven
//     TODOS los clientes, y el pie dice «N de M» cuando hay alguno encendido.
//   · Solo entra en un lote lo revisado (estado «listo») y, por ahora, solo el
//     303: es lo único que Sumied presenta. El 111 y el 115 listos se cuentan
//     aparte y la confirmación dice que se presentan fuera (decisión 3, 19/10).

import { eurosExactos } from '@/modules/conta/lib/formato'
import type { TonoChip } from '@/modules/conta/diseno/valores'

export type EstadoModelo = 'presentado' | 'listo' | 'revisar' | 'avisos' | 'por_calcular' | 'no_hace_falta'
export type EstadoCertificado = 'ok' | 'caduca' | 'caducado' | 'quitado' | 'sin_certificado' | 'sin_permiso'

export interface ModeloCliente {
  declaracion: string | null
  modelo: string
  nombre: string | null
  cadencia: 'monthly' | 'quarterly' | 'annual' | 'instalments_202'
  ejercicio: number
  periodo: string
  estado: EstadoModelo
  estado_texto: string
  resultado: 'to_pay' | 'to_refund' | 'to_offset' | 'zero' | 'no_activity' | null
  importe: number | null
  plazo: string | null
  plazo_domiciliacion: string | null
  plazo_suyo: string | null
  domicilia: boolean
  dias: number | null
  urgente: boolean
  atrasado: boolean | null
  errores: number
  avisos: number
  aviso: string | null
  presentada: string | null
  por: 'sumied' | 'outside' | null
  desde_sumied: boolean
}

export interface ClienteDespacho {
  empresa: string
  nombre: string
  razon_social: string | null
  tipo: 'company' | 'self_employed' | null
  hosteleria: boolean | null
  periodo_iva: 'quarterly' | 'monthly' | null
  sii: boolean
  prorrata: number | null
  base: 'social_collaborator' | 'power_of_attorney' | null
  domicilia: boolean
  modelos: ModeloCliente[]
  a_ingresar: number | null
  a_compensar: number | null
  a_devolver: number | null
  responsable: { usuario: string; nombre: string; activa: boolean } | null
  certificado: { id: string | null; estado: EstadoCertificado; titular: string | null; caduca: string | null; dias: number | null }
  listos: number
  listos_303: number
  con_avisos: boolean
  urgentes: number
  pendiente: boolean
  siguiente_paso: string
  orden: number
}

export interface ResumenDespacho {
  clientes: number
  modelos: number
  presentados: number
  listos: number
  para_revisar: number
  vencen: number
  atrasados: number
  filtros: { con_avisos: number; listos: number; sin_certificado: number; domiciliados: number }
}

export interface TrimestreDespacho {
  hoy: string
  ejercicio: number
  periodo: string
  plazos: { presentacion: string | null; domiciliacion: string | null } | null
  asesoria: string
  es_asesoria: boolean
  puede_gestionar: boolean
  resumen: ResumenDespacho
  clientes: ClienteDespacho[]
}

export interface PersonaEquipo { usuario: string; nombre: string; rol: 'admin' | 'manager' | 'worker' }

// ── Fechas y trimestres ──────────────────────────────────────────────────────

/** 'YYYY-MM-DD' → «15/10». */
export function ddmm(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}

/** El trimestre que se está presentando un día dado: el último que ya acabó. */
export function trimestreDe(hoyIso: string): { ejercicio: number; periodo: string } {
  const [a, m] = hoyIso.slice(0, 10).split('-').map(Number)
  const q = Math.floor((m - 1) / 3)          // 0..3: el trimestre en curso
  return q === 0 ? { ejercicio: a - 1, periodo: '4T' } : { ejercicio: a, periodo: `${q}T` }
}

/** Los trimestres del selector: los 8 últimos, del más reciente al más viejo. */
export function trimestresParaElegir(hoyIso: string, cuantos = 8): { ejercicio: number; periodo: string }[] {
  let { ejercicio, periodo } = trimestreDe(hoyIso)
  const out: { ejercicio: number; periodo: string }[] = []
  for (let i = 0; i < cuantos; i++) {
    out.push({ ejercicio, periodo })
    const q = Number(periodo[0])
    if (q === 1) { ejercicio -= 1; periodo = '4T' } else periodo = `${q - 1}T`
  }
  return out
}

const ORDINAL: Record<string, string> = { '1T': '1.er', '2T': '2.º', '3T': '3.er', '4T': '4.º' }

/** «3.er trimestre 2026». */
export function nombreTrimestre(ejercicio: number, periodo: string): string {
  return `${ORDINAL[periodo] ?? periodo} trimestre ${ejercicio}`
}

/**
 * «Hoy» de la pantalla: el de verdad, o el de `?hoy=AAAA-MM-DD` FUERA de
 * producción (demo y capturas, decisión 4 del 19/10). En producción se ignora.
 */
export function hoyDeLaPantalla(buscar: string, esProduccion: boolean, ahora: Date = new Date()): { hoy: string; forzado: boolean } {
  const deVerdad = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
  if (esProduccion) return { hoy: deVerdad, forzado: false }
  const p = new URLSearchParams(buscar).get('hoy')
  if (p && /^\d{4}-\d{2}-\d{2}$/.test(p) && !Number.isNaN(Date.parse(p))) return { hoy: p, forzado: p !== deVerdad }
  return { hoy: deVerdad, forzado: false }
}

// ── Los chips ────────────────────────────────────────────────────────────────

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** El periodo dentro del chip: los mensuales con su mes («303 sep»); los trimestrales, nada; el 202 con su pago. */
export function periodoCorto(m: Pick<ModeloCliente, 'cadencia' | 'periodo'>): string {
  if (m.cadencia === 'monthly') return MES[Number(m.periodo) - 1] ?? m.periodo
  if (m.cadencia === 'instalments_202') return `${({ '1': '1.er', '2': '2.º', '3': '3.er' } as Record<string, string>)[m.periodo[0]] ?? m.periodo} pago`
  return ''
}

/** Un importe con signo de oficina: lo que se compensa o se devuelve, en negativo. */
export function importeConSigno(m: Pick<ModeloCliente, 'resultado' | 'importe'>): number | null {
  if (m.importe === null) return null
  return m.resultado === 'to_offset' || m.resultado === 'to_refund' ? -m.importe : m.importe
}

export interface VistaChip { tono: TonoChip; texto: string; titulo: string }

/**
 * El chip de un modelo (encargo, punto 4): verde presentado o listo, azul para
 * revisar, ámbar con avisos, rojo si vence en 2 días o ya venció. El texto
 * siempre dice lo mismo que el color (WCAG 1.4.1).
 */
export function chipDeModelo(m: ModeloCliente): VistaChip {
  const nombre = [m.modelo, periodoCorto(m)].filter(Boolean).join(' ')
  const titulo = `${m.nombre ?? m.modelo} · ${m.estado_texto}${m.plazo_suyo ? ` · plazo ${ddmm(m.plazo_suyo)}${m.domicilia ? ' (domiciliado)' : ''}` : ''}`
  if (m.estado === 'presentado') return { tono: 'seguro', texto: `${nombre} ✓`, titulo }
  if (m.estado === 'no_hace_falta') return { tono: 'neutro', texto: `${nombre} · no hace falta`, titulo }
  if (m.urgente && m.estado !== 'listo') {
    const cuando = m.dias === null ? '' : m.dias < 0 ? `venció el ${ddmm(m.plazo_suyo)}` : m.dias === 0 ? 'vence hoy' : m.dias === 1 ? 'vence mañana' : `vence en ${m.dias} días`
    return { tono: 'falta', texto: `${nombre} ${cuando}`.trim(), titulo }
  }
  if (m.estado === 'listo') return { tono: 'seguro', texto: `${nombre} listo`, titulo }
  if (m.estado === 'avisos') {
    const n = m.errores + m.avisos
    return { tono: 'duda', texto: `${nombre} · ${n} ${n === 1 ? 'aviso' : 'avisos'}`, titulo: m.aviso ? `${titulo} · ${m.aviso}` : titulo }
  }
  if (m.estado === 'revisar') {
    const imp = importeConSigno(m)
    return { tono: 'accion', texto: imp === null ? nombre : `${nombre} · ${eurosExactos(imp).replace(' €', '')}`, titulo }
  }
  // Por preparar: el plazo, para que se sepa cuánto queda.
  return { tono: 'neutro', texto: m.plazo_suyo ? `${nombre} · hasta ${ddmm(m.plazo_suyo)}` : nombre, titulo }
}

/** El chip del certificado, si hay que decir algo (rojo si caduca o ya no vale). */
export function chipDeCertificado(c: ClienteDespacho['certificado'], hayPendiente: boolean): VistaChip | null {
  if (c.estado === 'caduca') {
    const d = c.dias ?? 0
    return { tono: 'falta', texto: d <= 0 ? 'Certificado caduca hoy' : `Certificado caduca en ${d} ${d === 1 ? 'día' : 'días'}`, titulo: `${c.titular ?? ''} · válido hasta el ${ddmm(c.caduca)}` }
  }
  if (!hayPendiente) return null
  if (c.estado === 'caducado' || c.estado === 'quitado') return { tono: 'falta', texto: 'Certificado caducado', titulo: c.titular ?? '' }
  if (c.estado === 'sin_certificado') return { tono: 'falta', texto: 'Sin certificado', titulo: 'La asesoría no tiene un certificado vivo con el que presentar.' }
  if (c.estado === 'sin_permiso') return { tono: 'duda', texto: 'Sin permiso para el certificado', titulo: 'Tú no puedes presentar con este certificado: pídeselo a la administración.' }
  return null
}

/** «Hostelería · trimestral · domicilia», «Autónoma · estimación directa»… */
export function tipoDeCliente(c: ClienteDespacho): string {
  const partes: string[] = []
  if (c.hosteleria) partes.push('Hostelería')
  else if (c.tipo === 'self_employed') partes.push('Autónomo')
  else if (c.tipo === 'company') partes.push('Sociedad')
  partes.push(c.periodo_iva === 'monthly' ? 'mensual' : 'trimestral')
  if (c.sii) partes.push('SII')
  if (c.prorrata !== null) partes.push(`prorrata ${String(c.prorrata).replace('.', ',')} %`)
  if (c.domicilia) partes.push('domicilia')
  return partes.join(' · ')
}

// ── Los filtros ──────────────────────────────────────────────────────────────

export interface Filtros {
  conAvisos: boolean
  listos: boolean
  sinCertificado: boolean
  domiciliados: boolean
  responsable: string | null     // usuario, '—' = sin responsable, null = todos
  modelo: string | null
}

export const SIN_FILTROS: Filtros = { conAvisos: false, listos: false, sinCertificado: false, domiciliados: false, responsable: null, modelo: null }

export const CERT_PROBLEMA: EstadoCertificado[] = ['sin_certificado', 'caducado', 'quitado', 'sin_permiso']

export function hayFiltros(f: Filtros): boolean {
  return f.conAvisos || f.listos || f.sinCertificado || f.domiciliados || f.responsable !== null || f.modelo !== null
}

/** Los clientes que deja ver un filtro: el orden lo trae la base (lo que vence, primero). */
export function filtrar(clientes: ClienteDespacho[], f: Filtros): ClienteDespacho[] {
  return clientes.filter((c) =>
    (!f.conAvisos || c.con_avisos)
    && (!f.listos || c.listos > 0)
    && (!f.sinCertificado || CERT_PROBLEMA.includes(c.certificado.estado))
    && (!f.domiciliados || c.domicilia)
    && (f.responsable === null || (f.responsable === '—' ? c.responsable === null : c.responsable?.usuario === f.responsable))
    && (f.modelo === null || c.modelos.some((m) => m.modelo === f.modelo)))
}

/** Los modelos que hay en el trimestre, para el filtro (regla 30: de los datos, no de una lista fija). */
export function modelosDelTrimestre(clientes: ClienteDespacho[]): string[] {
  return [...new Set(clientes.flatMap((c) => c.modelos.map((m) => m.modelo)))].sort()
}

// ── El lote ─────────────────────────────────────────────────────────────────

export interface EnLote { cliente: ClienteDespacho; modelo: ModeloCliente }

export interface Lote {
  clientes: number
  /** Lo que Sumied presenta: los 303 revisados. */
  aPresentar: EnLote[]
  /** Lo revisado que aún se presenta fuera (111, 115…). */
  fuera: EnLote[]
  /** Lo elegido que no está revisado: no entra, y se dice. */
  sinRevisar: number
  /** Clientes elegidos cuyo certificado no deja presentar. */
  sinCertificado: ClienteDespacho[]
  aIngresar: number
  aCompensar: number
}

/** El lote de lo elegido: solo lo revisado; del certificado, lo que deja presentar. */
export function loteDe(elegidos: ClienteDespacho[]): Lote {
  const aPresentar: EnLote[] = []
  const fuera: EnLote[] = []
  const sinCertificado: ClienteDespacho[] = []
  let sinRevisar = 0
  for (const c of elegidos) {
    const certNo = CERT_PROBLEMA.includes(c.certificado.estado)
    for (const m of c.modelos) {
      if (m.estado === 'presentado' || m.estado === 'no_hace_falta') continue
      if (m.estado !== 'listo' || !m.declaracion) { sinRevisar++; continue }
      if (!m.desde_sumied) fuera.push({ cliente: c, modelo: m })
      else if (!certNo) aPresentar.push({ cliente: c, modelo: m })
    }
    if (certNo && c.modelos.some((m) => m.estado === 'listo' && m.desde_sumied)) sinCertificado.push(c)
  }
  const listos = [...aPresentar, ...fuera]
  const suma = (r: ModeloCliente['resultado']) => listos.filter((x) => x.modelo.resultado === r).reduce((s, x) => s + (x.modelo.importe ?? 0), 0)
  return { clientes: elegidos.length, aPresentar, fuera, sinRevisar, sinCertificado, aIngresar: suma('to_pay'), aCompensar: suma('to_offset') }
}

/** «1 cliente elegido · 3 modelos listos · 4.902,10 € a ingresar». */
export function resumenLote(l: Lote): string {
  const n = l.aPresentar.length + l.fuera.length
  const partes = [`${l.clientes} ${l.clientes === 1 ? 'cliente elegido' : 'clientes elegidos'}`, `${n} ${n === 1 ? 'modelo listo' : 'modelos listos'}`]
  if (l.aIngresar > 0) partes.push(`${eurosExactos(l.aIngresar)} a ingresar`)
  if (l.aCompensar > 0) partes.push(`${eurosExactos(l.aCompensar)} a compensar`)
  return partes.join(' · ')
}

/** El texto del botón principal de la barra. */
export function textoPresentar(l: Lote): string {
  const n = l.aPresentar.length
  return n === 0 ? 'Nada que presentar' : n === 1 ? 'Presentar el 1 a Hacienda' : `Presentar los ${n} a Hacienda`
}

/**
 * Por qué el botón de presentar no presenta (regla 8: nunca en silencio).
 * null = puede presentar.
 */
export function porQueNoPresenta(l: Lote, puerta: { abierta: boolean; mensaje: string } | null, puedeGestionar: boolean): string | null {
  if (!puedeGestionar) return 'Solo la administración o una encargada de la asesoría presenta.'
  if (l.aPresentar.length === 0) {
    if (l.fuera.length > 0) return 'Lo elegido que está listo se presenta todavía fuera de Sumied (111, 115…).'
    return 'No hay nada revisado entre lo elegido: solo se presenta lo revisado.'
  }
  if (!puerta) return 'Mirando si la conexión con Hacienda está abierta…'
  if (!puerta.abierta) return puerta.mensaje || 'La conexión con Hacienda está cerrada: no se presenta nada todavía.'
  return null
}

// ── Las cifras de arriba ─────────────────────────────────────────────────────

/** La línea de debajo del título: «3.er trimestre 2026 · domiciliados hasta el 15/10 · el resto hasta el 20/10 · hoy 13/10». */
export function lineaDelTrimestre(t: Pick<TrimestreDespacho, 'ejercicio' | 'periodo' | 'plazos' | 'hoy'>): string {
  const partes = [nombreTrimestre(t.ejercicio, t.periodo)]
  if (t.plazos?.domiciliacion) partes.push(`domiciliados hasta el ${ddmm(t.plazos.domiciliacion)}`)
  if (t.plazos?.presentacion) partes.push(`${t.plazos?.domiciliacion ? 'el resto' : 'presentación'} hasta el ${ddmm(t.plazos.presentacion)}`)
  partes.push(`hoy ${ddmm(t.hoy)}`)
  return partes.join(' · ')
}
