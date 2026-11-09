// src/portal/cliente.ts
//
// GP · Tarea 3 · Cómo habla el portal del cliente con Sumied.
//   · Su propia sesión de Supabase (storageKey «sumied-portal»): no se mezcla con
//     la de la app de la gestoría aunque estén en el mismo dominio.
//   · leer(): una función conta_portal_* de la base, con la sesión. Una por
//     pantalla (la regla del segundo).
//   · accion(): conta-portal (el servidor), con la sesión.
//   · entrar(): conta-portal-entrar, sin sesión, para pedir el enlace.
//   · canjear(): el enlace del correo (token_hash) → sesión, con verifyOtp,
//     como /acceso del portal del trabajador.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const CLAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const sb: SupabaseClient | null = URL_BASE && CLAVE
  ? createClient(URL_BASE, CLAVE, { auth: { storageKey: 'sumied-portal', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null

export class ErrorPortal extends Error {}

/** Lo que dice la base, en su frase; nada técnico al cliente. */
function frase(e: { message?: string } | null): string {
  const m = e?.message ?? ''
  return m && !/(permission denied|function|column|relation|JWT|fetch)/i.test(m) ? m : 'No se ha podido cargar ahora. Prueba en unos segundos.'
}

export async function leer<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!sb) throw new ErrorPortal('El portal no está configurado.')
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new ErrorPortal(frase(error))
  return data as T
}

export interface Respuesta { ok: boolean; frase?: string; [k: string]: unknown }

export async function accion(nombre: string, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  if (!sb || !URL_BASE) throw new ErrorPortal('El portal no está configurado.')
  const { data: s } = await sb.auth.getSession()
  const r = await fetch(`${URL_BASE}/functions/v1/conta-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}`, apikey: CLAVE ?? '' },
    body: JSON.stringify({ accion: nombre, origen: window.location.origin, ...cuerpo }),
  })
  if (r.status === 401) throw new ErrorPortal('Tu sesión ha caducado. Pide otro enlace para entrar.')
  const j = await r.json().catch(() => ({ ok: false, frase: 'No se ha podido hacer ahora. Prueba en unos minutos.' })) as Respuesta
  return j
}

export async function entrar(correo: string): Promise<Respuesta> {
  if (!URL_BASE) throw new ErrorPortal('El portal no está configurado.')
  const r = await fetch(`${URL_BASE}/functions/v1/conta-portal-entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLAVE ?? ''}`, apikey: CLAVE ?? '' },
    body: JSON.stringify({ correo, origen: window.location.origin }),
  })
  return await r.json().catch(() => ({ ok: true, frase: 'Si ese correo tiene acceso, te llega un enlace para entrar en un minuto.' })) as Respuesta
}

/** El enlace del correo: ?token_hash=…&type=magiclink → sesión. */
export async function canjear(tokenHash: string): Promise<string | null> {
  if (!sb) return 'El portal no está configurado.'
  const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  return error ? 'Ese enlace ya se ha usado o ha caducado. Pide otro aquí abajo.' : null
}

/** Sube un fichero a su carpeta con la dirección firmada que da el servidor. Devuelve la ruta. */
export async function subirFichero(cliente: string, f: File, carpeta: 'subidas' | 'mensajes'): Promise<string> {
  if (!sb) throw new ErrorPortal('El portal no está configurado.')
  const tipo = f.type || (/\.heic$/i.test(f.name) ? 'image/heic' : '')
  const u = await accion('subida_url', { cliente, carpeta, nombre: f.name, tipo, bytes: f.size })
  if (!u.ok) throw new ErrorPortal(u.frase ?? 'No se puede subir ahora.')
  const { error } = await sb.storage.from('conta-portal').uploadToSignedUrl(String(u.ruta), String(u.token), f, { contentType: tipo })
  if (error) throw new ErrorPortal(`No se ha podido subir «${f.name}». Prueba otra vez.`)
  return String(u.ruta)
}

/** Abre (o descarga) un fichero suyo con un enlace firmado de 5 minutos. */
// La ventana se abre ANTES de esperar al servidor: en el móvil, una ventana que
// se abre después de un await la bloquea el navegador.
export async function abrir(cliente: string, tipo: string, id: string, indice = 0): Promise<void> {
  const w = window.open('', '_blank')
  try {
    const r = await accion('archivo', { cliente, tipo, id, indice })
    if (!r.ok || typeof r.url !== 'string') throw new ErrorPortal(r.frase ?? 'Ese documento no se puede abrir ahora.')
    if (w) w.location.href = r.url
    else window.location.href = r.url
  } catch (e) {
    w?.close()
    throw e
  }
}
