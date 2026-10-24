// supabase/functions/_shared/diezTexto.ts
//
// D07a · Los textos que se mandan a Diez caben en 40 caracteres. Diez rechaza
// una factura con `factura.Descripcion` de más de 40 («debe ser un texto de
// 40 como máximo»): pasó con RIDERS ES I 34427 26 00014 (asiento 3248), cuyo
// «<número>-<nombre del proveedor>» tenía más. El mismo límite para todo lo que
// se manda: la descripción y los conceptos de facturas, asientos y subcuentas.
// Núcleo puro: sin red ni base.

export const MAX_TEXTO_DIEZ = 40

/** El texto, en una línea y sin espacios de más, recortado a lo que admite Diez. */
export function textoDiez(x: unknown, max = MAX_TEXTO_DIEZ): string {
  return String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trimEnd()
}

/**
 * La descripción de una recibida, «<número>-<nombre del proveedor>», en 40: el
 * número va entero (por él se busca la factura); el nombre se recorta. Si el
 * número solo ya pasa de 40, sus 40 primeros.
 */
export function descripcionRecibida(numero: string, nombre: string, max = MAX_TEXTO_DIEZ): string {
  const n = textoDiez(numero, Number.MAX_SAFE_INTEGER)
  if (n.length >= max) return n.slice(0, max)
  return textoDiez(`${n}-${textoDiez(nombre, Number.MAX_SAFE_INTEGER)}`, max)
}

type ConTextos = {
  Descripcion?: unknown
  Apuntes?: { Concepto?: unknown }[]
  Analitica?: { Descripcion?: unknown }[]
  Detalles?: { Descripcion?: unknown }[]
}

/** Una copia con cada texto que lee Diez (Descripcion, y Concepto o Descripcion de sus líneas) en 40. */
export function conTextosDiez<T extends object>(entrada: T): T {
  const x = entrada as ConTextos
  const fuera = { ...entrada } as T & ConTextos
  if (x.Descripcion !== undefined) fuera.Descripcion = textoDiez(x.Descripcion)
  if (Array.isArray(x.Apuntes)) fuera.Apuntes = x.Apuntes.map((a) => (a.Concepto === undefined ? a : { ...a, Concepto: textoDiez(a.Concepto) }))
  if (Array.isArray(x.Analitica)) fuera.Analitica = x.Analitica.map((a) => (a.Descripcion === undefined ? a : { ...a, Descripcion: textoDiez(a.Descripcion) }))
  if (Array.isArray(x.Detalles)) fuera.Detalles = x.Detalles.map((a) => (a.Descripcion === undefined ? a : { ...a, Descripcion: textoDiez(a.Descripcion) }))
  return fuera
}
