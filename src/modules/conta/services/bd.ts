// src/modules/conta/services/bd.ts
//
// El acceso a la base de los servicios de contabilidad. Las tablas del C00
// aún no están en `src/types/database.ts` (se regenera aparte; ver
// src/lib/rpcSinTipar.ts): el desvío de tipos vive aquí, en un solo sitio.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
export { rpcSinTipar as rpc } from '@/lib/rpcSinTipar'

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

/** El mensaje de un error de la base, en una frase que se puede enseñar. */
export function mensaje(prefijo: string, error: { message: string } | null): string {
  return error ? `${prefijo}: ${error.message}` : prefijo
}
