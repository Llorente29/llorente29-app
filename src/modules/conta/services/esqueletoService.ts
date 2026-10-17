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
      ? tabla('company').select('is_hospitality').eq('account_id', accountId).eq('id', companyId).maybeSingle()
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
  return {
    hosteleria: (empresa.data as Record<string, unknown> | null)?.is_hospitality === true,
    diez: !!diez.data,
    interruptores: new Set(encendidos),
  }
}
