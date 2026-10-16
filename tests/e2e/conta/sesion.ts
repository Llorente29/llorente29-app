/// <reference lib="dom" />
// tests/e2e/conta/sesion.ts
//
// Entrar en staging-conta como uno de los dos usuarios de prueba SIN pasar por
// la pantalla de login: se pide la sesión a la API de autenticación y se deja
// en el almacenamiento del navegador, que es donde la busca supabase-js.
//
// Por qué no por la pantalla: el login llama a la edge function
// check-account-status y necesita los claims del custom_access_token_hook, y
// staging-conta solo tiene la base (ver docs/conta/staging.md). La app, una
// vez dentro, no usa esos claims.
//
// La contraseña llega por la variable CLAVE_PRUEBAS, que el workflow genera
// al azar en cada ejecución y no se imprime. Nunca está en el repositorio.
//
// USUARIOS POR FRENTE (C06, respuesta 2): cada frente (A, B, C y D) tiene sus
// propios dobles de los cuatro usuarios de prueba (seed_e2e_frentes_staging.sql),
// y su e2e solo cambia la contraseña de los suyos: dos frentes a la vez ya no se
// pisan. El frente lo pone el workflow en E2E_FRENTE, sacado de la rama. Sin
// frente, los de siempre. Las cuentas A y B son las mismas para todos; la C (la
// que vive sin empresa) es una por frente, porque el alta borra todas las suyas.

import type { Page } from '@playwright/test'

export const STAGING_URL = 'https://oseymswjlzplqoxrfjzi.supabase.co'
export const CLAVE_STORAGE = 'sb-oseymswjlzplqoxrfjzi-auth-token'

/** El frente de esta ejecución ('a', 'b', 'c' o 'd'), o null: los usuarios de siempre. */
export const FRENTE = frenteDe(process.env.E2E_FRENTE)

export type Frente = 'a' | 'b' | 'c' | 'd'

export function frenteDe(valor: string | undefined): Frente | null {
  const v = (valor ?? '').trim().toLowerCase()
  if (v === '') return null
  if (v === 'a' || v === 'b' || v === 'c' || v === 'd') return v
  throw new Error(`E2E_FRENTE tiene que ser a, b, c, d o nada; es «${valor}».`)
}

/** El correo del usuario de prueba para el frente: a.admin@… → a.admin.frente-b@…; sin frente, el de siempre. */
export function correoDelFrente(correo: string, frente: Frente | null = FRENTE): string {
  if (!frente) return correo
  const [local, dominio] = correo.split('@')
  return `${local}.frente-${frente}@${dominio}`
}

export const CUENTA_A = { id: 'c01a0000-0000-4000-8000-00000000000a', email: correoDelFrente('a.admin@prueba.folvy.test') }
export const CUENTA_B = { id: 'c01b0000-0000-4000-8000-00000000000b', email: correoDelFrente('b.admin@prueba.folvy.test') }
/** El encargado de A (rol manager, no administrador): semilla seed_c00_encargado_prueba.sql. */
export const ENCARGADO_A = { id: 'c01a0000-0000-4000-8000-0000000000a6', email: correoDelFrente('a.encargado@prueba.folvy.test') }
/**
 * Una cuenta SIN empresa, para el alta a pantalla completa (N1bAlta): semilla
 * seed_c00_cuenta_c_sin_empresa.sql; con frente, la C de ese frente.
 */
export const CUENTA_C = {
  id: FRENTE ? `e2e0000${FRENTE}-0000-4000-8000-00000000000c` : 'c01c0000-0000-4000-8000-00000000000c',
  email: correoDelFrente('c.admin@prueba.folvy.test'),
}
export const HERMANOS_RUIZ = 'c01a0000-0000-4000-8000-0000000000a3'
export const CARNES_SUR = 'c01b0000-0000-4000-8000-0000000000b3'

export function anonKey(): string {
  const k = process.env.VITE_SUPABASE_ANON_KEY
  if (!k) throw new Error('Falta VITE_SUPABASE_ANON_KEY')
  return k
}

export interface Sesion { access_token: string; refresh_token: string; expires_at: number; user: { id: string } }

export async function pedirSesion(email: string): Promise<Sesion> {
  const clave = process.env.CLAVE_PRUEBAS
  if (!clave) throw new Error('Falta CLAVE_PRUEBAS (la genera el workflow)')
  const r = await fetch(`${STAGING_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: clave }),
  })
  if (!r.ok) throw new Error(`No se pudo entrar como ${email}: HTTP ${r.status}`)
  return await r.json() as Sesion
}

/** Deja la sesión en el navegador ANTES de que cargue la app. */
export async function entrarComo(page: Page, email: string): Promise<Sesion> {
  const s = await pedirSesion(email)
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [CLAVE_STORAGE, JSON.stringify(s)] as const)
  return s
}
