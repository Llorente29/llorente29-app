// src/modules/conta/plan/leerFicheros.ts
//
// C02c · Abrir en el navegador los ficheros que trae la persona. Nada sale del
// dispositivo: se leen aquí y solo se guardan las filas leídas (encargo §4.1 y
// respuesta 1.4: nada de mandar el fichero a un modelo).
//
//   · Excel (.xlsx, .xls) y CSV (.csv, .txt) → filas de texto (xlsx, la misma
//     librería con la que Folvy ya lee y escribe Excel en otras pantallas).
//   · PDF de Cegid Diez (plan de cuentas, proveedores / acreedores, clientes /
//     deudores) → pdfjs-dist saca las celdas (celdasPdf.ts) y lectorDiez.ts las
//     lee por su posición. Determinista. pdfjs se carga solo cuando llega un PDF.
//
// La asignación de columnas de un Excel y el resto son del núcleo (importarPlan.ts).

import * as XLSX from 'xlsx'
import { partirCsv, type Programa } from '@/modules/conta/lib/importarPlan'
import { leerPdfDiez, PdfNoReconocido, type LecturaPdf } from '@/modules/conta/lib/lectorDiez'
import { celdasPdf, type PdfJs } from '@/modules/conta/lib/celdasPdf'

export interface FicheroAbierto {
  nombre: string
  clase: 'tabla' | 'pdf'
  /** Para la huella (sha-256): el fichero tal cual. */
  bytes: ArrayBuffer
  /** Las filas, si es una tabla (la primera hoja con datos, si es un Excel). */
  filas: string[][]
  /** Lo leído, si es un PDF de Diez. */
  pdf: LecturaPdf | null
}

const EXT = (n: string) => n.toLowerCase().split('.').pop() ?? ''
export const ACEPTA = '.pdf,.csv,.txt,.xlsx,.xls'

export class FicheroNoValido extends Error {}

// El build «legacy» de pdfjs: el normal pide un navegador muy reciente, y quien
// trae su plan puede venir de un ordenador de oficina con años.
let cargado: Promise<PdfJs> | null = null
export function pdfjs(): Promise<PdfJs> {
  cargado ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([m, w]) => {
    m.GlobalWorkerOptions.workerSrc = w.default
    return m as unknown as PdfJs
  }).catch((e: unknown) => { cargado = null; throw e })
  return cargado
}

export async function abrir(f: File, programa: Programa): Promise<FicheroAbierto> {
  const ext = EXT(f.name)
  const bytes = await f.arrayBuffer()
  if (ext === 'pdf') {
    if (programa !== 'diez') throw new FicheroNoValido('De este programa Folvy lee Excel o CSV, no PDF: expórtalo a Excel y suéltalo aquí.')
    let paginas
    try {
      paginas = await celdasPdf(await pdfjs(), bytes)
    } catch (e) {
      throw new FicheroNoValido(`No he podido abrir «${f.name}» como PDF (${e instanceof Error ? e.message : String(e)}). Si en Diez lo puedes sacar a Excel, suéltalo así.`)
    }
    try {
      return { nombre: f.name, clase: 'pdf', bytes, filas: [], pdf: leerPdfDiez(paginas, f.name) }
    } catch (e) {
      if (e instanceof PdfNoReconocido) throw new FicheroNoValido(e.message)
      throw e
    }
  }
  if (ext === 'csv' || ext === 'txt') {
    // Diez y Contasol exportan en Windows-1252 a menudo: si no es UTF-8 válido, se lee como tal.
    let texto: string
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { texto = new TextDecoder('windows-1252').decode(bytes) }
    return { nombre: f.name, clase: 'tabla', bytes, filas: partirCsv(texto), pdf: null }
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(bytes, { type: 'array' })
    for (const hoja of wb.SheetNames) {
      const filas = (XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: false, defval: '', blankrows: false }) as unknown[][])
        .map((r) => r.map((c) => String(c ?? '')))
        .filter((r) => r.some((c) => c.trim() !== ''))
      if (filas.length) return { nombre: f.name, clase: 'tabla', bytes, filas, pdf: null }
    }
    throw new FicheroNoValido(`«${f.name}» no tiene ninguna hoja con datos.`)
  }
  throw new FicheroNoValido(`«${f.name}» no es un fichero que Folvy sepa leer: esperaba un PDF de Diez, un Excel (.xlsx, .xls) o un CSV.`)
}
