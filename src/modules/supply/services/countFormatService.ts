// src/modules/supply/services/countFormatService.ts
//
// FORMATOS DE CONTEO (§2.1 y §2.6 del encargo del 10/09/2026).
//
// Un formato de COMPRA («Caja de 6 kg») y un formato de CONTEO («Bolsa · 2,5 kg»)
// no son lo mismo, y confundirlos es lo que hacía Folvy hasta hoy: el móvil
// ofrecía los formatos de compra tal cual, y por eso Pulled Pork salía con
// «Bolsa» tres veces —1 kg, 1,3 kg y 4 kg— sin decir cuál era cuál.
//
// `use_in_count` es la columna que los separa. Nace en `false` para todo lo que
// choca (mismo nombre, distinto peso) o suena a unidad suelta sin serlo («Ud» =
// 20 tortillas), y espera a que una persona decida. Nadie decide por ella: cuál
// de las tres bolsas de Pulled Pork llega hoy es un hecho del negocio.
//
// EL NOMBRE QUE VE EL EMPLEADO SE COMPONE, NO SE GUARDA. «Caja · 4 bolsas · 10 kg»
// se arma de `name` + el árbol + `qty_in_base` cada vez. Guardarlo sería tener
// dos verdades: la etiqueta y el peso, que se separan el día que alguien corrige
// uno de los dos.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import type { PurchaseFormat } from '@/types/kitchen'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

type Row = Record<string, unknown>

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })

/** Un formato tal como lo necesita el conteo: el de compra + si sale en el móvil. */
export interface CountFormat extends PurchaseFormat {
  useInCount: boolean
  /** Cuántas piezas del formato padre lleva («4 bolsas»), si el árbol lo dice. */
  parentName: string | null
}

function rowToCountFormat(r: Row, byId: Map<string, Row>): CountFormat {
  const parent = r.parent_format_id ? byId.get(r.parent_format_id as string) : undefined
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    itemId: r.item_id as string,
    name: r.name as string,
    parentFormatId: (r.parent_format_id as string | null) ?? null,
    qtyPerParent: r.qty_per_parent == null ? null : Number(r.qty_per_parent),
    qtyInBase: Number(r.qty_in_base),
    isPiece: Boolean(r.is_piece),
    isWeighted: Boolean(r.is_weighted),
    source: r.source as PurchaseFormat['source'],
    aiConfidence: r.ai_confidence == null ? null : Number(r.ai_confidence),
    needsReview: Boolean(r.needs_review),
    isActive: Boolean(r.is_active),
    archivedAt: (r.archived_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    useInCount: Boolean(r.use_in_count),
    parentName: (parent?.name as string | undefined) ?? null,
  }
}

/** «1000 g» se lee «1 kg»: el contenido tiene que entrar de un vistazo. */
export function fmtQty(v: number, unit: string | null | undefined): string {
  const u = (unit ?? '').toLowerCase()
  if (u === 'g' && Math.abs(v) >= 1000) return `${nf.format(v / 1000)} kg`
  if (u === 'ml' && Math.abs(v) >= 1000) return `${nf.format(v / 1000)} l`
  return `${nf.format(v)}${unit ? ` ${unit}` : ''}`
}

/**
 * El nombre completo que ve quien cuenta: «Caja · 4 bolsas · 10 kg».
 * El tramo del medio sólo sale si el árbol lo sabe; sin él, «Caja · 10 kg».
 */
export function formatLabel(f: CountFormat, baseUnit: string | null): string {
  const partes = [f.name]
  if (f.qtyPerParent != null && f.qtyPerParent > 0 && f.parentName) {
    const n = nf.format(f.qtyPerParent)
    partes.push(`${n} ${f.parentName.toLowerCase()}${f.qtyPerParent === 1 ? '' : 's'}`)
  }
  partes.push(fmtQty(f.qtyInBase, baseUnit))
  return partes.join(' · ')
}

/** La segunda línea de la fila del móvil: todo menos el nombre. */
export function formatDetail(f: CountFormat, baseUnit: string | null): string {
  return formatLabel(f, baseUnit).slice(f.name.length + 3)
}

/**
 * Los formatos con los que se cuenta este artículo. Si no hay ninguno, el móvil
 * pide sólo la unidad base — que es exactamente lo que debe pasar mientras
 * nadie haya decidido cuál es el bueno (§2.6, último punto).
 */
export async function listCountFormats(itemId: string): Promise<CountFormat[]> {
  requireSupabase()
  const { data, error } = await from('recipe_item_purchase_format')
    .select('*')
    .eq('item_id', itemId)
    .is('archived_at', null)
    .eq('is_active', true)
  if (error) throw new Error(`No se pudieron cargar los formatos: ${error.message}`)
  const rows = (data as Row[] | null) ?? []
  const byId = new Map(rows.map(r => [r.id as string, r]))
  return rows
    .map(r => rowToCountFormat(r, byId))
    .filter(f => f.useInCount && f.qtyInBase > 0)
    .sort((a, b) => b.qtyInBase - a.qtyInBase)
}

// ═══════════════════════════════════════════════════════════════════════
// PANTALLA 5 · «Deja claros los formatos antes de contar»
// ═══════════════════════════════════════════════════════════════════════

export type ChoqueKind = 'repetido' | 'nombre_enganoso' | 'sin_formato'

export interface FormatReviewItem {
  itemId: string
  itemName: string
  baseUnit: string | null
  /** Cuántas veces se ha contado en el periodo. Ordena la lista. */
  timesCounted: number
  formats: CountFormat[]
  /** Por qué está en la lista. Vacío = no choca con nada. */
  problems: ChoqueKind[]
  /** La frase, en palabras de cocina, que explica el choque. */
  explanation: string
  reviewedAt: string | null
}

const NOMBRES_DE_UNIDAD = new Set(['ud', 'uni', 'unidad', 'u'])

function norm(s: string): string { return s.trim().toLowerCase() }

/**
 * Detecta los dos choques. Se exporta para poder probarlo contra los nombres
 * REALES del catálogo y no contra ejemplos inventados (regla 31).
 */
export function detectarChoques(formats: CountFormat[]): ChoqueKind[] {
  const vivos = formats.filter(f => f.isActive && !f.archivedAt)
  if (vivos.length === 0) return ['sin_formato']

  const out: ChoqueKind[] = []

  const pesosPorNombre = new Map<string, Set<number>>()
  for (const f of vivos) {
    const k = norm(f.name)
    if (!pesosPorNombre.has(k)) pesosPorNombre.set(k, new Set())
    pesosPorNombre.get(k)!.add(f.qtyInBase)
  }
  if ([...pesosPorNombre.values()].some(s => s.size > 1)) out.push('repetido')

  // «Ud» que no es una unidad. Un «Ud» que vale 1 es honesto y no molesta a
  // nadie; el que vale 20 tortillas o 0,25 milanesas es el que engaña.
  if (vivos.some(f => NOMBRES_DE_UNIDAD.has(norm(f.name)) && f.qtyInBase !== 1)) {
    out.push('nombre_enganoso')
  }

  return out
}

/** La frase que explica el choque, con los números de este artículo. */
export function explicarChoque(
  item: { itemName: string; formats: CountFormat[]; baseUnit: string | null },
  problems: ChoqueKind[],
): string {
  const { formats, baseUnit } = item
  if (problems.includes('repetido')) {
    const grupos = new Map<string, number[]>()
    for (const f of formats) {
      const k = norm(f.name)
      grupos.set(k, [...(grupos.get(k) ?? []), f.qtyInBase])
    }
    const peor = [...grupos.entries()]
      .filter(([, v]) => new Set(v).size > 1)
      .sort((a, b) => b[1].length - a[1].length)[0]
    if (peor) {
      const nombre = formats.find(f => norm(f.name) === peor[0])?.name ?? peor[0]
      const pesos = [...new Set(peor[1])].sort((a, b) => a - b).map(v => fmtQty(v, baseUnit))
      return `${pesos.length} «${nombre}» con distinto peso: ${pesos.join(', ')}. ` +
        `¿Cuál llega hoy? Hasta que alguien lo decida, ninguna sale en el móvil y se cuenta en ${unidadLarga(baseUnit)}. ` +
        `Las que no se usen se archivan, no se borran: los albaranes antiguos siguen cuadrando.`
    }
  }
  if (problems.includes('nombre_enganoso')) {
    const f = formats.find(x => NOMBRES_DE_UNIDAD.has(norm(x.name)) && x.qtyInBase !== 1)
    if (f) {
      return `Un formato que se llama «${f.name}» y son ${fmtQty(f.qtyInBase, baseUnit)}: ` +
        `quien cuenta 13 «${f.name}» apunta ${fmtQty(f.qtyInBase * 13, baseUnit)}. Ponle su nombre real.`
    }
  }
  if (problems.includes('sin_formato')) {
    return `Sin ningún formato: se cuenta sólo en ${unidadLarga(baseUnit)}.`
  }
  return ''
}

function unidadLarga(abbr: string | null): string {
  switch ((abbr ?? '').toLowerCase()) {
    case 'g': return 'gramos'
    case 'kg': return 'kilos'
    case 'ml': return 'mililitros'
    case 'l': return 'litros'
    default: return 'unidades'
  }
}

/**
 * La lista de la pantalla 5: artículos que se cuentan en este local, con sus
 * formatos y su choque, primero los que más se cuentan.
 *
 * REGLA 9: `account_id` en las dos consultas. Las tres cuentas comparten
 * nombres de artículo Y de local, y un listado sin cuenta es un listado que no
 * es de nadie.
 */
export async function listFormatReview(
  accountId: string,
  opts: { desde?: string; incluirResueltos?: boolean } = {},
): Promise<FormatReviewItem[]> {
  requireSupabase()
  const desde = opts.desde ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)

  // (1) Qué se cuenta y cuántas veces.
  const { data: lineas, error: e1 } = await from('inventory_count_line')
    .select('recipe_item_id, inventory_count!inner(created_at)')
    .eq('account_id', accountId)
    .gte('inventory_count.created_at', `${desde}T00:00:00`)
  if (e1) throw new Error(`No se pudieron cargar los conteos: ${e1.message}`)

  const veces = new Map<string, number>()
  for (const r of ((lineas as Row[] | null) ?? [])) {
    const id = r.recipe_item_id as string
    veces.set(id, (veces.get(id) ?? 0) + 1)
  }
  if (veces.size === 0) return []

  const ids = [...veces.keys()]

  // (2) Las fichas, con su unidad base.
  const { data: items, error: e2 } = await from('recipe_item')
    .select('id, name, count_formats_reviewed_at, kitchen_unit:base_unit_id(abbreviation)')
    .eq('account_id', accountId)
    .in('id', ids)
  if (e2) throw new Error(`No se pudieron cargar los artículos: ${e2.message}`)

  // (3) Sus formatos.
  const { data: fmts, error: e3 } = await from('recipe_item_purchase_format')
    .select('*')
    .eq('account_id', accountId)
    .in('item_id', ids)
    .is('archived_at', null)
    .eq('is_active', true)
  if (e3) throw new Error(`No se pudieron cargar los formatos: ${e3.message}`)

  const fRows = (fmts as Row[] | null) ?? []
  const byId = new Map(fRows.map(r => [r.id as string, r]))
  const porItem = new Map<string, CountFormat[]>()
  for (const r of fRows) {
    const k = r.item_id as string
    porItem.set(k, [...(porItem.get(k) ?? []), rowToCountFormat(r, byId)])
  }

  const out: FormatReviewItem[] = ((items as Row[] | null) ?? []).map(r => {
    const itemId = r.id as string
    const ku = (r.kitchen_unit ?? {}) as Record<string, unknown>
    const baseUnit = (ku.abbreviation as string | null) ?? null
    const formats = (porItem.get(itemId) ?? []).sort((a, b) => a.qtyInBase - b.qtyInBase)
    const problems = detectarChoques(formats)
    const itemName = r.name as string
    return {
      itemId,
      itemName,
      baseUnit,
      timesCounted: veces.get(itemId) ?? 0,
      formats,
      problems,
      explanation: explicarChoque({ itemName, formats, baseUnit }, problems),
      reviewedAt: (r.count_formats_reviewed_at as string | null) ?? null,
    }
  })

  // REGLA 7: esta pantalla se abre a propósito, así que NO esconde filas. El
  // orden pone delante lo que choca y lo que más se cuenta; lo confirmado baja,
  // pero sigue estando.
  return out.sort((a, b) => {
    const pa = a.problems.length > 0 && !a.reviewedAt ? 0 : 1
    const pb = b.problems.length > 0 && !b.reviewedAt ? 0 : 1
    if (pa !== pb) return pa - pb
    return b.timesCounted - a.timesCounted
  })
}

/** Marca (o desmarca) un formato como formato de conteo. */
export async function setUseInCount(formatId: string, value: boolean): Promise<void> {
  requireSupabase()
  const { error } = await from('recipe_item_purchase_format')
    .update({ use_in_count: value, updated_at: new Date().toISOString() })
    .eq('id', formatId)
  if (error) throw new Error(`No se pudo cambiar el formato: ${error.message}`)
}

export async function renameFormat(formatId: string, name: string): Promise<void> {
  requireSupabase()
  const limpio = name.trim()
  if (!limpio) throw new Error('El nombre no puede quedar vacío.')
  const { error } = await from('recipe_item_purchase_format')
    .update({ name: limpio, updated_at: new Date().toISOString() })
    .eq('id', formatId)
  if (error) throw new Error(`No se pudo renombrar: ${error.message}`)
}

/**
 * Archivar NO es borrar (§2.1): los albaranes y pedidos antiguos siguen
 * apuntando a este id y tienen que seguir cuadrando.
 */
export async function archiveFormat(formatId: string): Promise<void> {
  requireSupabase()
  const { error } = await from('recipe_item_purchase_format')
    .update({
      archived_at: new Date().toISOString(),
      is_active: false,
      use_in_count: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', formatId)
  if (error) throw new Error(`No se pudo archivar: ${error.message}`)
}

/** «Confirmar»: el artículo queda revisado hasta que alguien toque sus formatos. */
export async function confirmItemFormats(itemId: string, userId: string | null): Promise<void> {
  requireSupabase()
  const { error } = await from('recipe_item')
    .update({
      count_formats_reviewed_at: new Date().toISOString(),
      count_formats_reviewed_by: userId,
    })
    .eq('id', itemId)
  if (error) throw new Error(`No se pudo confirmar: ${error.message}`)
}

/**
 * El nombre del local, para la línea de arriba de la pantalla del móvil.
 * Va aquí y no en el tipo `Employee` porque `Employee` guarda el id, no el
 * nombre, y añadirle un campo derivado invita a que se quede viejo.
 */
export async function getLocationName(locationId: string): Promise<string> {
  requireSupabase()
  const { data, error } = await from('locations').select('name').eq('id', locationId).maybeSingle()
  if (error) throw new Error(`No se pudo leer el local: ${error.message}`)
  return ((data as Row | null)?.name as string | undefined) ?? ''
}
