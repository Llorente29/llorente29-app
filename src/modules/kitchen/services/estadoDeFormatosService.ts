// src/modules/kitchen/services/estadoDeFormatosService.ts
//
// Lo que la LISTA de artículos y la FICHA necesitan saber sobre los formatos
// de compra, contado EN VIVO contra la base (nada escrito a mano):
//
//   · listEstadoDeFormatos  → por artículo: si le falta el formato, si algún
//     enlace va sin referencia, si el texto del proveedor no cuadra con el
//     formato y si hay dos enlaces del mismo proveedor. Alimenta la franja,
//     los filtros y los sellos de la lista (E de la maqueta).
//   · historiaDelFormato    → cuántas veces se ha recibido un formato y desde
//     cuándo, para poder EXPLICAR la guarda de inmutabilidad en castellano en
//     vez de soltar el error de la base (C de la maqueta).
//   · ultimoAlbaranPorProveedor → la fecha del último albarán de cada
//     proveedor de un artículo (B3).
//
// REGLA 9 — todas las consultas llevan `account_id`: estas tablas son
// multi-cuenta y el catálogo plantilla de Folvy Interno comparte tablas Y
// NOMBRES con producción. Un recuento sin cuenta no da un número equivocado:
// da un número que no es de nadie.
//
// REGLA 40 — los nombres que viajan dentro de comillas no los mira `tsc`.
// Comprobados contra `information_schema.columns` el 19/09/2026:
//   article_supplier(account_id, recipe_item_id, supplier_id, supplier_code,
//                    supplier_item_name, purchase_format_id, is_active)
//   recipe_item_purchase_format(id, account_id, item_id, name, qty_in_base,
//                    parent_format_id, qty_per_parent, is_active, archived_at)
//   goods_receipt_line(id, account_id, goods_receipt_id, purchase_format_id,
//                    recipe_item_id)
//   goods_receipt(id, account_id, supplier_id, receipt_date, status)
//   stock_movement(source_type, source_id)
// No se usa ninguna relación embebida de PostgREST a propósito: su nombre
// depende de la clave ajena y tampoco lo mira el compilador.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import {
  elTextoNoCuadra,
  articulosConProveedorRepetido,
  type FormatoParaRegla,
} from '@/modules/kitchen/lib/formatosDeCompra'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export interface EstadoDeFormato {
  /** ningún enlace vivo con formato: el artículo no sabe cómo viene. */
  sinFormato: boolean
  /** al menos un enlace vivo sin la referencia del proveedor. */
  sinReferencia: boolean
  /** el texto del proveedor dice un tamaño que el formato no explica. */
  noCuadra: boolean
  /** dos enlaces vivos del mismo proveedor para este artículo. */
  repetido: boolean
  /** cuántos proveedores vivos tiene. */
  proveedores: number
  /** el porqué del sello «No cuadra», para el title del sello. */
  porQueNoCuadra: string | null
}

export interface ResumenDeFormatos {
  /** artículo → su estado. Solo los que tienen algo que decir entran aquí. */
  porArticulo: Map<string, EstadoDeFormato>
  /** cuántos artículos ACTIVOS se han mirado (el denominador honesto). */
  articulosMirados: number
}

interface FilaEnlace {
  id: string
  recipe_item_id: string
  supplier_id: string
  supplier_code: string | null
  supplier_item_name: string | null
  purchase_format_id: string | null
}

interface FilaFormato {
  id: string
  item_id: string
  name: string
  qty_in_base: number
  parent_format_id: string | null
  qty_per_parent: number | null
}

/** Dimensión de la unidad base de cada artículo, para leer el texto del proveedor. */
export interface DimensionPorArticulo {
  get(itemId: string): string | undefined
}

export async function listEstadoDeFormatos(
  accountId: string,
  itemIds: string[],
  dimensionPorArticulo: DimensionPorArticulo,
): Promise<ResumenDeFormatos> {
  requireSupabase()
  const vacio: ResumenDeFormatos = { porArticulo: new Map(), articulosMirados: itemIds.length }
  if (itemIds.length === 0) return vacio

  const [enlacesRes, formatosRes] = await Promise.all([
    supabase!
      .from('article_supplier')
      .select('id, recipe_item_id, supplier_id, supplier_code, supplier_item_name, purchase_format_id')
      .eq('account_id', accountId)
      .eq('is_active', true),
    supabase!
      .from('recipe_item_purchase_format')
      .select('id, item_id, name, qty_in_base, parent_format_id, qty_per_parent')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .is('archived_at', null),
  ])
  if (enlacesRes.error) {
    throw new Error(`Error leyendo los proveedores del catálogo: ${enlacesRes.error.message}`)
  }
  if (formatosRes.error) {
    throw new Error(`Error leyendo los formatos de compra: ${formatosRes.error.message}`)
  }

  const formatos = (formatosRes.data ?? []) as FilaFormato[]
  const formatoPorId = new Map<string, FilaFormato>()
  formatos.forEach((f) => formatoPorId.set(f.id, f))

  const deEstosArticulos = new Set(itemIds)
  const enlaces = ((enlacesRes.data ?? []) as FilaEnlace[]).filter((e) =>
    deEstosArticulos.has(e.recipe_item_id),
  )

  const repetidos = articulosConProveedorRepetido(
    enlaces.map((e) => ({ recipeItemId: e.recipe_item_id, supplierId: e.supplier_id })),
  )

  const porArticulo = new Map<string, EstadoDeFormato>()
  for (const itemId of itemIds) {
    const mios = enlaces.filter((e) => e.recipe_item_id === itemId)
    const baseDim = dimensionPorArticulo.get(itemId) ?? 'unit'

    let noCuadra = false
    let porQueNoCuadra: string | null = null
    for (const e of mios) {
      const fila = e.purchase_format_id ? formatoPorId.get(e.purchase_format_id) ?? null : null
      if (!fila) continue
      const padre = fila.parent_format_id ? formatoPorId.get(fila.parent_format_id) ?? null : null
      const formato: FormatoParaRegla = {
        nombre: fila.name,
        qtyInBase: Number(fila.qty_in_base),
        qtyPerParent: fila.qty_per_parent === null ? null : Number(fila.qty_per_parent),
        innerQtyInBase: padre ? Number(padre.qty_in_base) : null,
        innerNombre: padre ? padre.name : null,
      }
      if (elTextoNoCuadra({ texto: e.supplier_item_name, baseDim, formato })) {
        noCuadra = true
        porQueNoCuadra = `Su texto dice «${e.supplier_item_name}» y el formato guardado es ${fila.name} de ${fila.qty_in_base}.`
        break
      }
    }

    porArticulo.set(itemId, {
      sinFormato: !mios.some((e) => e.purchase_format_id !== null),
      sinReferencia: mios.some((e) => (e.supplier_code ?? '').trim() === ''),
      noCuadra,
      repetido: repetidos.has(itemId),
      proveedores: new Set(mios.map((e) => e.supplier_id)).size,
      porQueNoCuadra,
    })
  }

  return { porArticulo, articulosMirados: itemIds.length }
}

// ─────────────────────────────────────────────────────────────────────
// C · La historia de un formato, para poder explicar la guarda
// ─────────────────────────────────────────────────────────────────────
//
// `trg_recipe_item_purchase_format_immutable` corta un cambio de `qty_in_base`
// cuando alguna línea de albarán con este formato ha movido stock. Aquí se
// cuenta EXACTAMENTE eso —líneas con movimiento— para que el aviso diga el
// mismo número que la guarda usa para decidir, y no uno parecido.

export interface HistoriaDelFormato {
  /** líneas de albarán recibidas con este formato. */
  lineas: number
  /** de esas, las que movieron stock: son las que la guarda mira. */
  conMovimiento: number
  /** fecha del albarán más antiguo con este formato (ISO date), o null. */
  desde: string | null
}

export async function historiaDelFormato(
  accountId: string,
  formatId: string,
): Promise<HistoriaDelFormato> {
  requireSupabase()
  const vacia: HistoriaDelFormato = { lineas: 0, conMovimiento: 0, desde: null }

  const { data: lineasData, error: eLineas } = await supabase!
    .from('goods_receipt_line')
    .select('id, goods_receipt_id')
    .eq('account_id', accountId)
    .eq('purchase_format_id', formatId)
  if (eLineas) throw new Error(`Error leyendo el historial del formato: ${eLineas.message}`)

  const lineas = (lineasData ?? []) as { id: string; goods_receipt_id: string }[]
  if (lineas.length === 0) return vacia

  const idsLinea = lineas.map((l) => l.id)
  const idsAlbaran = [...new Set(lineas.map((l) => l.goods_receipt_id))]

  const [movRes, albRes] = await Promise.all([
    supabase!
      .from('stock_movement')
      .select('source_id')
      .eq('source_type', 'goods_receipt_line')
      .in('source_id', idsLinea),
    supabase!
      .from('goods_receipt')
      .select('id, receipt_date')
      .eq('account_id', accountId)
      .in('id', idsAlbaran),
  ])
  if (movRes.error) throw new Error(`Error leyendo los movimientos del formato: ${movRes.error.message}`)
  if (albRes.error) throw new Error(`Error leyendo los albaranes del formato: ${albRes.error.message}`)

  const conMovimiento = new Set(
    ((movRes.data ?? []) as { source_id: string }[]).map((m) => m.source_id),
  ).size

  const fechas = ((albRes.data ?? []) as { id: string; receipt_date: string | null }[])
    .map((a) => a.receipt_date)
    .filter((d): d is string => typeof d === 'string' && d !== '')
    .sort()

  return { lineas: lineas.length, conMovimiento, desde: fechas[0] ?? null }
}

// ─────────────────────────────────────────────────────────────────────
// B3 · La fecha del último albarán de cada proveedor de un artículo
// ─────────────────────────────────────────────────────────────────────

export async function ultimoAlbaranPorProveedor(
  accountId: string,
  itemId: string,
): Promise<Map<string, string>> {
  requireSupabase()
  const salida = new Map<string, string>()

  const { data: lineasData, error: eLineas } = await supabase!
    .from('goods_receipt_line')
    .select('goods_receipt_id')
    .eq('account_id', accountId)
    .eq('recipe_item_id', itemId)
  if (eLineas) throw new Error(`Error leyendo los albaranes del artículo: ${eLineas.message}`)

  const idsAlbaran = [
    ...new Set(((lineasData ?? []) as { goods_receipt_id: string }[]).map((l) => l.goods_receipt_id)),
  ]
  if (idsAlbaran.length === 0) return salida

  const { data: albData, error: eAlb } = await supabase!
    .from('goods_receipt')
    .select('id, supplier_id, receipt_date')
    .eq('account_id', accountId)
    .in('id', idsAlbaran)
  if (eAlb) throw new Error(`Error leyendo los albaranes del artículo: ${eAlb.message}`)

  for (const a of (albData ?? []) as {
    supplier_id: string | null
    receipt_date: string | null
  }[]) {
    if (!a.supplier_id || !a.receipt_date) continue
    const previo = salida.get(a.supplier_id)
    if (!previo || a.receipt_date > previo) salida.set(a.supplier_id, a.receipt_date)
  }
  return salida
}
