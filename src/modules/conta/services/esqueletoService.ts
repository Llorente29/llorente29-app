// src/modules/conta/services/esqueletoService.ts
//
// S01 · Lo que el esqueleto lee de la base:
//   · las preferencias de la persona (conta_user_pref: una fila por cuenta y
//     usuario; RLS: cada uno la suya);
//   · lo que decide qué sale: si la EMPRESA es de hostelería
//     (company.is_hospitality, la marca explícita que pidió Julio el 17/10: los
//     datos solo sugieren), si trabaja con Diez (conta_diez_base) y qué
//     interruptores de producto tiene la CUENTA (feature_flags:
//     conta_facturacion, conta_laboral, conta_impuestos; sin caducidad).
//
// Nombres dentro de cadenas (regla 40): conta_user_pref y
// company.is_hospitality los crea 20261118T0400_s01_esqueleto.sql; el resto
// (company, conta_diez_base, feature_flags.feature_key/enabled/expires_at)
// existe hoy en producción, comprobado el 17/10 en information_schema.

import { tabla, mensaje } from '@/modules/conta/services/bd'
import { supabase } from '@/lib/supabase'
import { aFila, deFila, type Preferencias } from '@/modules/conta/esqueleto/preferencias'
import { INTERRUPTORES, type Contexto } from '@/modules/conta/esqueleto/productos'

const COLUMNAS = 'nivel, favoritos, cinta_oculta, densidad, barra_desplegada, documento_oculto'

/** Las preferencias guardadas, o null si la persona aún no tiene fila. */
export async function leerPreferencias(accountId: string, userId: string): Promise<Preferencias | null> {
  const { data, error } = await tabla('conta_user_pref').select(COLUMNAS)
    .eq('account_id', accountId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(mensaje('No se han podido leer tus preferencias', error))
  return data ? deFila(data as Record<string, unknown>) : null
}

/** Guarda un cambio (crea la fila si no la hay). Devuelve lo que quedó guardado. */
export async function guardarPreferencias(accountId: string, userId: string, cambio: Partial<Preferencias>): Promise<Preferencias> {
  const { data, error } = await tabla('conta_user_pref')
    .upsert({ account_id: accountId, user_id: userId, ...aFila(cambio) }, { onConflict: 'account_id,user_id' })
    .select(COLUMNAS).single()
  if (error) throw new Error(mensaje('No se han podido guardar tus preferencias', error))
  return deFila(data as Record<string, unknown>)
}

/** Hostelería y Diez de la empresa, e interruptores de la cuenta. */
export async function leerContexto(accountId: string, companyId: string | null): Promise<Contexto> {
  const [empresa, diez, flags] = await Promise.all([
    companyId
      // «*»: logo_path llega con la 0120; hasta que esté aplicada, la columna no está y no se pide por nombre.
      ? tabla('company').select('*').eq('account_id', accountId).eq('id', companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    companyId
      ? tabla('conta_diez_base').select('company_id').eq('account_id', accountId).eq('company_id', companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    tabla('feature_flags').select('feature_key, enabled, expires_at').eq('account_id', accountId).in('feature_key', [...INTERRUPTORES]),
  ])
  if (empresa.error) throw new Error(mensaje('No se ha podido leer la empresa', empresa.error))
  if (diez.error) throw new Error(mensaje('No se ha podido saber si la empresa trabaja con Diez', diez.error))
  if (flags.error) throw new Error(mensaje('No se han podido leer los productos de la cuenta', flags.error))
  const ahora = Date.now()
  const encendidos = ((flags.data ?? []) as Record<string, unknown>[])
    .filter((f) => f.enabled === true && (f.expires_at == null || new Date(String(f.expires_at)).getTime() > ahora))
    .map((f) => String(f.feature_key))
  const fila = empresa.data as Record<string, unknown> | null
  return {
    hosteleria: fila?.is_hospitality === true,
    diez: !!diez.data,
    interruptores: new Set(encendidos),
    logoEmpresa: typeof fila?.logo_path === 'string' && fila.logo_path ? await urlDelLogo(fila.logo_path) : null,
  }
}

// ── S01 · El logo de la empresa (bucket company-logos, 0120) ────────────────

const BUCKET_LOGOS = 'company-logos'
export const LOGO_TIPOS = ['image/png', 'image/jpeg', 'image/webp'] as const
export const LOGO_MAXIMO = 1024 * 1024

/** La URL firmada del logo (un día). Si no se puede firmar, sin logo: la cabecera pone la inicial. */
export async function urlDelLogo(ruta: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from(BUCKET_LOGOS).createSignedUrl(ruta, 60 * 60 * 24)
  if (error || !data?.signedUrl) { console.error('[esqueleto] el logo de la empresa no se ha podido firmar', error); return null }
  return data.signedUrl
}

/** Lo que no deja subir, dicho para la persona; null si se puede. */
export function motivoLogoNoValido(f: { type: string; size: number }): string | null {
  if (!(LOGO_TIPOS as readonly string[]).includes(f.type)) return 'El logo tiene que ser PNG, JPG o WebP.'
  if (f.size > LOGO_MAXIMO) return `El logo pesa ${(f.size / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB y caben hasta 1 MB.`
  return null
}

/** Sube el logo de la empresa y lo apunta. Devuelve la ruta nueva; el de antes, si lo había, se borra. */
export async function subirLogoEmpresa(accountId: string, companyId: string, fichero: File, anterior: string | null): Promise<string> {
  const motivo = motivoLogoNoValido(fichero)
  if (motivo) throw new Error(motivo)
  if (!supabase) throw new Error('No hay conexión con la base.')
  const huella = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await fichero.arrayBuffer())))
    .slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
  const ext = fichero.type === 'image/png' ? 'png' : fichero.type === 'image/webp' ? 'webp' : 'jpg'
  const ruta = `${accountId}/${companyId}/${huella}.${ext}`
  const subida = await supabase.storage.from(BUCKET_LOGOS).upload(ruta, fichero, { upsert: true, contentType: fichero.type })
  if (subida.error) throw new Error(mensaje('No se ha podido subir el logo', subida.error))
  const { error } = await tabla('company').update({ logo_path: ruta }).eq('id', companyId).eq('account_id', accountId)
  if (error) throw new Error(mensaje('El logo se ha subido pero no se ha apuntado en la empresa', error))
  if (anterior && anterior !== ruta) await supabase.storage.from(BUCKET_LOGOS).remove([anterior]).catch(() => undefined)
  return ruta
}

/** Quita el logo de la empresa (y su fichero). */
export async function quitarLogoEmpresa(accountId: string, companyId: string, anterior: string | null): Promise<void> {
  const { error } = await tabla('company').update({ logo_path: null }).eq('id', companyId).eq('account_id', accountId)
  if (error) throw new Error(mensaje('No se ha podido quitar el logo', error))
  if (anterior && supabase) await supabase.storage.from(BUCKET_LOGOS).remove([anterior]).catch(() => undefined)
}
