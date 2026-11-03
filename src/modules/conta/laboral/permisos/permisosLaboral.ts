// src/modules/conta/laboral/permisos/permisosLaboral.ts
//
// N1 · PR 2 (02/11/2026) · Quién tiene el permiso de Laboral en la cuenta, para
// la lista de Equipo (Sumied): el nombre de cada persona, su permiso en palabras
// y quién se lo dio y cuándo. Sin tocar la base: el administrador ya lee
// lab_permiso y los perfiles de su cuenta (RLS). Quien no es administrador no
// ve la lista: solo el administrador da y quita el permiso.

import { supabase } from '@/lib/supabase'

export interface Perfil { user_id: string; employee_id: string | null; display_name: string | null; role: string; active: boolean }
export interface Permiso { user_id: string; dado_por: string | null; dado_at: string }

export interface FilaPermiso {
  userId: string
  nombre: string
  /** El permiso, en palabras. */
  permiso: string
  /** Quién se lo dio y cuándo, en palabras. */
  origen: string
  porSerAdministrador: boolean
}

export const QUE_VE = 'Ve y cambia lo privado de Laboral: lo que cobra, el IRPF, el IBAN, el documento y la fecha de nacimiento'

function fechaHora(iso: string): string {
  const d = new Date(iso)
  const dos = (n: number) => String(n).padStart(2, '0')
  // En la hora de Madrid, que es la de quien lo mira (regla 4).
  const madrid = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }))
  return `${dos(madrid.getDate())}/${dos(madrid.getMonth() + 1)}/${madrid.getFullYear()} a las ${dos(madrid.getHours())}:${dos(madrid.getMinutes())}`
}

/** Cruza perfiles y permisos: primero los administradores (lo tienen siempre), después los que lo tienen dado, por nombre. */
export function filasDePermiso(perfiles: Perfil[], permisos: Permiso[], nombreDeEmpleado: (id: string) => string | undefined): FilaPermiso[] {
  const porUsuario = new Map(perfiles.map((p) => [p.user_id, p]))
  const nombre = (userId: string): string => {
    const p = porUsuario.get(userId)
    if (!p) return 'Alguien que ya no está en la cuenta'
    return (p.employee_id ? nombreDeEmpleado(p.employee_id) : undefined) ?? p.display_name ?? 'Usuario sin nombre'
  }
  const porNombre = (a: FilaPermiso, b: FilaPermiso) => a.nombre.localeCompare(b.nombre, 'es')
  const admins = perfiles.filter((p) => p.active && p.role === 'admin').map((p): FilaPermiso => ({
    userId: p.user_id, nombre: nombre(p.user_id), permiso: QUE_VE,
    origen: 'Lo tiene siempre, por ser administrador de la cuenta', porSerAdministrador: true,
  })).sort(porNombre)
  const yaAdmin = new Set(admins.map((a) => a.userId))
  const dados = permisos.filter((x) => !yaAdmin.has(x.user_id)).map((x): FilaPermiso => ({
    userId: x.user_id, nombre: nombre(x.user_id), permiso: QUE_VE,
    origen: `Se lo dio ${x.dado_por ? nombre(x.dado_por) : 'alguien que no consta'} el ${fechaHora(x.dado_at)}`,
    porSerAdministrador: false,
  })).sort(porNombre)
  return [...admins, ...dados]
}

export async function leerPermisos(accountId: string): Promise<{ perfiles: Perfil[]; permisos: Permiso[] }> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const [pf, pm] = await Promise.all([
    supabase.from('user_profiles').select('user_id, employee_id, display_name, role, active').eq('account_id', accountId),
    // lab_permiso aún no está en database.ts (1937). Como método de supabase, con su «this».
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('lab_permiso').select('user_id, dado_por, dado_at').eq('account_id', accountId),
  ])
  if (pf.error) throw new Error(`No se han podido leer las personas de la cuenta: ${pf.error.message}`)
  if (pm.error) throw new Error(`No se ha podido leer quién tiene el permiso: ${pm.error.message}`)
  return { perfiles: (pf.data ?? []) as Perfil[], permisos: (pm.data ?? []) as Permiso[] }
}
