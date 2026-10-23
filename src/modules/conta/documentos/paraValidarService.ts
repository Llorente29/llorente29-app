// src/modules/conta/documentos/paraValidarService.ts
//
// D06 · «¿Lista para validar?» de cada factura de la lista (validar en bloque,
// tablero 2b): el MISMO veredicto que su ficha (veredicto.ts), con lo que se
// lee de una vez para todas: su lectura, su documento, las otras del mismo
// proveedor (duplicadas) y la propuesta de su asiento (verPropuestasFacturas,
// la de «El asiento que se crea»). Y validarlas de una en una, como al
// validarla sola (apuntarFactura: su asiento, validado y a Diez), sin pararse
// si una falla.

import { tabla, mensaje, rpc } from '@/modules/conta/services/bd'
import { verPropuestasFacturas } from '@/modules/conta/services/propuestasLibroService'
import { apuntarFactura, leerFactura, leerFichaRecibida, type ExtraFactura } from '@/modules/conta/services/documentosService'
import type { TipoVeredicto } from '@/modules/conta/diseno/plantillas'
import { comprobacionesSinContradecir } from './RevisarFacturaPage.textos'
import { veredictoFactura, type Comprobacion } from './veredicto'
import { cargoDeLaTarjeta, duplicadas, faltaDocumento, textoDuplicada, type CargoBanco } from './paraValidar'
import type { FilaDocumento } from './documentos'

export interface ParaValidar {
  lista: boolean
  tipo: TipoVeredicto
  /** El motivo, en una frase (el de su ficha). */
  motivo: string
  /** La cuenta de gasto de su asiento (la de más importe al debe que no es IVA), para el reparto. */
  cuenta: { codigo: string; nombre: string } | null
}

type Fila = Record<string, unknown>
const n = (x: unknown): number | null => (x === null || x === undefined || x === '' ? null : Number(x))
const s = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null)

async function leerEnTrozos(select: string, campo: string, valores: readonly string[], cuenta: string, que: string): Promise<Fila[]> {
  const fuera: Fila[] = []
  for (let i = 0; i < valores.length; i += 150) {
    const { data, error } = await tabla('supplier_invoice').select(select).eq('account_id', cuenta).in(campo, valores.slice(i, i + 150))
    if (error) throw new Error(mensaje(`No se han podido leer ${que}`, error))
    fuera.push(...((data ?? []) as Fila[]))
  }
  return fuera
}

/** El veredicto de cada factura por revisar de la lista, de una sola vez. */
export async function leerParaValidar(accountId: string, companyId: string, filas: readonly FilaDocumento[], extras: ReadonlyMap<string, ExtraFactura>,
  desde: string, hasta: string): Promise<Map<string, ParaValidar>> {
  const facturas = filas.filter((x) => x.tipo === 'factura' && x.estado === 'para_mirar')
  const fuera = new Map<string, ParaValidar>()
  if (facturas.length === 0) return fuera
  const ids = facturas.map((x) => x.id)
  const [detalle, vistas] = await Promise.all([
    leerEnTrozos('id, supplier_id, invoice_number, invoice_date, grand_total, status, source, raw_document_url, no_document_at, reading, supplier(name, tax_id)', 'id', ids, accountId, 'las facturas'),
    verPropuestasFacturas(accountId, companyId, desde, hasta),
  ])
  const proveedores = [...new Set(detalle.map((f) => s(f.supplier_id)).filter((x): x is string => !!x))]
  const otras = proveedores.length ? await leerEnTrozos('id, supplier_id, invoice_number, invoice_date, grand_total, status', 'supplier_id', proveedores, accountId, 'las otras facturas de sus proveedores') : []
  const dup = duplicadas(otras.map((f) => ({ id: String(f.id), proveedorId: s(f.supplier_id), numero: s(f.invoice_number), fecha: s(f.invoice_date), total: n(f.grand_total), descartada: f.status === 'descartada' })))
  const porId = new Map(detalle.map((f) => [String(f.id), f]))

  for (const x of facturas) {
    const f = porId.get(x.id)
    if (!f) continue
    const prov = (f.supplier ?? null) as Fila | null
    const lectura = (f.reading ?? null) as { comprobaciones?: Comprobacion[]; factura?: { proveedor?: { nif?: string | null } } } | null
    const nifFactura = lectura?.factura?.proveedor?.nif ?? null
    const comprobaciones = comprobacionesSinContradecir(lectura?.comprobaciones ?? [], !!(s(prov?.tax_id) || nifFactura))
      .map((c) => ({ ...c, grave: (lectura?.comprobaciones ?? []).find((y) => y.id === c.id)?.grave }))
    const p = vistas.propuestas.get(x.id)
    const e = extras.get(x.id)
    const total = n(f.grand_total)
    const cuadra = e?.base !== null && e?.base !== undefined && e.iva !== null && total !== null ? Math.abs(e.base + e.iva - total) <= 0.011 : null
    const d = dup.get(x.id)
    const v = veredictoFactura({
      validada: false, numeroAsiento: null, descartada: false, motivoDescarte: null,
      proveedor: prov ? { nombre: s(prov.name) ?? 'Proveedor', nif: s(prov.tax_id) } : null, nifFactura, fecha: s(f.invoice_date),
      comprobaciones, propuesta: p ? { confianza: p.confianza, avisos: p.avisos, razones: p.razones } : vistas.sinPropuesta.has(x.id) ? null : undefined,
      porqueSinPropuesta: vistas.sinPropuesta.get(x.id) ?? null,
      origenGasto: x.entendido?.origen ?? null, pagada: e?.pagada ? { fecha: e.pagada } : null,
      cuadraConElPdf: comprobaciones.length ? null : cuadra,
      faltaDocumento: faltaDocumento({ tieneDocumento: !!s(f.raw_document_url) || !!x.archivo || !!x.llegada_tipo, sinPdf: !!s(f.no_document_at), fuente: s(f.source) }),
      duplicada: d ? textoDuplicada(d) : null,
    })
    const gasto = p?.lineas.filter((l) => (l.debe ?? 0) > 0 && !/^47[23]/.test(l.cuenta) && !/^4[0-4]/.test(l.cuenta)).sort((a, b) => (b.debe ?? 0) - (a.debe ?? 0))[0]
    fuera.set(x.id, {
      lista: v.tipo === 'lista', tipo: v.tipo, motivo: v.porque,
      cuenta: gasto ? { codigo: gasto.cuenta, nombre: vistas.nombres.get(gasto.cuenta) ?? x.entendido?.nombre ?? 'Cuenta' } : x.entendido ? { codigo: x.entendido.cuenta, nombre: x.entendido.nombre } : null,
    })
  }
  return fuera
}

export interface ResultadoBloque { bien: { id: string; texto: string }[]; mal: { id: string; nombre: string; porque: string }[] }

/**
 * Valida una a una, como al validarla sola: su asiento (con el local de su ficha), validado y, si el
 * envío está encendido, a Diez. Si una falla, las demás siguen; al final se dice cuál y por qué.
 */
export async function validarEnBloque(accountId: string, ids: readonly string[], nombres: ReadonlyMap<string, string>, quien: string | null, userId: string | null,
  alAvanzar?: (hechas: number) => void): Promise<ResultadoBloque> {
  const r: ResultadoBloque = { bien: [], mal: [] }
  let hechas = 0
  for (const id of ids) {
    try {
      const [fac, ficha] = await Promise.all([leerFactura(id), leerFichaRecibida(accountId, id).catch(() => null)])
      const a = await apuntarFactura(fac, quien, userId, ficha ? ficha.localId ?? ficha.recepcion?.localId ?? null : null)
      if (a.validado) r.bien.push({ id, texto: a.texto })
      else r.mal.push({ id, nombre: nombres.get(id) ?? 'Una factura', porque: a.texto.replace(/^No se ha apuntado: /, '') })
    } catch (e) {
      r.mal.push({ id, nombre: nombres.get(id) ?? 'Una factura', porque: e instanceof Error ? e.message : String(e) })
    }
    alAvanzar?.(++hechas)
  }
  return r
}

/** D06 · Si puede estar repetida (otra del mismo proveedor con el mismo número normalizado, o la misma fecha y total), el aviso. */
export async function duplicadaDe(accountId: string, invoiceId: string, proveedorId: string | null): Promise<string | null> {
  if (!proveedorId) return null
  const { data, error } = await tabla('supplier_invoice').select('id, supplier_id, invoice_number, invoice_date, grand_total, status')
    .eq('account_id', accountId).eq('supplier_id', proveedorId)
  if (error) throw new Error(mensaje('No se ha podido mirar si está repetida', error))
  const d = duplicadas(((data ?? []) as Fila[]).map((f) => ({ id: String(f.id), proveedorId: s(f.supplier_id), numero: s(f.invoice_number), fecha: s(f.invoice_date), total: n(f.grand_total), descartada: f.status === 'descartada' })))
  const x = d.get(invoiceId)
  return x ? textoDuplicada(x) : null
}

/**
 * D06 · Pagada con tarjeta: el cargo del banco que casa (mismo importe, del día de la factura a 5 días
 * después, con el proveedor o la tarjeta en su concepto), sin casar todavía. null si no hay uno claro.
 */
export async function cargoParaLaTarjeta(f: { account_id: string; company_id: string | null; fecha: string | null; total: number | null; proveedor: string; tarjeta: string | null }): Promise<CargoBanco | null> {
  if (!f.company_id || !f.fecha || f.total === null) return null
  const hasta = new Date(Date.parse(`${f.fecha}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await tabla('bank_movement').select('id, op_date, amount, bank_concept, clean_concept, counterparty, status')
    .eq('account_id', f.account_id).eq('company_id', f.company_id).eq('amount', -Math.abs(f.total)).gte('op_date', f.fecha).lte('op_date', hasta)
    .not('status', 'in', '(casado,ignorado)')
  if (error) throw new Error(mensaje('No se han podido leer los cargos del banco', error))
  const cargos = ((data ?? []) as Fila[]).map((m) => ({ id: String(m.id), fecha: String(m.op_date), importe: Number(m.amount), concepto: [s(m.clean_concept), s(m.bank_concept), s(m.counterparty)].filter(Boolean).join(' ') }))
  return cargoDeLaTarjeta({ fecha: f.fecha, total: f.total, proveedor: f.proveedor, tarjeta: f.tarjeta }, cargos)
}

/** Casa el cargo con la factura (ya validada): queda pagada con tarjeta (bank_casar, como en Bancos). */
export async function casarPagoConTarjeta(cargo: CargoBanco, factura: { id: string; total: number; cuentaProveedor: string; terceroId: string | null; concepto: string }): Promise<string> {
  const { error } = await rpcCasar(cargo.id, {
    tipo: 'factura_recibida', facturas: [{ id: factura.id, importe: factura.total }], cuenta_tercero: factura.cuentaProveedor, tercero_id: factura.terceroId,
    concepto: factura.concepto, metodo: 'card',
  })
  if (error) throw new Error(error)
  return `Casada con el cargo de ${factura.total.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € del ${cargo.fecha.slice(8, 10)}/${cargo.fecha.slice(5, 7)}: pagada con tarjeta.`
}

async function rpcCasar(movimiento: string, destino: Record<string, unknown>): Promise<{ error: string | null }> {
  try {
    await rpc('bank_casar', { p_movement: movimiento, p_destino: destino, p_confianza: 'seguro', p_porque: 'Pagada con tarjeta: lo dice su factura, y el cargo es del mismo importe y de los días siguientes.', p_razones: [], p_por: 'folvy', p_regla: null })
    return { error: null }
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
}
