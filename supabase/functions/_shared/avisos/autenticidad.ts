// supabase/functions/_shared/avisos/autenticidad.ts
//
// G01d · Tarea 2 · ¿El aviso es auténtico? Puro (solo Web Crypto, que tienen
// Deno y Node): lo usan las dos funciones que reciben avisos y lo prueban las
// unitarias con avisos buenos, firmas malas y avisos sin firma.
//
//   · Bitrix24 (webhook saliente): manda en auth[application_token] el código
//     que enseña al guardar el webhook. Se compara con el guardado de esa
//     conexión (documentación oficial, «Security in Handlers»).
//   · GoCardless: la cabecera Webhook-Signature es el HMAC-SHA256, en
//     hexadecimal, del cuerpo TAL CUAL llega, con el secreto del endpoint de
//     esa cuenta (como verifySignature de gocardless-nodejs).
//
// Las comparaciones son en tiempo constante: no dicen, por lo que tardan,
// cuántos caracteres se acertaron. Sin aviso auténtico: 401 y no se hace nada.

export type PorQueNo = 'apagado' | 'sin_codigo_guardado' | 'sin_firma' | 'firma_mala'

export type Veredicto = { ok: true } | { ok: false; porque: PorQueNo }

/** Lo que se registra de un aviso rechazado, en palabras (nunca el código ni la firma). */
export const FRASE_RECHAZO: Record<PorQueNo, string> = {
  apagado: 'Llegó un aviso con «Al instante» apagado: no se ha hecho nada.',
  sin_codigo_guardado: 'Llegó un aviso, pero aún no se ha pegado su código en Sumied: no se ha hecho nada.',
  sin_firma: 'Llegó un aviso sin código de seguridad: no se ha hecho nada.',
  firma_mala: 'Llegó un aviso con un código de seguridad que no es el de esta conexión: no se ha hecho nada.',
}

const codificador = new TextEncoder()

/** Igual en tiempo constante (para cadenas de la misma longitud tarda lo mismo). */
export function igualesEnTiempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  let diferencia = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diferencia |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diferencia === 0
}

/** Bitrix24: el código del aviso contra el guardado de la conexión. */
export function avisoBitrixAutentico(a: { encendido: boolean; guardado: string | null; recibido: string | null }): Veredicto {
  if (!a.encendido) return { ok: false, porque: 'apagado' }
  if (!a.guardado) return { ok: false, porque: 'sin_codigo_guardado' }
  const recibido = a.recibido?.trim() ?? ''
  if (!recibido) return { ok: false, porque: 'sin_firma' }
  return igualesEnTiempoConstante(codificador.encode(recibido), codificador.encode(a.guardado.trim()))
    ? { ok: true } : { ok: false, porque: 'firma_mala' }
}

const deHex = (h: string): Uint8Array | null => {
  if (!/^[0-9a-f]+$/i.test(h) || h.length % 2 !== 0) return null
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16)
  return out
}

/** El HMAC-SHA256 del cuerpo con el secreto, en hexadecimal (lo que manda GoCardless). */
export async function firmaGoCardless(cuerpo: string | Uint8Array, secreto: string): Promise<string> {
  const clave = await crypto.subtle.importKey('raw', codificador.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const datos = typeof cuerpo === 'string' ? codificador.encode(cuerpo) : new Uint8Array(cuerpo)
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', clave, datos))
  return [...firma].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** GoCardless: la firma de la cabecera contra la del cuerpo tal cual llegó. */
export async function avisoGoCardlessAutentico(a: { encendido: boolean; secreto: string | null; cuerpo: string | Uint8Array; firma: string | null }): Promise<Veredicto> {
  if (!a.encendido) return { ok: false, porque: 'apagado' }
  if (!a.secreto) return { ok: false, porque: 'sin_codigo_guardado' }
  const recibida = a.firma?.trim() ?? ''
  if (!recibida) return { ok: false, porque: 'sin_firma' }
  const bytes = deHex(recibida)
  if (!bytes) return { ok: false, porque: 'firma_mala' }
  const esperada = deHex(await firmaGoCardless(a.cuerpo, a.secreto))!
  return igualesEnTiempoConstante(bytes, esperada) ? { ok: true } : { ok: false, porque: 'firma_mala' }
}
