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

export const supabase = url && key ? createClient(url, key) : null

export const isSupabaseEnabled = !!supabase
