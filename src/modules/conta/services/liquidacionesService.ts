// src/modules/conta/services/liquidacionesService.ts
//
// S02 · PR 3 · Compras y gastos › Liquidaciones: lo que la lista lee de la base.
//   · las mensuales guardadas (licensed_settlement) de la cuenta, de la empresa
//     activa y las que no tienen empresa (las del sistema anterior: regla 7, no
//     se esconden), con el nombre de su proveedor y su local;
//   · las que se esperan del mes pasado y de este (compras_liquidaciones, la
//     misma función que Recepciones del local);
//   · las quincenas de Catcher, con leerLotes (catcherService), la misma
//     lectura que su ficha.
// Regla 9: todo anclado por account_id, y lo de la empresa por company_id.

import { hayBase, mensaje, tabla } from '@/modules/conta/services/bd'
import { cargarLiquidaciones } from '@/modules/conta/services/comprasService'
import { leerLotes } from '@/modules/conta/services/catcherService'
import { mesAnterior, primeroDeMes } from '@/modules/conta/lib/compras'
import { filaMensual, filaQuincena, filasPorLlegar, type FilaLiquidaciones, type LiquidacionGuardada } from '@/modules/conta/compras/liquidaciones'

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
  const [mensuales, lp, le, lotes] = await Promise.all([
    leerMensuales(accountId, companyId),
    cargarLiquidaciones(accountId, pasado),
    cargarLiquidaciones(accountId, este),
    leerLotes(accountId, companyId),
  ])
  return {
    filas: [...mensuales, ...filasPorLlegar(pasado, lp, hoy), ...filasPorLlegar(este, le, hoy), ...lotes.map(filaQuincena)],
    mesesPorLlegar: [pasado, este],
  }
}
