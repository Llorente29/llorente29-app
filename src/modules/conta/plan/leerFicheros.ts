// src/modules/conta/plan/leerFicheros.ts
//
// C02c · Abrir en el navegador los ficheros que trae la persona. Nada sale del
// dispositivo: se leen aquí y solo se guardan las filas leídas (encargo §4.1 y
// respuesta 1.4: nada de mandar el fichero a un modelo).
//
//   · Excel (.xlsx, .xls) y CSV (.csv, .txt) → filas de texto (xlsx, la misma
//     librería con la que Folvy ya lee y escribe Excel en otras pantallas).
//   · PDF de Cegid Diez → su lector (pdfjs-dist, determinista) llega cuando se vea
//     la forma de los tres PDF (respuesta 1.4); hasta entonces se pide el Excel.
//
// La asignación de columnas y el resto son del núcleo (importarPlan.ts).

import * as XLSX from 'xlsx'
import { partirCsv } from '@/modules/conta/lib/importarPlan'

export interface FicheroAbierto {
  nombre: string
  clase: 'tabla' | 'pdf'
  /** Para la huella (sha-256): el fichero tal cual. */
  bytes: ArrayBuffer
  /** Las filas, si es una tabla (la primera hoja con datos, si es un Excel). */
  filas: string[][]
}

const EXT = (n: string) => n.toLowerCase().split('.').pop() ?? ''
export const ACEPTA = '.pdf,.csv,.txt,.xlsx,.xls'

export class FicheroNoValido extends Error {}

export async function abrir(f: File): Promise<FicheroAbierto> {
  const ext = EXT(f.name)
  const bytes = await f.arrayBuffer()
  if (ext === 'pdf') return { nombre: f.name, clase: 'pdf', bytes, filas: [] }
  if (ext === 'csv' || ext === 'txt') {
    // Diez y Contasol exportan en Windows-1252 a menudo: si no es UTF-8 válido, se lee como tal.
    let texto: string
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { texto = new TextDecoder('windows-1252').decode(bytes) }
    return { nombre: f.name, clase: 'tabla', bytes, filas: partirCsv(texto) }
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(bytes, { type: 'array' })
    for (const hoja of wb.SheetNames) {
      const filas = (XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: false, defval: '', blankrows: false }) as unknown[][])
        .map((r) => r.map((c) => String(c ?? '')))
        .filter((r) => r.some((c) => c.trim() !== ''))
      if (filas.length) return { nombre: f.name, clase: 'tabla', bytes, filas }
    }
    throw new FicheroNoValido(`«${f.name}» no tiene ninguna hoja con datos.`)
  }
  throw new FicheroNoValido(`«${f.name}» no es un fichero que Folvy sepa leer: esperaba un PDF de Diez, un Excel (.xlsx, .xls) o un CSV.`)
}
