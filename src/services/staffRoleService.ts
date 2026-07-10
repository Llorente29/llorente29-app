// src/services/staffRoleService.ts
// Áreas/roles de personal (staff_role) por cuenta: dan color a las pastillas del
// cuadrante y `kind` para la dotación por platos. Estándar sembrado + ampliable.
//
// db() laxo por la deuda de database.ts (staff_role no está en los tipos aún).

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export type RoleKind = 'cocina' | 'servicio' | 'reparto' | 'otro'

export interface StaffRole {
  id: string
  name: string
  color: string          // clave de color (ver ROLE_COLORS)
  kind: RoleKind
  active: boolean
  sort: number
}

// Paleta de áreas → clases Tailwind (fondo suave + texto). Genérica, no por sector.
export const ROLE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  coral:     { bg: 'bg-[#FAECE7]', text: 'text-[#993C1D]', dot: 'bg-[#D85A30]' },
  blue:      { bg: 'bg-[#E6F1FB]', text: 'text-[#0C447C]', dot: 'bg-[#378ADD]' },
  teal:      { bg: 'bg-[#E1F5EE]', text: 'text-[#0F6E56]', dot: 'bg-[#1D9E75]' },
  amber:     { bg: 'bg-[#FAEEDA]', text: 'text-[#854F0B]', dot: 'bg-[#EF9F27]' },
  green:     { bg: 'bg-[#EAF3DE]', text: 'text-[#3B6D11]', dot: 'bg-[#639922]' },
  purple:    { bg: 'bg-[#EEEDFE]', text: 'text-[#3C3489]', dot: 'bg-[#7F77DD]' },
  pink:      { bg: 'bg-[#FBEAF0]', text: 'text-[#993556]', dot: 'bg-[#D4537E]' },
  gray:      { bg: 'bg-[#F1EFE8]', text: 'text-[#444441]', dot: 'bg-[#888780]' },
}
export const ROLE_COLOR_KEYS = Object.keys(ROLE_COLORS)
export function roleColor(color?: string) { return ROLE_COLORS[color || 'gray'] || ROLE_COLORS.gray }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRole(r: any): StaffRole {
  return { id: r.id, name: r.name, color: r.color || 'gray', kind: r.kind || 'otro', active: !!r.active, sort: r.sort ?? 0 }
}

export async function fetchStaffRoles(accountId: string): Promise<StaffRole[]> {
  const { data, error } = await db().from('staff_role')
    .select('*').eq('account_id', accountId).order('sort', { ascending: true })
  if (error) { console.error('fetchStaffRoles:', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(rowToRole)
}

export async function upsertStaffRole(accountId: string, role: Partial<StaffRole> & { name: string }): Promise<StaffRole | null> {
  const row = {
    ...(role.id ? { id: role.id } : {}),
    account_id: accountId,
    name: role.name,
    color: role.color || 'gray',
    kind: role.kind || 'otro',
    active: role.active ?? true,
    sort: role.sort ?? 0,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await db().from('staff_role').upsert(row).select().single()
  if (error) { console.error('upsertStaffRole:', error); return null }
  return rowToRole(data)
}

export async function deleteStaffRole(id: string): Promise<boolean> {
  const { error } = await db().from('staff_role').delete().eq('id', id)
  if (error) { console.error('deleteStaffRole:', error); return false }
  return true
}
