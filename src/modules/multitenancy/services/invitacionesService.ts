// src/modules/multitenancy/services/invitacionesService.ts
//
// DM1 · Accesos 1 (03/11/2026). Lo que necesitan las pantallas de accesos e
// invitaciones (tableros 5 a 8): las funciones de la 0812 y las dos edge
// functions (invitar-persona, invitacion-aceptar). Cada error vuelve con el
// motivo en palabras de la base o de la función (regla 8).

import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase
}

export type Rol = 'admin' | 'manager'
export const NOMBRE_PERMISO: Record<Rol, string> = { admin: 'Todo', manager: 'Encargado' }

export interface Acceso { user_id: string; correo: string; nombre: string | null; rol: Rol; activo: boolean; ultimo_acceso: string | null; soy_yo: boolean }
export interface Pendiente { id: string; correo: string; rol: Rol; invita: string | null; creada_at: string; caduca_at: string; envios: number; caducada: boolean }
export interface MiInvitacion { id: string; empresa: string; rol: Rol; invita: string | null; creada_at: string; caduca_at: string }
export interface InvitacionDelEnlace { correo: string; invita: string | null; empresas: { nombre: string; permiso: string }[]; tieneUsuario: boolean }

async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(nombre, args)
  if (error) throw new Error(error.message || 'No se ha podido hacer.')
  return data as T
}

/** Lo que dice una edge function al fallar: su { error }, si lo trae. */
async function motivoDe(e: { message: string; context?: Response }): Promise<string> {
  try { const cuerpo = await e.context?.json(); if (cuerpo?.error) return String(cuerpo.error) } catch { /* sin cuerpo */ }
  return e.message
}

export const accesosDeCuenta = (accountId: string) => rpc<Acceso[]>('accesos_de_cuenta', { p_account_id: accountId })
export const pendientesDeCuenta = (accountId: string) => rpc<Pendiente[]>('invitaciones_de_cuenta', { p_account_id: accountId })
export const misInvitaciones = () => rpc<MiInvitacion[]>('mis_invitaciones', {})
/** Devuelve el correo de la invitación anulada. */
export const anularInvitacion = (id: string) => rpc<string>('invitacion_anular', { p_id: id })
/** Devuelve el correo de a quien se le ha quitado. */
export const quitarAcceso = (accountId: string, userId: string) => rpc<string>('acceso_quitar', { p_account_id: accountId, p_user_id: userId })
/** Acepta las mías (todas, o las que diga). Devuelve los nombres de las empresas. */
export const aceptarInvitaciones = (ids: string[] | null) => rpc<string[]>('invitacion_aceptar', { p_ids: ids })

/** Reenviar: otro enlace y otros 7 días. Devuelve la frase para la pantalla. */
export async function reenviarInvitacion(id: string, marca: 'folvy' | 'sumied'): Promise<string> {
  const { data, error } = await db().functions.invoke('invitar-persona', { body: { accion: 'reenviar', id, marca } })
  if (error) throw new Error(await motivoDe(error))
  return (data as { frase: string }).frase
}

/** Lo que hay detrás de un enlace (sin sesión). */
export async function verInvitacion(token: string): Promise<InvitacionDelEnlace> {
  const { data, error } = await db().functions.invoke('invitacion-aceptar', { body: { accion: 'ver', token } })
  if (error) throw new Error(await motivoDe(error))
  return data as InvitacionDelEnlace
}

/** Crea el usuario de quien no lo tiene, con su contraseña, y entra. */
export async function crearUsuarioYEntrar(token: string, correo: string, contrasena: string, acepto: boolean): Promise<string[]> {
  const { data, error } = await db().functions.invoke('invitacion-aceptar', { body: { accion: 'crear', token, contrasena, acepto } })
  if (error) throw new Error(await motivoDe(error))
  const { error: e2 } = await db().auth.signInWithPassword({ email: correo, password: contrasena })
  if (e2) throw new Error('Tu usuario está creado, pero no se ha podido entrar: entra con tu correo y tu contraseña.')
  return (data as { empresas: string[] }).empresas ?? []
}
