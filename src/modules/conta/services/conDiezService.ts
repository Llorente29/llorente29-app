// src/modules/conta/services/conDiezService.ts
//
// C04b · R15 · El documento de cada asiento de ventas de una plataforma y su
// envío a Diez, desde el Libro.
//
//   · guardarDocumento: el «Resumen de ventas» del asiento VALIDADO, hecho en
//     el navegador con jsPDF (el mismo núcleo que la prueba de C0009), subido
//     al bucket privado conta-documentos y enlazado a su asiento por la base
//     (conta_documento_guardar, que comprueba ruta, fichero y tamaño).
//   · urlDocumento: «Ver documento», una URL firmada de cinco minutos.
//   · enviarADiez: la edge function conta-diez-enviar (C0008 cerrado, C0001
//     vetada, sin documento no se envía, nunca dos veces).
//   · validarConDocumento (respuesta 8): validar y guardar el PDF, juntos.
//   · validarYEnviar: asiento a asiento y por fecha, diciendo de cada uno qué
//     ha pasado (regla 8); para en el primero que se valida y no llega a Diez.
//
// Nombres dentro de cadenas (regla 40), comprobados contra producción el 13/10
// (pg_class, pg_proc, pg_constraint e information_schema): sales_day_summary
// (entry_id, channel_id, account_id, company_id; channel_id SIN clave ajena,
// por eso el canal se lee aparte), sales_channel (id, slug, name, account_id),
// external_send (entry_id, status, ext_series, ext_number, ext_invoice_number,
// attempts, last_error), journal_entry_validar; y los que crea la
// 20261021T0100: journal_entry_document, conta_resumen_ventas,
// conta_documento_guardar, external_send.document_status / document_error, el
// bucket conta-documentos y la función conta-diez-enviar.
// Y los de la 20261111T0720 (C06b, respuesta 8): conta_numero_previsto y
// journal_entry_validar_con_documento.

import { jsPDF } from 'jspdf'
import { supabase } from '@/lib/supabase'
import { rpc, tabla, mensaje, hayBase } from '@/modules/conta/services/bd'
import { anular } from '@/modules/conta/services/diarioService'
import { correspondenciaDeEmpresa } from '../../../../supabase/functions/_shared/diezAnalitica.ts'
import { resumenDeAsiento, type ResumenBD } from '../../../../supabase/functions/_shared/resumenDeAsiento.ts'
import { resumenVentasPdf } from '../../../../supabase/functions/_shared/resumenVentasPdf.ts'
import type { ResultadoEnvio } from '../../../../supabase/functions/_shared/diezEnviar.ts'
import type { ConDiez, EnvioDiez } from '@/modules/conta/lib/conDiez'
import { nombreEnZip, ordenPendientes, type PendienteDiez } from '@/modules/conta/lib/pendientesDiez'
import { crearZip, type FicheroZip } from '@/modules/conta/lib/zip'
import { validarConPdf, type ValidadoConPdf } from '@/modules/conta/lib/validarConPdf'
import { validarYEnviarVarios, type AsientoParaEnviar, type PasoVarios } from '@/modules/conta/lib/enviarVarios'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const BUCKET = 'conta-documentos'
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

const aEnvio = (f: Fila): EnvioDiez => ({
  status: String(f.status) as EnvioDiez['status'], serie: s(f.ext_series), numero: f.ext_number == null ? null : Number(f.ext_number), factura: s(f.ext_invoice_number),
  intentos: Number(f.attempts ?? 0), error: s(f.last_error), documento: (s(f.document_status) as EnvioDiez['documento']) ?? null, errorDocumento: s(f.document_error),
})

/** Los asientos de ventas de una plataforma de la empresa entre dos fechas, con su documento y su envío. */
export async function leerConDiez(accountId: string, companyId: string, entryIds: readonly string[]): Promise<Map<string, ConDiez>> {
  const out = new Map<string, ConDiez>()
  if (entryIds.length === 0) return out
  const ids = [...entryIds]
  const trozos: string[][] = []
  for (let i = 0; i < ids.length; i += 200) trozos.push(ids.slice(i, i + 200))
  // sales_day_summary.channel_id no tiene clave ajena (medido el 13/10): el
  // canal se lee aparte, de la cuenta, y no embebido en el select.
  const canalDe = new Map<string, string>()
  for (const t of trozos) {
    const { data, error } = await tabla('sales_day_summary').select('entry_id, channel_id')
      .eq('account_id', accountId).eq('company_id', companyId).in('entry_id', t).not('channel_id', 'is', null)
    if (error) throw new Error(mensaje('No se han podido leer las ventas por plataforma', error))
    for (const f of (data ?? []) as Fila[]) canalDe.set(String(f.entry_id), String(f.channel_id))
  }
  if (canalDe.size === 0) return out
  const { data: canales, error: eCanal } = await tabla('sales_channel').select('id, slug, name').eq('account_id', accountId).in('id', [...new Set(canalDe.values())])
  if (eCanal) throw new Error(mensaje('No se han podido leer las plataformas', eCanal))
  const canal = new Map(((canales ?? []) as Fila[]).map((c) => [String(c.id), c]))
  for (const [entryId, ch] of canalDe) {
    const c = canal.get(ch)
    out.set(entryId, { entryId, canal: String(c?.slug ?? ''), nombreCanal: String(c?.name ?? 'la plataforma'), documento: null, envio: null })
  }
  const conCanal = [...out.keys()]
  for (let i = 0; i < conCanal.length; i += 200) {
    const t = conCanal.slice(i, i + 200)
    const [docs, envios] = await Promise.all([
      tabla('journal_entry_document').select('entry_id, storage_path, file_name, size_bytes, created_at, created_by_name').eq('account_id', accountId).eq('kind', 'resumen_ventas').in('entry_id', t),
      tabla('external_send').select('entry_id, status, ext_series, ext_number, ext_invoice_number, attempts, last_error, document_status, document_error').eq('account_id', accountId).neq('status', 'rechazado').in('entry_id', t),
    ])
    if (docs.error) throw new Error(mensaje('No se han podido leer los documentos', docs.error))
    if (envios.error) throw new Error(mensaje('No se han podido leer los envíos a Diez', envios.error))
    for (const f of (docs.data ?? []) as Fila[]) {
      const x = out.get(String(f.entry_id))
      if (x) x.documento = { ruta: String(f.storage_path), nombre: String(f.file_name), bytes: Number(f.size_bytes), creadoEn: String(f.created_at), creadoPor: s(f.created_by_name) }
    }
    for (const f of (envios.data ?? []) as Fila[]) {
      const x = out.get(String(f.entry_id))
      if (x) x.envio = aEnvio(f)
    }
  }
  // Respuesta 8: lo anulado, con el envío a Diez de su contraasiento.
  const anulados = await tabla('journal_entry').select('id, voided_by_entry_id').eq('account_id', accountId).eq('status', 'anulado').in('id', conCanal).not('voided_by_entry_id', 'is', null)
  if (anulados.error) throw new Error(mensaje('No se han podido leer los anulados', anulados.error))
  const contraDe = new Map(((anulados.data ?? []) as Fila[]).map((f) => [String(f.voided_by_entry_id), String(f.id)]))
  if (contraDe.size) {
    const c = await tabla('external_send').select('entry_id, status, ext_series, ext_number, ext_invoice_number, attempts, last_error, document_status, document_error').eq('account_id', accountId).neq('status', 'rechazado').in('entry_id', [...contraDe.keys()])
    if (c.error) throw new Error(mensaje('No se han podido leer los envíos de los contraasientos', c.error))
    for (const f of (c.data ?? []) as Fila[]) { const x = out.get(contraDe.get(String(f.entry_id)) ?? ''); if (x) x.contraasiento = aEnvio(f) }
  }
  return out
}

/** El «Resumen de ventas» del asiento, tal como queda validado (estado y número los pone quien llama). */
function hacerPdf(r: ResumenBD): { bytes: Uint8Array; nombre: string } {
  const listo = resumenDeAsiento(r, { correspondencia: correspondenciaDeEmpresa(r.company_id), generado: new Date(), hoy: hoyMadrid() })
  return { bytes: resumenVentasPdf(jsPDF, listo.datos), nombre: listo.nombreFichero }
}

/** Lo sube a cuenta/asiento/huella.pdf. Subido sin enlazar no es el documento de nadie. */
async function subirPdf(r: ResumenBD, pdf: Uint8Array): Promise<{ ruta: string; sha256: string }> {
  const sha = hex(await crypto.subtle.digest('SHA-256', pdf as BufferSource))
  const ruta = `${r.account_id}/${r.id}/${sha.slice(0, 16)}.pdf`
  hayBase()
  const sub = await supabase!.storage.from(BUCKET).upload(ruta, new Blob([pdf as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
  // Ya subido en un intento anterior con la misma huella: es el mismo fichero.
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`no se ha podido subir su PDF (${sub.error.message})`)
  return { ruta, sha256: sha }
}

/**
 * Solo para un asiento validado ANTES de la 0720 sin su PDF: guardarlo ahora.
 * Lo nuevo se valida con su PDF en una sola transacción (validarConDocumento).
 */
export async function guardarDocumento(entryId: string, quien: string | null): Promise<{ ruta: string; nombre: string; yaEstaba: boolean }> {
  const r = await rpc<ResumenBD>('conta_resumen_ventas', { p_entry: entryId })
  if (r.documento) return { ruta: r.documento.ruta, nombre: r.documento.nombre, yaEstaba: true }
  const pdf = hacerPdf(r)
  const sub = await subirPdf(r, pdf.bytes)
  const g = await rpc<Fila>('conta_documento_guardar', { p_entry: entryId, p_ruta: sub.ruta, p_nombre: pdf.nombre, p_sha256: sub.sha256, p_bytes: pdf.bytes.length, p_quien_nombre: quien })
  return { ruta: String(g.ruta), nombre: String(g.nombre), yaEstaba: g.ya_estaba === true }
}

/**
 * C06b · Respuesta 8, pregunta 1: validar un asiento de ventas de una
 * plataforma y guardar su PDF van juntos (lib/validarConPdf.ts y la 0720). Si
 * el PDF falla, el asiento no se valida y el error dice por qué.
 */
export async function validarConDocumento(entryId: string, quien: string | null): Promise<ValidadoConPdf> {
  const quitar = (e: unknown) => new Error((e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, ''))
  return validarConPdf(entryId, quien, {
    resumen: (id) => rpc<ResumenBD>('conta_resumen_ventas', { p_entry: id }),
    numeroPrevisto: (id) => rpc<number>('conta_numero_previsto', { p_entry: id }),
    hacerPdf: async (r) => {
      try { return hacerPdf(r) } catch (e) { throw new Error(`su PDF no se puede hacer (${quitar(e).message.replace(/\.$/, '')})`, { cause: e }) }
    },
    subir: subirPdf,
    validarConDocumento: async (a) => {
      try {
        const r = await rpc<Fila>('journal_entry_validar_con_documento', { p_entry: a.entryId, p_numero: a.numero, p_ruta: a.ruta, p_nombre: a.nombre, p_sha256: a.sha256, p_bytes: a.bytes, p_quien_nombre: a.quien })
        return { serie: Number(r.serie), numero: Number(r.numero) }
      } catch (e) { throw quitar(e) }
    },
    guardarDocumento,
  })
}

/** «Ver documento»: una URL firmada de cinco minutos. */
export async function urlDocumento(ruta: string): Promise<string> {
  hayBase()
  const { data, error } = await supabase!.storage.from(BUCKET).createSignedUrl(ruta, 300)
  if (error || !data?.signedUrl) throw new Error(`No se ha podido abrir el documento: ${error?.message ?? 'sin enlace'}`)
  return data.signedUrl
}

/** El envío a Diez de un asiento validado, por la edge function. Nunca lanza: dice qué ha pasado. */
export async function enviarADiez(entryId: string): Promise<ResultadoEnvio> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-diez-enviar', { body: { entry_id: entryId } })
  if (!error && data && typeof data === 'object' && 'estado' in data) return data as ResultadoEnvio
  // La función contestó con un error: su cuerpo dice por qué, en palabras.
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const cuerpo = await ctx.clone().json().catch(() => null) as Fila | null
    if (cuerpo?.estado) return cuerpo as unknown as ResultadoEnvio
    const motivo = s(cuerpo?.error) ?? (ctx.status === 404 ? 'el envío a Diez aún no está publicado en este entorno' : `la función ha contestado ${ctx.status}`)
    return { estado: 'no_llega', motivo, reintentar: ctx.status !== 403, texto: `No ha llegado a Diez: ${motivo}.` }
  }
  const motivo = error ? `no se ha podido hablar con el envío a Diez (${error.message})` : 'el envío a Diez no ha contestado'
  return { estado: 'no_llega', motivo, reintentar: true, texto: `No ha llegado a Diez: ${motivo}.` }
}

/**
 * «Validar y enviar a Diez», asiento a asiento y por fecha: validar con su PDF
 * (si no lo está) y el envío. Si uno no se valida, se dice y se sigue; si uno
 * se valida y no llega a Diez, se para y lo demás queda como estaba
 * (lib/enviarVarios.ts, respuesta 8, tarea 1b).
 */
export async function validarYEnviar(xs: readonly AsientoParaEnviar[], quien: string | null, alPaso?: (i: number) => void): Promise<PasoVarios[]> {
  return validarYEnviarVarios(xs, quien, { validarConDocumento, guardarDocumento, enviarADiez }, alPaso)
}

// ── C06b · Respuesta 7: lo que está en Diez sin su PDF ──────────────────────────
// Nombres dentro de cadenas (regla 40), los de la 20261111T0700 y los de antes
// (external_send.document_status / ext_year / sent_at, journal_entry.concept /
// entry_date / series / number / status, journal_entry_document.storage_path /
// file_name), y la función conta_diez_adjunto_a_mano.

/** Un asiento anulado en Folvy cuya factura sigue en Diez (le falta su contraasiento allí). */
export interface AnuladoEnDiez {
  entryId: string; concepto: string; fecha: string; ejercicio: string; serie: string; documento: number; factura: string | null
  /** Respuesta 8: su contraasiento en Folvy, que es lo que se manda a Diez; y por qué no ha llegado aún, si se intentó. */
  contraasiento: string | null; motivo: string | null
}

/** Las facturas de la empresa que están en Diez sin su PDF, y lo anulado en Folvy que sigue en Diez. */
export async function leerPendientesDiez(accountId: string, companyId: string): Promise<{ pendientes: PendienteDiez[]; anulados: AnuladoEnDiez[] }> {
  const { data: envios, error } = await tabla('external_send')
    .select('entry_id, ext_year, ext_series, ext_number, ext_invoice_number, sent_at, document_status')
    .eq('account_id', accountId).eq('company_id', companyId).in('status', ['enviado', 'enlazado'])
  if (error) throw new Error(mensaje('No se han podido leer los envíos a Diez', error))
  const filas = (envios ?? []) as Fila[]
  if (!filas.length) return { pendientes: [], anulados: [] }
  const ids = filas.map((f) => String(f.entry_id))
  const asientos = new Map<string, Fila>()
  const docs = new Map<string, Fila>()
  for (let i = 0; i < ids.length; i += 200) {
    const t = ids.slice(i, i + 200)
    const [a, d] = await Promise.all([
      tabla('journal_entry').select('id, concept, entry_date, series, number, status, voided_by_entry_id').eq('account_id', accountId).eq('company_id', companyId).in('id', t),
      // C06b (16/10): también el PDF de una recibida (kind factura_recibida, mismo almacén).
      tabla('journal_entry_document').select('entry_id, storage_path, file_name').eq('account_id', accountId).in('kind', ['resumen_ventas', 'factura_recibida']).in('entry_id', t),
    ])
    if (a.error) throw new Error(mensaje('No se han podido leer los asientos', a.error))
    if (d.error) throw new Error(mensaje('No se han podido leer los documentos', d.error))
    for (const x of (a.data ?? []) as Fila[]) asientos.set(String(x.id), x)
    for (const x of (d.data ?? []) as Fila[]) docs.set(String(x.entry_id), x)
  }
  // Respuesta 8: lo anulado cuyo contraasiento ya está en Diez no falta; el que se intentó y no llegó, con su motivo.
  const enDiez = new Set(ids)
  const contras = [...asientos.values()].filter((a) => a.status === 'anulado' && a.voided_by_entry_id).map((a) => String(a.voided_by_entry_id)).filter((c) => !enDiez.has(c))
  const motivoDe = new Map<string, string | null>()
  if (contras.length) {
    const { data: m, error: em } = await tabla('external_send').select('entry_id, last_error').eq('account_id', accountId).eq('status', 'pendiente').in('entry_id', contras)
    if (em) throw new Error(mensaje('No se han podido leer los envíos de los contraasientos', em))
    for (const x of (m ?? []) as Fila[]) motivoDe.set(String(x.entry_id), s(x.last_error))
  }
  const pendientes: PendienteDiez[] = []
  const anulados: AnuladoEnDiez[] = []
  for (const f of filas) {
    const id = String(f.entry_id)
    const a = asientos.get(id)
    if (!a) continue
    const base = { entryId: id, concepto: String(a.concept ?? ''), fecha: String(a.entry_date), ejercicio: String(f.ext_year ?? String(a.entry_date).slice(0, 4)), serie: String(f.ext_series), documento: Number(f.ext_number), factura: s(f.ext_invoice_number) }
    if (a.status === 'anulado') {
      const contra = s(a.voided_by_entry_id)
      if (contra && enDiez.has(contra)) continue
      anulados.push({ ...base, contraasiento: contra, motivo: contra ? motivoDe.get(contra) ?? null : null }); continue
    }
    if (f.document_status !== 'pendiente_diez') continue
    const d = docs.get(id)
    pendientes.push({ ...base, serieFolvy: Number(a.series), numeroFolvy: a.number == null ? null : Number(a.number), enviadoEn: s(f.sent_at),
      ruta: String(d?.storage_path ?? ''), nombrePdf: String(d?.file_name ?? '') })
  }
  return { pendientes: ordenPendientes(pendientes), anulados: ordenPendientes(anulados) }
}

/** «Ya está adjunto»: una persona lo ha adjuntado en Diez. Devuelve la frase de la pantalla. */
export async function marcarAdjuntoEnDiez(entryId: string, quien: string | null): Promise<string> {
  const r = await rpc<Fila>('conta_diez_adjunto_a_mano', { p_entry: entryId, p_quien_nombre: quien })
  const ref = `${r.serie}/${r.numero}`
  return r.ya_estaba === true ? `Ya estaba marcado: el PDF de ${ref} está adjunto en Diez.` : `Hecho: el PDF de ${ref} queda adjunto en Diez${quien ? `, marcado por ${quien}` : ''}.`
}

/** «Descargar todos»: un zip con cada PDF guardado en Folvy, con el nombre de su referencia en Diez. */
export async function zipPendientesDiez(xs: readonly PendienteDiez[]): Promise<{ zip: Uint8Array; n: number; sinPdf: string[] }> {
  hayBase()
  const ficheros: FicheroZip[] = []
  const sinPdf: string[] = []
  for (const x of xs) {
    if (!x.ruta) { sinPdf.push(x.concepto); continue }
    const { data, error } = await supabase!.storage.from(BUCKET).download(x.ruta)
    if (error || !data) { sinPdf.push(x.concepto); continue }
    ficheros.push({ nombre: nombreEnZip(x), datos: new Uint8Array(await data.arrayBuffer()) })
  }
  return { zip: crearZip(ficheros), n: ficheros.length, sinPdf }
}

// ── C06b · Respuesta 8, pregunta 2: anular lo que ya está en Diez ──────────────

/**
 * Anula el asiento y, si su factura ya está en Diez, manda SOLO el
 * contraasiento a Diez (conta-diez-enviar con el id del contraasiento: nunca
 * dos veces, como la factura). Si el envío no llega, el anulado sale en
 * «Pendientes de adjuntar en Diez», con «Enviar el contraasiento».
 */
export async function anularConDiez(entryId: string, motivo: string, fecha: string | null, quien: string | null): Promise<{ serie: number; numero: number; fecha: string; contraasiento: string; diez: ResultadoEnvio | null }> {
  const { data, error } = await tabla('external_send').select('status').eq('entry_id', entryId).in('status', ['enviado', 'enlazado']).limit(1)
  if (error) throw new Error(mensaje('No se ha podido mirar si está en Diez', error))
  const enDiez = (data ?? []).length > 0
  const x = await anular(entryId, motivo, fecha, quien)
  return { ...x, diez: enDiez ? await enviarADiez(x.contraasiento) : null }
}
