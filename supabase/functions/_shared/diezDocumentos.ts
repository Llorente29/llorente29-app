// supabase/functions/_shared/diezDocumentos.ts
//
// C04b · T3 · Los documentos que exporta Diez («libro de requerimientos con
// descarga de documentos»). Núcleo puro: sin red y sin base.
//
// Medido con septiembre de 2026 (12/10, T2 §7):
//   · cada PDF se llama  C0008_F<ejercicio>_<serie>_<documento>.PDF
//   · el Excel lo nombra C0008_CON_<libro>_<RECIBIDA|EXPEDIDA>_<ejercicio>_<serie>_<documento>.pdf
//     en la columna «Registro gestión documental»;
//   · los dos dan la clave del asiento de Diez (ejercicio, serie, documento):
//     838 de 838 recibidas y 248 de 248 expedidas casan, sin adivinar nada;
//   · algunos ficheros llegan con las CABECERAS HTTP de la descarga delante del
//     PDF (content-length, date, etag, content-type…). Se quitan, comprobando
//     que content-length cuadra con lo que queda y que acaba en %%EOF; si no
//     cuadra, el documento va a «revisar» con el porqué, no se arregla a ojo.

export type ClaveDiez = { base: string; ejercicio: string; serie: string; documento: number }

const RE_FICHERO = /^(C\d{4})_F(\d{4})_(\d{1,5})_(\d+)\.pdf$/i
const RE_EXCEL = /^(C\d{4})_CON_(\d{3})_(RECIBIDA|EXPEDIDA)_(\d{4})_(\d{1,5})_(\d+)\.pdf$/i

/** La clave del asiento a partir del nombre del PDF, o null si no tiene esa forma. */
export function claveDeFichero(nombre: string): ClaveDiez | null {
  const m = RE_FICHERO.exec(String(nombre ?? '').trim())
  return m ? { base: m[1].toUpperCase(), ejercicio: m[2], serie: m[3], documento: Number(m[4]) } : null
}

/** La clave del asiento a partir del código «Registro gestión documental» del Excel. */
export function claveDeCodigoExcel(codigo: string): (ClaveDiez & { libro: 'recibida' | 'expedida' }) | null {
  const m = RE_EXCEL.exec(String(codigo ?? '').trim())
  if (!m) return null
  return { base: m[1].toUpperCase(), ejercicio: m[4], serie: m[5], documento: Number(m[6]), libro: m[3].toUpperCase() === 'RECIBIDA' ? 'recibida' : 'expedida' }
}

export const textoClave = (k: ClaveDiez) => `${k.base}/${k.ejercicio}/${k.serie}/${k.documento}`

export type PdfLimpio =
  | { ok: true; pdf: Uint8Array; cabeceraQuitada: boolean; cabeceras: string[] }
  | { ok: false; motivo: string }

const PDF = [0x25, 0x50, 0x44, 0x46] // %PDF
const indiceDe = (b: Uint8Array, p: number[], hasta: number) => {
  for (let i = 0; i <= Math.min(b.length - p.length, hasta); i++) if (p.every((x, j) => b[i + j] === x)) return i
  return -1
}
const acabaEnEof = (b: Uint8Array) => {
  let fin = b.length
  while (fin > 0 && (b[fin - 1] === 0x0a || b[fin - 1] === 0x0d || b[fin - 1] === 0x20 || b[fin - 1] === 0x00)) fin--
  const eof = [0x25, 0x25, 0x45, 0x4f, 0x46] // %%EOF
  return fin >= eof.length && eof.every((x, j) => b[fin - eof.length + j] === x)
}

/**
 * El PDF tal cual, o sin las cabeceras HTTP que Diez deja delante a veces.
 * Nunca «arregla» más que eso: lo que no sea exactamente cabeceras + PDF
 * completo se rechaza con su porqué.
 */
export function limpiarPdf(bytes: Uint8Array): PdfLimpio {
  if (bytes.length === 0) return { ok: false, motivo: 'fichero vacío' }
  const i = indiceDe(bytes, PDF, 4096)
  if (i < 0) return { ok: false, motivo: 'no es un PDF: no aparece %PDF al principio' }
  const pdf = bytes.subarray(i)
  if (!acabaEnEof(pdf)) return { ok: false, motivo: 'PDF incompleto: no acaba en %%EOF' }
  if (i === 0) return { ok: true, pdf, cabeceraQuitada: false, cabeceras: [] }

  const cabecera = new TextDecoder('latin1').decode(bytes.subarray(0, i))
  const lineas = cabecera.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lineas.length || !lineas.every((l) => /^[A-Za-z][A-Za-z0-9-]*:\s?.*$/.test(l))) {
    return { ok: false, motivo: 'hay algo delante del PDF que no son cabeceras HTTP' }
  }
  const campos = Object.fromEntries(lineas.map((l) => { const k = l.indexOf(':'); return [l.slice(0, k).trim().toLowerCase(), l.slice(k + 1).trim()] }))
  if (campos['content-type'] && !/application\/pdf/i.test(campos['content-type'])) {
    return { ok: false, motivo: `las cabeceras dicen ${campos['content-type']}, no un PDF` }
  }
  if (campos['content-length'] != null && Number(campos['content-length']) !== pdf.length) {
    return { ok: false, motivo: `las cabeceras dicen ${campos['content-length']} bytes y el PDF tiene ${pdf.length}` }
  }
  return { ok: true, pdf, cabeceraQuitada: true, cabeceras: Object.keys(campos) }
}

export type CruceDocumentos = {
  enlazados: { clave: string; fichero: string }[]
  /** Códigos del Excel sin PDF en la carpeta. */
  sinFichero: string[]
  /** PDF sin código en el Excel. */
  sinCodigo: string[]
  /** Ficheros con un nombre que no es el de Diez. */
  nombreRaro: string[]
  /** El mismo nombre más de una vez (se queda uno si son el mismo contenido). */
  repetidos: string[]
}

/** Cruza los nombres de los PDF con los códigos del Excel, por la clave del asiento. */
export function cruzar(ficheros: string[], codigosExcel: string[]): CruceDocumentos {
  const porClave = new Map<string, string>()
  const nombreRaro: string[] = [], repetidos: string[] = []
  const vistos = new Set<string>()
  for (const f of ficheros) {
    if (vistos.has(f)) { repetidos.push(f); continue }
    vistos.add(f)
    const k = claveDeFichero(f)
    if (!k) { nombreRaro.push(f); continue }
    porClave.set(textoClave(k), f)
  }
  const enlazados: CruceDocumentos['enlazados'] = [], sinFichero: string[] = []
  const usadas = new Set<string>()
  for (const c of codigosExcel) {
    const k = claveDeCodigoExcel(c)
    if (!k) { sinFichero.push(c); continue }
    const t = textoClave(k)
    const f = porClave.get(t)
    if (f) { enlazados.push({ clave: t, fichero: f }); usadas.add(t) } else sinFichero.push(c)
  }
  const sinCodigo = [...porClave.entries()].filter(([t]) => !usadas.has(t)).map(([, f]) => f)
  return { enlazados, sinFichero, sinCodigo, nombreRaro, repetidos }
}
