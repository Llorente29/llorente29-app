// src/modules/conta/services/pdfsQueFaltanService.ts
//
// V01 · El histórico: las facturas emitidas sin PDF y hacerlos, con la misma
// plantilla y el mismo guardado que una emitida a mano (facturaVentaPdf +
// conta_venta_pdf_guardar). Lo usa ventas/PdfsQueFaltan.tsx.
// Nombres dentro de cadenas (regla 40): customer_invoice (status, pdf_path,
// account_id, company_id, issue_date), de la 0835.

import { tabla, mensaje } from '@/modules/conta/services/bd'
import { datosDelPdf, empresaDelPdf, guardarPdf, leerFactura } from '@/modules/conta/services/ventasService'

type Fila = Record<string, unknown>

/** Las emitidas (o anuladas) de la empresa sin PDF, de mil en mil. */
export async function facturasSinPdf(accountId: string, companyId: string): Promise<string[]> {
  const ids: string[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await tabla('customer_invoice').select('id').eq('account_id', accountId).eq('company_id', companyId)
      .neq('status', 'borrador').is('pdf_path', null).order('issue_date').order('id').range(desde, desde + 999)
    if (error) throw new Error(mensaje('No he podido leer las facturas sin PDF', error))
    const filas = (data ?? []) as Fila[]
    ids.push(...filas.map((f) => String(f.id)))
    if (filas.length < 1000) return ids
  }
}

/** Hace el PDF de cada una, de una en una. Nunca lanza: dice qué ha pasado con cada una. */
export async function hacerPdfs(accountId: string, companyId: string, ids: readonly string[], alPaso: (hechas: number) => void): Promise<{ hechas: number; fallos: { id: string; numero: string | null; motivo: string }[] }> {
  const empresa = await empresaDelPdf(accountId, companyId)
  const fallos: { id: string; numero: string | null; motivo: string }[] = []
  let hechas = 0
  for (const [i, id] of ids.entries()) {
    let numero: string | null = null
    try {
      const f = await leerFactura(accountId, id)
      if (!f) throw new Error('no está')
      numero = f.numero
      const datos = datosDelPdf(empresa, f, null, null)
      // Una de consumidor final (la resumen de un cierre o un traído) no lleva NIF: lo dice.
      const conNif = datos.cliente.nif ? datos : { ...datos, cliente: { ...datos.cliente, nif: 'consumidor final' } }
      await guardarPdf(accountId, f, conNif)
      hechas++
    } catch (e) {
      fallos.push({ id, numero, motivo: e instanceof Error ? e.message : String(e) })
    }
    alPaso(i + 1)
  }
  return { hechas, fallos }
}

