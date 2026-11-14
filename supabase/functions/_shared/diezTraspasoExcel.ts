// supabase/functions/_shared/diezTraspasoExcel.ts
//
// B01r·26 (13/11) · EL TRASPASO DEL MES CON LOS DOS EXCEL: de la lista del mes
// (conta_traspaso_lista), qué facturas van por Excel con su PDF y cuáles por la
// API, y lo que cada una necesita (su fila y sus subcuentas). Lo usa
// conta-diez-traspaso. Las filas, de _shared/diezExcel.ts (puro y probado).
//
//   · Ventas del día (tipo «ventas»): la factura de Sumied, la del PDF
//     (resumenDeAsiento → facturaDeVentas), con el número de la vez.
//   · Recibidas (tipo «recibidas»): lo que conta_recibida_envio devuelve.
//   · Las dos solo si tienen su PDF guardado: sin PDF no van por Excel (y por
//     la API tampoco: «sin documento no se envía»; la pantalla lo dice).
//   · Lo demás (banco, manuales, liquidaciones, anulaciones) va por la API, como
//     hasta hoy.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { correspondenciaDeEmpresa } from './diezAnalitica.ts'
import { emitidaDeVentas, filaEmitida, filaRecibida, recibidaDeAsiento, ingresosAgrupados, type Emitida, type Fila, type Recibida, type RecibidaAsiento } from './diezExcel.ts'
import { XML_EMITIDAS, XML_RECIBIDAS } from './diezExcelConfig.ts'
import { resumenDeAsiento, type ResumenBD } from './resumenDeAsiento.ts'

export type Traspaso = { id: string; account_id: string; company_id: string; mes: string }
export type FacturaDelTraspaso = {
  entry_id: string
  excel: 'emitidas' | 'recibidas'
  numero: string
  /** La subcuenta del cliente o del proveedor (con la que Diez la guarda). */
  cuenta: string
  /** Si va por la API, por qué (y entonces no lleva fila). */
  porLaApi?: string
  emitida?: Emitida
  recibida?: Recibida
  /** Las subcuentas que usa su fila (cliente o proveedor, ingresos o gastos, retención). */
  subcuentas: string[]
}

const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })

/**
 * Las facturas del traspaso (ventas y recibidas) y cómo van. `url(entry)` da el
 * enlace de su PDF (el de conta-pdf), o null si no tiene PDF: sin PDF, por la API.
 */
export async function facturasDelTraspaso(srv: SupabaseClient, t: Traspaso, url: (entryId: string) => string | null): Promise<FacturaDelTraspaso[]> {
  const { data: lista, error } = await srv.rpc('conta_traspaso_lista', { p_company: t.company_id, p_mes: t.mes })
  if (error) throw new Error(`no se ha podido leer lo que va: ${error.message}`)
  const corr = correspondenciaDeEmpresa(t.company_id)
  // B01r26 (ensayo del 14/11): el número de la factura de ventas es el de su factura (customer_invoice,
  // «UBR-2026/00016», el del PDF), no el que calcula la API («UBR-CAM-20261031»).
  const numeroDeFactura = new Map<string, string>()
  {
    const ids = ((lista ?? []) as { entry_id: string; tipo: string }[]).filter((x) => x.tipo === 'ventas').map((x) => x.entry_id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error: e0 } = await srv.from('customer_invoice').select('entry_id, number_text').eq('company_id', t.company_id).in('entry_id', ids.slice(i, i + 200))
      if (e0) throw new Error(`no se han podido leer los números de las facturas de ventas: ${e0.message}`)
      for (const f of (data ?? []) as { entry_id: string; number_text: string | null }[]) if (f.number_text) numeroDeFactura.set(f.entry_id, f.number_text)
    }
  }
  const out: FacturaDelTraspaso[] = []
  for (const x of (lista ?? []) as { entry_id: string; tipo: string }[]) {
    if (x.tipo === 'ventas') {
      const { data, error: e1 } = await srv.rpc('conta_resumen_ventas', { p_entry: x.entry_id })
      if (e1) throw new Error(`no se ha podido leer la venta ${x.entry_id}: ${e1.message}`)
      const r = data as ResumenBD
      let f: ReturnType<typeof resumenDeAsiento>['factura'] = null; let porque: string | null = null
      try { const listo = resumenDeAsiento(r, { correspondencia: corr, generado: new Date(), hoy: hoyMadrid() }); f = listo.factura; porque = listo.sinFactura } catch (z) { porque = z instanceof Error ? z.message : String(z) }
      if (!f || !corr) { out.push({ entry_id: x.entry_id, excel: 'emitidas', numero: String(r.numero ?? ''), cuenta: '', porLaApi: porque ?? 'sin factura de Diez', subcuentas: [] }); continue }
      const deSuFactura = numeroDeFactura.get(x.entry_id)
      if (!deSuFactura) { out.push({ entry_id: x.entry_id, excel: 'emitidas', numero: String(r.numero ?? ''), cuenta: '', porLaApi: 'no tiene su factura de ventas (con número) en Sumied', subcuentas: [] }); continue }
      const fd = { ...f.factura, NumeroFactura: deSuFactura } as unknown as Parameters<typeof emitidaDeVentas>[0]['factura']
      const u = r.documento ? url(x.entry_id) : null
      const emitida = emitidaDeVentas({ factura: fd, fecha: r.fecha, nombreCliente: '', url: u ?? '', local: r.local?.nombre ?? null, canal: r.canal?.slug ?? null, correspondencia: corr })
      const ing = ingresosAgrupados(emitida.ingresos)
      const fila = filaEmitida({ ...emitida, cliente: { ...emitida.cliente, nombre: 'x' } }, XML_EMITIDAS)
      out.push({
        entry_id: x.entry_id, excel: 'emitidas', numero: emitida.numero, cuenta: emitida.cliente.subcuenta, emitida,
        ...(!u ? { porLaApi: 'no tiene su PDF guardado' } : 'porLaApi' in fila ? { porLaApi: fila.porLaApi } : {}),
        subcuentas: [emitida.cliente.subcuenta, ...('porLaApi' in ing ? [] : ing.map((l) => l.cuenta))],
      })
    } else if (x.tipo === 'recibidas') {
      const { data, error: e1 } = await srv.rpc('conta_recibida_envio', { p_entry: x.entry_id })
      if (e1) throw new Error(`no se ha podido leer la recibida ${x.entry_id}: ${e1.message}`)
      const rec = data as RecibidaAsiento & { documento: unknown }
      const u = rec.documento ? url(x.entry_id) : null
      const r = recibidaDeAsiento({ ...rec, lineas: (rec.lineas ?? []).map((l) => ({ ...l, debe: Number(l.debe), haber: Number(l.haber), tipoIva: l.tipoIva == null ? null : Number(l.tipoIva), baseIva: l.baseIva == null ? null : Number(l.baseIva) })) }, u ?? '')
      if ('porLaApi' in r) { out.push({ entry_id: x.entry_id, excel: 'recibidas', numero: String(rec.factura?.numero ?? ''), cuenta: '', porLaApi: r.porLaApi, subcuentas: [] }); continue }
      const fila = filaRecibida(r, XML_RECIBIDAS)
      out.push({
        entry_id: x.entry_id, excel: 'recibidas', numero: r.numero, cuenta: r.proveedor.subcuenta, recibida: r,
        ...(!u ? { porLaApi: 'no tiene su PDF guardado' } : 'porLaApi' in fila ? { porLaApi: fila.porLaApi } : {}),
        subcuentas: [r.proveedor.subcuenta, ...r.gastos.map((g) => g.cuenta), ...(r.retencion ? [r.retencion.subcuenta] : [])],
      })
    }
  }
  return out
}

/** Las que van por Excel (las demás, por la API). */
export const porExcel = (xs: readonly FacturaDelTraspaso[]) => xs.filter((x) => !x.porLaApi)

/** Las filas de los dos Excel, con el nombre de cada cliente como lo tiene Diez (las recibidas llevan el de Sumied). */
export function filasDeLosExcel(xs: readonly FacturaDelTraspaso[], nombreEnDiez: (subcuenta: string) => string): { emitidas: Fila[]; recibidas: Fila[] } {
  const emitidas: Fila[] = []; const recibidas: Fila[] = []
  for (const x of porExcel(xs)) {
    if (x.emitida) {
      const f = filaEmitida({ ...x.emitida, cliente: { ...x.emitida.cliente, nombre: nombreEnDiez(x.emitida.cliente.subcuenta) } }, XML_EMITIDAS)
      if (!('porLaApi' in f)) emitidas.push(f)
    } else if (x.recibida) {
      const f = filaRecibida(x.recibida, XML_RECIBIDAS)
      if (!('porLaApi' in f)) recibidas.push(f)
    }
  }
  return { emitidas, recibidas }
}

/** La misma factura en Diez: serie, número (sin espacios, puntos ni guiones, en mayúsculas) y subcuenta. */
export function esLaMisma(x: FacturaDelTraspaso, f: { Serie?: unknown; NumeroFactura?: unknown; CuentaCliente?: unknown }): boolean {
  const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s.\-/]/g, '')
  const serie = x.excel === 'emitidas' ? '1' : '2'
  return String(f.Serie) === serie && norm(f.NumeroFactura) === norm(x.numero) && String(f.CuentaCliente ?? '').replace(/\D/g, '') === x.cuenta
}
