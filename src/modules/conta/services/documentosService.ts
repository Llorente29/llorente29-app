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
import { proponerFactura, verPropuestaFactura } from '@/modules/conta/services/propuestasLibroService'
import { approveInvoice } from '@/modules/supply/services/supplierInvoiceService'
import { getReceiptFileUrl, uploadReceiptFiles } from '@/modules/supply/services/goodsReceiptService'
import { fotoAPdf } from '@/modules/conta/lib/fotoAPdf'
import type { DatosDocumentos, PlazoFicha } from '@/modules/conta/documentos/documentos'
import { leerFactura as comprobarLectura, type Lectura, type LecturaModelo } from '../../../../supabase/functions/_shared/lecturaFactura.ts'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { MAX_BYTES_EXPEDIDA, claseDeFichero, motivoExpedida, nombreExpedida, rutaExpedida, tamano } from '@/modules/conta/lib/expedidaPdf'

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
  const de = `Lo leyó la recepción del ${ddmm(f.leido_en_recepcion.recepcion)} con su papel; no la he vuelto a leer.`
  return { ...f, lectura: { ...l, porque: [de, ...l.porque] }, confianza: f.confianza ?? l.confianza }
}

/** R6 · El papel de una recepción, para «Ver papel» en N22: una URL firmada. */
export async function urlDePapelDeRecepcion(ruta: string | null | undefined): Promise<string | null> {
  return ruta ? getReceiptFileUrl(ruta) : null
}

/** El fichero tal como llegó, para verlo a la izquierda: una URL firmada. */
export async function urlDelPapel(f: Pick<FacturaRevisar, 'llegada' | 'papel'>): Promise<string | null> {
  return getReceiptFileUrl(f.llegada?.ruta ?? f.papel)
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
      s.bien = r.estado === 'factura'
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
  const ruta = f.llegada?.ruta ?? f.papel
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
export async function apuntarFactura(f: FacturaRevisar, quien: string | null, userId: string | null): Promise<Apuntada> {
  const a: Apuntada = { aprobada: f.estado === 'aprobada', asiento: f.asiento?.id ?? null, validado: f.asiento?.estado === 'validado', documento: false, enDiez: false, texto: '' }
  try {
    if (!f.company_id) throw new Error('la factura no dice de qué empresa es')
    if (!f.fecha) throw new Error('la factura no tiene fecha: dímela antes de apuntarla')
    if (!a.aprobada && f.estado === 'en_revision') { await approveInvoice(f.id, userId, quien); a.aprobada = true }
    if (!a.aprobada) throw new Error(`la factura está ${f.estado}`)
    if (!a.asiento) {
      const r = await proponerFactura(f.account_id, f.company_id, f.id, f.fecha, quien)
      if (r.sinPropuesta.length) throw new Error(`aprobada, pero sin asiento: ${r.sinPropuesta[0].porque}`)
      const de = await leerFactura(f.id)
      a.asiento = de.asiento?.id ?? null
      a.validado = de.asiento?.estado === 'validado'
      if (!a.asiento) throw new Error('aprobada, pero el asiento no aparece')
    }
    if (!a.validado) { await validar(a.asiento, quien); a.validado = true }
    await guardarFacturaPdf(f, a.asiento, quien); a.documento = true
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
