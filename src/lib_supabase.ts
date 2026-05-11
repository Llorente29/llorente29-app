// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !key) {
  console.warn(
    '⚠️ Supabase no configurado. Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. ' +
    'La app funcionará en modo localStorage hasta que configures las variables.'
  )
}

export const supabase = url && key
  ? createClient(url, key, {
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

export const isSupabaseEnabled = !!supabase
