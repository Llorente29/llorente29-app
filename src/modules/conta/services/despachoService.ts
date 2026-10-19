// src/modules/conta/services/despachoService.ts
//
// P01 · «Impuestos de tus clientes» por dentro. Todo va por funciones de la
// base (security definer) de 20261123T0100_p01_despacho.sql, que miran quién
// pregunta y si cada empresa ha dado permiso:
//   conta_despacho_soy, conta_despacho_marcar, conta_despacho_correo_poner,
//   conta_despacho_equipo, conta_despacho_responsable_poner,
//   conta_despacho_trimestre.
// Nombres dentro de cadenas (regla 40): los ocho los crea esa migración;
// comprobado en staging el 19/10 (run 356).
// Presentar y descargar el fichero van por lo que ya existe (impuestosService).

import { rpc } from '@/modules/conta/services/bd'
import type { PersonaEquipo, TrimestreDespacho } from '@/modules/conta/impuestos/despacho/despacho'

export interface SoyAsesoria {
  asesoria: boolean
  desde: string | null
  nombre: string
  correo_respuesta: string | null
  clientes: number
  puede_gestionar: boolean
  puede_marcar: boolean
}

export function leerSoyAsesoria(accountId: string): Promise<SoyAsesoria> {
  return rpc<SoyAsesoria>('conta_despacho_soy', { p_account: accountId })
}

export function marcarAsesoria(accountId: string, es: boolean): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_despacho_marcar', { p_account: accountId, p_es: es })
}

export function ponerCorreoRespuesta(accountId: string, correo: string): Promise<{ ok: boolean; mensaje: string; correo: string }> {
  return rpc('conta_despacho_correo_poner', { p_account: accountId, p_correo: correo })
}

export function leerTrimestre(accountId: string, ejercicio: number, periodo: string, hoy?: string): Promise<TrimestreDespacho> {
  return rpc<TrimestreDespacho>('conta_despacho_trimestre', { p_account: accountId, p_year: ejercicio, p_period: periodo, p_hoy: hoy ?? null })
}

export function leerEquipo(accountId: string): Promise<PersonaEquipo[]> {
  return rpc<PersonaEquipo[]>('conta_despacho_equipo', { p_account: accountId })
}

export function ponerResponsable(accountId: string, companyId: string, userId: string | null): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_despacho_responsable_poner', { p_account: accountId, p_company: companyId, p_user: userId })
}
