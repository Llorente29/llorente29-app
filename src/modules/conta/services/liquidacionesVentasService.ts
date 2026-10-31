// src/modules/conta/services/liquidacionesVentasService.ts
//
// V01 · Entrega 3 · Ventas › Hostelería › Liquidaciones: leer y escribir.
//
//   · conta_plataformas: las liquidaciones de plataforma, por periodo,
//     plataforma y local, con sus cierres, las marcas cedidas, los cerrados
//     sin confirmar que no cobra y lo ya resuelto.
//   · resolver una diferencia (conta_plataforma_resolver): gasto, con su
//     asiento (la cuenta de gasto contra la 430 de la plataforma, validado), o
//     reclamación. Un pedido sin cobrar dado por gasto propone antes su
//     devolución al libro (proponerDevolucionSinCobrar, la de «Lo que deja el
//     cierre del día»).
//   · casar el cobro: los movimientos del banco que pueden ser el de una
//     liquidación (mismo importe, después del periodo, sin casar) y bank_casar
//     con su destino «liquidacion», como en Bancos.
// Nombres dentro de cadenas (regla 40): conta_plataformas y
// conta_plataforma_resolver, de la 20261024T1650;
// bank_movement (account_id, company_id, op_date, amount, status, bank_concept,
// treasury_account_id) y treasury_account (name), de B01; bank_casar, de B02.
// Regla 9: todo por la empresa (las funciones comprueban la cuenta de quien llama).

import { mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import { cargarContexto, proponerDevolucionSinCobrar } from '@/modules/conta/services/propuestasLibroService'
import { asientoDeGasto, grupoDeFila, periodo, r2, type GrupoPlataforma } from '@/modules/conta/lib/liquidacionesPlataforma'
import { eurosExactos } from '@/modules/conta/lib/formato'
import type { CasadoAMano, Dimension, LineaAlbaran, ProductoRelacion } from '@/modules/conta/lib/socioDelMes'

type Fila = Record<string, unknown>

export async function leerPlataformas(companyId: string, desde: string | null, hasta: string | null): Promise<GrupoPlataforma[]> {
  const r = await rpc<Fila[] | null>('conta_plataformas', { p_company: companyId, p_desde: desde, p_hasta: hasta })
  return (r ?? []).map(grupoDeFila)
}

/** La 430 de la plataforma y su tercero, y la cuenta de gasto (629, otros servicios). */
async function cuentasDe(accountId: string, companyId: string, canalId: string): Promise<{ cliente430: string; terceroId: string | null; gasto: string }> {
  const ctx = await cargarContexto(accountId, companyId)
  const canal = ctx.canales.get(canalId)
  const cliente430 = canal?.partyId ? ctx.enlace('customer', canal.partyId, 'principal') : null
  if (!cliente430) throw new Error(`${canal?.nombre ?? 'La plataforma'} no tiene su cuenta de cliente (430): ponla en Contactos.`)
  const gasto = ctx.hoja('629')
  if (!gasto) throw new Error('Falta en tu plan una cuenta de otros servicios (629) para el gasto.')
  return { cliente430, terceroId: canal?.partyId ?? null, gasto }
}

export interface Resolver {
  tipo: 'gasto' | 'reclamacion'
  importe: number
  frase: string
  /** Un pedido cerrado sin confirmar (C11b); sin él, la diferencia de la liquidación entera. */
  pedido: { saleId: string; dia: string } | null
}

/** Resuelve una diferencia y lo dice en palabras (regla 8). */
export async function resolverDiferencia(accountId: string, companyId: string, g: GrupoPlataforma, x: Resolver, quien: string | null): Promise<string> {
  const frase = x.frase.trim()
  if (!frase) throw new Error('Escribe en una frase por qué.')
  let lineas: unknown = null
  let antes = ''
  if (x.tipo === 'gasto' && !x.pedido) {
    const c = await cuentasDe(accountId, companyId, g.canalId)
    const ls = asientoDeGasto(x.importe, c, { localId: g.localId, terceroId: c.terceroId, concepto: `Diferencia de ${g.canal} ${periodo(g.desde, g.hasta)}: ${frase}` })
    if (!ls) throw new Error('Solo es un gasto lo que la plataforma paga de menos.')
    lineas = ls
  }
  if (x.tipo === 'gasto' && x.pedido) {
    if (!g.localId) throw new Error('Sin el local de la liquidación no se puede proponer la devolución del pedido.')
    const ref = g.liquidaciones[0]
    antes = await proponerDevolucionSinCobrar(accountId, companyId, { saleId: x.pedido.saleId, locationId: g.localId, dia: x.pedido.dia,
      liquidacion: { ref: ref?.ref ?? null, fecha: ref?.fecha ?? null } }, quien)
  }
  const r = await rpc<Fila>('conta_plataforma_resolver', {
    p_company: companyId, p_canal: g.canalId, p_local: g.localId, p_desde: g.desde, p_hasta: g.hasta, p_pedido: x.pedido?.saleId ?? null,
    p_tipo: x.tipo, p_importe: r2(x.importe), p_frase: frase, p_fecha: null, p_lineas: lineas, p_quien_nombre: quien,
  })
  if (x.tipo === 'reclamacion') return `Apuntada la reclamación a ${g.canal} por ${eurosExactos(Math.abs(x.importe))}: «${frase}».${x.pedido ? ' El pedido sale del aviso del cierre del día.' : ''}`
  if (x.pedido) return `Gasto apuntado por ${eurosExactos(x.importe)}. ${antes}`
  return `Gasto apuntado por ${eurosExactos(x.importe)}, con su asiento nº ${Number(r.numero_asiento ?? 0).toLocaleString('es-ES')} (629 contra la 430 de ${g.canal}), validado.`
}

/** Un movimiento del banco que puede ser el cobro de una liquidación. */
export interface MovimientoCandidato { id: string; fecha: string; importe: number; concepto: string; banco: string | null }

/** Los que pueden ser su cobro: mismo importe, desde el fin del periodo y 45 días, sin casar. */
export async function candidatosCobro(accountId: string, companyId: string, neto: number, hasta: string): Promise<MovimientoCandidato[]> {
  if (!(neto > 0)) return []
  const fin = new Date(Date.parse(`${hasta}T12:00:00Z`) + 45 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await tabla('bank_movement').select('id, op_date, amount, bank_concept, status, treasury_account(name)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('amount', r2(neto)).gte('op_date', hasta).lte('op_date', fin)
    .not('status', 'in', '(casado,antes_corte_sin_pareja)').order('op_date').limit(20)
  if (error) throw new Error(mensaje('No se han podido leer los movimientos del banco', error))
  return ((data ?? []) as Fila[]).map((m) => ({
    id: String(m.id), fecha: String(m.op_date), importe: Number(m.amount), concepto: String(m.bank_concept ?? ''),
    banco: ((m.treasury_account ?? null) as { name?: string } | null)?.name ?? null,
  }))
}

/** Casa el cobro de una liquidación con su movimiento (bank_casar, como en Bancos) y lo dice. */
export async function casarCobro(accountId: string, companyId: string, g: GrupoPlataforma, liquidacionId: string, mov: MovimientoCandidato): Promise<string> {
  const c = await cuentasDe(accountId, companyId, g.canalId)
  const l = g.liquidaciones.find((x) => x.id === liquidacionId)
  const que = `Cobro de ${g.canal}${l?.tienda ? ` · ${l.tienda}` : ''} ${periodo(g.desde, g.hasta)}`
  const r = await rpc<Fila>('bank_casar', {
    p_movement: mov.id, p_destino: { tipo: 'liquidacion', liquidacion_id: liquidacionId, cuenta_cliente: c.cliente430, tercero_id: c.terceroId, concepto: que },
    p_confianza: 'seguro', p_porque: `Casado desde Ventas › Liquidaciones: mismo importe (${eurosExactos(mov.importe)}) y llegado el ${mov.fecha.split('-').reverse().join('/')}.`,
    p_razones: [], p_por: 'persona', p_regla: null,
  })
  return `Cobro casado: ${eurosExactos(mov.importe)} del ${mov.fecha.split('-').reverse().join('/')}${mov.banco ? ` en ${mov.banco}` : ''}, con su asiento${r.creado ? '' : ' (ya estaba)'}.`
}

// ── El socio de marca: sus albaranes del mes contra su «Relación Compras y Ventas» ──
// Nombres dentro de cadenas (regla 40), comprobados en producción el 24/10:
// compras_liquidacion_recepciones y compras_liquidacion_productos (0190);
// goods_receipt_line (goods_receipt_id, recipe_item_id, product_name,
// qty_in_base, qty_received, doc_amount, unit_cost, not_goods); recipe_item
// (id, name, base_unit_id); kitchen_unit (id, dimension, factor_to_base).

/** Las líneas de los albaranes que cuenta la liquidación del socio, y lo casado a mano de su Relación. */
export async function lineasDelSocio(accountId: string, liqId: string): Promise<{ lineas: LineaAlbaran[]; casados: CasadoAMano[] }> {
  const [recs, prods] = await Promise.all([
    rpc<{ recepcion: string; codigo: string | null }[] | null>('compras_liquidacion_recepciones', { p_liq: liqId }),
    rpc<{ nombre: string; articulo: string | null; no_es_nuestro: boolean }[] | null>('compras_liquidacion_productos', { p_liq: liqId }),
  ])
  const casados: CasadoAMano[] = (prods ?? []).map((p) => ({ nombre: p.nombre, articulo: p.articulo, noEsNuestro: p.no_es_nuestro === true }))
  const codigo = new Map((recs ?? []).map((r) => [r.recepcion, r.codigo]))
  return { lineas: await lineasDeRecepciones(accountId, codigo), casados }
}

/** S01g · El detalle de una liquidación: la «Relación Compras y Ventas» que se leyó al subirla (null si no la tiene). */
export async function relacionDeLiquidacion(accountId: string, liqId: string): Promise<ProductoRelacion[] | null> {
  const { data, error } = await tabla('licensed_settlement').select('detail').eq('account_id', accountId).eq('id', liqId).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer la liquidación', error))
  const p = ((data as Fila | null)?.detail as { inventario?: { productos?: unknown } } | null)?.inventario?.productos
  return Array.isArray(p) ? (p as ProductoRelacion[]) : null
}

/** Las líneas de unas recepciones (id → su código), con su artículo y su cantidad en la unidad base. */
export async function lineasDeRecepciones(accountId: string, codigo: ReadonlyMap<string, string | null>): Promise<LineaAlbaran[]> {
  if (codigo.size === 0) return []
  const { data: ls, error } = await tabla('goods_receipt_line')
    .select('goods_receipt_id, recipe_item_id, product_name, qty_in_base, qty_received, doc_amount, unit_cost, not_goods')
    .eq('account_id', accountId).in('goods_receipt_id', [...codigo.keys()])
  if (error) throw new Error(mensaje('No se han podido leer las líneas de los albaranes', error))
  const filas = ((ls ?? []) as Fila[]).filter((l) => l.not_goods !== true)
  const arts = [...new Set(filas.map((l) => l.recipe_item_id).filter((x): x is string => typeof x === 'string'))]
  const artInfo = new Map<string, { nombre: string; unidad: string | null }>()
  const unidades = new Map<string, { dimension: Dimension | null; factor: number }>()
  if (arts.length) {
    const { data: ri, error: e1 } = await tabla('recipe_item').select('id, name, base_unit_id').eq('account_id', accountId).in('id', arts)
    if (e1) throw new Error(mensaje('No se han podido leer los artículos de los albaranes', e1))
    for (const r of (ri ?? []) as Fila[]) artInfo.set(String(r.id), { nombre: String(r.name ?? ''), unidad: r.base_unit_id ? String(r.base_unit_id) : null })
    const us = [...new Set([...artInfo.values()].map((a) => a.unidad).filter((x): x is string => !!x))]
    if (us.length) {
      const { data: ku, error: e2 } = await tabla('kitchen_unit').select('id, dimension, factor_to_base').in('id', us)
      if (e2) throw new Error(mensaje('No se han podido leer las unidades de los artículos', e2))
      for (const u of (ku ?? []) as Fila[]) {
        const d = String(u.dimension ?? '')
        unidades.set(String(u.id), { dimension: d === 'weight' || d === 'volume' || d === 'unit' ? d : null, factor: Number(u.factor_to_base ?? 1) || 1 })
      }
    }
  }
  const lineas: LineaAlbaran[] = filas.map((l) => {
    const art = typeof l.recipe_item_id === 'string' ? l.recipe_item_id : null
    const info = art ? artInfo.get(art) : undefined
    const u = info?.unidad ? unidades.get(info.unidad) : undefined
    const q = l.qty_in_base == null ? null : Number(l.qty_in_base)
    const importe = l.doc_amount != null ? Number(l.doc_amount) : l.unit_cost != null && l.qty_received != null ? r2(Number(l.unit_cost) * Number(l.qty_received)) : null
    return {
      albaran: codigo.get(String(l.goods_receipt_id)) ?? null, articulo: art, articuloNombre: info?.nombre ?? null, producto: l.product_name ? String(l.product_name) : null,
      dimension: u?.dimension ?? null, cantidadBase: q == null || !u ? null : q * u.factor, importe,
    }
  })
  return lineas
}
