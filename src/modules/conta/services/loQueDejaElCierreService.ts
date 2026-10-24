// src/modules/conta/services/loQueDejaElCierreService.ts
//
// N2 · Lo que deja el cierre del día (C11 y C11b): lo que apuntó el cierre en
// sales_day_close_log ('revisar' y 'cerrado_sin_confirmar'), con el estado de
// hoy de cada pedido (si su liquidación lo cobra, si ya tiene su devolución o
// se descartó). Todo filtrado por cuenta y empresa (regla 9). Las acciones:
// proponer la devolución (propuestasLibroService) y «se cobró por otro lado»
// (journal_dismissal de sales_adjustment, que el aviso del C11b ya respeta).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { MOTIVO_COBRADO_POR_OTRO_LADO, type FilaCierre } from '@/modules/conta/lib/loQueDejaElCierre'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/** Los nombres de cada origen que no es una plataforma (sale.source). */
const ORIGEN: Record<string, string> = { folvy_pos: 'el TPV', folvy_shop: 'la tienda', manual: 'a mano', import: 'importado' }

export interface FilaCierreConLocal extends FilaCierre { locationId: string }

async function leer(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No he podido leer ${que}`, error))
  return (data as Fila[] | null) ?? []
}

const trozos = <T,>(xs: readonly T[], n = 150): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

export async function leerLoQueDejaElCierre(accountId: string, companyId: string): Promise<FilaCierreConLocal[]> {
  const log = await leer(tabla('sales_day_close_log').select('sale_id, location_id, sales_day, order_code, total, accion')
    .eq('account_id', accountId).eq('company_id', companyId).in('accion', ['revisar', 'cerrado_sin_confirmar']), 'lo que apuntó el cierre del día')
  if (log.length === 0) return []
  const ids = log.map((l) => String(l.sale_id))
  const [canales, locales, noCobrados] = await Promise.all([
    leer(tabla('sales_channel').select('id, name').eq('account_id', accountId), 'los canales'),
    leer(tabla('locations').select('id, name').eq('account_id', accountId), 'los locales'),
    rpc<Fila[] | null>('conta_sin_confirmar_no_cobrados', { p_company: companyId }).then((x) => x ?? []),
  ])
  const ventas: Fila[] = []; const cobrados: Fila[] = []; const descartes: Fila[] = []; const asientos: Fila[] = []
  for (const t of trozos(ids)) {
    const [v, c, d, a] = await Promise.all([
      leer(tabla('sale').select('id, status, source, channel_id').eq('account_id', accountId).in('id', t), 'los pedidos'),
      leer(tabla('channel_settlement_order').select('sale_id').eq('account_id', accountId).eq('matched', true).in('sale_id', t), 'lo cobrado en las liquidaciones'),
      leer(tabla('journal_dismissal').select('source_key').eq('account_id', accountId).eq('company_id', companyId).eq('source_type', 'sales_adjustment').in('source_key', t), 'lo descartado'),
      leer(tabla('journal_entry').select('source_id').eq('account_id', accountId).eq('company_id', companyId).eq('source_type', 'sales_adjustment')
        .in('status', ['propuesto', 'borrador', 'validado']).in('source_id', t), 'las devoluciones del libro'),
    ])
    ventas.push(...v); cobrados.push(...c); descartes.push(...d); asientos.push(...a)
  }
  const canal = new Map(canales.map((c) => [String(c.id), String(c.name)]))
  const local = new Map(locales.map((l) => [String(l.id), String(l.name)]))
  const venta = new Map(ventas.map((v) => [String(v.id), v]))
  const sinCobrar = new Map(noCobrados.map((x) => [String(x.sale_id), x]))
  const cobrado = new Set(cobrados.map((c) => String(c.sale_id)))
  const descartado = new Set(descartes.map((d) => String(d.source_key)))
  const devolucion = new Set(asientos.map((a) => String(a.source_id)))
  return log.map((l): FilaCierreConLocal => {
    const id = String(l.sale_id); const v = venta.get(id); const nc = sinCobrar.get(id)
    const origen = s(v?.source)
    const canalId = s(v?.channel_id)
    return {
      saleId: id, dia: String(l.sales_day), codigo: s(l.order_code), total: n(l.total),
      accion: l.accion === 'revisar' ? 'revisar' : 'cerrado_sin_confirmar',
      estadoVenta: s(v?.status) ?? 'desconocido', origen,
      canal: (canalId ? canal.get(canalId) : null) ?? (origen ? ORIGEN[origen] ?? origen : 'sin canal'),
      local: local.get(String(l.location_id)) ?? 'su local', locationId: String(l.location_id),
      liquidacion: nc ? { ref: s(nc.settlement_ref), fecha: s(nc.settlement_date) } : null,
      cobrado: cobrado.has(id), descartado: descartado.has(id), devolucion: devolucion.has(id),
    }
  })
}

/** «Se cobró por otro lado»: el ajuste no hace falta; el aviso no vuelve. */
export async function descartarAjuste(accountId: string, companyId: string, saleId: string, quien: string | null): Promise<string> {
  const { error } = await tabla('journal_dismissal').insert({
    account_id: accountId, company_id: companyId, source_type: 'sales_adjustment', source_key: saleId,
    reason: MOTIVO_COBRADO_POR_OTRO_LADO, created_by_name: quien,
  })
  if (error && error.code !== '23505') throw new Error(mensaje('No se ha guardado', error))
  return 'Apuntado: se cobró por otro lado. No hace falta la devolución y no vuelvo a avisar.'
}
