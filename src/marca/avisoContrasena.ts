// src/marca/avisoContrasena.ts
//
// C06, respuesta 2: con la marca, al cambiar la contraseña se avisa por correo
// (conta-contrasena, accion «cambiada»; la marca sale de la cuenta, no de aquí).
// Lo que devuelve es lo que la pantalla dice: a quién se avisó o por qué no.

import { supabase } from '../lib/supabase'

export interface AvisoContrasena { avisado: boolean; a?: string; motivo?: string }

export async function avisarContrasenaCambiada(): Promise<AvisoContrasena> {
  if (!supabase) return { avisado: false, motivo: 'no hay conexión con el servidor' }
  try {
    const { data, error } = await supabase.functions.invoke('conta-contrasena', { body: { accion: 'cambiada' } })
    if (error) return { avisado: false, motivo: 'no he podido pedir el aviso' }
    const r = (data ?? {}) as AvisoContrasena
    return { avisado: r.avisado === true, a: r.a, motivo: r.motivo }
  } catch {
    return { avisado: false, motivo: 'no he podido pedir el aviso' }
  }
}

/** La frase de la pantalla (regla 8: con contenido). */
export function fraseAviso(r: AvisoContrasena): string {
  return r.avisado
    ? `Contraseña cambiada. Te he mandado un aviso a ${r.a ?? 'tu correo'}: si no has sido tú, lo verás ahí.`
    : `Contraseña cambiada. El aviso por correo no ha salido: ${r.motivo ?? 'no sé por qué'}.`
}
