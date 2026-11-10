// src/modules/conta/cuenta/volverAEmpezar.ts
//
// GD · «Volver a empezar» (Julio, nº51): llama a conta-gd-volver-a-empezar un
// paso cada vez (supabase/functions/conta-gd-volver-a-empezar/pasos.ts). Nunca
// lanza: si un paso falla, su `texto` dice por qué.

import { supabase } from '@/lib/supabase'
import { PASOS, TANDAS_MAX, type Paso } from '../../../../supabase/functions/conta-gd-volver-a-empezar/pasos'

export { PASOS, TANDAS_MAX }
/** `sigue`: el paso va por tandas y le queda algo (hay que volver a llamarlo). */
export type Salida = { ok: true; frase: string; sigue: boolean } | { ok: false; texto: string }

export async function pasoDeVolverAEmpezar(cuenta: string, paso: Paso): Promise<Salida> {
  if (!supabase) return { ok: false, texto: 'Sin conexión con la base.' }
  const { data, error } = await supabase.functions.invoke('conta-gd-volver-a-empezar', { body: { cuenta, paso } })
  if (!error && data && typeof data === 'object' && (data as { ok?: boolean }).ok) return { ok: true, frase: String((data as { frase?: string }).frase ?? ''), sigue: (data as { sigue?: boolean }).sigue === true }
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as { error?: string } | null
    if (c && typeof c.error === 'string') return { ok: false, texto: c.error }
    if (ctx.status === 404) return { ok: false, texto: '«Volver a empezar» aún no está publicado en este entorno.' }
    return { ok: false, texto: `La función ha contestado ${ctx.status}. Inténtalo otra vez en un momento.` }
  }
  return { ok: false, texto: `No se ha podido hablar con «Volver a empezar»${error ? ` (${error.message})` : ''}.` }
}
