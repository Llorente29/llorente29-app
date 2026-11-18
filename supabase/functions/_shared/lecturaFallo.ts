// supabase/functions/_shared/lecturaFallo.ts
//
// E02 · Por qué no se ha leído un documento, en dos clases fijas (encargo E02,
// respuesta E01 · 1):
//
//   · «caida»: la lectura no funciona (para todos): el tope de gasto de la
//     clave, la clave (401/403), demasiadas peticiones (429), el proveedor
//     (5xx, 529), un tiempo agotado o la red. El documento no tiene nada malo.
//   · «documento»: este documento no se ha podido leer: la respuesta llegó
//     cortada, no es un JSON, no trae lo mínimo, o el fichero no le vale.
//
// Con una clase y una causa cortas, nunca con el texto del proveedor. De lo que
// contestó solo se guarda el principio y el final (sin cabeceras, sin claves y
// sin el documento). Lo usan ocr-albaran (la lectura) y conta-facturas-entrada
// (la llamada a ocr-albaran). Sin dependencias: lo prueba tests/conta/e02.

export type ClaseFallo = 'caida' | 'documento'
export type CausaCaida = 'tope_gasto' | 'clave' | 'limite' | 'proveedor' | 'tiempo'
export type CausaDocumento = 'cortada' | 'no_json' | 'sin_minimo' | 'rechazo' | 'fichero'
export type CausaFallo = CausaCaida | CausaDocumento

export interface FalloLectura {
  clase: ClaseFallo
  causa: CausaFallo
  /** El código HTTP del proveedor (o de la llamada), si lo hubo. */
  http: number | null
  /** stop_reason de la respuesta, si llegó a responder. */
  stop_reason: string | null
  /** El uso de tokens de la respuesta, si llegó a responder. */
  usage: { input_tokens?: number; output_tokens?: number } | null
  /** Los primeros y los últimos caracteres de lo que contestó (MAX_TROZO cada uno). */
  inicio: string | null
  fin: string | null
}

export const MAX_TROZO = 300
export const CAUSAS_CAIDA: readonly CausaCaida[] = ['tope_gasto', 'clave', 'limite', 'proveedor', 'tiempo']
export const CAUSAS_DOCUMENTO: readonly CausaDocumento[] = ['cortada', 'no_json', 'sin_minimo', 'rechazo', 'fichero']

// El tope de gasto de la clave (o el saldo): lo dice el mensaje del proveedor, venga con 400, 402, 403 o 429.
const TOPE = /credit balance|usage limits?|spend(?:ing)? limit|billing|purchase credits|plans? & billing/i

/** El principio y el final de un texto, sin repetir lo que se solape. */
export function trozos(texto: string | null | undefined): { inicio: string | null; fin: string | null } {
  if (!texto) return { inicio: null, fin: null }
  const t = texto.replace(/\s+/g, ' ').trim()
  if (t.length <= MAX_TROZO) return { inicio: t, fin: null }
  return { inicio: t.slice(0, MAX_TROZO), fin: t.slice(Math.max(MAX_TROZO, t.length - MAX_TROZO)) }
}

/** El mensaje de un error del proveedor ({"type":"error","error":{"message":…}}), o el texto tal cual. */
function mensajeDe(cuerpo: string): string {
  try {
    const j = JSON.parse(cuerpo) as { error?: { message?: unknown; type?: unknown } }
    const m = j?.error?.message
    if (typeof m === 'string') return `${typeof j.error?.type === 'string' ? `${j.error.type}: ` : ''}${m}`
  } catch { /* no es JSON */ }
  return cuerpo
}

/** El proveedor contestó con un código que no es 2xx. */
export function falloDeRespuesta(http: number, cuerpo: string): FalloLectura {
  const mensaje = mensajeDe(cuerpo ?? '')
  const base = { http, stop_reason: null, usage: null, ...trozos(mensaje) }
  if (TOPE.test(mensaje) && [400, 402, 403, 429].includes(http)) return { clase: 'caida', causa: 'tope_gasto', ...base }
  if (http === 401 || http === 403) return { clase: 'caida', causa: 'clave', ...base }
  if (http === 429) return { clase: 'caida', causa: 'limite', ...base }
  if (http === 408 || http === 504) return { clase: 'caida', causa: 'tiempo', ...base }
  if (http >= 500) return { clase: 'caida', causa: 'proveedor', ...base }   // 500, 502, 503, 529…
  // Otro 4xx (un PDF que no se puede abrir, demasiado grande): es de este documento.
  return { clase: 'documento', causa: 'fichero', ...base }
}

/** No llegó ninguna respuesta: red, tiempo agotado o una excepción al llamar. */
export function falloDeExcepcion(e: unknown): FalloLectura {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  return { clase: 'caida', causa: 'tiempo', http: null, stop_reason: null, usage: null, ...trozos(m) }
}

type RespuestaModelo = { stop_reason?: unknown; usage?: unknown; content?: unknown }

/** El texto de la respuesta del modelo (los bloques de texto, juntos). */
export function textoDe(raw: unknown): string {
  const c = (raw as RespuestaModelo | null)?.content
  return Array.isArray(c) ? c.filter((b) => (b as { type?: unknown })?.type === 'text').map((b) => String((b as { text?: unknown }).text ?? '')).join('') : ''
}

/**
 * El proveedor contestó 2xx, pero lo que trae no vale como lectura: cortada
 * (stop_reason max_tokens), rechazada, sin JSON o sin el documento. Null si vale.
 */
export function falloDeContenido(raw: unknown, parsed: { document?: unknown } | null): FalloLectura | null {
  const r = (raw ?? {}) as RespuestaModelo
  const stop = typeof r.stop_reason === 'string' ? r.stop_reason : null
  const usage = r.usage && typeof r.usage === 'object' ? (r.usage as FalloLectura['usage']) : null
  const base = { http: 200, stop_reason: stop, usage, ...trozos(textoDe(raw)) }
  if (stop === 'max_tokens') return { clase: 'documento', causa: 'cortada', ...base }
  if (stop === 'refusal') return { clase: 'documento', causa: 'rechazo', ...base }
  if (!parsed) return { clase: 'documento', causa: 'no_json', ...base }
  if (!parsed.document) return { clase: 'documento', causa: 'sin_minimo', ...base }
  return null
}

/**
 * Quien llama a ocr-albaran (la entrada por correo, la pantalla): la clase que
 * ella dice, o, si no la dice (la plataforma cortó la función, 546 o 504, o no
 * contestó JSON), una caída por tiempo. Un 4xx sin clase es de este documento.
 */
export function falloDeLlamada(http: number | null, cuerpo: unknown): { clase: ClaseFallo; causa: CausaFallo } {
  const j = (cuerpo ?? {}) as { clase?: unknown; causa?: unknown }
  if ((j.clase === 'caida' && (CAUSAS_CAIDA as readonly unknown[]).includes(j.causa))
    || (j.clase === 'documento' && (CAUSAS_DOCUMENTO as readonly unknown[]).includes(j.causa))) {
    return { clase: j.clase as ClaseFallo, causa: j.causa as CausaFallo }
  }
  if (http === null || http >= 500 || http === 408) return { clase: 'caida', causa: 'tiempo' }
  return { clase: 'documento', causa: 'no_json' }
}

/** Lo que se guarda de un fallo (en la sesión de lectura): sin cabeceras, sin claves y sin el documento. */
export const paraGuardar = (f: FalloLectura) => ({
  clase: f.clase, causa: f.causa, http: f.http, stop_reason: f.stop_reason,
  usage: f.usage ? { input_tokens: f.usage.input_tokens ?? null, output_tokens: f.usage.output_tokens ?? null } : null,
  inicio: f.inicio, fin: f.fin,
})

/** Las frases de la pantalla (las de la propuesta del E01, ajustadas al E02: aún no se relee solo). */
export const FRASE_CAIDA = 'Ahora mismo no puedo leer facturas. No has perdido ninguna: están guardadas. Cuando vuelva, léelas con «Leerla».'
export const FRASE_DOCUMENTO = 'No he podido leer este documento. Escríbelo tú con el PDF al lado, o pulsa «Leerla» otra vez.'
export const fraseDe = (clase: ClaseFallo | null | undefined) => (clase === 'caida' ? FRASE_CAIDA : FRASE_DOCUMENTO)
