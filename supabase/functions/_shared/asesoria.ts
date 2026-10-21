// supabase/functions/_shared/asesoria.ts
//
// I01b · P4b · «Invitar a mi asesoría»: lo que no necesita Deno, para probarlo
// (tests/conta/impuestos/asesoria.test.ts). El enlace lleva un token de 32
// bytes al azar; la base solo guarda su huella (sha256), así que ni quien lea
// la base puede rehacer el enlace.

import { enlaceDeMarca, esIdMarca, MARCAS, type Marca } from './marcas.ts'

/** 32 bytes al azar en base64url (sin relleno). */
export function tokenNuevo(azar: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const b = azar(new Uint8Array(32))
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const tokenValido = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t)

/** La huella del token, en hexadecimal: lo único que guarda la base. */
export async function huella(token: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** La marca con la que sale la invitación: la de la cuenta que invita (Folvy si no tiene). */
export function marcaDeCuenta(productBrand: unknown): Marca {
  return esIdMarca(productBrand) ? MARCAS[productBrand] : MARCAS.folvy
}

export const RUTA_ACEPTAR = '/conta/asesoria'

/**
 * El enlace de aceptar. En producción, por el dominio de la marca; fuera, por
 * la base de pruebas (nunca un enlace de staging al dominio de producción).
 */
export function enlaceAceptar(m: Marca, token: string, esProduccion: boolean, basePruebas: string | null): string | null {
  if (esProduccion) return enlaceDeMarca(m, RUTA_ACEPTAR, { t: token }, null)
  if (!basePruebas) return null
  const q = new URLSearchParams({ t: token })
  if (m.id !== 'folvy') q.set('marca', m.id)
  return `${basePruebas.replace(/\/+$/, '')}${RUTA_ACEPTAR}?${q.toString()}`
}

/** Lo que pide quien invita, validado. */
export interface PedidoInvitar { empresa: string; correo: string; nombre: string; base: 'social_collaborator' | 'power_of_attorney' }
export function leerInvitar(b: Record<string, unknown> | null): { ok: true; p: PedidoInvitar } | { ok: false; mensaje: string } {
  const empresa = String(b?.empresa ?? '')
  const correo = String(b?.correo ?? '').trim().toLowerCase()
  const nombre = String(b?.nombre ?? '').trim()
  const base = b?.base
  if (!/^[0-9a-f-]{36}$/i.test(empresa)) return { ok: false, mensaje: 'Falta la empresa.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return { ok: false, mensaje: 'Escribe un correo válido.' }
  if (nombre.length < 2) return { ok: false, mensaje: 'Escribe el nombre de la asesoría.' }
  if (base !== 'social_collaborator' && base !== 'power_of_attorney') return { ok: false, mensaje: 'Di cómo presenta: como colaboradora social o con un poder.' }
  return { ok: true, p: { empresa, correo, nombre, base } }
}
