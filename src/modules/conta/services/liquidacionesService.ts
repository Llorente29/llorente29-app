// src/modules/conta/services/liquidacionesService.ts
//
// S02 · PR 3 · Compras y gastos › Liquidaciones: lo que la lista lee de la base.
//   · las mensuales guardadas (licensed_settlement) de la cuenta, de la empresa
//     activa y las que no tienen empresa (las del sistema anterior: regla 7, no
//     se esconden), con el nombre de su proveedor y su local;
//   · las que se esperan del mes pasado y de este (compras_liquidaciones, la
//     misma función que Recepciones del local);
//   · las quincenas de Catcher, con leerLotes (catcherService), la misma
//     lectura que su ficha;
//   · D07 · las de plataforma (channel_settlement): ventas, comisión y neto
//     cobrado de cada semana; no son facturas ni tienen PDF, y su factura de
//     comisión llega aparte (supplier_invoice, por commission_invoice_id).
//     Nombres de la base entre comillas (regla 40, comprobados el 23/10 en
//     pg_constraint): channel_settlement_store_id_fkey → platform_store
//     (company_id, external_text) y channel_settlement_channel_id_fkey →
//     sales_channel (name).
// Regla 9: todo anclado por account_id, y lo de la empresa por company_id.

import { hayBase, mensaje, tabla } from '@/modules/conta/services/bd'
import { cargarLiquidaciones } from '@/modules/conta/services/comprasService'
import { leerLotes } from '@/modules/conta/services/catcherService'
import { mesAnterior, primeroDeMes } from '@/modules/conta/lib/compras'
import { filaMensual, filaPlataforma, filaQuincena, filasPorLlegar, type FilaLiquidaciones, type LiquidacionGuardada, type LiquidacionPlataforma } from '@/modules/conta/compras/liquidaciones'

const COLUMNAS = 'id, status, formula, settlement_ref, period_from, period_to, net_settlement, supplier_id, location_id, company_id, bloqueos:detail->bloqueos'

async function nombres(t: 'supplier' | 'locations', accountId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const { data, error } = await tabla(t).select('id, name').eq('account_id', accountId).in('id', ids)
  if (error) throw new Error(mensaje(`No se han podido leer los nombres (${t === 'supplier' ? 'proveedores' : 'locales'})`, error))
  return new Map(((data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]))
}

/** Las mensuales guardadas: las de la empresa y las que no tienen ninguna (del sistema anterior). */
export async function leerMensuales(accountId: string, companyId: string): Promise<FilaLiquidaciones[]> {
  hayBase()
  const { data, error } = await tabla('licensed_settlement').select(COLUMNAS)
    .eq('account_id', accountId).or(`company_id.eq.${companyId},company_id.is.null`).order('period_from', { ascending: false })
  if (error) throw new Error(mensaje('No se han podido leer las liquidaciones mensuales', error))
  const filas = (data ?? []) as LiquidacionGuardada[]
  const unicos = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))]
  const [proveedor, local] = await Promise.all([
    nombres('supplier', accountId, unicos(filas.map((f) => f.supplier_id))),
    nombres('locations', accountId, unicos(filas.map((f) => f.location_id))),
  ])
  return filas.map((f) => filaMensual(f, { proveedor, local }))
}

export interface DatosLiquidaciones {
  filas: FilaLiquidaciones[]
  /** Los meses de los que se dicen las que faltan: el pasado y este. */
  mesesPorLlegar: [string, string]
}

/** Todo lo de la lista, de una vez. */
export async function leerLiquidaciones(accountId: string, companyId: string, hoy: string): Promise<DatosLiquidaciones> {
  const este = primeroDeMes(hoy)
  const pasado = mesAnterior(este)
  const [mensuales, lp, le, lotes, plataforma] = await Promise.all([
    leerMensuales(accountId, companyId),
    cargarLiquidaciones(accountId, pasado),
    cargarLiquidaciones(accountId, este),
    leerLotes(accountId, companyId),
    leerPlataforma(accountId, companyId),
  ])
  return {
    filas: [...mensuales, ...filasPorLlegar(pasado, lp, hoy), ...filasPorLlegar(este, le, hoy), ...lotes.map(filaQuincena), ...plataforma.map(filaPlataforma)],
    mesesPorLlegar: [pasado, este],
  }
}

type Fila = Record<string, unknown>
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/**
 * D07 · Las liquidaciones de plataforma de la empresa (las de sus tiendas) y
 * las que no dicen tienda (subidas a mano: regla 7, no se esconden), con el
 * número de sus facturas de comisión (S01i: de channel_settlement_invoice).
 */
export async function leerPlataforma(accountId: string, companyId: string): Promise<LiquidacionPlataforma[]> {
  hayBase()
  const { data, error } = await tabla('channel_settlement')
    .select('id, period_from, period_to, settlement_date, gross_sales, commission, net_payout, collected_on, collected_amount, is_reference, needs_review, review_note, raw, external_location_text, sales_channel(name), platform_store(company_id, external_text), channel_settlement_invoice(supplier_invoice(id, invoice_number, grand_total))')
    .eq('account_id', accountId).order('period_to', { ascending: false })
  if (error) throw new Error(mensaje('No se han podido leer las liquidaciones de plataforma', error))
  const filas = ((data ?? []) as unknown as Fila[]).filter((x) => {
    const t = x.platform_store as { company_id?: string } | null
    return !t || t.company_id === companyId
  })
  return filas.map((x) => {
    const canal = (x.sales_channel as { name?: string } | null)?.name ?? 'Plataforma'
    const tienda = (x.platform_store as { external_text?: string } | null)?.external_text ?? txt(x.external_location_text)
    // S01i · Sus facturas de comisión, de la tabla de enlaces (ya no de commission_invoice_id).
    const facturas = ((x.channel_settlement_invoice ?? []) as { supplier_invoice: Fila | null }[])
      .map((k) => k.supplier_invoice).filter((f): f is Fila => !!f)
      .map((f) => ({ id: String(f.id), numero: txt(f.invoice_number), total: num(f.grand_total) ?? 0 }))
    const total = num(((x.raw ?? null) as { factura?: { total?: unknown } } | null)?.factura?.total) ?? 0
    return {
      id: String(x.id), canal, tienda: tienda ? tienda.replace(/\s*\(.*\)\s*$/, '') : null,
      desde: txt(x.period_from) ?? txt(x.settlement_date) ?? '', hasta: txt(x.period_to) ?? txt(x.settlement_date) ?? '',
      ventas: num(x.gross_sales), comision: Math.abs(num(x.commission) ?? 0), neto: num(x.net_payout),
      cobrado: txt(x.collected_on) ? { fecha: String(x.collected_on), importe: num(x.collected_amount) } : null,
      aFacturar: total > 0 ? total : 0, facturas,
      deReferencia: x.is_reference === true,
      porAclarar: x.needs_review === true && x.is_reference !== true ? txt(x.review_note) : null,
    }
  })
}

