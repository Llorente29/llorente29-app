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
//   · validarYEnviar: los tres pasos, asiento a asiento, diciendo de cada uno
//     qué ha pasado (regla 8).
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

import { jsPDF } from 'jspdf'
import { supabase } from '@/lib/supabase'
import { rpc, tabla, mensaje, hayBase } from '@/modules/conta/services/bd'
import { validar } from '@/modules/conta/services/diarioService'
import { correspondenciaDeEmpresa } from '../../../../supabase/functions/_shared/diezAnalitica.ts'
import { resumenDeAsiento, type ResumenBD } from '../../../../supabase/functions/_shared/resumenDeAsiento.ts'
import { resumenVentasPdf } from '../../../../supabase/functions/_shared/resumenVentasPdf.ts'
import type { ResultadoEnvio } from '../../../../supabase/functions/_shared/diezEnviar.ts'
import type { ConDiez, EnvioDiez, PasoEnvio } from '@/modules/conta/lib/conDiez'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const BUCKET = 'conta-documentos'
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

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
      if (x) x.envio = {
        status: String(f.status) as EnvioDiez['status'], serie: s(f.ext_series), numero: f.ext_number == null ? null : Number(f.ext_number), factura: s(f.ext_invoice_number),
        intentos: Number(f.attempts ?? 0), error: s(f.last_error), documento: (s(f.document_status) as EnvioDiez['documento']) ?? null, errorDocumento: s(f.document_error),
      }
    }
  }
  return out
}

/** El PDF del asiento validado, guardado y enlazado. Si ya lo tiene, devuelve el que hay. */
export async function guardarDocumento(entryId: string, quien: string | null): Promise<{ ruta: string; nombre: string; yaEstaba: boolean }> {
  const r = await rpc<ResumenBD>('conta_resumen_ventas', { p_entry: entryId })
  if (r.documento) return { ruta: r.documento.ruta, nombre: r.documento.nombre, yaEstaba: true }
  const listo = resumenDeAsiento(r, { correspondencia: correspondenciaDeEmpresa(r.company_id), generado: new Date(), hoy: hoyMadrid() })
  const pdf = resumenVentasPdf(jsPDF, listo.datos)
  const sha = hex(await crypto.subtle.digest('SHA-256', pdf as BufferSource))
  const ruta = `${r.account_id}/${r.id}/${sha.slice(0, 16)}.pdf`
  hayBase()
  const sub = await supabase!.storage.from(BUCKET).upload(ruta, new Blob([pdf as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
  // Ya subido en un intento anterior con la misma huella: es el mismo fichero.
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`No se ha podido subir el documento: ${sub.error.message}`)
  const g = await rpc<Fila>('conta_documento_guardar', { p_entry: entryId, p_ruta: ruta, p_nombre: listo.nombreFichero, p_sha256: sha, p_bytes: pdf.length, p_quien_nombre: quien })
  return { ruta: String(g.ruta), nombre: String(g.nombre), yaEstaba: g.ya_estaba === true }
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
 * «Validar y enviar a Diez», asiento a asiento: validar (si no lo está), su
 * documento y el envío. Si un paso falla, ese asiento se queda donde llegó y
 * se dice; los demás siguen.
 */
export async function validarYEnviar(xs: readonly { id: string; concepto: string; estado: string }[], quien: string | null, alPaso?: (i: number) => void): Promise<PasoEnvio[]> {
  const pasos: PasoEnvio[] = []
  for (const [i, a] of xs.entries()) {
    alPaso?.(i)
    const p: PasoEnvio = { concepto: a.concepto, validado: a.estado === 'validado', documento: false, enDiez: false, texto: '' }
    try {
      if (!p.validado) { await validar(a.id, quien); p.validado = true }
      await guardarDocumento(a.id, quien); p.documento = true
      const r = await enviarADiez(a.id)
      p.enDiez = r.estado === 'en_diez'
      p.texto = r.texto
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      p.texto = !p.validado ? `No se ha validado: ${m}` : !p.documento ? `Validado, pero no ha llegado a Diez: falta el documento (${m}).` : `No ha llegado a Diez: ${m}.`
    }
    pasos.push(p)
  }
  return pasos
}
