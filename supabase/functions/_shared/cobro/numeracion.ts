// supabase/functions/_shared/cobro/numeracion.ts
//
// G05 · Tarea 2 (09/11/2026). EL NÚMERO DE LAS FACTURAS DE CADA EMISOR.
// Obligatorio seguir la numeración que hoy lleva Cegid, sin serie nueva
// (decisiones_qbo.md, 06/11 y 09/11): QBO numera «año/serie/número»
// (2026/1/2740, serie 1 «Facturas expedidas»), el número sigue dentro del año
// y Sumied continúa desde el último confirmado. En la demo, 2026/1/141 en
// adelante. Cada gestoría puede tener su formato: es una plantilla. Puro.
//
// La plantilla lleva {año} (cuatro cifras), {aa} (dos), {serie} y {número}
// (o {número:6} para rellenar con ceros hasta 6 cifras). La de partida de la
// V01 es «{serie}-{aa}/{número:6}»; la de QBO, «{año}/{serie}/{número}».
//
// Lo prueban tests/unit/modules/conta/gestoria/g05/numeracion.test.ts.

export const FORMATO_QBO = '{año}/{serie}/{número}'

export interface Numeracion {
  /** La plantilla del número. */
  formato: string
  serie: string
  /** El último número dado en ese año (el de Cegid el día del cambio); 0 si aún no hay ninguno. */
  ultimo: number
  anio: number
}

/** Las piezas que admite una plantilla; cualquier otra cosa entre llaves es un error. */
const PIEZA = /\{(año|aa|serie|número(?::(\d{1,2}))?)\}/g

/** Lo que está mal en una plantilla, en palabras; vacío si vale. */
export function fallosDelFormato(formato: string): string[] {
  const fallos: string[] = []
  if (!formato.includes('{número')) fallos.push('Falta el número: {número}')
  if (!formato.includes('{año}') && !formato.includes('{aa}')) fallos.push('Falta el año ({año} o {aa}): el número sigue dentro de cada año')
  const sobran = formato.replace(PIEZA, '').match(/\{[^}]*\}/g)
  if (sobran) fallos.push(`No sé qué es ${sobran.join(', ')}`)
  return fallos
}

/** El número de factura con su plantilla: «2026/1/141». */
export function numeroDeFactura(formato: string, anio: number, serie: string, numero: number): string {
  const f = fallosDelFormato(formato)
  if (f.length) throw new Error(`El formato del número no vale: ${f.join('; ')}.`)
  if (!Number.isInteger(numero) || numero < 1) throw new Error('El número de factura tiene que ser un entero mayor que cero.')
  return formato.replace(PIEZA, (_t, pieza: string, cifras?: string) => {
    if (pieza === 'año') return String(anio)
    if (pieza === 'aa') return String(anio).slice(-2)
    if (pieza === 'serie') return serie
    return cifras ? String(numero).padStart(Number(cifras), '0') : String(numero)
  })
}

/** El siguiente número de un emisor en un año: el último + 1; en un año nuevo, el 1. */
export function siguienteNumero(n: Numeracion, anio: number): { anio: number; numero: number; texto: string } {
  const numero = anio === n.anio ? n.ultimo + 1 : 1
  return { anio, numero, texto: numeroDeFactura(n.formato, anio, n.serie, numero) }
}

/**
 * Leer un número de Cegid escrito con la plantilla («2026/1/2740» → año 2026,
 * serie 1, número 2740), para poner el contador el día del cambio. Null si no encaja.
 */
export function leerNumero(formato: string, texto: string): { anio: number; serie: string; numero: number } | null {
  const partes: string[] = []
  const re = formato.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(año|aa|serie|número(?::\d{1,2})?)\\?\}/g, (_t, pieza: string) => {
    partes.push(pieza.startsWith('número') ? 'número' : pieza)
    return pieza === 'año' ? '(\\d{4})' : pieza === 'aa' ? '(\\d{2})' : pieza === 'serie' ? '([A-Z0-9-]+?)' : '(\\d+)'
  })
  const m = new RegExp(`^${re}$`).exec(texto.trim())
  if (!m) return null
  const de = (p: string) => m[partes.indexOf(p) + 1]
  const anio = partes.includes('año') ? Number(de('año')) : 2000 + Number(de('aa'))
  return { anio, serie: partes.includes('serie') ? de('serie') : '', numero: Number(de('número')) }
}
