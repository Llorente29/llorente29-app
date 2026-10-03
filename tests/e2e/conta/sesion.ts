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

import type { Page } from '@playwright/test'

export const STAGING_URL = 'https://oseymswjlzplqoxrfjzi.supabase.co'
export const CLAVE_STORAGE = 'sb-oseymswjlzplqoxrfjzi-auth-token'

export const CUENTA_A = { id: 'c01a0000-0000-4000-8000-00000000000a', email: 'a.admin@prueba.folvy.test' }
export const CUENTA_B = { id: 'c01b0000-0000-4000-8000-00000000000b', email: 'b.admin@prueba.folvy.test' }
/** El encargado de A (rol manager, no administrador): semilla seed_c00_encargado_prueba.sql. */
export const ENCARGADO_A = { id: 'c01a0000-0000-4000-8000-0000000000a6', email: 'a.encargado@prueba.folvy.test' }
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
