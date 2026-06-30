// src/modules/kitchen/services/recipeVersionService.ts
//
// Versionado de escandallo (recipe_item_version). Modelo: HITO MANUAL + snapshot
// recuperable (como meez/Apicbase), con el coste guardado por versión para
// mostrar el impacto ECONÓMICO de cada cambio (el diferenciador de Folvy).
//
// Escritura vía 2 RPCs SECURITY DEFINER (migración 20260630T2100):
//   create_recipe_version(item, label, note, is_milestone, created_by_name)
//   restore_recipe_version(version_id, created_by_name)  ← con red (no pierde nada)
//
// database.ts no incluye estas RPCs todavía (recién creadas) → cast acotado.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export interface RecipeVersionLine {
  id: string
  childItemId: string
  childName: string
  quantityNet: number | null
  quantityGross: number | null
  unitId: string | null
  position: number
}

export interface RecipeVersionSnapshot {
  name: string | null
  yieldPortions: number | null
  computedCost: number | null
  lines: RecipeVersionLine[]
}

export interface RecipeVersion {
  id: string
  recipeItemId: string
  versionNumber: number
  validFrom: string
  validTo: string | null
  computedCost: number | null
  status: string
  isMilestone: boolean
  milestoneLabel: string | null
  changeNote: string | null
  createdByName: string | null
  createdAt: string
  snapshot: RecipeVersionSnapshot
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function mapSnapshot(raw: unknown): RecipeVersionSnapshot {
  const s = (raw ?? {}) as Record<string, unknown>
  const rawLines = Array.isArray(s.lines) ? (s.lines as Record<string, unknown>[]) : []
  return {
    name: (s.name as string) ?? null,
    yieldPortions: num(s.yield_portions),
    computedCost: num(s.computed_cost),
    lines: rawLines.map((l) => ({
      id: (l.id as string) ?? '',
      childItemId: (l.child_item_id as string) ?? '',
      childName: (l.child_name as string) ?? '(ingrediente)',
      quantityNet: num(l.quantity_net),
      quantityGross: num(l.quantity_gross),
      unitId: (l.unit_id as string) ?? null,
      position: Number(l.position ?? 0),
    })),
  }
}

function mapVersion(r: Record<string, unknown>): RecipeVersion {
  return {
    id: r.id as string,
    recipeItemId: r.recipe_item_id as string,
    versionNumber: Number(r.version_number ?? 0),
    validFrom: r.valid_from as string,
    validTo: (r.valid_to as string) ?? null,
    computedCost: num(r.computed_cost),
    status: (r.status as string) ?? 'active',
    isMilestone: r.is_milestone === true,
    milestoneLabel: (r.milestone_label as string) ?? null,
    changeNote: (r.change_note as string) ?? null,
    createdByName: (r.created_by_name as string) ?? null,
    createdAt: r.created_at as string,
    snapshot: mapSnapshot(r.snapshot),
  }
}

/** Versiones de un plato, la más reciente primero. */
export async function listRecipeVersions(recipeItemId: string): Promise<RecipeVersion[]> {
  requireSupabase()
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
        }
      }
    }
  }
  const { data, error } = await sb
    .from('recipe_item_version')
    .select('*')
    .eq('recipe_item_id', recipeItemId)
    .order('version_number', { ascending: false })
  if (error) throw new Error(`Error listando versiones: ${error.message}`)
  return (data ?? []).map((r) => mapVersion(r as Record<string, unknown>))
}

export async function createRecipeVersion(
  recipeItemId: string,
  opts: { label?: string | null; note?: string | null; isMilestone?: boolean; createdByName?: string | null },
): Promise<string> {
  requireSupabase()
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('create_recipe_version', {
    p_item_id: recipeItemId,
    p_label: opts.label ?? null,
    p_note: opts.note ?? null,
    p_is_milestone: opts.isMilestone ?? false,
    p_created_by_name: opts.createdByName ?? null,
  })
  if (error) throw new Error(`No se pudo guardar la versión: ${error.message}`)
  return data as string
}

export async function restoreRecipeVersion(
  versionId: string,
  createdByName?: string | null,
): Promise<string> {
  requireSupabase()
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('restore_recipe_version', {
    p_version_id: versionId,
    p_created_by_name: createdByName ?? null,
  })
  if (error) throw new Error(`No se pudo restaurar la versión: ${error.message}`)
  return data as string
}

// ── Diff legible entre dos snapshots (cliente) ──
// Compara por ingrediente (child_item_id). Cantidad mostrada = bruto (fallback neto).

export interface LineDiff {
  kind: 'added' | 'removed' | 'changed'
  childItemId: string
  name: string
  fromQty: number | null
  toQty: number | null
  unitId: string | null
}

export interface VersionDiff {
  lines: LineDiff[]
  costFrom: number | null
  costTo: number | null
  costDelta: number | null
}

function lineQty(l: RecipeVersionLine): number | null {
  return l.quantityGross ?? l.quantityNet
}

/** Diff de `from` → `to` (p. ej. una versión antigua → la actual). */
export function diffSnapshots(from: RecipeVersionSnapshot, to: RecipeVersionSnapshot): VersionDiff {
  const fromBy = new Map(from.lines.map((l) => [l.childItemId, l]))
  const toBy = new Map(to.lines.map((l) => [l.childItemId, l]))
  const lines: LineDiff[] = []

  for (const [id, tl] of toBy) {
    const fl = fromBy.get(id)
    if (!fl) {
      lines.push({ kind: 'added', childItemId: id, name: tl.childName, fromQty: null, toQty: lineQty(tl), unitId: tl.unitId })
    } else {
      const fq = lineQty(fl)
      const tq = lineQty(tl)
      if ((fq ?? 0) !== (tq ?? 0)) {
        lines.push({ kind: 'changed', childItemId: id, name: tl.childName, fromQty: fq, toQty: tq, unitId: tl.unitId })
      }
    }
  }
  for (const [id, fl] of fromBy) {
    if (!toBy.has(id)) {
      lines.push({ kind: 'removed', childItemId: id, name: fl.childName, fromQty: lineQty(fl), toQty: null, unitId: fl.unitId })
    }
  }

  const costFrom = from.computedCost
  const costTo = to.computedCost
  const costDelta = costFrom !== null && costTo !== null ? costTo - costFrom : null

  return { lines, costFrom, costTo, costDelta }
}
