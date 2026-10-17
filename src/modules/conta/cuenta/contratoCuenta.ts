// src/modules/conta/cuenta/contratoCuenta.ts
//
// EL CONTRATO MÍNIMO entre contabilidad y el resto de Folvy (respuesta 1 del
// C00, «Fuera de Folvy»). Contabilidad tiene que poder venderse sola, a un
// cliente sin Cocina, albaranes ni pedidos. Por eso ESTE es el único fichero
// del módulo que importa algo de fuera de `src/modules/conta`, y lo que
// importa está escrito aquí:
//
//   1. Qué cuenta está activa  → useActiveAccount (multitenancy).
//   2. Quién es el usuario     → useApp (id de auth y nombre del perfil).
//   3. Los datos que la cuenta ya tiene de sí misma → `accounts`:
//      name, legal_name, cif, billing_address. Solo LECTURA, y solo para
//      PROPONERLOS en el alta (D2). La empresa es la fuente nueva: si la
//      persona los cambia, `accounts` no se toca.
//
//   4. Si la cuenta es SOLO de contabilidad (C06) → `accounts.product_brand`,
//      leída de la cuenta que ya carga la plataforma (useFeatureGate). Una
//      cuenta así no tiene a dónde «volver»: no hay resto de la aplicación.
//      La marca con que se enseña la pantalla va aparte, en cuenta/marca.ts.
//   5. El logo de la cuenta (S01, la cabecera) → `accounts.logo_url`, de la
//      misma cuenta ya cargada. Solo lectura.
//
// Nada de Cocina (recetas, artículos, albaranes, ventas) entra en el módulo
// por aquí ni por ningún otro sitio. Si mañana se vende solo, se reimplementa
// este fichero y nada más.

import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useApp } from '@/context/AppContext'
import { useFeatureGate } from '@/platform/feature-gate/useFeatureGate'
import { supabase } from '@/lib/supabase'
import { mensaje } from '@/modules/conta/services/bd'

export interface CuentaConta {
  accountId: string | null
  cargando: boolean
  userId: string | null
  /** Nombre con el que firma lo que hace en el registro («lo cambió Marta»). */
  userName: string | null
  /** ¿Es administrador de la cuenta? Socios y cargos solo los ve un administrador. */
  esAdmin: boolean
  /**
   * ¿La cuenta es solo de contabilidad (C06)? Sin Cocina y sin «Volver a…».
   * ES EL CAMPO QUE LEEN LOS DEMÁS FRENTES (Julio, C06 respuesta 2). Ejemplo, el
   * frente A: con `soloContabilidad`, el ajuste «Recibe la mercancía con Folvy»
   * vale siempre «no» y no se enseña. Lo dice la CUENTA (accounts.product_brand
   * no nulo), no la pantalla: para decidir cómo se ve, useProductoSolo(), que
   * además cuenta la marca forzada con ?marca= en staging. En SQL, lo mismo:
   * `accounts.product_brand is not null`.
   */
  soloContabilidad: boolean
  /**
   * S01 · El logo de la cuenta (accounts.logo_url), para la cabecera, al lado
   * del nombre de la empresa. Solo si la cuenta que carga la plataforma es la
   * activa: con dos cuentas no se enseña el logo de la otra.
   */
  logoCuenta: string | null
}

/**
 * El logo de la cuenta, si es la activa. `select *` de la plataforma trae
 * accounts.logo_url aunque su tipo (src/platform/types.ts) no lo nombre. Pura.
 */
export function logoDe(cuenta: { id?: unknown; logo_url?: unknown } | null | undefined, activa: string | null): string | null {
  if (!cuenta || cuenta.id !== activa) return null
  return typeof cuenta.logo_url === 'string' && cuenta.logo_url.trim() !== '' ? cuenta.logo_url : null
}

/** ¿Es una cuenta solo de contabilidad? La marca la tienen solo las que se dieron de alta así (C06). Pura. */
export function esCuentaSoloContabilidad(fila: { product_brand?: unknown } | null | undefined): boolean {
  return typeof fila?.product_brand === 'string' && fila.product_brand !== ''
}

export function useCuentaConta(): CuentaConta {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { authUserId, userProfile } = useApp()
  const { account } = useFeatureGate()
  return {
    accountId: activeAccountId,
    cargando: accountsLoading,
    userId: authUserId,
    userName: userProfile?.displayName ?? null,
    esAdmin: userProfile?.role === 'admin',
    soloContabilidad: esCuentaSoloContabilidad(account),
    logoCuenta: logoDe(account, activeAccountId),
  }
}

/** Lo que `accounts` ya sabe de sí misma. Todo puede faltar. */
export interface DatosDeLaCuenta {
  nombre: string | null
  razonSocial: string | null
  nif: string | null
  direccion: { calle: string | null; codigoPostal: string | null; poblacion: string | null; provincia: string | null } | null
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** Pasa la fila de `accounts` al contrato. Pura: se prueba sin base. */
export function leerFilaDeCuenta(fila: Record<string, unknown> | null): DatosDeLaCuenta {
  if (!fila) return { nombre: null, razonSocial: null, nif: null, direccion: null }
  const b = (fila.billing_address && typeof fila.billing_address === 'object') ? fila.billing_address as Record<string, unknown> : {}
  const direccion = {
    calle: texto(b.street), codigoPostal: texto(b.postalCode), poblacion: texto(b.city), provincia: texto(b.province),
  }
  const hayDireccion = Object.values(direccion).some((v) => v !== null)
  return {
    nombre: texto(fila.name),
    razonSocial: texto(fila.legal_name),
    nif: texto(fila.cif),
    direccion: hayDireccion ? direccion : null,
  }
}

export async function leerDatosDeLaCuenta(accountId: string): Promise<DatosDeLaCuenta> {
  if (!supabase) throw new Error('No hay conexión con la base de datos.')
  const { data, error } = await supabase
    .from('accounts')
    .select('name, legal_name, cif, billing_address')
    .eq('id', accountId)
    .maybeSingle()
  if (error) throw new Error(mensaje('No se han podido leer los datos de la cuenta', error))
  return leerFilaDeCuenta(data as Record<string, unknown> | null)
}
