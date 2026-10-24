// supabase/functions/_shared/hacienda/puerta.ts
//
// I01a · 6 · LA PUERTA DE HACIENDA: toda llamada a la AEAT pasa por aquí, y
// por ningún otro sitio.
//
// Tres llamadas (informe I01 paso 1, §1.2 y §1.5; Especificaciones de
// Presentación Directa, Consulta de Declaraciones Presentadas y Validación de
// Impresión, v3.0):
//   · presentar: Presentación Directa (PresBasicaDos), POST JSON con el
//     fichero del diseño de registro. Correcta: CSV, justificante, expediente,
//     urlPdf… Con errores: hasta 100 E00…, y NO se graba nada.
//   · consultar: Consulta de declaraciones presentadas (ConsultaExt), POST de
//     formulario con certificado; XML con hasta 100 declaraciones (csv,
//     justificante, fecha…). Sirve también para «Probar con Hacienda»: lleva
//     certificado y no presenta nada.
//   · pdf: el justificante. El de una presentación, de su urlPdf; el de una
//     declaración presentada fuera, de la URL del CSV (VisualizaSc). Sin
//     certificado (si esa URL lo pide, no se sabe: §1.5 [?]). Si no responde,
//     se dice, y quien llama pide subir el PDF.
//
// Hay dos: la de verdad (HaciendaAeat) y el doble (doble.ts). La de verdad
// NO SE ABRE sola: abrirPuerta solo la da con el entorno puesto a propósito y
// su autorización (el freno de abajo). Sin nada, la puerta está cerrada y
// todo se niega con un mensaje que lo dice. Las pruebas usan siempre el doble.
//
// Núcleo sin Deno: el certificado viaja con llamarConCertificado (mtls.ts),
// que pone tiempo límite y cierra el cliente. Aquí no se escribe nada en el
// registro: ni cabeceras, ni cuerpos, ni el certificado, ni el CSV.

import { llamarConCertificado, type MaterialCertificado, type Opciones as OpcionesMtls } from '../certificados/mtls.ts'
import type { Firmante } from '../certificados/leerP12.ts'

export type Entorno = 'cerrada' | 'doble' | 'pruebas' | 'produccion'

export interface PeticionPresentar {
  modelo: string
  ejercicio: number
  periodo: string
  /** El fichero del diseño de registro, sin saltos de línea ni tabuladores. */
  fichero: string
  /** Solo si se paga con NRC. */
  nrc?: string | null
  firmante: Firmante
}

export interface ErrorHacienda { codigo: string; texto: string }

export type ResultadoPresentar =
  | {
      ok: true
      csv: string
      fecha: string | null
      hora: string | null
      expediente: string | null
      justificante: string | null
      nifPresentador: string | null
      tipoRepresentacion: string | null
      nifDeclarante: string | null
      nrc: string | null
      importe: string | null
      urlPdf: string | null
      avisos: string[]
      advertencias: string[]
    }
  | { ok: false; errores: ErrorHacienda[] }

export interface PeticionConsultar { nif: string; modelo?: string; ejercicio?: number; periodo?: string }

export interface Presentada {
  ejercicio: string
  modelo: string
  periodo: string
  nif: string
  csv: string
  expediente: string | null
  justificante: string | null
  justificanteAnterior: string | null
  fechaHora: string | null
}

export type ResultadoPdf =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; motivo: 'no_responde' | 'no_es_pdf'; mensaje: string }

export interface Hacienda {
  readonly entorno: Entorno
  presentar(m: MaterialCertificado, p: PeticionPresentar): Promise<ResultadoPresentar>
  consultar(m: MaterialCertificado, p: PeticionConsultar): Promise<Presentada[]>
  /**
   * El PDF de una URL de Hacienda (la urlPdf de una presentación o la del CSV),
   * sin certificado. Si Hacienda no lo da así, se pide subirlo.
   */
  pdf(url: string): Promise<ResultadoPdf>
  /** La URL del PDF de una declaración, a partir de su CSV. */
  urlPdfDeCsv(csv: string): string
}

/** Hacienda ha contestado algo que no se entiende: no se sabe si ha pasado. */
export class RespuestaRara extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'RespuestaRara'
  }
}

/** La puerta está cerrada (o este entorno no está autorizado). */
export class PuertaCerrada extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'PuertaCerrada'
  }
}

// ── Las direcciones (informe I01 paso 1, §1.2, §1.4 y §1.5) ──────────────────
export const DIRECCIONES = {
  pruebas: {
    presentar: 'https://prewww1.aeat.es/wlpl/PFTW-PICW/PresBasicaDos',
    consultar: 'https://prewww1.aeat.es/wlpl/SCEJ-MANT/ConsultaExt',
    pdfCsv: 'https://prewww2.aeat.es/wlpl/inwinvoc/es.aeat.dit.adu.eeca.catalogo.VisualizaSc?COMPLETA=SI&ORIGEN=C&CSV=',
  },
  produccion: {
    presentar: 'https://www1.agenciatributaria.gob.es/wlpl/PFTW-PICW/PresBasicaDos',
    consultar: 'https://www1.agenciatributaria.gob.es/wlpl/SCEJ-MANT/ConsultaExt',
    pdfCsv: 'https://www2.agenciatributaria.gob.es/wlpl/inwinvoc/es.aeat.dit.adu.eeca.catalogo.VisualizaSc?COMPLETA=SI&ORIGEN=C&CSV=',
  },
} as const

// ── Leer lo que contesta Hacienda ───────────────────────────────────────────
const texto = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : texto(v) ? [String(v)] : [])

function unError(e: unknown): ErrorHacienda {
  if (typeof e === 'string') {
    const m = e.trim().match(/^([A-Z]\d{3,6})\s*[-:.]?\s*(.*)$/)
    return m ? { codigo: m[1], texto: m[2] || m[1] } : { codigo: 'SIN_CODIGO', texto: e.trim() }
  }
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    const codigo = texto(o.codigo ?? o.Codigo ?? o.code ?? o.cod) ?? 'SIN_CODIGO'
    return { codigo, texto: texto(o.descripcion ?? o.Descripcion ?? o.texto ?? o.mensaje ?? o.message) ?? codigo }
  }
  return { codigo: 'SIN_CODIGO', texto: String(e) }
}

/**
 * La respuesta de PresBasicaDos. Correcta si trae CSV; con errores si trae
 * errores y ningún CSV. Cualquier otra cosa es RespuestaRara: no se sabe si se
 * ha grabado, y así se dice.
 */
export function leerPresentacion(cuerpo: string): ResultadoPresentar {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(cuerpo)
  } catch {
    throw new RespuestaRara('Hacienda ha contestado algo que no se entiende. No sabemos si se ha presentado: compruébalo antes de repetir.')
  }
  const r = (o.respuesta ?? o.Respuesta ?? o) as Record<string, unknown>
  const csv = texto(r.CodigoSeguroVerificacion ?? r.codigoSeguroVerificacion ?? r.CSV ?? r.csv)
  const errores = (r.errores ?? r.Errores ?? r.ErroresDeclaracion ?? null) as unknown
  if (csv) {
    return {
      ok: true, csv,
      fecha: texto(r.Fecha), hora: texto(r.Hora), expediente: texto(r.Expediente), justificante: texto(r.Justificante),
      nifPresentador: texto(r.NIFPresentador), tipoRepresentacion: texto(r.TipoRepresentacion), nifDeclarante: texto(r.NIFDeclarante),
      nrc: texto(r.NRCPago), importe: texto(r.ImporteAIngresar), urlPdf: texto(r.urlPdf ?? r.UrlPdf ?? r.URLPdf),
      avisos: lista(r.avisos ?? r.Avisos), advertencias: lista(r.advertencias ?? r.Advertencias),
    }
  }
  const lst = Array.isArray(errores) ? errores : errores ? [errores] : []
  if (lst.length > 0) return { ok: false, errores: lst.map(unError) }
  throw new RespuestaRara('Hacienda ha contestado sin CSV y sin errores. No sabemos si se ha presentado: compruébalo antes de repetir.')
}

const etiqueta = (xml: string, nombre: string): string | null => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nombre}>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`, 'i'))
  return m ? texto(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : null
}

/** La respuesta de ConsultaExt (consultas.xsd): cada declaración presentada. */
export function leerConsulta(xml: string): Presentada[] {
  if (!/<[^>]+>/.test(xml)) throw new RespuestaRara('Hacienda ha contestado a la consulta algo que no se entiende.')
  const bloques = [...xml.matchAll(/<(?:\w+:)?declaracion\b[^>]*>([\s\S]*?)<\/(?:\w+:)?declaracion>/gi)].map((m) => m[1])
  return bloques.map((b) => ({
    ejercicio: etiqueta(b, 'ejercicio') ?? '',
    modelo: etiqueta(b, 'modelo') ?? '',
    periodo: etiqueta(b, 'periodo') ?? '',
    nif: etiqueta(b, 'nif') ?? '',
    csv: etiqueta(b, 'csv') ?? '',
    expediente: etiqueta(b, 'expediente'),
    justificante: etiqueta(b, 'justificante'),
    justificanteAnterior: etiqueta(b, 'just_anterior'),
    fechaHora: etiqueta(b, 'fechaYHoraPresentacion'),
  })).filter((d) => d.csv)
}

/** Un PDF de verdad empieza por «%PDF-». */
export function esPdf(b: Uint8Array): boolean {
  return b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d
}

// ── La de verdad ────────────────────────────────────────────────────────────
export class HaciendaAeat implements Hacienda {
  constructor(readonly entorno: 'pruebas' | 'produccion', private readonly red: OpcionesMtls,
              private readonly pedirSinCertificado: (url: string) => Promise<Response>) {}

  async presentar(m: MaterialCertificado, p: PeticionPresentar): Promise<ResultadoPresentar> {
    if (/[\r\n\t]/.test(p.fichero)) throw new RespuestaRara('El fichero lleva saltos de línea o tabuladores: no se envía.')
    const cuerpo: Record<string, string> = {
      MODELO: p.modelo, EJERCICIO: String(p.ejercicio), PERIODO: p.periodo, IDI: 'ES', F01: p.fichero,
      FIR: 'FirmaBasica', FIRNIF: p.firmante.nif, FIRNOMBRE: p.firmante.nombre,
    }
    if (p.nrc) cuerpo.NRC = p.nrc
    const r = await llamarConCertificado(m, DIRECCIONES[this.entorno].presentar, {
      method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body: JSON.stringify(cuerpo),
    }, this.red)
    if (r.status >= 500) throw new RespuestaRara(`Hacienda ha dado un error suyo (${r.status}). No sabemos si se ha presentado: compruébalo antes de repetir.`)
    if (r.status === 401 || r.status === 403) return { ok: false, errores: [{ codigo: `HTTP${r.status}`, texto: 'Hacienda no acepta este certificado para presentar.' }] }
    return leerPresentacion(r.cuerpo)
  }

  async consultar(m: MaterialCertificado, p: PeticionConsultar): Promise<Presentada[]> {
    const f = new URLSearchParams({ NIF: p.nif })
    if (p.modelo) f.set('MOD', p.modelo)
    if (p.ejercicio) f.set('EJF', String(p.ejercicio))
    if (p.periodo) f.set('PER', p.periodo)
    const r = await llamarConCertificado(m, DIRECCIONES[this.entorno].consultar, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString(),
    }, this.red)
    if (r.status === 401 || r.status === 403) throw new RespuestaRara('Hacienda no acepta este certificado para consultar las declaraciones de este NIF.')
    if (r.status >= 400) throw new RespuestaRara(`Hacienda no ha contestado a la consulta (${r.status}).`)
    return leerConsulta(r.cuerpo)
  }

  async pdf(url: string): Promise<ResultadoPdf> {
    let host = ''
    try { host = new URL(url).hostname } catch { /* no es una URL */ }
    if (!/(^|\.)agenciatributaria\.gob\.es$|(^|\.)aeat\.es$/.test(host)) {
      return { ok: false, motivo: 'no_es_pdf', mensaje: 'La dirección del justificante no es de Hacienda: no se baja.' }
    }
    try {
      const s = await this.pedirSinCertificado(url)
      if (s.status !== 200) return { ok: false, motivo: 'no_responde', mensaje: 'Hacienda no da el justificante desde aquí.' }
      const bytes = new Uint8Array(await s.arrayBuffer())
      return esPdf(bytes) ? { ok: true, pdf: bytes } : { ok: false, motivo: 'no_es_pdf', mensaje: 'Hacienda ha devuelto algo que no es el PDF del justificante.' }
    } catch {
      return { ok: false, motivo: 'no_responde', mensaje: 'Hacienda no da el justificante desde aquí.' }
    }
  }

  urlPdfDeCsv(csv: string): string {
    return DIRECCIONES[this.entorno].pdfCsv + encodeURIComponent(csv)
  }
}

// ── El freno ────────────────────────────────────────────────────────────────
export const CERRADA =
  'Todavía no se presenta desde Sumied: la conexión con Hacienda no está abierta. No se ha enviado nada.'

/**
 * Las condiciones para abrir la puerta, sin red:
 *   · sin entorno (o «cerrada»): cerrada;
 *   · «doble»: el doble, nunca contra la base de producción;
 *   · «pruebas» (prewww): con la autorización de ese día («pruebas:AAAA-MM-DD»)
 *     y solo en laborable de 8:00 a 15:00 de Madrid, el horario del entorno de
 *     pruebas de la AEAT;
 *   · «produccion»: con la autorización «produccion».
 * Esto no es la autorización: es su cerrojo. La da Julio, poniendo los dos
 * secretos a mano.
 */
export function comprobarPuerta(a: { entorno: string | undefined; autorizacion: string | undefined; ahora: Date; esProduccion: boolean }): Entorno {
  const entorno = (a.entorno ?? '').trim() || 'cerrada'
  if (entorno === 'cerrada') return 'cerrada'
  if (entorno === 'doble') {
    if (a.esProduccion) throw new PuertaCerrada('El doble de Hacienda no se usa contra la base de producción. No se ha enviado nada.')
    return 'doble'
  }
  if (entorno === 'pruebas') {
    const madrid = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(a.ahora).reduce<Record<string, string>>((o, p) => ({ ...o, [p.type]: p.value }), {})
    const dia = `${madrid.year}-${madrid.month}-${madrid.day}`
    if ((a.autorizacion ?? '').trim() !== `pruebas:${dia}`) {
      throw new PuertaCerrada(`El entorno de pruebas de Hacienda no está autorizado para hoy (${dia}). No se ha enviado nada.`)
    }
    const hora = Number(madrid.hour) % 24
    if (madrid.weekday === 'Sat' || madrid.weekday === 'Sun' || hora < 8 || hora >= 15) {
      throw new PuertaCerrada('El entorno de pruebas de Hacienda solo se usa en laborable, de 8:00 a 15:00. No se ha enviado nada.')
    }
    return 'pruebas'
  }
  if (entorno === 'produccion') {
    if ((a.autorizacion ?? '').trim() !== 'produccion') throw new PuertaCerrada('Presentar en Hacienda de verdad no está autorizado. No se ha enviado nada.')
    return 'produccion'
  }
  throw new PuertaCerrada(`«${entorno}» no es un entorno de Hacienda. No se ha enviado nada.`)
}

/** Lo que hace una puerta cerrada: negarse, diciéndolo. */
export class HaciendaCerrada implements Hacienda {
  readonly entorno = 'cerrada' as const
  presentar(): Promise<ResultadoPresentar> { return Promise.reject(new PuertaCerrada(CERRADA)) }
  consultar(): Promise<Presentada[]> { return Promise.reject(new PuertaCerrada(CERRADA)) }
  pdf(): Promise<ResultadoPdf> { return Promise.reject(new PuertaCerrada(CERRADA)) }
  urlPdfDeCsv(): string { return '' }
}
