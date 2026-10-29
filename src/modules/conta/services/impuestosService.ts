// src/modules/conta/services/impuestosService.ts
//
// I01a · Impuestos por dentro. Lo que el front escribe de Impuestos va por
// funciones de la base (security definer): las respuestas del alta, que
// hasta el I01a se usaban para proponer los modelos y se tiraban, y los
// modelos que salen de las reglas de la base.

import { supabase } from '@/lib/supabase'
import { hayBase, rpc, tabla } from '@/modules/conta/services/bd'
import type { Cadencia, Calendario, Estado } from '@/modules/conta/impuestos/calendario'
import type { FilaLibroTrimestre, RetencionesDiario, SumaCuenta, Trimestre } from '@/modules/conta/impuestos/trimestre'
import type { DeclaracionVer, Puerta } from '@/modules/conta/impuestos/declaracion'
import type { CertificadosVer } from '@/modules/conta/impuestos/certificados'
import type { DatosJustificante, Mirado } from '@/modules/conta/impuestos/justificantes'
import type { Lectura } from '@/modules/conta/lib/justificanteAeat'
import type { Sociedades } from '@/modules/conta/impuestos/sociedades'

/** Las preguntas del paso «impuestos» del alta que deciden modelos. */
const CLAVES_DEL_ALTA = ['retiene', 'alquiler', 'retenido70'] as const

/**
 * Guarda, como datos de la empresa con quién y cuándo, las respuestas del
 * paso «impuestos»: «sí», «no» o «No lo sé» (__nolose). Las que no se
 * preguntaron no se envían. Devuelve cuántas se guardaron.
 */
export async function guardarRespuestasDelAlta(companyId: string, respuestas: Partial<Record<string, string>>): Promise<number> {
  const p: Record<string, string> = {}
  for (const k of CLAVES_DEL_ALTA) {
    const v = respuestas[k]
    if (v === 'si' || v === 'no' || v === '__nolose') p[k] = v
  }
  if (Object.keys(p).length === 0) return 0
  return rpc<number>('conta_impuesto_datos_del_alta', { p_company: companyId, p_respuestas: p })
}

/** Lo que devuelve conta_impuesto_obligaciones_calcular por cada modelo. */
interface ObligacionCalculada {
  modelo: string
  presenta: boolean
  regla: string
  por_que: string
  hecho: 'igual' | 'nuevo' | 'cambiado' | 'no_toca' | 'lo_decidio_una_persona'
}

/**
 * Escribe los modelos que dicen las reglas de la base (cada uno con su regla,
 * sus datos y su porqué; lo que decidió una persona no se toca) y devuelve los
 * que presenta, ordenados, con el porqué de cada uno en una frase.
 */
export async function calcularObligaciones(companyId: string): Promise<{ modelos: string[]; porque: string }> {
  const filas = await rpc<ObligacionCalculada[]>('conta_impuesto_obligaciones_calcular', { p_company: companyId })
  const presenta = filas.filter((f) => f.presenta).sort((a, b) => a.modelo.localeCompare(b.modelo))
  return {
    modelos: presenta.map((f) => f.modelo),
    porque: presenta.length
      ? presenta.map((f) => `${f.modelo}: ${f.por_que}`).join(' ')
      : 'Con lo que me has dicho, no presentas ningún modelo de los que conozco.',
  }
}

// ── I01b · Las pantallas de Impuestos ──────────────────────────────────────


/** Lo que pinta Impuestos › Calendario (conta_impuesto_calendario). */
export function leerCalendario(companyId: string, hoy?: string): Promise<Calendario> {
  return rpc<Calendario>('conta_impuesto_calendario', { p_company: companyId, ...(hoy ? { p_hoy: hoy } : {}) })
}

/** «+ Añadir otro impuesto»: con su motivo, queda quién y cuándo (conta_impuesto_obligacion_decidir). */
export function anadirImpuesto(companyId: string, modelo: string, motivo: string): Promise<string> {
  return rpc<string>('conta_impuesto_obligacion_decidir', { p_company: companyId, p_form: modelo, p_presenta: true, p_motivo: motivo })
}

/** Lo que devuelve conta_impuesto_303_calcular. */
/** Sin libro de IVA (o sin saber la [110] cuando sale a pagar), `sabido` es false y no hay resultado ni importe. */
export interface Calculo303 { declaracion: string; desde: string; hasta: string; apuntes: number; resultado: string | null; importe: number | null; sabido: boolean }

/** I01c · El trimestre (conta_impuesto_trimestre, 0280): la tira y la cartera del 303. No escribe nada. */
export function leerTrimestre(companyId: string, ejercicio: number, trimestre: number): Promise<Trimestre> {
  return rpc<Trimestre>('conta_impuesto_trimestre', { p_company: companyId, p_year: ejercicio, p_quarter: trimestre })
}

/** Calcula (o recalcula) el borrador del 303 de un periodo desde el libro de IVA. */
export function calcular303(companyId: string, ejercicio: number, periodo: string): Promise<Calculo303> {
  return rpc<Calculo303>('conta_impuesto_303_calcular', { p_company: companyId, p_year: ejercicio, p_period: periodo })
}

/**
 * Escribe a mano casillas del 303 (la [110] de antes, o las del justificante de
 * lo presentado fuera), con el motivo; null quita la que se puso. La base
 * comprueba que cuadran y vuelve a calcular.
 */
export function ponerCasillas(declaracion: string, casillas: Record<string, number | null>, motivo: string): Promise<{ ok: boolean; mensaje: string; calculo: Calculo303 }> {
  return rpc('conta_impuesto_casillas_poner', { p_return: declaracion, p_casillas: casillas, p_motivo: motivo })
}

/** Lo que pinta el IVA de un periodo (conta_impuesto_declaracion_ver). */
export function leerDeclaracion(companyId: string, ejercicio: number, periodo: string): Promise<DeclaracionVer> {
  return rpc<DeclaracionVer>('conta_impuesto_declaracion_ver', { p_company: companyId, p_year: ejercicio, p_period: periodo })
}

/** «Revisado»: sin nada que Sumied no sepa resolver. */
export function revisarDeclaracion(declaracion: string): Promise<unknown> {
  return rpc('conta_impuesto_revisar', { p_return: declaracion })
}

/** Dar por bueno un aviso, con su motivo. */
export function aceptarAviso(comprobacion: string, motivo: string): Promise<unknown> {
  return rpc('conta_impuesto_aviso_aceptar', { p_check: comprobacion, p_motivo: motivo })
}

/** Cómo se paga: domiciliado, pagar yo o a devolver en un banco. */
export function ponerPago(declaracion: string, modo: 'direct_debit' | 'self' | 'refund', cuenta: string | null): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_impuesto_pago_poner', { p_return: declaracion, p_modo: modo, p_cuenta: cuenta })
}

/** El asiento de liquidación (0180). */
export function contabilizar303(declaracion: string): Promise<{ mensaje: string }> {
  return rpc('conta_impuesto_303_contabilizar', { p_return: declaracion })
}

export interface CargoPosible { movimiento: string; fecha: string; importe: number; concepto: string | null; cuenta: string }

/** Los movimientos del banco sin casar por el importe de la declaración (0180). */
export function cargosPosibles(declaracion: string): Promise<CargoPosible[]> {
  return rpc<CargoPosible[]>('conta_impuesto_cargos_posibles', { p_return: declaracion })
}

/** Casar el cargo con la declaración: «Pagado» (0180). */
export function casarCargo(declaracion: string, movimiento: string): Promise<{ mensaje: string }> {
  return rpc('conta_impuesto_casar_cargo', { p_return: declaracion, p_movement: movimiento })
}

/** El token de un solo uso para usar el certificado en ESA acción (dura 5 minutos). */
export function confirmarCertificado(certificado: string, accion: 'test' | 'file' | 'query', declaracion?: string, empresa?: string): Promise<string> {
  return rpc<string>('conta_cert_confirmar', { p_certificate: certificado, p_action: accion, p_tax_return: declaracion ?? null, p_company: empresa ?? null })
}

/** Lo que contesta conta-hacienda: siempre con un mensaje para la pantalla (regla 8). */
export type SalidaHacienda = { ok: boolean; mensaje: string; motivo?: string; [k: string]: unknown }

/** Llama a conta-hacienda. Nunca lanza: si la función contesta con un error, su cuerpo dice por qué. */
export async function hacienda(accion: 'puerta' | 'fichero_303' | 'fichero_190' | 'fichero_180' | 'presentar_303' | 'ya_presentado_fuera' | 'probar', cuerpo: Record<string, unknown> = {}): Promise<SalidaHacienda> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-hacienda', { body: { accion, ...cuerpo } })
  if (!error && data && typeof data === 'object' && 'ok' in data) return data as SalidaHacienda
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as SalidaHacienda | null
    if (c && typeof c.mensaje === 'string') return { ...c, ok: false }
    if (ctx.status === 404) return { ok: false, motivo: 'sin_funcion', mensaje: 'La conexión con Hacienda aún no está publicada en este entorno. No se ha enviado nada.' }
    return { ok: false, motivo: 'fallo', mensaje: `La conexión con Hacienda ha contestado ${ctx.status}. No se ha enviado nada nuevo.` }
  }
  return { ok: false, motivo: 'fallo', mensaje: `No se ha podido hablar con la conexión con Hacienda${error ? ` (${error.message})` : ''}. No se ha enviado nada.` }
}

/** ¿Está abierta la puerta de Hacienda? Sin respuesta, cerrada (y se dice). */
export async function leerPuerta(): Promise<Puerta> {
  const r = await hacienda('puerta')
  if (r.ok) return { abierta: r.abierta === true, entorno: (r.entorno as Puerta['entorno']) ?? 'desconocido', mensaje: r.mensaje }
  return { abierta: false, entorno: 'cerrada', mensaje: r.mensaje }
}

export interface Presentado {
  id: string; cuenta: string; modelo: string; nombre: string; cadencia: Cadencia; ejercicio: number; periodo: string
  estado: Estado
  estado_texto: string; resultado: string | null; importe: number | null
  presentada: string | null; presentada_por: string | null; por: 'sumied' | 'outside' | null; plazo: string
  csv: string | null; justificante: string | null; justificante_pdf: string | null; contabilizada: boolean; casada: boolean; comprobada: boolean
  /** 0270: el PDF traído de Hacienda por su CSV, el expediente, el presentador y, en el 303, lo compensado ([78]). */
  traido?: boolean; expediente?: string | null; presentador?: { nif: string | null; nombre: string | null } | null; compensado?: number | null
}
export interface ParaApuntar { ejercicio: number; periodo: string; presentacion: string; declaracion: string | null; estado: string | null; resultado: string | null; importe: number | null }
export interface Presentados { puede_gestionar: boolean; presentados: Presentado[]; para_apuntar: ParaApuntar[] }

/** Impuestos › Presentados (conta_impuesto_presentados). */
export function leerPresentados(companyId: string): Promise<Presentados> {
  return rpc<Presentados>('conta_impuesto_presentados', { p_company: companyId })
}

const DOCUMENTOS = 'conta-documentos'

/** Lee todas las filas de una consulta, de 1.000 en 1.000 (PostgREST no da más de una vez). */
async function todasLasFilas<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await pedir(i, i + 999)
    if (error) throw new Error(`No se ha podido leer ${que}: ${error.message}`)
    const filas = (data ?? []) as T[]
    out.push(...filas)
    if (filas.length < 1000) return out
  }
}

/**
 * I01c · maqueta v4 · El libro de IVA de un trimestre, lo justo para casarlo
 * con el 303: expedidas por su fecha de operación (o de expedición) y
 * recibidas por «deducida en» o, sin ella, por su fecha de recepción (o de
 * expedición), como lo hace el cálculo del 303 (0290). Regla 9: cuenta y empresa.
 */
export async function libroIvaDelTrimestre(cuenta: string, empresa: string, ejercicio: number, trimestre: string, desde: string, hasta: string): Promise<FilaLibroTrimestre[]> {
  const cols = 'book, tax_rate, tax_amount, reverse_charge, operation_key, investment_good'
  const base = () => tabla('vat_book_entry').select(cols).eq('account_id', cuenta).eq('company_id', empresa).is('voided_at', null)
  const [exp, rec] = await Promise.all([
    todasLasFilas<FilaLibroTrimestre>((a, b) => base().eq('book', 'issued')
      .or(`and(operation_date.gte.${desde},operation_date.lte.${hasta}),and(operation_date.is.null,issue_date.gte.${desde},issue_date.lte.${hasta})`)
      .order('id').range(a, b), 'el libro de IVA (expedidas)'),
    todasLasFilas<FilaLibroTrimestre>((a, b) => base().eq('book', 'received')
      .or(`and(deduction_year.eq.${ejercicio},deduction_period.eq.${trimestre}),and(deduction_period.is.null,received_date.gte.${desde},received_date.lte.${hasta}),and(deduction_period.is.null,received_date.is.null,issue_date.gte.${desde},issue_date.lte.${hasta})`)
      .order('id').range(a, b), 'el libro de IVA (recibidas)'),
  ])
  return [...exp, ...rec].map((f) => ({ ...f, tax_rate: f.tax_rate === null ? null : Number(f.tax_rate), tax_amount: Number(f.tax_amount) }))
}

/** Lo que mueve el diario (validado o anulado) en cada cuenta de unos prefijos en unas fechas, con su nombre. */
export async function cuentasDelTrimestre(cuenta: string, empresa: string, prefijos: string[], desde: string, hasta: string): Promise<SumaCuenta[]> {
  const filas = await todasLasFilas<{ account_code: string; account_name: string | null; debit: number; credit: number }>((a, b) =>
    tabla('journal_ledger').select('account_code, account_name, debit, credit')
      .eq('account_id', cuenta).eq('company_id', empresa).in('status', ['validado', 'anulado'])
      .gte('entry_date', desde).lte('entry_date', hasta)
      .or(prefijos.map((p) => `account_code.like.${p}%`).join(','))
      .order('line_id').range(a, b), 'el diario del trimestre')
  const m = new Map<string, SumaCuenta>()
  for (const f of filas) {
    const c = m.get(f.account_code) ?? { codigo: f.account_code, nombre: f.account_name ?? '', debe: 0, haber: 0 }
    c.debe = Math.round((c.debe + Number(f.debit)) * 100) / 100
    c.haber = Math.round((c.haber + Number(f.credit)) * 100) / 100
    m.set(f.account_code, c)
  }
  return [...m.values()].sort((x, y) => x.codigo.localeCompare(y.codigo))
}

/** Lo que Sumied comprobó al calcular la declaración (tax_return_check), si la calculó. */
export async function comprobacionesDeDeclaracion(id: string, cuenta: string): Promise<{ clave: string; resultado: 'ok' | 'warning' | 'error'; titulo: string; detalle: Record<string, unknown> | null }[]> {
  const { data, error } = await tabla('tax_return_check').select('check_key, result, title, detail').eq('tax_return_id', id).eq('account_id', cuenta)
  if (error) throw new Error(`No se ha podido leer lo comprobado: ${error.message}`)
  return ((data ?? []) as { check_key: string; result: 'ok' | 'warning' | 'error'; title: string; detail: Record<string, unknown> | null }[])
    .map((f) => ({ clave: f.check_key, resultado: f.result, titulo: f.title, detalle: f.detail }))
}

/** I01g · Lo que devuelve conta_impuesto_retenciones_calcular (0330). */
export interface CalculoRetenciones {
  declaracion: string; modelo: '111' | '115'; desde: string; hasta: string; asientos: number
  resultado: string | null; importe: number | null; casillas: Record<string, number>; falta_perceptores: boolean; propuesta_perceptores: number | null
}

/** I01g · Calcula (o recalcula) el borrador del 111 o del 115 de un periodo desde el diario. */
export function calcularRetenciones(companyId: string, ejercicio: number, periodo: string, modelo: '111' | '115'): Promise<CalculoRetenciones> {
  return rpc<CalculoRetenciones>('conta_impuesto_retenciones_calcular', { p_company: companyId, p_year: ejercicio, p_period: periodo, p_form: modelo })
}

/** I01g · La [01] del 111 a mano (cuántas personas cobraron nómina), con su motivo; vuelve a calcular. */
export function ponerPerceptores(declaracion: string, perceptores: number, motivo: string): Promise<{ ok: boolean; mensaje: string; calculo: CalculoRetenciones }> {
  return rpc('conta_impuesto_perceptores_poner', { p_return: declaracion, p_perceptores: perceptores, p_motivo: motivo })
}

/** I01g · Lo que dice el diario de las retenciones de un periodo (conta_impuesto_retenciones_diario). No escribe nada. */
export function retencionesDelDiario(companyId: string, ejercicio: number, periodo: string): Promise<RetencionesDiario> {
  return rpc<RetencionesDiario>('conta_impuesto_retenciones_diario', { p_company: companyId, p_year: ejercicio, p_period: periodo })
}

/** I01h · La pestaña «Impuesto de sociedades»: los 200 guardados y los 202 con su base (conta_impuesto_sociedades). No escribe nada. */
export function leerSociedades(companyId: string): Promise<Sociedades> {
  return rpc<Sociedades>('conta_impuesto_sociedades', { p_company: companyId })
}

/** I01h · Escribe a mano (con su motivo) los datos de un 200 y vuelve a calcular los 202 que salen de él. */
export function poner200(companyId: string, ejercicio: number, datos: Record<string, unknown>, motivo: string): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_impuesto_200_poner', { p_company: companyId, p_year: ejercicio, p_datos: datos, p_motivo: motivo })
}

/** I01h · Lo que devuelve conta_impuesto_202_calcular (0340). */
export interface Calculo202 {
  declaracion: string; ejercicio: number; periodo: string; ejercicio_base: number; falta_200: boolean
  cuota: number | null; resultado: string | null; importe: number | null; no_hace_falta: boolean
}

/** I01h · Calcula (o recalcula) el 202 de un periodo desde el último 200 (art. 40.2). */
export function calcular202(companyId: string, ejercicio: number, periodo: string): Promise<Calculo202> {
  return rpc<Calculo202>('conta_impuesto_202_calcular', { p_company: companyId, p_year: ejercicio, p_period: periodo })
}

/**
 * I01c · Los asientos de una declaración (Trimestre › «Ver el asiento»): el de
 * la liquidación y el del pago, si Sumied los tiene. Regla 9: de su cuenta.
 * Columnas medidas en producción (tax_return.liquidation_entry_id y
 * payment_entry_id, 20/10; regla 40).
 */
export async function asientosDeDeclaracion(id: string, cuenta: string): Promise<{ liquidacion: string | null; pago: string | null }> {
  const { data, error } = await tabla('tax_return').select('liquidation_entry_id, payment_entry_id')
    .eq('id', id).eq('account_id', cuenta).maybeSingle()
  if (error) throw new Error(`No se han podido leer los asientos de la declaración: ${error.message}`)
  const f = (data ?? null) as { liquidation_entry_id: string | null; payment_entry_id: string | null } | null
  return { liquidacion: f?.liquidation_entry_id ?? null, pago: f?.payment_entry_id ?? null }
}

/** Un enlace de 5 minutos al justificante en PDF. */
export async function enlaceJustificante(ruta: string): Promise<string> {
  hayBase()
  const { data, error } = await supabase!.storage.from(DOCUMENTOS).createSignedUrl(ruta, 300)
  if (error || !data?.signedUrl) throw new Error(`No se ha podido abrir el justificante: ${error?.message ?? 'sin enlace'}`)
  return data.signedUrl
}

/**
 * Subir el justificante en PDF de una declaración presentada: a
 * <cuenta>/impuestos/<declaración>/<huella>.pdf, y la base comprueba que es ese
 * fichero (tamaño y tipo) antes de enlazarlo. Uno por declaración: no se cambia.
 */
export async function subirJustificante(p: { declaracion: string; cuenta: string; fichero: File | Blob }): Promise<string> {
  hayBase()
  if (p.fichero.type && p.fichero.type !== 'application/pdf') throw new Error('El justificante tiene que ser un PDF.')
  const bytes = new Uint8Array(await p.fichero.arrayBuffer())
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Ese PDF pasa de 10 MB: no parece un justificante.')
  const huella = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))).map((b) => b.toString(16).padStart(2, '0')).join('')
  const ruta = `${p.cuenta}/impuestos/${p.declaracion}/${huella}.pdf`
  const sub = await supabase!.storage.from(DOCUMENTOS).upload(ruta, new Blob([bytes as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`No se ha podido subir el PDF: ${sub.error.message}`)
  const r = await rpc<{ mensaje: string }>('conta_impuesto_justificante_guardar', { p_return: p.declaracion, p_ruta: ruta, p_huella: huella, p_tamano: bytes.length })
  return r.mensaje
}

// ── I01c · P1 · Subir justificantes de Hacienda ─────────────────────────────

/**
 * Lee un justificante de la Sede en el navegador (pdfjs + celdasPdf +
 * justificanteAeat). Nunca lanza. Da también el CSV que se ve en el PDF (el de
 * un reimpreso que no se lee, para traer el original de Hacienda).
 */
export async function leerJustificantePdf(fichero: File | Blob, nombre = 'el PDF'): Promise<Lectura & { csvVisto?: { csv: string | null; candidatos: string[] } }> {
  const n = fichero instanceof File ? fichero.name : nombre
  if (fichero.type && fichero.type !== 'application/pdf' && !/\.pdf$/i.test(n)) {
    return { ok: false, causa: 'no_pdf', motivo: 'No es un PDF: el justificante de la Sede se descarga en PDF.', parcial: {} }
  }
  if (fichero.size > 10 * 1024 * 1024) return { ok: false, causa: 'no_pdf', motivo: 'Pasa de 10 MB: no parece un justificante.', parcial: {} }
  try {
    const [{ pdfjs }, { celdasPdf }, { leerJustificante, csvDelPdf }] = await Promise.all([
      import('@/modules/conta/plan/leerFicheros'), import('@/modules/conta/lib/celdasPdf'), import('@/modules/conta/lib/justificanteAeat'),
    ])
    const paginas = await celdasPdf(await pdfjs(), await fichero.arrayBuffer())
    return { ...leerJustificante(paginas), csvVisto: csvDelPdf(paginas) }
  } catch (e) {
    return { ok: false, causa: 'no_pdf', motivo: `No se ha podido abrir como PDF (${e instanceof Error ? e.message : String(e)}).`, parcial: {} }
  }
}

export type TraidoDeHacienda =
  | { ok: true; pdf: Blob }
  | { ok: false; motivo: 'formato' | 'permiso' | 'ya_estaba' | 'no_encontrado' | 'no_responde'; mensaje: string; declaracion?: string }

/**
 * Trae de Hacienda el justificante original por su CSV (conta-justificante-csv).
 * No guarda nada: lo devuelve para leerlo y enseñarlo. Nunca lanza.
 */
export async function traerJustificanteCsv(companyId: string, csv: string): Promise<TraidoDeHacienda> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-justificante-csv', { body: { company_id: companyId, csv } })
  let d = data as { ok?: boolean; pdf_base64?: string; motivo?: string; mensaje?: string; declaracion?: string } | null
  if (error) {
    const ctx = (error as { context?: Response } | null)?.context
    d = ctx && typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) : null
    if (!d) return { ok: false, motivo: 'no_responde', mensaje: 'No se ha podido preguntar a Hacienda desde Sumied ahora mismo. Vuelve a intentarlo en un rato. No se ha guardado nada.' }
  }
  if (d?.ok && d.pdf_base64) {
    const bytes = Uint8Array.from(atob(d.pdf_base64), (c) => c.charCodeAt(0))
    return { ok: true, pdf: new Blob([bytes as BlobPart], { type: 'application/pdf' }) }
  }
  const motivos = ['formato', 'permiso', 'ya_estaba', 'no_encontrado', 'no_responde'] as const
  const motivo = motivos.find((m) => m === d?.motivo) ?? 'no_responde'
  return { ok: false, motivo, mensaje: d?.mensaje ?? 'Hacienda no responde ahora mismo. No se ha guardado nada.', declaracion: d?.declaracion }
}

/** La pantalla de repaso: cada justificante mirado por la base. No escribe nada. */
export function repasarJustificantes(companyId: string, lista: DatosJustificante[]): Promise<Mirado[]> {
  return rpc<Mirado[]>('conta_impuesto_justificantes_repasar', { p_company: companyId, p_lista: lista })
}

/**
 * Apunta un justificante (crea o completa la declaración, presentada fuera) y
 * guarda su PDF en la carpeta de la declaración. Devuelve lo que ha pasado, en
 * palabras; si el PDF no llega, la declaración queda apuntada y se dice.
 */
export async function apuntarJustificante(companyId: string, datos: DatosJustificante, fichero: File | Blob | null): Promise<string> {
  const r = await rpc<Mirado & { ok: boolean; mensaje: string; cuenta: string }>('conta_impuesto_justificante_apuntar', { p_company: companyId, p_datos: datos })
  if (!fichero || !r.declaracion || (r.estado === 'ya_estaba' && !r.falta_pdf)) return r.mensaje
  try {
    await subirJustificante({ declaracion: r.declaracion, cuenta: r.cuenta, fichero })
    return r.mensaje
  } catch (e) {
    return `${r.mensaje} El PDF no se ha guardado (${e instanceof Error ? e.message : String(e)}): súbelo desde la lista.`
  }
}

// ── P4 · Certificados y accesos ─────────────────────────────────────────────

/** Lo que pinta Certificados y accesos (conta_impuesto_certificados_ver). */
export function leerCertificados(companyId: string): Promise<CertificadosVer> {
  return rpc<CertificadosVer>('conta_impuesto_certificados_ver', { p_company: companyId })
}

/**
 * Subir un certificado (.p12 / .pfx) con su contraseña a conta-certificado, que
 * lo abre en memoria y lo guarda en el almacén. Ni el fichero ni la contraseña
 * se guardan en el navegador ni en la base. Nunca lanza: devuelve el mensaje.
 */
export async function subirCertificado(cuentaId: string, fichero: File, contrasena: string): Promise<{ ok: boolean; mensaje: string; id?: string }> {
  hayBase()
  const bytes = new Uint8Array(await fichero.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const { data, error } = await supabase!.functions.invoke('conta-certificado', { body: { cuenta_id: cuentaId, p12_base64: btoa(bin), contrasena } })
  if (!error && data && typeof data === 'object' && 'ok' in data) return data as { ok: boolean; mensaje: string; id?: string }
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as { mensaje?: string } | null
    if (c?.mensaje) return { ok: false, mensaje: c.mensaje }
    return { ok: false, mensaje: `La subida del certificado ha contestado ${ctx.status}. No se ha guardado nada.` }
  }
  return { ok: false, mensaje: 'No se ha podido hablar con la subida del certificado. No se ha guardado nada.' }
}

/** La empresa presenta con este certificado. */
export function certificadoPresenta(companyId: string, certificado: string): Promise<{ mensaje: string }> {
  return rpc('conta_impuesto_certificado_presenta', { p_company: companyId, p_certificate: certificado })
}

/** «Quitar el certificado ahora»: se borra del almacén al instante; el registro de usos se queda. */
export function quitarCertificado(certificado: string): Promise<string> {
  return rpc<string>('conta_cert_quitar', { p_certificate: certificado })
}

/** «Puede presentar» (file), «solo ver» (view) o nada (null). */
export function permisoCertificado(certificado: string, persona: string, permiso: 'file' | 'view' | null): Promise<string> {
  return rpc<string>('conta_cert_permiso', { p_certificate: certificado, p_user: persona, p_permission: permiso })
}

/** «Probar con Hacienda»: un token de un solo uso y la consulta (no presenta nada). */
export async function probarCertificado(certificado: string): Promise<SalidaHacienda> {
  const token = await confirmarCertificado(certificado, 'test')
  return hacienda('probar', { confirmacion: token })
}

// ── P4b · Invitar a mi asesoría ─────────────────────────────────────────────

export interface InvitacionViva {
  id: string; estado: 'pending' | 'waiting_approval'; correo: string; asesoria: string; base: 'social_collaborator' | 'power_of_attorney'
  invita: string; creada: string; expira: string; envios: number; ultimo_envio: string
}

/** La invitación viva de la empresa, si la hay (conta_asesoria_de_empresa). */
export function invitacionDeEmpresa(companyId: string): Promise<InvitacionViva | null> {
  return rpc<InvitacionViva | null>('conta_asesoria_de_empresa', { p_company: companyId })
}

/** Cancelar la invitación: su enlace deja de valer. */
export function cancelarInvitacion(id: string): Promise<string> {
  return rpc<string>('conta_asesoria_cancelar', { p_invitation: id })
}

/** Retirar el permiso de la asesoría: deja de ver y gestionar en el acto. */
export async function retirarAsesoria(companyId: string): Promise<string> {
  await rpc('conta_impuesto_presentador_retirar', { p_company: companyId })
  return 'Retirado el permiso de la asesoría: desde ahora no ve ni gestiona los impuestos de esta empresa.'
}

/** Llama a conta-asesoria. Nunca lanza: si contesta con un error, su cuerpo dice por qué. */
export async function asesoria(accion: 'invitar' | 'ver' | 'aceptar' | 'aprobar', cuerpo: Record<string, unknown>): Promise<{ ok: boolean; mensaje: string; [k: string]: unknown }> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-asesoria', { body: { accion, ...cuerpo } })
  if (!error && data && typeof data === 'object') return data as { ok: boolean; mensaje: string }
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as { mensaje?: string } | null
    if (c?.mensaje) return { ...c, ok: false, mensaje: c.mensaje }
    if (ctx.status === 404) return { ok: false, mensaje: 'La invitación de asesorías aún no está publicada en este entorno.' }
    return { ok: false, mensaje: `La invitación ha contestado ${ctx.status}. No se ha cambiado nada.` }
  }
  return { ok: false, mensaje: 'No se ha podido hablar con la invitación. No se ha cambiado nada.' }
}

// ── S02 · Los modelos del año ──────────────────────────────────────────────

/** S02 · La tira del año (conta_impuesto_anual): los modelos anuales de la empresa, con la forma del trimestre. No escribe nada. */
export function leerAnual(companyId: string, ejercicio: number): Promise<Trimestre> {
  return rpc<Trimestre>('conta_impuesto_anual', { p_company: companyId, p_year: ejercicio })
}

/** S02 · Lo que devuelve conta_impuesto_190_calcular. */
export interface Calculo190 { declaracion: string; ejercicio: number; perceptores: number; casillas: Record<string, number>; errores: number; avisos: number }

/** S02 · Calcula (o recalcula) el borrador del 190 del año desde los 111. */
export function calcular190(companyId: string, ejercicio: number): Promise<Calculo190> {
  return rpc<Calculo190>('conta_impuesto_190_calcular', { p_company: companyId, p_year: ejercicio })
}

/** S02 · «Ya lo presenté fuera» de un modelo anual informativo, con su CSV y su fecha. */
export function informativaFuera(companyId: string, modelo: string, ejercicio: number, csv: string, fecha: string, justificante: string | null): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_impuesto_informativa_fuera', { p_company: companyId, p_form: modelo, p_year: ejercicio, p_csv: csv, p_fecha: fecha, p_justificante: justificante })
}

/** S02 · Un perceptor del 190, como lo dejó el cálculo (tax_return_line.frozen). */
export interface Perceptor190 {
  clave: string; subclave: string | null; nif: string | null; nombre: string | null; provincia: string | null; nif_valido: boolean
  integra: number; retenciones: number; sin_trabajador?: boolean; origen: 'diario' | 'nominas'; anio_nacimiento?: number | null
  asientos?: { asiento: string; fecha: string; serie: number | null; numero: number | null; retenido: number; periodo: string }[]
}

/** S02 · Los perceptores del 190 calculado. */
export async function perceptores190(id: string, cuenta: string): Promise<Perceptor190[]> {
  const { data, error } = await tabla('tax_return_line').select('frozen').eq('tax_return_id', id).eq('account_id', cuenta)
  if (error) throw new Error(`No se han podido leer los perceptores: ${error.message}`)
  return ((data ?? []) as { frozen: Perceptor190 }[]).map((f) => f.frozen)
}

/** S02 · Calcula (o recalcula) el borrador del 180 del año desde los 115. Devuelve lo mismo que el del 190. */
export function calcular180(companyId: string, ejercicio: number): Promise<Calculo190> {
  return rpc<Calculo190>('conta_impuesto_180_calcular', { p_company: companyId, p_year: ejercicio })
}

/** S02 · El inmueble arrendado de un arrendador, como lo pide el registro de perceptor del 180 (anexo VI). */
export interface Inmueble180 {
  situacion: '1' | '2' | '3' | '4'; catastral: string | null; tipo_via: string | null; nombre_via: string; tipo_numeracion: string | null
  numero: string | null; calificador?: string | null; bloque?: string | null; portal?: string | null; escalera?: string | null
  planta: string | null; puerta: string | null; complemento?: string | null; localidad?: string | null
  municipio: string; codigo_municipio: string | null; provincia: string; cp: string
}

/** S02 · Un arrendador del 180, como lo dejó el cálculo (tax_return_line.frozen). */
export interface Perceptor180 {
  perceptor: string | null; proveedor: string | null; nif: string | null; nombre: string | null; provincia: string | null; nif_valido: boolean
  base: number; porcentaje: number; retenciones: number; inmueble: Inmueble180 | null
  asientos?: { asiento: string; fecha: string; serie: number | null; numero: number | null; retenido: number; periodo: string }[]
}

/** S02 · Los arrendadores del 180 calculado. */
export async function perceptores180(id: string, cuenta: string): Promise<Perceptor180[]> {
  const { data, error } = await tabla('tax_return_line').select('frozen').eq('tax_return_id', id).eq('account_id', cuenta)
  if (error) throw new Error(`No se han podido leer los arrendadores: ${error.message}`)
  return ((data ?? []) as { frozen: Perceptor180 }[]).map((f) => f.frozen)
}

/** S02 · Guarda el inmueble de un arrendador (lo comprueba la base y dice qué ha guardado). */
export function ponerInmueble180(companyId: string, proveedor: string, datos: Partial<Inmueble180>): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_impuesto_180_inmueble_poner', { p_company: companyId, p_supplier: proveedor, p_datos: datos })
}

/** S02 · Lo comprobado de una declaración, con su id y si un aviso se dio por bueno (para «Dar por bueno»). */
export async function comprobacionesConAviso(id: string, cuenta: string): Promise<{ id: string; clave: string; resultado: 'ok' | 'warning' | 'error'; titulo: string; detalle: Record<string, unknown> | null; aceptado: boolean; motivo: string | null }[]> {
  const { data, error } = await tabla('tax_return_check').select('id, check_key, result, title, detail, accepted_at, accepted_reason').eq('tax_return_id', id).eq('account_id', cuenta)
  if (error) throw new Error(`No se ha podido leer lo comprobado: ${error.message}`)
  return ((data ?? []) as { id: string; check_key: string; result: 'ok' | 'warning' | 'error'; title: string; detail: Record<string, unknown> | null; accepted_at: string | null; accepted_reason: string | null }[])
    .map((f) => ({ id: f.id, clave: f.check_key, resultado: f.result, titulo: f.title, detalle: f.detail, aceptado: f.accepted_at !== null, motivo: f.accepted_reason }))
}
