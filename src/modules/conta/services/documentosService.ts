// src/modules/conta/services/documentosService.ts
//
// D01 · Lo que hablan N22 (Documentos › Facturas recibidas) y N23 (Revisar
// factura) con la base. Cada paso que escribe dice qué ha pasado (regla 8).
//
//   · Leer: conta_documentos_recibidos (0280) y conta_factura_para_revisar (0290).
//   · Subir: el fichero a receipt-uploads, su registro (conta_subida_registrar,
//     que no registra dos veces el mismo fichero), la lectura en modo factura
//     (ocr-albaran) y la factura desde lo leído (conta_factura_desde_lectura,
//     que no apunta dos veces la misma: repetida = número y total).
//   · «Está bien · apuntar»: aprobarla como en Compras, proponer su asiento
//     igual que la tanda, validarlo, guardar su PDF (una foto se convierte) y
//     mandarlo a Diez. Si Diez no lo admite, lo dice y el asiento se queda
//     validado en Folvy.
//   · «Pedírselas»: la petición queda confirmada por la persona; el correo lo
//     manda ella desde el suyo (mailto) mientras no haya dominio de correo.

import { supabase } from '@/lib/supabase'
import { rpc, tabla, hayBase, mensaje } from '@/modules/conta/services/bd'
import { validar } from '@/modules/conta/services/diarioService'
import { enviarADiez, urlDocumento } from '@/modules/conta/services/conDiezService'
import { leerEnvioEmpresa } from '@/modules/conta/services/envioDiezService'
import { proponerFactura, verPropuestaFactura } from '@/modules/conta/services/propuestasLibroService'
import { approveInvoice } from '@/modules/supply/services/supplierInvoiceService'
import { getReceiptFileUrl, uploadReceiptFiles } from '@/modules/supply/services/goodsReceiptService'
import { fotoAPdf } from '@/modules/conta/lib/fotoAPdf'
import type { DatosDocumentos, PlazoFicha } from '@/modules/conta/documentos/documentos'
import { leerFactura as comprobarLectura, type Lectura, type LecturaModelo } from '../../../../supabase/functions/_shared/lecturaFactura.ts'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { textoParaPantalla } from '@/modules/conta/lib/errorBase'
import { MAX_BYTES_EXPEDIDA, claseDeFichero, motivoExpedida, nombreExpedida, rutaExpedida, tamano } from '@/modules/conta/lib/expedidaPdf'
import { papelDeLaLectura } from '@/modules/conta/documentos/fichaRecibida'
import type { ProveedorLeido } from '@/modules/conta/lib/proveedorDesdeFactura'

type Fila = Record<string, unknown>
const RECEPCIONES = 'receipt-uploads'
const DOCUMENTOS = 'conta-documentos'

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256 = async (b: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', b))
const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function leerDocumentos(companyId: string, desde: string, hasta: string): Promise<DatosDocumentos> {
  return rpc<DatosDocumentos>('conta_documentos_recibidos', { p_company: companyId, p_desde: desde, p_hasta: hasta })
}

// ── N23 ─────────────────────────────────────────────────────────────────────

export interface FacturaRevisar {
  id: string
  account_id: string
  company_id: string | null
  estado: string
  numero: string | null
  fecha: string | null
  vence: string | null
  clase: 'invoice' | 'credit_note' | null
  base: number | null
  cuota: number | null
  recargo: number | null
  retencion: number | null
  total: number | null
  canal: string | null
  confianza: 'seguro' | 'probable' | 'duda' | null
  lectura: (Lectura & { porque: string[] }) | null
  no_repetida: boolean
  tipos: { tipo: number; base: number; cuota: number; recargo: number | null }[]
  lineas: { texto: string; cantidad: number | null; importe: number | null; iva: number | null }[]
  proveedor: {
    id: string; nombre: string; razon: string | null; nif: string | null; subcuenta: string | null
    gasto: { cuenta: string; nombre: string; origen: string } | null
    facturacion: { nombre: string; email: string } | null
  } | null
  propuesto: { nombre: string | null; nif: string | null } | null
  llegada: { canal: string; archivo: string | null; ruta: string | null; tipo: string | null; de: string | null; a: string | null; cuando: string } | null
  papel: string | null
  recepcion: { fecha: string; local: string | null } | null
  asiento: { id: string; estado: string; numero: number | null } | null
  /** R6 · Lo que leyó la recepción de su papel, si la factura salió de ella y no trae lectura propia. */
  leido_en_recepcion?: { modelo: LecturaModelo; cuando: string; recepcion: string } | null
}

export async function leerFactura(invoiceId: string): Promise<FacturaRevisar> {
  return conLoLeidoEnRecepcion(await rpc<FacturaRevisar>('conta_factura_para_revisar', { p_invoice: invoiceId }))
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/**
 * R6 · Una factura hecha desde su recepción (Compras) no trae lectura propia:
 * se comprueba lo que leyó la recepción con la MISMA regla que el modo factura
 * (cuadra, IVA por tipo, NIF, número…), aquí, sin volver a leerla con el modelo.
 */
export function conLoLeidoEnRecepcion(f: FacturaRevisar, hoy = hoyEnMadrid()): FacturaRevisar {
  if (f.lectura || !f.leido_en_recepcion?.modelo) return f
  const l = comprobarLectura(f.leido_en_recepcion.modelo, { hoy })
  const de = `Lo leyó la recepción del ${ddmm(f.leido_en_recepcion.recepcion)} con su factura; no la he vuelto a leer.`
  return { ...f, lectura: { ...l, porque: [de, ...l.porque] }, confianza: f.confianza ?? l.confianza }
}

/** R6 · El documento de una recepción, para «Ver la factura» en N22: una URL firmada. */
export async function urlDePapelDeRecepcion(ruta: string | null | undefined): Promise<string | null> {
  return ruta ? getReceiptFileUrl(ruta) : null
}

/**
 * El fichero tal como llegó, para verlo a la derecha: una URL firmada. Ficha
 * completa: si la factura no tiene enlazado su papel (raw_document_url vacío),
 * el que guardó su lectura (`deLaLectura`, de goods_receipt_ai_session.input_files):
 * la COHELDI P26 4.980 lo tenía ahí y salía «sin fichero».
 */
export async function urlDelPapel(f: Pick<FacturaRevisar, 'llegada' | 'papel'>, deLaLectura?: string | null): Promise<string | null> {
  return getReceiptFileUrl(f.llegada?.ruta ?? f.papel ?? deLaLectura ?? null)
}

export { verPropuestaFactura }

/** R5 · 1 · El plazo de pago de su ficha, para comparar con el vencimiento de la factura (regla 9: por su cuenta). */
export async function plazoDeLaFicha(accountId: string, supplierId: string): Promise<PlazoFicha> {
  const { data, error } = await tabla('supplier').select('payment_terms_days, payment_fixed_days').eq('id', supplierId).eq('account_id', accountId).maybeSingle()
  if (error) throw new Error(`No se ha podido leer el plazo de su ficha: ${error.message}`)
  const f = data as Fila | null
  const dias = f && typeof f.payment_terms_days === 'number' ? f.payment_terms_days : null
  const fijos = f && Array.isArray(f.payment_fixed_days) ? (f.payment_fixed_days as unknown[]).map(Number).filter((x) => Number.isFinite(x)) : []
  return { dias, fijos }
}

// ── Subir ───────────────────────────────────────────────────────────────────

export interface Subida { archivo: string; bien: boolean; texto: string; factura: string | null }

/** Lee un fichero ya subido en modo factura. Devuelve la sesión de lectura. */
async function leerEnModoFactura(accountId: string, ruta: string): Promise<string> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('ocr-albaran', { body: { account_id: accountId, file_paths: [ruta], modo: 'factura' } })
  if (error) throw new Error(`no se ha podido leer (${error.message})`)
  const id = (data as Fila | null)?.session_id
  if (typeof id !== 'string') throw new Error('la lectura no ha devuelto su sesión')
  return id
}

/**
 * S01b2 · Vuelve a leer el PDF guardado de una factura con el lector de hoy (el
 * mismo de «Subir factura»: ocr-albaran en modo factura) y completa su lectura
 * con lo que le faltaba del proveedor (conta_lectura_proveedor_releida, que lo
 * toma de la sesión de esa lectura, no de aquí). Devuelve el proveedor como ha
 * quedado y qué se ha añadido.
 */
export async function releerProveedorDeLaFactura(accountId: string, invoiceId: string, ruta: string): Promise<{ proveedor: ProveedorLeido; puesto: string[] }> {
  const sesion = await leerEnModoFactura(accountId, ruta)
  const r = await rpc<Fila>('conta_lectura_proveedor_releida', { p_invoice: invoiceId, p_session: sesion })
  const proveedor = (r.proveedor && typeof r.proveedor === 'object' ? r.proveedor : {}) as ProveedorLeido
  const puesto = Array.isArray(r.puesto) ? (r.puesto as unknown[]).map(String) : []
  return { proveedor, puesto }
}

/**
 * Sube, registra y lee cada fichero, uno a uno: cada uno es un documento. Lo
 * que pasa con cada uno se dice; uno que falla no para a los demás.
 */
export async function subirFacturas(accountId: string, companyId: string, ficheros: readonly File[], quien: string | null,
  alPaso?: (i: number) => void): Promise<Subida[]> {
  hayBase()
  const out: Subida[] = []
  for (const [i, f] of ficheros.entries()) {
    alPaso?.(i)
    const s: Subida = { archivo: f.name, bien: false, texto: '', factura: null }
    try {
      const [ruta] = await uploadReceiptFiles(accountId, [f])
      // La huella, de lo que se ha guardado (las fotos se recomprimen al subir).
      const bajado = await supabase!.storage.from(RECEPCIONES).download(ruta)
      if (bajado.error || !bajado.data) throw new Error(`no se ha podido comprobar lo subido (${bajado.error?.message ?? 'vacío'})`)
      const bytes = await bajado.data.arrayBuffer()
      const tipo = bajado.data.type || (ruta.endsWith('.jpg') ? 'image/jpeg' : f.type)
      const reg = await rpc<Fila>('conta_subida_registrar', {
        p_company: companyId, p_ruta: ruta, p_nombre: f.name, p_tipo: tipo, p_bytes: bytes.byteLength, p_sha256: await sha256(bytes), p_quien_nombre: quien,
      })
      let leer = ruta
      if (reg.ya_estaba === true) {
        // Ya estaba: si se quedó sin leer (la lectura falló), se lee ahora el que había; si no, nada.
        const { data: ya } = await tabla('document_inbox').select('status, file_path, supplier_invoice_id').eq('id', String(reg.id)).maybeSingle()
        const y = (ya ?? {}) as Fila
        if (y.supplier_invoice_id || !['recibido', 'error'].includes(String(y.status))) {
          s.texto = `«${f.name}» ya estaba subido: no lo he vuelto a registrar.`; s.bien = true; s.factura = typeof y.supplier_invoice_id === 'string' ? y.supplier_invoice_id : null
          out.push(s); continue
        }
        leer = String(y.file_path)
      }
      const sesion = await leerEnModoFactura(accountId, leer)
      const r = await rpc<Fila>('conta_factura_desde_lectura', { p_inbox: reg.id, p_session: sesion })
      s.factura = typeof r.factura_id === 'string' ? r.factura_id : null
      // D06: el PDF bueno de una que entró con foto ocupa su sitio (no hay otra factura): también es bien.
      s.bien = r.estado === 'factura' || r.estado === 'pdf_sustituye_foto'
      s.texto = typeof r.texto === 'string' ? `«${f.name}»: ${r.texto}` : `«${f.name}»: ${String(r.estado)}.`
    } catch (e) {
      s.texto = `«${f.name}» no ha entrado: ${motivo(e)}.`
    }
    out.push(s)
  }
  return out
}

// ── «Está bien · apuntar» ───────────────────────────────────────────────────

export interface Apuntada { aprobada: boolean; asiento: string | null; validado: boolean; documento: boolean; enDiez: boolean; texto: string }

/** El PDF de la factura, en conta-documentos y enlazado al asiento validado. Una foto se convierte a PDF. */
async function guardarFacturaPdf(f: FacturaRevisar, entryId: string, quien: string | null): Promise<void> {
  hayBase()
  // D02: el servidor (conta-recibida-pdf) ya puede haberlo enlazado. Si está, vale:
  // otro PDF chocaría con «ya tiene su factura».
  const { data: ya, error: yaError } = await tabla('journal_entry_document').select('id')
    .eq('account_id', f.account_id).eq('entry_id', entryId).eq('kind', 'factura_recibida').maybeSingle()
  if (yaError) throw new Error(`no se ha podido mirar si ya tiene su PDF (${yaError.message})`)
  if (ya) return
  const ruta = f.llegada?.ruta ?? f.papel ?? (await leerPapelDeLaLectura(f.account_id, f.id))
  if (!ruta) throw new Error('no tengo el fichero de la factura')
  const bajado = await supabase!.storage.from(RECEPCIONES).download(ruta)
  if (bajado.error || !bajado.data) throw new Error(`no se ha podido leer el fichero (${bajado.error?.message ?? 'vacío'})`)
  const tipo = bajado.data.type || f.llegada?.tipo || ''
  let pdf: Uint8Array
  if (tipo === 'application/pdf' || ruta.toLowerCase().endsWith('.pdf')) pdf = new Uint8Array(await bajado.data.arrayBuffer())
  else if (tipo === 'image/jpeg' || tipo === 'image/png') {
    const img = await createImageBitmap(bajado.data)
    pdf = fotoAPdf(new Uint8Array(await bajado.data.arrayBuffer()), tipo, img.width, img.height).pdf
  } else throw new Error(`el fichero es ${tipo || 'de un tipo desconocido'} y Diez necesita un PDF`)
  const huella = await sha256(pdf.slice().buffer)
  const destino = `${f.account_id}/${entryId}/${huella.slice(0, 16)}.pdf`
  const sub = await supabase!.storage.from(DOCUMENTOS).upload(destino, new Blob([pdf as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`no se ha podido guardar el PDF (${sub.error.message})`)
  // S01d: journal_entry_document.file_name solo admite [A-Za-z0-9._-]+\.pdf (check de la
  // 20261021T0100). Con espacios o tildes («Hermanos Ruiz F-12.pdf») la base lo rechazaba y
  // ninguna recibida llegaba a Diez con su PDF (en producción, 0 de factura_recibida, 18/10).
  const nombre = nombreExpedida(`${f.proveedor?.nombre ?? 'factura'}${f.numero ? ` ${f.numero}` : ''}`)
  await rpc('conta_documento_factura_guardar', { p_entry: entryId, p_ruta: destino, p_nombre: nombre, p_sha256: huella, p_bytes: pdf.length, p_quien_nombre: quien })
}

// ── S01d · El PDF de una factura expedida a mano ───────────────────────────
// Nombres de la base entre comillas (regla 40): conta_documento_expedida_guardar
// (la 0160 del S01d), journal_entry_document (entry_id, kind, storage_path,
// file_name, size_bytes, created_at, created_by_name) y el bucket conta-documentos.

export interface DocExpedida { ruta: string; nombre: string; bytes: number | null; cuando: string; quien: string | null }

/** El PDF ya adjunto a una expedida, o null si no tiene (regla 9: por su cuenta). */
export async function leerExpedidaPdf(accountId: string, entryId: string): Promise<DocExpedida | null> {
  const { data, error } = await tabla('journal_entry_document').select('storage_path, file_name, size_bytes, created_at, created_by_name')
    .eq('account_id', accountId).eq('entry_id', entryId).eq('kind', 'factura_expedida').maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer la factura adjunta', error))
  const f = data as Fila | null
  if (!f) return null
  return {
    ruta: String(f.storage_path), nombre: String(f.file_name), bytes: typeof f.size_bytes === 'number' ? f.size_bytes : null,
    cuando: String(f.created_at), quien: typeof f.created_by_name === 'string' ? f.created_by_name : null,
  }
}

/** El fichero elegido, como PDF: tal cual si lo es; una foto JPG o PNG se convierte. */
export async function ficheroAPdf(fichero: File): Promise<Uint8Array> {
  const clase = claseDeFichero(fichero.name, fichero.type)
  if (!clase) throw new Error(`«${fichero.name}» no es un PDF ni una foto JPG o PNG`)
  const bytes = new Uint8Array(await fichero.arrayBuffer())
  if (clase === 'pdf') return bytes
  const img = await createImageBitmap(fichero)
  return fotoAPdf(bytes, clase, img.width, img.height).pdf
}

/**
 * Sube el PDF de la expedida a conta-documentos y lo enlaza a su asiento ya
 * validado. Lanza con el motivo (los de la base, en sus palabras) si no.
 */
export async function guardarExpedidaPdf(accountId: string, entryId: string, fichero: File, quien: string | null): Promise<{ nombre: string; yaEstaba: boolean }> {
  hayBase()
  const pdf = await ficheroAPdf(fichero)
  if (pdf.length > MAX_BYTES_EXPEDIDA) throw new Error(`el PDF pesa ${tamano(pdf.length)} y caben ${tamano(MAX_BYTES_EXPEDIDA)}`)
  const huella = await sha256(pdf.slice().buffer)
  const destino = rutaExpedida(accountId, entryId, huella)
  const sub = await supabase!.storage.from(DOCUMENTOS).upload(destino, new Blob([pdf as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
  // Ya subido con la misma huella (un reintento): es el mismo fichero, se enlaza.
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`no se ha podido subir el PDF (${sub.error.message})`)
  const r = await rpc<Fila>('conta_documento_expedida_guardar', {
    p_entry: entryId, p_ruta: destino, p_nombre: nombreExpedida(fichero.name), p_sha256: huella, p_bytes: pdf.length, p_quien_nombre: quien,
  }).catch((e: unknown) => { throw new Error(motivoExpedida(motivo(e))) })
  return { nombre: typeof r.nombre === 'string' ? r.nombre : nombreExpedida(fichero.name), yaEstaba: r.ya_estaba === true }
}

/**
 * Aprueba (como en Compras), propone su asiento (como la tanda), lo valida,
 * guarda su PDF y lo manda a Diez. Se para donde falle y lo dice.
 */
export async function apuntarFactura(f: FacturaRevisar, quien: string | null, userId: string | null, localPropuesto?: string | null): Promise<Apuntada> {
  // D07b · Pagada en el banco antes de validarla: ya está aprobada (cuenta como tal); le falta el asiento.
  const a: Apuntada = { aprobada: f.estado === 'aprobada' || f.estado === 'pagada', asiento: f.asiento?.id ?? null, validado: f.asiento?.estado === 'validado', documento: false, enDiez: false, texto: '' }
  try {
    if (!f.company_id) throw new Error('la factura no dice de qué empresa es')
    if (!f.fecha) throw new Error('la factura no tiene fecha: dímela antes de apuntarla')
    if (!a.aprobada && f.estado === 'en_revision') { await approveInvoice(f.id, userId, quien); a.aprobada = true }
    if (!a.aprobada) throw new Error(`la factura está ${f.estado}`)
    if (!a.asiento) {
      const r = await proponerFactura(f.account_id, f.company_id, f.id, f.fecha, quien, localPropuesto)
      if (r.sinPropuesta.length) throw new Error(`aprobada, pero sin asiento: ${r.sinPropuesta[0].porque}`)
      const de = await leerFactura(f.id)
      a.asiento = de.asiento?.id ?? null
      a.validado = de.asiento?.estado === 'validado'
      if (!a.asiento) throw new Error('aprobada, pero el asiento no aparece')
    }
    if (!a.validado) { await validar(a.asiento, quien); a.validado = true }
    await guardarFacturaPdf(f, a.asiento, quien); a.documento = true
    // C07: con «Enviar a Diez» apagado, no se manda ni se habla de Diez.
    if (!(await leerEnvioEmpresa(f.account_id, f.company_id)).encendido) { a.texto = 'Apuntada y validada.'; return a }
    const r = await enviarADiez(a.asiento)
    a.enDiez = r.estado === 'en_diez'
    a.texto = a.enDiez ? `Apuntada y en Diez. ${r.texto}` : `Apuntada y validada. ${r.texto}`
  } catch (e) {
    const m = motivo(e)
    a.texto = !a.aprobada ? `No se ha apuntado: ${m}.` : !a.validado ? `No se ha apuntado: ${m}.`
      : !a.documento ? `Apuntada y validada, pero no ha llegado a Diez: falta su PDF (${m}).` : `Apuntada y validada, pero no ha llegado a Diez: ${m}.`
  }
  return a
}

/** «Decirlo yo»: el proveedor de una factura cuyo emisor no reconocí. */
export async function decirProveedor(invoiceId: string, supplierId: string): Promise<void> {
  const { error } = await tabla('supplier_invoice').update({ supplier_id: supplierId, updated_at: new Date().toISOString() }).eq('id', invoiceId)
  if (error) throw new Error(`No se ha podido guardar el proveedor: ${error.message}`)
}

export async function proveedoresDeLaCuenta(accountId: string): Promise<{ id: string; nombre: string; nif: string | null }[]> {
  const { data, error } = await tabla('supplier').select('id, name, tax_id').eq('account_id', accountId).is('archived_at', null).order('name')
  if (error) throw new Error(`No se han podido leer los proveedores: ${error.message}`)
  return ((data ?? []) as Fila[]).map((x) => ({ id: String(x.id), nombre: String(x.name), nif: typeof x.tax_id === 'string' ? x.tax_id : null }))
}

export { urlDocumento }

// ── «Pedírselas» ────────────────────────────────────────────────────────────

export interface Peticion { supplierId: string; periodo: string; email: string; contacto: string | null; guardarContacto: boolean; asunto: string; cuerpo: string }

/** Guarda la petición confirmada y devuelve el enlace para mandarla desde el correo de la persona. */
export async function pedirFactura(companyId: string, p: Peticion, quien: string | null): Promise<{ yaEstaba: boolean; mailto: string }> {
  const r = await rpc<Fila>('conta_factura_pedir', {
    p_company: companyId, p_supplier: p.supplierId, p_periodo: p.periodo, p_email: p.email, p_contacto: p.contacto,
    p_guardar_contacto: p.guardarContacto, p_asunto: p.asunto, p_cuerpo: p.cuerpo, p_quien_nombre: quien,
  })
  const mailto = `mailto:${encodeURIComponent(p.email.trim())}?subject=${encodeURIComponent(p.asunto)}&body=${encodeURIComponent(p.cuerpo)}`
  return { yaEstaba: r.ya_estaba === true, mailto }
}

/** El contacto de Facturación de un proveedor, si lo tiene (para proponer a quién se la pido). */
export async function contactoFacturacion(supplierId: string): Promise<{ nombre: string; email: string } | null> {
  const { data, error } = await tabla('supplier_contact').select('name, email, role').eq('supplier_id', supplierId).not('email', 'is', null).order('created_at')
  if (error) throw new Error(`No se ha podido leer su contacto: ${error.message}`)
  const xs = (data ?? []) as Fila[]
  const x = xs.find((c) => c.role === 'billing') ?? xs.find((c) => c.role === 'admin') ?? xs[0]
  return x ? { nombre: String(x.name), email: String(x.email) } : null
}

/** «Ver» de un documento que aún no es factura: su fichero, por una URL firmada. */
export async function urlDeLlegada(inboxId: string): Promise<string | null> {
  const { data, error } = await tabla('document_inbox').select('file_path').eq('id', inboxId).maybeSingle()
  if (error) throw new Error(`No se ha podido abrir el documento: ${error.message}`)
  return getReceiptFileUrl((data as Fila | null)?.file_path as string | null)
}

// ── S01 (0160) · «No es una factura» ───────────────────────────────────────
// Nombres de la base entre comillas (regla 40): conta_factura_descartar,
// conta_factura_recuperar y supplier_invoice.discard_reason, discarded_by_name,
// discarded_at (la 0160 del S01).

export interface Descarte { motivo: string; quien: string | null; cuando: string }

/** Por qué no es una factura, quién y cuándo. Null si no está descartada (o la base aún no tiene la 0160). */
export async function leerDescarte(invoiceId: string): Promise<Descarte | null> {
  const { data, error } = await tabla('supplier_invoice').select('discard_reason, discarded_by_name, discarded_at').eq('id', invoiceId).maybeSingle()
  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204' || /discard/.test(error.message)) return null
    throw new Error(mensaje('No se ha podido leer por qué no es una factura', error))
  }
  const f = data as { discard_reason: string | null; discarded_by_name: string | null; discarded_at: string | null } | null
  return f?.discard_reason && f.discarded_at ? { motivo: f.discard_reason, quien: f.discarded_by_name, cuando: f.discarded_at } : null
}

/** La deja descartada con su motivo; se deshace con recuperarFactura. */
export async function descartarFactura(invoiceId: string, motivo: string, quien: string | null): Promise<void> {
  await rpc('conta_factura_descartar', { p_invoice: invoiceId, p_motivo: motivo, p_quien_nombre: quien })
}

/** Deshace «No es una factura»: vuelve al estado de antes. Devuelve ese estado. */
export async function recuperarFactura(invoiceId: string, quien: string | null): Promise<string> {
  const r = await rpc<{ estado: string }>('conta_factura_recuperar', { p_invoice: invoiceId, p_quien_nombre: quien })
  return r.estado
}

// ── S02 · Lo que la lista de Facturas recibidas enseña además (tablero 2) ──
//
// La base, el IVA, el local y si está pagada, de supplier_invoice (columnas
// comprobadas en information_schema el 22/10: tax_base_total, tax_total,
// paid_at, paid_method, location_id) y el nombre del local de locations (la
// misma que lee conta_documentos_recibidos). Sin migración: una lectura más,
// por ids, con su cuenta (regla 9). Si no se puede leer, la lista sale igual
// con «—» en esas columnas y lo dice.

export interface ExtraFactura { base: number | null; iva: number | null; pagada: string | null; comoPagada: string | null; localId: string | null; local: string | null }

export async function leerExtrasFacturas(accountId: string, ids: readonly string[]): Promise<Map<string, ExtraFactura>> {
  const fuera = new Map<string, ExtraFactura>()
  if (ids.length === 0) return fuera
  const filas: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await tabla('supplier_invoice').select('id, tax_base_total, tax_total, paid_at, paid_method, location_id')
      .eq('account_id', accountId).in('id', ids.slice(i, i + 200))
    if (error) throw new Error(mensaje('No se han podido leer la base, el IVA y el pago de las facturas', error))
    filas.push(...((data ?? []) as Record<string, unknown>[]))
  }
  const locales = [...new Set(filas.map((f) => f.location_id).filter((x): x is string => typeof x === 'string'))]
  const nombres = new Map<string, string>()
  if (locales.length > 0) {
    const { data, error } = await tabla('locations').select('id, name').eq('account_id', accountId).in('id', locales)
    if (error) throw new Error(mensaje('No se han podido leer los locales', error))
    for (const l of (data ?? []) as Record<string, unknown>[]) nombres.set(String(l.id), String(l.name))
  }
  const num = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x))
  for (const f of filas) {
    const localId = typeof f.location_id === 'string' ? f.location_id : null
    fuera.set(String(f.id), {
      base: num(f.tax_base_total), iva: num(f.tax_total),
      pagada: typeof f.paid_at === 'string' ? f.paid_at : null, comoPagada: typeof f.paid_method === 'string' ? f.paid_method : null,
      localId, local: localId ? nombres.get(localId) ?? null : null,
    })
  }
  return fuera
}

// ── La ficha de la recibida, completa (tablero 3b) ─────────────────────────
//
// Lo que la ficha enseña además de conta_factura_para_revisar: de dónde vino
// (su recepción con su local y quién la hizo, la lectura de su fichero), su
// historial (los sellos que ya se guardan: alta, aprobada, vence, pagos,
// asiento, descarte), la forma de pago de su ficha y el papel de su lectura.
// Todo por su cuenta (regla 9). Nombres de la base entre comillas (regla 40),
// comprobados en information_schema el 23/10: supplier_invoice (id,
// account_id, source, location_id, ai_session_id, created_at, created_by_name,
// approved_at, approved_by_name, due_date_set_at, due_date_set_name,
// discarded_at, discarded_by_name, discard_reason, supplier_id),
// supplier_invoice_receipt (supplier_invoice_id, goods_receipt_id),
// goods_receipt (id, account_id, receipt_date, location_id, created_at,
// created_by_name), goods_receipt_ai_session (id, account_id, input_files,
// created_at), supplier_invoice_payment_log (account_id, invoice_id, action,
// paid_at, due_date, actor_name, created_at), journal_entry (account_id,
// source_type, source_id, number, status, validated_at, validated_by_name,
// created_at), supplier (id, account_id, payment_method), company_account
// (account_id, company_id, code, name) y locations (id, account_id, name).
// Y los de la 0790 (contrato D03, aún no en producción el 23/10; si faltan, la
// ficha sale igual): supplier_invoice (payment_method, no_document_at,
// no_document_reason, no_document_by_name, entry_overrides),
// supplier_invoice_expense (account_id, supplier_invoice_id, position,
// account_code, location_id, is_common, amount) y supplier_invoice_change
// (account_id, supplier_invoice_id, at, by_name, what, cambios).

export interface FichaExtra {
  fuente: string | null
  localId: string | null
  creada: { cuando: string; quien: string | null }
  aprobada: { cuando: string; quien: string | null } | null
  venceCambiado: { cuando: string; quien: string | null } | null
  descartada: { cuando: string; quien: string | null; motivo: string | null } | null
  recepcion: { fecha: string; localId: string | null; local: string | null; quien: string | null; cuando: string | null } | null
  lectura: { cuando: string; ruta: string | null; archivo: string | null } | null
  pagos: { cuando: string; accion: string; quien: string | null; pagada: string | null; vence: string | null }[]
  asiento: { numero: number | null; validado: { cuando: string; quien: string | null } | null; creado: string | null } | null
  formaPagoFicha: string | null
  /** withholding_rate_id: la retención que lleva, para mandarla por su id. */
  retencionId: string | null
  /**
   * Lo que guarda la ficha con la tanda D03 · 0790 (null si la base aún no lo
   * tiene): supplier_invoice.payment_method, no_document_at/_reason/_by_name y
   * entry_overrides; supplier_invoice_expense (el gasto repartido) y
   * supplier_invoice_change (lo que cambió una persona).
   */
  guardado: {
    formaPago: string | null
    sinPdf: { cuando: string; motivo: string | null; quien: string | null } | null
    asientoAMano: unknown
    reparto: { cuenta: string; local: string | null; comun: boolean; importe: number }[]
    cambios: { cuando: string; quien: string | null; que: string; campos: string[]; anterior?: string | null; pdfSustituye?: boolean }[]
  } | null
}

/** Las columnas y tablas de la 0790 que aún no estén en la base no rompen la ficha: se leen como «no hay». */
const noEstaAun = (e: { code?: string | null; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === '42P01' || e.code === 'PGRST204' || e.code === 'PGRST205' || /does not exist|could not find/i.test(e.message ?? ''))

async function leerLoGuardado(accountId: string, invoiceId: string): Promise<FichaExtra['guardado']> {
  const [c, g, h] = await Promise.all([
    tabla('supplier_invoice').select('payment_method, no_document_at, no_document_reason, no_document_by_name, entry_overrides').eq('account_id', accountId).eq('id', invoiceId).maybeSingle(),
    tabla('supplier_invoice_expense').select('position, account_code, location_id, is_common, amount').eq('account_id', accountId).eq('supplier_invoice_id', invoiceId).order('position'),
    tabla('supplier_invoice_change').select('at, by_name, what, cambios').eq('account_id', accountId).eq('supplier_invoice_id', invoiceId).order('at'),
  ])
  if (noEstaAun(c.error)) return null
  for (const r of [c, g, h]) if (r.error && !noEstaAun(r.error)) throw new Error(mensaje('No se ha podido leer lo guardado en la ficha', r.error))
  const x = (c.data ?? {}) as Fila
  return {
    formaPago: texto(x.payment_method),
    sinPdf: texto(x.no_document_at) ? { cuando: String(x.no_document_at), motivo: texto(x.no_document_reason), quien: texto(x.no_document_by_name) } : null,
    asientoAMano: x.entry_overrides ?? null,
    reparto: g.error ? [] : ((g.data ?? []) as Fila[]).map((r) => ({ cuenta: String(r.account_code), local: texto(r.location_id), comun: r.is_common === true, importe: Number(r.amount) })),
    cambios: h.error ? [] : ((h.data ?? []) as Fila[]).map((r) => ({
      cuando: String(r.at), quien: texto(r.by_name), que: String(r.what ?? 'guardar'),
      campos: Array.isArray(r.cambios) ? (r.cambios as Fila[]).map((k) => String(k.campo ?? '')).filter(Boolean) : [],
      ...documentoAnterior(r.cambios),
    })),
  }
}

const texto = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null)

/** D06 · Si el cambio fue el PDF bueno que sustituyó a la foto (0800), la foto: queda como documento anterior. */
function documentoAnterior(cambios: unknown): { anterior?: string | null; pdfSustituye?: boolean } {
  if (!Array.isArray(cambios)) return {}
  const d = (cambios as Fila[]).find((k) => k.campo === 'documento')
  if (!d) return {}
  return { anterior: texto(d.antes), pdfSustituye: d.motivo === 'pdf_sustituye_foto' }
}

/** El papel que guardó la lectura de una factura, si no tiene otro. */
async function leerPapelDeLaLectura(accountId: string, invoiceId: string): Promise<string | null> {
  const { data } = await tabla('supplier_invoice').select('ai_session_id').eq('account_id', accountId).eq('id', invoiceId).maybeSingle()
  const sesion = texto((data as Fila | null)?.ai_session_id)
  if (!sesion) return null
  const { data: a } = await tabla('goods_receipt_ai_session').select('input_files').eq('account_id', accountId).eq('id', sesion).maybeSingle()
  return papelDeLaLectura((a as Fila | null)?.input_files)
}

export async function leerFichaRecibida(accountId: string, invoiceId: string): Promise<FichaExtra> {
  const { data: d, error } = await tabla('supplier_invoice')
    .select('id, source, location_id, ai_session_id, created_at, created_by_name, approved_at, approved_by_name, due_date_set_at, due_date_set_name, discarded_at, discarded_by_name, discard_reason, supplier_id, withholding_rate_id')
    .eq('account_id', accountId).eq('id', invoiceId).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer de dónde vino la factura', error))
  const i = (d ?? {}) as Fila
  const [recs, sesion, pagos, asientos, prov, guardado] = await Promise.all([
    tabla('supplier_invoice_receipt').select('goods_receipt_id').eq('supplier_invoice_id', invoiceId),
    texto(i.ai_session_id) ? tabla('goods_receipt_ai_session').select('input_files, created_at').eq('account_id', accountId).eq('id', String(i.ai_session_id)).maybeSingle() : Promise.resolve({ data: null, error: null }),
    tabla('supplier_invoice_payment_log').select('action, paid_at, due_date, actor_name, created_at').eq('account_id', accountId).eq('invoice_id', invoiceId).order('created_at'),
    tabla('journal_entry').select('number, status, validated_at, validated_by_name, created_at').eq('account_id', accountId).eq('source_type', 'supplier_invoice').eq('source_id', invoiceId)
      .in('status', ['propuesto', 'borrador', 'validado']).order('created_at', { ascending: false }),
    texto(i.supplier_id) ? tabla('supplier').select('payment_method').eq('account_id', accountId).eq('id', String(i.supplier_id)).maybeSingle() : Promise.resolve({ data: null, error: null }),
    leerLoGuardado(accountId, invoiceId),
  ])
  for (const r of [recs, sesion, pagos, asientos, prov]) if (r.error) throw new Error(mensaje('No se ha podido leer el historial de la factura', r.error))
  const idsRec = ((recs.data ?? []) as Fila[]).map((x) => String(x.goods_receipt_id))
  let recepcion: FichaExtra['recepcion'] = null
  if (idsRec.length) {
    const { data: g, error: eg } = await tabla('goods_receipt').select('id, receipt_date, location_id, created_at, created_by_name')
      .eq('account_id', accountId).in('id', idsRec).order('receipt_date', { ascending: false }).limit(1)
    if (eg) throw new Error(mensaje('No se ha podido leer su recepción', eg))
    const r = ((g ?? []) as Fila[])[0]
    if (r) {
      const localId = texto(r.location_id)
      let local: string | null = null
      if (localId) {
        const { data: l } = await tabla('locations').select('name').eq('account_id', accountId).eq('id', localId).maybeSingle()
        local = texto((l as Fila | null)?.name)
      }
      recepcion = { fecha: String(r.receipt_date), localId, local, quien: texto(r.created_by_name), cuando: texto(r.created_at) }
    }
  }
  const s = sesion.data as Fila | null
  const ruta = s ? papelDeLaLectura(s.input_files) : null
  const a = ((asientos.data ?? []) as Fila[]).sort((x, y) => Number(y.status === 'validado') - Number(x.status === 'validado'))[0]
  return {
    fuente: texto(i.source),
    localId: texto(i.location_id),
    creada: { cuando: String(i.created_at ?? ''), quien: texto(i.created_by_name) },
    aprobada: texto(i.approved_at) ? { cuando: String(i.approved_at), quien: texto(i.approved_by_name) } : null,
    venceCambiado: texto(i.due_date_set_at) ? { cuando: String(i.due_date_set_at), quien: texto(i.due_date_set_name) } : null,
    descartada: texto(i.discarded_at) ? { cuando: String(i.discarded_at), quien: texto(i.discarded_by_name), motivo: texto(i.discard_reason) } : null,
    recepcion,
    lectura: s ? { cuando: String(s.created_at), ruta, archivo: ruta ? ruta.split('/').pop() ?? null : null } : null,
    pagos: ((pagos.data ?? []) as Fila[]).map((p) => ({ cuando: String(p.created_at), accion: String(p.action), quien: texto(p.actor_name), pagada: texto(p.paid_at), vence: texto(p.due_date) })),
    asiento: a ? {
      numero: typeof a.number === 'number' ? a.number : null,
      validado: texto(a.validated_at) ? { cuando: String(a.validated_at), quien: texto(a.validated_by_name) } : null,
      creado: texto(a.created_at),
    } : null,
    formaPagoFicha: texto((prov.data as Fila | null)?.payment_method),
    retencionId: texto(i.withholding_rate_id),
    guardado,
  }
}

/** Las cuentas de gasto (6…) de la empresa, para F4. */
export async function cuentasDeGasto(accountId: string, companyId: string): Promise<{ codigo: string; nombre: string }[]> {
  const { data, error } = await tabla('company_account').select('code, name').eq('account_id', accountId).eq('company_id', companyId).like('code', '6%').order('code')
  if (error) throw new Error(mensaje('No se han podido leer las cuentas de gasto', error))
  return ((data ?? []) as Fila[]).map((x) => ({ codigo: String(x.code), nombre: String(x.name) }))
}

// ── «Guardar cambios» con la tanda D03 · 0790 ──────────────────────────────
// conta_recibida_guardar(p_invoice uuid, p_cambios jsonb, p_quien_nombre text),
// conta_recibida_papel_poner(p_invoice uuid, p_ruta text, p_nombre text, p_quien_nombre text)
// y conta_recibida_sin_papel(p_invoice uuid, p_sin boolean, p_motivo text, p_quien_nombre text),
// según el contrato de la 0790. Si la base aún no las tiene (staging antes de
// aplicarla: PGRST202 / 42883), se dice, y lo de antes sigue funcionando.

type ErrorRpc = { code?: string | null; message: string; details?: string | null; hint?: string | null }

async function llamar<T>(nombre: string, args: Record<string, unknown>): Promise<{ datos: T | null; falta: boolean; error: string | null }> {
  hayBase()
  const cliente = supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: ErrorRpc | null }> }
  const { data, error } = await cliente.rpc(nombre, args)
  if (!error) return { datos: data as T, falta: false, error: null }
  const falta = error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message)
  return { datos: null, falta, error: falta ? null : textoParaPantalla(nombre, error, error.message) }
}

export interface GuardadoFicha {
  /** false: la base aún no tiene conta_recibida_guardar y se guardó lo de antes. */
  conTanda: boolean
  hechos: string[]
  fallos: { etiqueta: string; porque: string }[]
  /** El `texto` de la base (regla 8), si lo dio. */
  texto: string | null
  asientoQuitado: boolean
  /** Lo que pasó al volver a proponer el asiento quitado. */
  repropuesto: string | null
}

/**
 * «Guardar cambios»: TODO lo cambiado en un viaje, con conta_recibida_guardar. Si
 * quita un asiento propuesto (ya no vale con lo nuevo), se vuelve a proponer con
 * lo guardado. Sin la función en la base, el proveedor y el vencimiento como
 * antes, y el resto se dice.
 */
export async function guardarCambiosRecibida(f: Pick<FacturaRevisar, 'id' | 'account_id' | 'company_id' | 'estado' | 'fecha'>, p_cambios: Record<string, unknown>,
  o: { quien: string | null; nombres: { proveedor?: string; vence?: string }; localPropuesto?: string | null }): Promise<GuardadoFicha> {
  const r: GuardadoFicha = { conTanda: true, hechos: [], fallos: [], texto: null, asientoQuitado: false, repropuesto: null }
  if (Object.keys(p_cambios).length === 0) return r
  const x = await llamar<{ guardado?: string[]; texto?: string; asiento_quitado?: boolean }>('conta_recibida_guardar', { p_invoice: f.id, p_cambios, p_quien_nombre: o.quien })
  if (x.error) { r.fallos.push({ etiqueta: 'Los cambios', porque: x.error }); return r }
  if (!x.falta) {
    r.hechos = (x.datos?.guardado ?? []).map(String)
    r.texto = typeof x.datos?.texto === 'string' ? x.datos.texto : null
    r.asientoQuitado = x.datos?.asiento_quitado === true
    if (r.asientoQuitado && f.company_id) {
      try {
        const fecha = typeof p_cambios.fecha === 'string' ? p_cambios.fecha : f.fecha
        if (f.estado !== 'aprobada' || !fecha) r.repropuesto = 'Su asiento propuesto se ha quitado: se vuelve a proponer al validarla.'
        else {
          const pr = await proponerFactura(f.account_id, f.company_id, f.id, fecha, o.quien, o.localPropuesto)
          r.repropuesto = pr.sinPropuesta.length ? `Su asiento propuesto se ha quitado y no ha salido otro: ${pr.sinPropuesta[0].porque}` : 'Su asiento se ha vuelto a proponer con lo nuevo.'
        }
      } catch (e) { r.repropuesto = `Su asiento propuesto se ha quitado y no se ha podido volver a proponer (${motivo(e)}): sale al validarla.` }
    }
    return r
  }
  // Sin la 0790: lo de antes.
  r.conTanda = false
  if (typeof p_cambios.proveedor === 'string') {
    try { await decirProveedor(f.id, p_cambios.proveedor); r.hechos.push(`Proveedor: ${o.nombres.proveedor ?? 'el elegido'}`) } catch (e) { r.fallos.push({ etiqueta: 'Proveedor', porque: motivo(e) }) }
  }
  if ('vence' in p_cambios) {
    try {
      await rpc('set_supplier_invoice_due_date', { p_invoice_id: f.id, p_due_date: p_cambios.vence ?? null })
      r.hechos.push(`Vence: ${o.nombres.vence ?? (p_cambios.vence || 'sin vencimiento')}`)
    } catch (e) { r.fallos.push({ etiqueta: 'Vence', porque: motivo(e) }) }
  }
  return r
}

/** Sube el PDF o la foto a receipt-uploads (bajo `<account_id>/…`) y lo pone a la factura. La foto la pasa a PDF el servidor (D02). */
export async function ponerPapelRecibida(f: Pick<FacturaRevisar, 'id' | 'account_id'>, fichero: File, quien: string | null): Promise<{ hecho: boolean; falta: boolean; texto: string }> {
  // Sin una función que diga si existe sin hacer nada, se sube primero: si la base aún no
  // sabe enlazarlo, el fichero queda en receipt-uploads sin enlazar (y se dice).
  let ruta: string
  try { [ruta] = await uploadReceiptFiles(f.account_id, [fichero]) } catch (e) { return { hecho: false, falta: false, texto: `no se ha podido subir «${fichero.name}» (${motivo(e)})` } }
  const x = await llamar<{ texto?: string }>('conta_recibida_papel_poner', { p_invoice: f.id, p_ruta: ruta, p_nombre: fichero.name, p_quien_nombre: quien })
  if (x.falta) return { hecho: false, falta: true, texto: 'la base aún no tiene con qué enlazar un PDF nuevo (la tanda D03, 0790): se ha subido, pero la factura sigue sin él' }
  if (x.error) return { hecho: false, falta: false, texto: x.error }
  return { hecho: true, falta: false, texto: typeof x.datos?.texto === 'string' ? x.datos.texto : `PDF: «${fichero.name}»` }
}

/** «Sin PDF» con su motivo (o quitarlo). */
export async function sinPapelRecibida(invoiceId: string, sin: boolean, motivoSin: string, quien: string | null): Promise<{ hecho: boolean; falta: boolean; texto: string }> {
  const x = await llamar<{ texto?: string }>('conta_recibida_sin_papel', { p_invoice: invoiceId, p_sin: sin, p_motivo: sin ? motivoSin.trim() : null, p_quien_nombre: quien })
  if (x.falta) return { hecho: false, falta: true, texto: 'la base aún no tiene dónde guardar «Sin PDF» (la tanda D03, 0790)' }
  if (x.error) return { hecho: false, falta: false, texto: x.error }
  return { hecho: true, falta: false, texto: typeof x.datos?.texto === 'string' ? x.datos.texto : sin ? `Sin PDF: «${motivoSin.trim()}»` : 'Ya no está marcada «Sin PDF»' }
}
