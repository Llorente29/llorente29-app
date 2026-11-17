// src/modules/conta/lib/traer/excel.ts
//
// N04 · Traer de ERP10: el Excel abierto CON EL TIPO DE CADA CELDA. Lo que ya lee
// los ficheros de Diez (plan/leerFicheros.ts) lo pasa todo a texto; aquí hace falta
// saber si «Serie» llegó como texto («2.18») o como número (2.18: «2.1» y «2.10» ya
// no se distinguen), y leer las fechas como fecha. Por eso no se reutiliza `abrir`:
// se usa la misma librería (xlsx) con el tipo de cada celda.
//
// Todo lo demás del módulo trabaja sobre FicheroExcel, sin la librería: las
// pruebas hacen variantes tocando celdas, sin escribir ningún Excel.

import * as XLSX from 'xlsx'
import { eurosExactos } from '@/modules/conta/lib/formato'

/** Una celda: texto, número, fecha (AAAA-MM-DD) o vacía. */
export type Celda = { t: 's'; v: string } | { t: 'n'; v: number } | { t: 'd'; v: string } | null

/** Una hoja: filas[0] es la fila 1 de Excel; cada fila, sus celdas desde la columna A. */
export interface Hoja { nombre: string; filas: Celda[][] }

/** Un fichero subido, ya abierto. */
export interface FicheroExcel { nombre: string; hojas: Hoja[] }

/** No se ha podido abrir como Excel (no es un Excel, o está roto). */
export class NoEsExcel extends Error {}

const dosCifras = (n: number) => String(n).padStart(2, '0')

/** Abre un .xlsx o .xls con el tipo de cada celda. Las fechas, como fecha (sin hora ni zona). */
export function abrirExcel(nombre: string, bytes: ArrayBuffer | Uint8Array): FicheroExcel {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  // Un .xlsx es un zip («PK»); un .xls, un documento de Office antiguo (D0 CF 11 E0). La librería
  // abre cualquier otra cosa como texto: sin esta mirada, una foto pasaría por un Excel vacío.
  const esZip = b[0] === 0x50 && b[1] === 0x4b
  const esXls = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0
  if (!esZip && !esXls) throw new NoEsExcel(`«${nombre}» no es un Excel: ERP10 saca los listados en Excel (.xlsx o .xls).`)
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(b, { type: 'array', cellDates: false, cellNF: true })
  } catch (e) {
    throw new NoEsExcel(`No he podido abrir «${nombre}» como Excel (${e instanceof Error ? e.message : String(e)}).`)
  }
  const hojas: Hoja[] = []
  for (const n of wb.SheetNames) {
    const ws = wb.Sheets[n]
    if (!ws || !ws['!ref']) { hojas.push({ nombre: n, filas: [] }); continue }
    const r = XLSX.utils.decode_range(ws['!ref'])
    const filas: Celda[][] = []
    for (let R = 0; R <= r.e.r; R++) {
      const fila: Celda[] = []
      for (let C = 0; C <= r.e.c; C++) {
        const c = ws[XLSX.utils.encode_cell({ r: R, c: C })] as XLSX.CellObject | undefined
        fila.push(deCelda(c))
      }
      while (fila.length && fila[fila.length - 1] === null) fila.pop()
      filas.push(fila)
    }
    hojas.push({ nombre: n, filas })
  }
  return { nombre, hojas }
}

function deCelda(c: XLSX.CellObject | undefined): Celda {
  if (!c || c.v === undefined || c.v === null || c.t === 'z' || c.t === 'e') return null
  if (c.t === 's') return c.v === '' ? null : { t: 's', v: String(c.v) }
  if (c.t === 'b') return { t: 's', v: c.v ? 'Sí' : 'No' }
  if (c.t === 'd' && c.v instanceof Date) {
    const d = c.v
    return { t: 'd', v: `${d.getUTCFullYear()}-${dosCifras(d.getUTCMonth() + 1)}-${dosCifras(d.getUTCDate())}` }
  }
  if (c.t === 'n' && typeof c.v === 'number') {
    const formato = typeof c.z === 'string' ? c.z : null
    if (formato && XLSX.SSF.is_date(formato)) {
      const p = XLSX.SSF.parse_date_code(c.v)
      if (p) return { t: 'd', v: `${p.y}-${dosCifras(p.m)}-${dosCifras(p.d)}` }
    }
    return { t: 'n', v: c.v }
  }
  return { t: 's', v: String(c.v) }
}

// ── Leer una celda ────────────────────────────────────────────────────────────────

/** El texto de una celda, limpio («» si está vacía). Un número sale como lo escribiría Excel. */
export function texto(c: Celda | undefined): string {
  if (!c) return ''
  if (c.t === 's') return c.v.replace(/\s+/g, ' ').trim()
  if (c.t === 'd') return c.v
  return String(c.v)
}

/** Céntimos enteros de un importe (los decimales de coma flotante, …0000001, se redondean). Null si no es un número. */
export function centimos(c: Celda | undefined): number | null {
  if (!c) return null
  if (c.t === 'n') return Math.round(c.v * 100)
  if (c.t === 's') {
    const s = c.v.trim().replace(/\./g, '').replace(',', '.')
    if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 100)
  }
  return null
}

/** Una fecha (AAAA-MM-DD) de una celda de fecha o de un texto «dd/mm/aaaa». Null si no lo es. */
export function fecha(c: Celda | undefined): string | null {
  if (!c) return null
  if (c.t === 'd') return c.v
  if (c.t === 's') {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(c.v.trim())
    if (m) return `${m[3]}-${dosCifras(Number(m[2]))}-${dosCifras(Number(m[1]))}`
  }
  return null
}

/** Una cuenta, como texto y con los números que traía (decisión 7 del N01: no se convierte nada). */
export function cuenta(c: Celda | undefined): string {
  return texto(c).replace(/\s/g, '')
}

/** Un importe en céntimos, como se lee en ERP10: «1.200,00». */
export const cifra = (cent: number): string => eurosExactos(cent / 100).replace(' €', '')

/** 2026-01-20 → 20/01/2026. */
export const fechaDeGente = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** El trimestre de una fecha: «1T 2026». */
export const trimestre = (iso: string): string => `${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}T ${iso.slice(0, 4)}`

/** «1 asiento», «2 asientos»; los miles con punto. */
export const cuantos = (n: number, uno: string, varios: string): string =>
  `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ${n === 1 ? uno : varios}`
