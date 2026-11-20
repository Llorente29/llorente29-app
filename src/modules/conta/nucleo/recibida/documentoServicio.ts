// src/modules/conta/nucleo/recibida/documentoServicio.ts
//
// K07 · Lo que la ficha de la recibida lee y hace para «Cambiar el documento» y
// el historial. Cada lectura filtra por la cuenta (regla 9). Nombres dentro de
// cadenas (regla 40): supplier_invoice_change (at, by_name, what, cambios,
// supplier_invoice_id), external_send (entry_id, status) y la función nueva de
// la 2004, conta_recibida_documento_cambiar.
//
//   · En una de por revisar, el documento nuevo se pone al guardar, como hoy
//     (conta_recibida_papel_poner, en guardarCambios de la ficha).
//   · En una contabilizada, se sube y se cambia ya, después de confirmar:
//     conta_recibida_documento_cambiar (el de la factura y el del asiento; el
//     de antes queda guardado; el asiento no cambia).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { uploadReceiptFiles } from '@/modules/supply/services/goodsReceiptService'
import type { CambioGuardado } from './contabilizada'

/** Cambia el documento de una recibida contabilizada. Siempre una frase (regla 8); si no se puede, lanza con el porqué. */
export async function cambiarDocumentoContabilizada(f: { id: string; account_id: string }, fichero: File, quien: string | null): Promise<string> {
  let ruta: string
  try { [ruta] = await uploadReceiptFiles(f.account_id, [fichero]) } catch (e) {
    throw new Error(`No se ha podido subir «${fichero.name}» (${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)})`, { cause: e })
  }
  const r = await rpc<{ texto?: string; ya_estaba?: boolean }>('conta_recibida_documento_cambiar', { p_invoice: f.id, p_ruta: ruta, p_nombre: fichero.name, p_quien_nombre: quien })
  return r?.texto ?? `Documento cambiado: «${fichero.name}». El de antes queda en su historial.`
}

/** Lo que se ha cambiado de la factura (supplier_invoice_change), del más nuevo al más viejo. */
export async function leerHistorial(accountId: string, invoiceId: string): Promise<CambioGuardado[]> {
  const { data, error } = await tabla('supplier_invoice_change').select('at, by_name, what, cambios')
    .eq('account_id', accountId).eq('supplier_invoice_id', invoiceId).order('at', { ascending: false }).limit(100)
  if (error) throw new Error(mensaje('No se ha podido leer su historial', error))
  return ((data ?? []) as Record<string, unknown>[]).map((c) => ({
    at: String(c.at ?? ''), quien: c.by_name ? String(c.by_name) : null, que: String(c.what ?? ''),
    cambios: Array.isArray(c.cambios) ? (c.cambios as CambioGuardado['cambios']) : [],
  }))
}

/** ¿Su asiento ya salió a ERP10 (el envío a Diez, enviado o enlazado)? */
export async function salioAErp10(accountId: string, entryId: string): Promise<boolean> {
  const { data, error } = await tabla('external_send').select('status').eq('account_id', accountId).eq('entry_id', entryId).in('status', ['enviado', 'enlazado']).limit(1)
  if (error) return false
  return (data ?? []).length > 0
}
