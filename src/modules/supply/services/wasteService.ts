// src/modules/supply/services/wasteService.ts
//
// Registro de merma proactivo (T2.3). El cocinero registra lo que tira en el
// momento ("2 kg de tomate caducado"): baja el stock y queda con su causa.
//
// El motor real es la RPC register_waste (SECURITY DEFINER): el worker NO
// escribe stock_movement directo (es admin/manager); la RPC lo hace por él tras
// validar belongs_to_account. Aquí solo se llama a la RPC, se lista el histórico
// y se sube la foto opcional (mismo patrón de Storage que APPCC).
//
// UNIDAD: hoy se registra en unidad BASE del artículo (g/ml/ud). La RPC ya
// admite unidad de uso amigable (use_unit_label/factor/qty); se activará cuando
// se construya el frente de "unidades de uso amigables" (frente 7), sin tocar
// esta capa: la tubería ya está puesta.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { compressImage } from '../../appcc/services/photosService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

const PHOTO_BUCKET = 'appcc-photos' // bucket compartido; ruta separada waste/

// ─── Catálogo de causas de merma (curado, alineado con tspoon + líderes) ───
export const WASTE_REASONS: { value: string; label: string }[] = [
  { value: 'caducado', label: 'Caducado' },
  { value: 'mal_estado', label: 'Mal estado' },
  { value: 'rotura', label: 'Rotura / se cayó' },
  { value: 'sobreproduccion', label: 'Sobreproducción' },
  { value: 'error_preparacion', label: 'Error de preparación' },
  { value: 'regalo', label: 'Regalo / invitación' },
  { value: 'consumo_personal', label: 'Consumo del personal' },
  { value: 'devolucion_cliente', label: 'Devolución de cliente' },
  { value: 'otro', label: 'Otro' },
]

export function reasonLabel(code: string | null): string {
  if (!code) return '—'
  return WASTE_REASONS.find(r => r.value === code)?.label ?? code
}

export interface WasteEvent {
  id: string
  recipeItemId: string
  itemName: string
  unitAbbr: string | null
  reasonCode: string
  qtyBase: number
  useUnitLabel: string | null
  useQty: number | null
  unitCost: number | null
  costEur: number | null
  photoUrl: string | null
  lotCode: string | null
  expiryDate: string | null
  notes: string | null
  occurredAt: string
  createdByName: string | null
}

export interface RegisterWasteInput {
  accountId: string
  locationId: string
  recipeItemId: string
  reasonCode: string
  qtyBase: number
  photoUrl?: string | null
  lotCode?: string | null
  expiryDate?: string | null
  notes?: string | null
  userId?: string | null
  userName?: string | null
}

export interface RegisterWasteResult {
  wasteId: string
  costEur: number
}

/**
 * Sube una foto de merma al bucket (ruta waste/) y devuelve la signed URL.
 * Reutiliza la compresión de APPCC. La foto es opcional: solo se llama si hay
 * archivo. Guardamos la signed URL en stock_waste.photo_url (igual que el resto).
 */
export async function uploadWastePhoto(file: File): Promise<{ path: string; url: string | null }> {
  requireSupabase()
  const compressed = await compressImage(file)
  const ts = Date.now()
  const path = `waste/${ts}-${Math.random().toString(36).slice(2, 8)}.jpg`

  const { error: upErr } = await supabase!.storage
    .from(PHOTO_BUCKET)
    .upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw new Error(`No se pudo subir la foto: ${upErr.message}`)

  const { data: signed } = await supabase!.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, 3600)

  return { path, url: signed?.signedUrl ?? null }
}

/**
 * Registra una merma vía la RPC register_waste (frontera con guard).
 * La RPC escribe stock_waste + el movimiento 'merma' al ledger y recalcula saldo.
 */
export async function registerWaste(input: RegisterWasteInput): Promise<RegisterWasteResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('register_waste', {
    p_account_id: input.accountId,
    p_location_id: input.locationId,
    p_recipe_item_id: input.recipeItemId,
    p_reason_code: input.reasonCode,
    p_qty_base: input.qtyBase,
    p_use_unit_label: undefined,   // frente 7: unidades de uso amigables
    p_use_unit_factor: undefined,
    p_use_qty: undefined,
    p_photo_url: input.photoUrl ?? undefined,
    p_lot_code: input.lotCode ?? undefined,
    p_expiry_date: input.expiryDate ?? undefined,
    p_notes: input.notes ?? undefined,
    p_user_id: input.userId ?? undefined,
    p_user_name: input.userName ?? undefined,
  })
  if (error) throw new Error(`No se pudo registrar la merma: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as Row | null
  return {
    wasteId: (r?.waste_id as string) ?? '',
    costEur: Number(r?.cost_eur ?? 0),
  }
}

/**
 * Lista las mermas de un local en un rango (occurred_at), recientes primero,
 * con el nombre del artículo y su unidad base. `to` exclusivo.
 */
export async function listWaste(input: {
  accountId: string
  locationId: string
  from?: string | null
  to?: string | null
}): Promise<WasteEvent[]> {
  requireSupabase()
  let q = from('stock_waste')
    .select(`
      id, recipe_item_id, reason_code, qty_base, use_unit_label, use_qty,
      unit_cost, cost_eur, photo_url, lot_code, expiry_date, notes,
      occurred_at, created_by_name,
      recipe_item:recipe_item_id ( name, kitchen_unit:base_unit_id ( abbreviation ) )
    `)
    .eq('account_id', input.accountId)
    .eq('location_id', input.locationId)
    .order('occurred_at', { ascending: false })

  if (input.from) q = q.gte('occurred_at', input.from)
  if (input.to) q = q.lt('occurred_at', input.to)

  const { data, error } = await q
  if (error) throw new Error(`Error cargando las mermas: ${error.message}`)

  return ((data as Row[] | null) ?? []).map(r => {
    const item = (r.recipe_item ?? null) as
      { name?: string; kitchen_unit?: { abbreviation?: string } | null } | null
    return {
      id: r.id as string,
      recipeItemId: r.recipe_item_id as string,
      itemName: item?.name ?? '(sin nombre)',
      unitAbbr: item?.kitchen_unit?.abbreviation ?? null,
      reasonCode: r.reason_code as string,
      qtyBase: Number(r.qty_base ?? 0),
      useUnitLabel: (r.use_unit_label as string | null) ?? null,
      useQty: (r.use_qty as number | null) ?? null,
      unitCost: (r.unit_cost as number | null) ?? null,
      costEur: (r.cost_eur as number | null) ?? null,
      photoUrl: (r.photo_url as string | null) ?? null,
      lotCode: (r.lot_code as string | null) ?? null,
      expiryDate: (r.expiry_date as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      occurredAt: r.occurred_at as string,
      createdByName: (r.created_by_name as string | null) ?? null,
    }
  })
}
