// src/admin/services/staffService.ts
//
// Service de gestión de administradores de plataforma (Portal de staff → Staff).
//
// Lee vía RPC list_platform_admins (Staff-A). Invita vía Edge Function
// create-platform-admin (mismo molde que createAccount). Muta rol/permisos/estado
// vía los RPC de Staff-A (set_platform_admin_role / _active / _permissions).
//
// Todos los mutadores exigen platform_can_manage_admins (lo comprueban los RPC).
// protect_last_admin (BBDD) impide degradar/desactivar al último CEO: el error
// se devuelve como mensaje legible para la UI.

import { supabase } from '../../lib/supabase'

// ─── Roles y permisos (etiquetas legibles) ──────────────────────────────────

export const ROLES: { value: string; label: string }[] = [
  { value: 'ceo', label: 'CEO' },
  { value: 'senior_admin', label: 'Senior admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'support', label: 'Support' },
]

export function roleLabel(role: string): string {
  return ROLES.find(r => r.value === role)?.label ?? role
}

// col = clave en platform_admin_permissions (la que espera el RPC de escritura)
// listKey = clave can_* que devuelve list_platform_admins
export const PERMISSIONS: { col: string; listKey: keyof StaffMember; label: string }[] = [
  { col: 'platform_can_create_accounts',            listKey: 'canCreateAccounts',          label: 'Crear cuentas' },
  { col: 'platform_can_suspend_accounts',           listKey: 'canSuspendAccounts',         label: 'Suspender cuentas' },
  { col: 'platform_can_archive_accounts',           listKey: 'canArchiveAccounts',         label: 'Archivar cuentas' },
  { col: 'platform_can_delete_accounts',            listKey: 'canDeleteAccounts',          label: 'Borrar cuentas' },
  { col: 'platform_can_edit_seed_data',             listKey: 'canEditSeedData',            label: 'Editar datos semilla' },
  { col: 'platform_can_impersonate',                listKey: 'canImpersonate',             label: 'Impersonar' },
  { col: 'platform_can_manage_admins',              listKey: 'canManageAdmins',            label: 'Gestionar admins' },
  { col: 'platform_can_reset_2fa_of_others',        listKey: 'canReset2faOfOthers',        label: 'Reset 2FA de otros' },
  { col: 'platform_can_send_global_notifications',  listKey: 'canSendGlobalNotifications', label: 'Notificaciones globales' },
  { col: 'platform_can_view_audit_log',             listKey: 'canViewAuditLog',            label: 'Ver auditoría' },
  { col: 'platform_can_view_system_health',         listKey: 'canViewSystemHealth',        label: 'Ver salud del sistema' },
]

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface StaffMember {
  id: string
  userId: string
  fullName: string
  email: string | null
  role: string
  active: boolean
  lastLoginAt: string | null
  createdAt: string
  canCreateAccounts: boolean
  canSuspendAccounts: boolean
  canArchiveAccounts: boolean
  canDeleteAccounts: boolean
  canEditSeedData: boolean
  canImpersonate: boolean
  canManageAdmins: boolean
  canReset2faOfOthers: boolean
  canSendGlobalNotifications: boolean
  canViewAuditLog: boolean
  canViewSystemHealth: boolean
}

export interface InvitePayload {
  email: string
  fullName: string
  role: string
}

export type MutationResult = { ok: true } | { ok: false; error: string }

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

export async function listStaff(): Promise<StaffMember[]> {
  const sb = requireSupabase()
  const { data, error } = await sb.rpc('list_platform_admins')
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return rows.map(r => ({
    id: r.id as string,
    userId: r.user_id as string,
    fullName: (r.full_name as string) ?? '',
    email: (r.email as string) ?? null,
    role: (r.role as string) ?? 'support',
    active: Boolean(r.active),
    lastLoginAt: (r.last_login_at as string) ?? null,
    createdAt: r.created_at as string,
    canCreateAccounts: Boolean(r.can_create_accounts),
    canSuspendAccounts: Boolean(r.can_suspend_accounts),
    canArchiveAccounts: Boolean(r.can_archive_accounts),
    canDeleteAccounts: Boolean(r.can_delete_accounts),
    canEditSeedData: Boolean(r.can_edit_seed_data),
    canImpersonate: Boolean(r.can_impersonate),
    canManageAdmins: Boolean(r.can_manage_admins),
    canReset2faOfOthers: Boolean(r.can_reset_2fa_of_others),
    canSendGlobalNotifications: Boolean(r.can_send_global_notifications),
    canViewAuditLog: Boolean(r.can_view_audit_log),
    canViewSystemHealth: Boolean(r.can_view_system_health),
  }))
}

// ─── Invitar (Edge Function, mismo wrapper que createAccount) ────────────────

export interface InviteResult {
  status: 'ok'
  admin_id: string
  user_id: string
  is_new_user: boolean
  welcome_sent: boolean | null
  welcome_error: string | null
}

export type InviteResponse =
  | { ok: true; data: InviteResult }
  | { ok: false; error: string; detail?: string }

export async function inviteAdmin(payload: InvitePayload): Promise<InviteResponse> {
  if (!supabase) return { ok: false, error: 'Supabase no está configurado.' }
  try {
    const { data, error } = await supabase.functions.invoke('create-platform-admin', { body: payload })
    if (error) {
      let parsed: { error?: string; detail?: string } | null = null
      try {
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') parsed = await ctx.json()
      } catch { parsed = null }
      return { ok: false, error: parsed?.error ?? error.message ?? 'Error al invitar el admin.', detail: parsed?.detail }
    }
    const body = data as Partial<InviteResult> & { error?: string; detail?: string }
    if (body?.error) return { ok: false, error: body.error, detail: body.detail }
    if (body?.status === 'ok' && body.admin_id) return { ok: true, data: body as InviteResult }
    return { ok: false, error: 'Respuesta inesperada de create-platform-admin.', detail: JSON.stringify(body) }
  } catch (e) {
    return { ok: false, error: 'Error de red al invitar el admin.', detail: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Mutaciones (RPC) ────────────────────────────────────────────────────────

export async function setRole(adminId: string, role: string): Promise<MutationResult> {
  try {
    const sb = requireSupabase()
    const { error } = await sb.rpc('set_platform_admin_role', { p_admin_id: adminId, p_role: role })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function setActive(adminId: string, active: boolean): Promise<MutationResult> {
  try {
    const sb = requireSupabase()
    const { error } = await sb.rpc('set_platform_admin_active', { p_admin_id: adminId, p_active: active })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Fija los 11 flags. `flags` indexado por la columna platform_can_*. */
export async function setPermissions(adminId: string, flags: Record<string, boolean>): Promise<MutationResult> {
  try {
    const sb = requireSupabase()
    const { error } = await sb.rpc('set_platform_admin_permissions', { p_admin_id: adminId, p_permissions: flags })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
