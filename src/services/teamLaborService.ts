// src/services/teamLaborService.ts
// Fase A — Modelo de trabajo: drivers por rol + intensidad + curva de personal
// necesario (RPC team_labor_requirement). Convierte la previsión de demanda en
// "cuánta gente hace falta por hora y por rol".
//
// db() laxo por la deuda de database.ts (tablas/funciones nuevas no tipadas).

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export type LaborDriver = 'platos' | 'tickets' | 'fixed'

export interface LaborModelRow {
  roleKind: string
  driver: LaborDriver
  perPersonHour: number
  minOnOpen: number
  openCloseExtra: number
  isEstimate: boolean   // true = viene del prior de hostelería (aún no afinado)
}

export interface LaborRequirementRow {
  fecha: string
  dow: number
  hora: number
  roleKind: string
  driver: string
  volumen: number
  perPersonHour: number
  required: number
  isEstimate: boolean
}

// Modelo efectivo por rol = fila propia de la cuenta o, si no hay, el prior por tipo de negocio.
export async function fetchLaborModel(accountId: string, roleKinds: string[]): Promise<LaborModelRow[]> {
  const [ownRes, accRes] = await Promise.all([
    db().from('team_labor_model').select('*').eq('account_id', accountId).is('location_id', null),
    db().from('accounts').select('business_type').eq('id', accountId).maybeSingle(),
  ])
  const bt = accRes?.data?.business_type || 'dark_kitchen'
  const priorRes = await db().from('labor_model_prior').select('*').eq('business_type', bt)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ownByKind = new Map<string, any>((ownRes?.data || []).map((r: any) => [r.role_kind, r]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priorByKind = new Map<string, any>((priorRes?.data || []).map((r: any) => [r.role_kind, r]))
  return roleKinds.map(k => {
    const o = ownByKind.get(k)
    const src = o || priorByKind.get(k)
    return {
      roleKind: k,
      driver: (src?.driver || 'platos') as LaborDriver,
      perPersonHour: Number(src?.per_person_hour ?? 30),
      minOnOpen: Number(src?.min_on_open ?? 0),
      openCloseExtra: Number(src?.open_close_extra ?? 0),
      isEstimate: !o,
    }
  })
}

export async function saveLaborModelRow(accountId: string, row: LaborModelRow): Promise<void> {
  const payload = {
    driver: row.driver,
    per_person_hour: row.perPersonHour,
    min_on_open: row.minOnOpen,
    open_close_extra: row.openCloseExtra,
    active: true,
    updated_at: new Date().toISOString(),
  }
  const existingRes = await db().from('team_labor_model')
    .select('id').eq('account_id', accountId).is('location_id', null).eq('role_kind', row.roleKind).maybeSingle()
  if (existingRes?.data?.id) {
    await db().from('team_labor_model').update(payload).eq('id', existingRes.data.id)
  } else {
    await db().from('team_labor_model').insert({ account_id: accountId, location_id: null, role_kind: row.roleKind, ...payload })
  }
}

export async function fetchLaborIntensity(accountId: string): Promise<string> {
  const res = await db().from('team_demand_config').select('labor_intensity').eq('account_id', accountId).maybeSingle()
  return res?.data?.labor_intensity || 'normal'
}

export async function setLaborIntensity(accountId: string, intensity: string): Promise<void> {
  await db().from('team_demand_config').upsert({ account_id: accountId, labor_intensity: intensity }, { onConflict: 'account_id' })
}

export async function fetchLaborRequirement(accountId: string, locationId: string, weekStart: string): Promise<LaborRequirementRow[]> {
  const { data, error } = await db().rpc('team_labor_requirement', { p_account: accountId, p_location: locationId, p_week_start: weekStart })
  if (error) { console.error('team_labor_requirement:', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    fecha: r.fecha,
    dow: Number(r.dow) || 0,
    hora: Number(r.hora) || 0,
    roleKind: r.role_kind,
    driver: r.driver,
    volumen: Number(r.volumen) || 0,
    perPersonHour: Number(r.per_person_hour) || 0,
    required: Number(r.required) || 0,
    isEstimate: !!r.is_estimate,
  }))
}
