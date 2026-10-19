// supabase/functions/_shared/hacienda/justificanteCsv.ts
//
// I01c · P1 definitiva · TRAER EL JUSTIFICANTE ORIGINAL DE HACIENDA POR SU CSV,
// como hacen Diez y ERP10: se pega el CSV y llega el PDF de la AEAT.
//
// Medido el 19/10 con una sola consulta real de solo lectura (run 39257823670,
// el 303 del 2T de Foodint): con el CSV basta. Sin certificado, sin Cl@ve y sin
// captcha, a cualquier hora; Hacienda contesta 200 con el PDF original (4
// páginas con texto), el que lee lib/justificanteAeat.ts, y sus 21 casillas
// casaron al céntimo con las guardadas.
//
// No pasa por la puerta (puerta.ts): esa sigue cerrada y es para PRESENTAR, con
// certificado. Esto solo LEE un documento público por su código, como el
// «Cotejo de documentos mediante CSV» de la Sede.
//
// Núcleo sin Deno (lo prueban las pruebas unitarias): quien llama pone cómo se
// pide (la AEAT de verdad, o el doble en staging) y aquí se decide qué ha
// pasado. Ni el CSV ni el PDF se escriben en ningún registro.

export const URL_CSV_AEAT = 'https://www2.agenciatributaria.gob.es/wlpl/inwinvoc/es.aeat.dit.adu.eeca.catalogo.VisualizaSc?COMPLETA=SI&ORIGEN=C&CSV='

/** Lo que contestó quien tiene el documento (Hacienda o el doble). null: no contestó. */
export interface Respuesta { status: number; tipo: string; cuerpo: Uint8Array }

export type Motivo = 'formato' | 'no_encontrado' | 'no_responde'

export type Traido =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; motivo: Motivo; mensaje: string }

/** Las palabras de cada caso, en las de una oficina. En ninguno se guarda nada. */
export const MENSAJES: Record<Motivo, string> = {
  formato: 'Ese CSV no tiene la forma de los de Hacienda: son 16 letras y números, como aparecen arriba en el justificante. No se ha preguntado a Hacienda.',
  no_encontrado: 'Hacienda no tiene ningún justificante con ese CSV. Revísalo letra a letra con el del PDF. No se ha guardado nada.',
  no_responde: 'Hacienda no responde ahora mismo. Vuelve a intentarlo en un rato. No se ha guardado nada.',
}

/** «prue ba3t-2025aaaa» → «PRUEBA3T2025AAAA». */
export function limpiarCsv(t: unknown): string {
  return String(t ?? '').replace(/[\s-]/g, '').toUpperCase()
}

/**
 * El formato, ANTES de preguntar: la AEAT tiene un tope diario de intentos
 * fallidos, y un CSV mal pegado gastaría uno.
 */
export const csvValido = (csv: string): boolean => /^[A-Z0-9]{16}$/.test(csv)

const esPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 // %PDF

/** Lo que dice una página de Hacienda cuando no tiene ese CSV. */
const NO_ENCONTRADO = /no se ha podido recuperar|no existe ning[uú]n documento|no se ha encontrado|c[oó]digo seguro de verificaci[oó]n (incorrecto|err[oó]neo)|csv (incorrecto|err[oó]neo|no v[aá]lido)/i

/** Qué ha pasado, de lo que contestó. */
export function clasificar(r: Respuesta | null): Traido {
  if (!r) return { ok: false, motivo: 'no_responde', mensaje: MENSAJES.no_responde }
  if (r.status === 200 && esPdf(r.cuerpo)) return { ok: true, pdf: r.cuerpo }
  if (r.status === 404) return { ok: false, motivo: 'no_encontrado', mensaje: MENSAJES.no_encontrado }
  if (r.status === 200 && /html|text/i.test(r.tipo)) {
    // La Sede sirve unas páginas en ISO-8859-1 y otras en UTF-8: se mira con las dos.
    const textos = [new TextDecoder('utf-8').decode(r.cuerpo), new TextDecoder('latin1').decode(r.cuerpo)]
    if (textos.some((t) => NO_ENCONTRADO.test(t))) return { ok: false, motivo: 'no_encontrado', mensaje: MENSAJES.no_encontrado }
  }
  // Una página que no es el PDF ni dice «no está», un 5xx, una redirección…: no se sabe; no se guarda.
  return { ok: false, motivo: 'no_responde', mensaje: MENSAJES.no_responde }
}

/**
 * Trae el justificante: comprueba el formato (sin llamar si no vale) y hace UNA
 * petición, sin reintentos. `pedir` no lanza: si no hay respuesta, null.
 */
export async function traerPorCsv(csvPegado: unknown, pedir: (csv: string) => Promise<Respuesta | null>): Promise<Traido> {
  const csv = limpiarCsv(csvPegado)
  if (!csvValido(csv)) return { ok: false, motivo: 'formato', mensaje: MENSAJES.formato }
  let r: Respuesta | null
  try { r = await pedir(csv) } catch { r = null }
  return clasificar(r)
}

/** El PDF en base64, para devolverlo en JSON (unos cientos de KB). */
export function enBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
