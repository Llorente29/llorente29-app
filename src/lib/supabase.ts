// src/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !key) {
  console.warn(
    '⚠️ Supabase no configurado. Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. ' +
    'La app funcionará en modo localStorage hasta que configures las variables.'
  )
}

/**
 * Cliente Supabase tipado con el schema completo de la BBDD.
 *
 * Es null si no hay credenciales (modo localStorage). Toda función que lo use
 * debe comprobar `if (!supabase) return ...` o usar `isSupabaseEnabled` antes.
 *
 * Tipado con <Database> generado por `npm run types:gen`. Esto da
 * autocompletado y validación en compilación de columnas/relaciones.
 */
export const supabase: SupabaseClient<Database> | null = url && key
  ? createClient<Database>(url, key, {
      auth: {
        // Detectar y procesar tokens automáticamente cuando la URL contiene
        // un hash con access_token (Magic Link, OAuth, etc).
        detectSessionInUrl: true,
        // Mantener la sesión guardada en localStorage entre recargas.
        persistSession: true,
        // Renovar tokens automáticamente antes de que expiren.
        autoRefreshToken: true,
        // Flujo de auth para Magic Links: 'implicit' (hash con tokens en URL).
        // PKCE no funciona con redirects fragmentados en GitHub Pages.
        flowType: 'implicit',
        // Almacenamiento de la sesión.
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    })
  : null

export const isSupabaseEnabled: boolean = !!supabase
