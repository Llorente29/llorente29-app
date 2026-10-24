// src/modules/conta/services/recibidaAManoService.ts
//
// S01d · «Nueva recibida a mano»: lo que habla con la base.
//
//   · Los tipos de IVA que se ofrecen: los de tax_rate que el asiento sabe
//     apuntar (los mismos que lee cargarContexto en propuestasLibroService:
//     sistema iva, vigentes, código «iva_…»), del sistema o de la cuenta.
//   · Guardar: una supplier_invoice (source 'manual', status 'en_revision',
//     de la empresa activa) y una supplier_invoice_line POR TIPO DE IVA (ficha
//     completa: la misma ficha que la que entra sola, con varios tipos), con la
//     cuenta de gasto elegida (expense_account_code); su PDF o foto en
//     raw_document_url (receipt-uploads), y su vencimiento con
//     set_supplier_invoice_due_date. Antes era UNA línea con la base y su tipo,
//     porque el asiento sale de las líneas (facturasDeProveedor lee
//     supplier_invoice_line.line_amount y vat_pct). Sin línea, «Está bien ·
//     apuntar» propondría un asiento de 0 €.
//
// Por qué 'en_revision' y no 'borrador' (lo de createSupplierInvoice en
// Compras): apuntarFactura solo aprueba las que están en revisión, y «Cómo se
// apunta» (verPropuestaFactura) solo ve 'en_revision' y 'aprobada'. Un
// borrador saldría en Asientos sin poder apuntarse («la factura está borrador»).
//
// El local va en supplier_invoice.location_id: null es común, como lo lee el
// asiento propuesto («la factura no dice de qué local es: queda común»).
//
// Nombres de la base entre comillas (regla 40): supplier_invoice (account_id,
// company_id, supplier_id, location_id, doc_kind, invoice_number,
// invoice_date, status, source, tax_base_total, tax_total, grand_total,
// notes, created_by, created_by_name, code), supplier_invoice_line
// (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct,
// position, expense_account_code), supplier_invoice.raw_document_url,
// set_supplier_invoice_due_date(p_invoice_id, p_due_date) y tax_rate (code, rate, tax_system, valid_to, is_system,
// account_id).

import { rpc, tabla } from '@/modules/conta/services/bd'
import { uploadReceiptFiles } from '@/modules/supply/services/goodsReceiptService'
import type { RecibidaAManoComprobada } from '@/modules/conta/documentos/fichaRecibida'
import { textoParaPantalla } from '@/modules/conta/lib/errorBase'
import { porcentaje } from '@/modules/conta/lib/formato'
import { TIPOS_DE_SERIE, textoDeFallo } from '@/modules/conta/lib/recibidaAMano'

type Fila = Record<string, unknown>

/** Los tipos de IVA soportado que se pueden elegir, de mayor a menor, con el 0 siempre. */
export async function tiposDeIvaRecibida(accountId: string): Promise<number[]> {
  const { data, error } = await tabla('tax_rate').select('code, rate, tax_system, valid_to').or(`is_system.eq.true,account_id.eq.${accountId}`)
  if (error) throw new Error(`No se han podido leer los tipos de IVA: ${textoParaPantalla('tax_rate', error, error.message)}`)
  const tipos = ((data ?? []) as Fila[])
    .filter((t) => t.tax_system === 'iva' && !t.valid_to && String(t.code ?? '').startsWith('iva_'))
    .map((t) => Number(t.rate)).filter((x) => Number.isFinite(x))
  const unicos = [...new Set([...tipos, 0])].sort((a, b) => b - a)
  return unicos.length > 1 ? unicos : [...TIPOS_DE_SERIE]
}

export interface GuardarRecibida {
  accountId: string
  companyId: string
  userId: string | null
  userName: string | null
  /** El nombre del proveedor, para lo que se dice (no se guarda). */
  proveedor: string
  datos: RecibidaAManoComprobada
  /** El PDF o la foto, si se subió con ella (la foto la pasa a PDF el servidor, D02). */
  papel?: File | null
}

/**
 * Guarda la factura, una línea por tipo de IVA y, si se dijo, su vencimiento.
 * Devuelve su id, su código (FAC-…) y lo que se dice de lo de después. Si la
 * factura no entra, lanza el porqué en lenguaje normal.
 */
export async function guardarRecibidaAMano(g: GuardarRecibida): Promise<{ id: string; codigo: string | null; ademas: string[] }> {
  const d = g.datos
  const ademas: string[] = []
  // Ficha completa: el PDF o la foto van con ella (raw_document_url, receipt-uploads), como los de Compras.
  let ruta: string | null = null
  if (g.papel) {
    try { [ruta] = await uploadReceiptFiles(g.accountId, [g.papel]) } catch (e) {
      ademas.push(`El PDF no se ha subido (${e instanceof Error ? e.message : String(e)}): súbelo desde su ficha.`)
    }
  }
  const { data, error } = await tabla('supplier_invoice').insert({
    account_id: g.accountId,
    company_id: g.companyId,
    supplier_id: d.proveedorId,
    location_id: d.localId,
    doc_kind: 'invoice',
    invoice_number: d.numero,
    invoice_date: d.fecha,
    status: 'en_revision',
    source: 'manual',
    tax_base_total: d.base,
    tax_total: d.cuota,
    grand_total: d.total,
    raw_document_url: ruta,
    notes: ruta ? 'Dada de alta a mano en Contabilidad, con su PDF.' : 'Dada de alta a mano en Contabilidad, sin fichero.',
    created_by: g.userId,
    created_by_name: g.userName,
  }).select('id, code').single()
  if (error || !data) {
    throw new Error(error ? textoDeFallo(error, d.numero, g.proveedor, (m) => textoParaPantalla('supplier_invoice', error, m)) : 'No se ha guardado la factura: la base no ha devuelto su número.')
  }
  const f = data as Fila
  const id = String(f.id)
  const codigo = typeof f.code === 'string' ? f.code : null

  const linea = await tabla('supplier_invoice_line').insert(d.lineas.map((l, i) => ({
    supplier_invoice_id: id,
    raw_text: `Base al ${porcentaje(l.tipo)} (a mano)`,
    qty: 1,
    unit_price: l.base,
    line_amount: l.base,
    vat_pct: l.tipo,
    expense_account_code: d.cuentaGasto,
    position: i,
  })))
  if (linea.error) {
    // Sin sus líneas, el asiento saldría de 0 €: se quita la cabecera y se dice.
    // Se mira lo borrado de verdad: un borrado que la seguridad no deja no da error, da cero filas.
    const quitada = await tabla('supplier_invoice').delete().eq('id', id).eq('account_id', g.accountId).select('id')
    const motivo = textoParaPantalla('supplier_invoice_line', linea.error, linea.error.message)
    throw new Error(quitada.error || ((quitada.data ?? []) as Fila[]).length === 0
      ? `La factura ${d.numero} se ha guardado sin su base (${motivo}) y no he podido quitarla: es la ${codigo ?? id}. Anúlala en Compras antes de volver a darla de alta.`
      : `No se ha guardado la factura: no ha entrado su base (${motivo}). No ha quedado nada a medias; vuelve a intentarlo.`)
  }
  if (d.vence) {
    try { await rpc('set_supplier_invoice_due_date', { p_invoice_id: id, p_due_date: d.vence }) } catch (e) {
      ademas.push(`El vencimiento no se ha guardado (${e instanceof Error ? e.message : String(e)}): ponlo en su ficha.`)
    }
  }
  return { id, codigo, ademas }
}
