// src/modules/conta/nucleo/listado/servicio.ts
//
// Q06 · Lo que el listado del núcleo lee que no leen ya los listados de hoy: el
// documento de un movimiento (para el panel de la derecha) y la empresa para la
// cabecera de la hoja. Las cifras NO se leen aquí: las leen las mismas
// funciones de hoy (librosService: saldosCuentas, movimientos,
// leerLibroRegistro, movimientoIva), para que salgan las mismas (regla 31).
//
// Nombres de la base entre comillas (regla 40), comprobados en
// information_schema el 19/11: journal_entry (id, account_id, source_type,
// source_id), supplier_invoice (id, account_id, raw_document_url),
// journal_entry_document (entry_id, account_id, storage_path, file_name).

import { tabla, mensaje } from '@/modules/conta/services/bd'
import { urlDocumento } from '@/modules/conta/services/conDiezService'
import { getReceiptFileUrl } from '@/modules/supply/services/goodsReceiptService'

export interface DocumentoDelMovimiento { url: string; foto: boolean; titulo: string }

const esFoto = (nombre: string) => /\.(jpe?g|png|webp|heic)$/i.test(nombre)

/**
 * El documento del asiento de un movimiento: si el asiento sale de una factura
 * recibida, su papel (supplier_invoice.raw_document_url, como la ficha); si
 * no, el que tenga adjunto (journal_entry_document: la emitida, el resumen de
 * ventas). Null si no tiene. Regla 9: todo por su cuenta.
 */
export async function documentoDelAsiento(accountId: string, entryId: string): Promise<DocumentoDelMovimiento | null> {
  const { data: e, error } = await tabla('journal_entry').select('source_type, source_id, document_ref').eq('account_id', accountId).eq('id', entryId).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer el asiento', error))
  const asiento = e as { source_type: string | null; source_id: string | null; document_ref: string | null } | null
  if (!asiento) return null
  const titulo = asiento.document_ref ? `El documento ${asiento.document_ref}` : 'El documento del asiento'
  if (asiento.source_type === 'supplier_invoice' && asiento.source_id) {
    const { data: f, error: e2 } = await tabla('supplier_invoice').select('raw_document_url').eq('account_id', accountId).eq('id', asiento.source_id).maybeSingle()
    if (e2) throw new Error(mensaje('No se ha podido leer la factura del asiento', e2))
    const ruta = (f as { raw_document_url: string | null } | null)?.raw_document_url ?? null
    if (ruta) {
      const url = await getReceiptFileUrl(ruta)
      if (url) return { url, foto: esFoto(ruta), titulo }
    }
  }
  const { data: d, error: e3 } = await tabla('journal_entry_document').select('storage_path, file_name').eq('account_id', accountId).eq('entry_id', entryId).limit(1)
  if (e3) throw new Error(mensaje('No se ha podido leer el documento del asiento', e3))
  const doc = ((d ?? []) as { storage_path: string; file_name: string }[])[0]
  if (!doc) return null
  return { url: await urlDocumento(doc.storage_path), foto: esFoto(doc.file_name), titulo }
}
