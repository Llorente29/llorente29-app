// src/modules/conta/services/bd.ts
//
// El acceso a la base de los servicios de contabilidad. Las tablas del C00
// aún no están en `src/types/database.ts` (se regenera aparte; ver
// src/lib/rpcSinTipar.ts): el desvío de tipos vive aquí, en un solo sitio.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { textoParaPantalla, type ErrorDeBase } from '@/modules/conta/lib/errorBase'

export function hayBase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('No hay conexión con la base de datos.')
}

/** Una tabla del módulo, sin tipar. */
export function tabla(nombre: string) {
  hayBase()
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(nombre)
}

/**
 * El mensaje de un error de la base, en una frase que se puede enseñar. Si es
 * técnico (el límite de tiempo, la red…), la frase normal; el texto de
 * Postgres va a la consola (lib/errorBase.ts).
 */
export function mensaje(prefijo: string, error: ErrorDeBase | null): string {
  return error ? `${prefijo}: ${textoParaPantalla(prefijo, error, error.message)}` : prefijo
}

/**
 * Llama a una RPC del módulo (las del C00 en adelante no están en
 * `src/types/database.ts`: ver src/lib/rpcSinTipar.ts). Igual que
 * rpcSinTipar, con una diferencia: un error técnico no llega a la pantalla
 * como «conta_dias_por_asentar: canceling statement due to statement
 * timeout», sino en palabras normales. Los que escriben las funciones
 * («MISMO_NIF …», «No puedes…») siguen llegando como siempre.
 */
export async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T> {
  hayBase()
  const cliente = supabase as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: ErrorDeBase | null }>
  }
  const { data, error } = await cliente.rpc(nombre, args)
  if (error) throw new Error(textoParaPantalla(nombre, error, `${nombre}: ${error.message}`))
  return data as T
}
