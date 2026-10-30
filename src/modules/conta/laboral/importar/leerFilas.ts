// src/modules/conta/laboral/importar/leerFilas.ts
//
// LAB2 · Tanda 2 del importador de Cegid (30/10/2026): las FILAS de las nueve
// hojas, tal cual, para guardarlas en lab_import_fila. Se leen en el navegador
// y van a la base por trozos (importarService.cargarFilas).
//
//   · Hojas «tabla»: cada fila es un objeto con las cabeceras de Cegid como
//     claves. Una cabecera repetida lleva « (2)», « (3)»… para no pisarse.
//   · Hojas «campo · valor» (Empresa y Convenio): cada fila es {campo, valor}.
//   · Las fechas, como AAAA-MM-DD; los números, como números; lo demás, como
//     texto sin espacios a los lados. Una celda vacía no se guarda.
//   · Una fila entera vacía no cuenta (igual que al contar en la tanda 1).
//   · Solo las nueve hojas esperadas: una pestaña que no se espera no se lee.

import * as XLSX from 'xlsx'
import { HOJAS_CEGID, normalizar } from './cegidCabeceras'

export type Valor = string | number | boolean
export type Fila = Record<string, Valor>

export interface HojaConFilas {
  /** El id de la hoja en la base (lab_import_fila.hoja). */
  id: string
  nombre: string
  filas: Fila[]
}

const dia = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Una celda, como se guarda; undefined si está vacía. */
export function valorDeCelda(c: unknown): Valor | undefined {
  if (c === null || c === undefined) return undefined
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? undefined : dia(c)
  if (typeof c === 'number') return Number.isFinite(c) ? c : undefined
  if (typeof c === 'boolean') return c
  const t = String(c).trim()
  return t === '' ? undefined : t
}

/** Las cabeceras de una hoja, con « (2)»… si alguna se repite. */
function clavesUnicas(cabecera: unknown[]): string[] {
  const vistas = new Map<string, number>()
  return cabecera.map((c, i) => {
    const base = String(c ?? '').trim() || `columna ${i + 1}`
    const n = (vistas.get(base) ?? 0) + 1
    vistas.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
}

/** Las filas de las nueve hojas de Cegid que trae el libro (las que no trae, no salen). */
export function filasDelLibro(libro: XLSX.WorkBook): HojaConFilas[] {
  const porNombre = new Map(libro.SheetNames.map((n) => [normalizar(n), n]))
  const out: HojaConFilas[] = []
  for (const h of HOJAS_CEGID) {
    const nombre = porNombre.get(normalizar(h.nombre))
    if (!nombre) continue
    const crudas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: true, defval: null, blankrows: false }) as unknown[][]
    if (h.clase === 'campo_valor') {
      const filas: Fila[] = []
      for (const r of crudas) {
        const campo = valorDeCelda(r[0])
        if (campo === undefined) continue
        const valor = valorDeCelda(r[1])
        filas.push(valor === undefined ? { campo: String(campo) } : { campo: String(campo), valor })
      }
      out.push({ id: h.id, nombre, filas })
      continue
    }
    const [cabecera = [], ...datos] = crudas
    const claves = clavesUnicas(cabecera)
    const filas: Fila[] = []
    for (const r of datos) {
      const f: Fila = {}
      claves.forEach((k, i) => { const v = valorDeCelda(r[i]); if (v !== undefined) f[k] = v })
      if (Object.keys(f).length) filas.push(f)
    }
    out.push({ id: h.id, nombre, filas })
  }
  return out
}

/** Lee el fichero (bytes de un .xlsx) y devuelve lo de filasDelLibro. */
export function leerFilas(bytes: ArrayBuffer | Uint8Array): HojaConFilas[] {
  return filasDelLibro(XLSX.read(bytes, { type: 'array', cellDates: true }))
}

/** Parte una lista en trozos de `tam`. */
export function enTrozos<T>(lista: readonly T[], tam: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < lista.length; i += tam) out.push(lista.slice(i, i + tam))
  return out
}

export interface ResultadoFilas {
  /** Hoja a hoja (por su id), lo que trae el fichero y lo que hay en la base después, contado allí. */
  hojas: Record<string, { esperadas: number; cargadas: number }>
  cargadas: number
  nuevas: number
  cambiadas: number
  quitadas: number
  completo: boolean
}

// Con punto de miles también en las de cuatro cifras («1.200»), como el resto de cifras del resumen.
const MILES = new Intl.NumberFormat('es-ES', { useGrouping: 'always' })
const num = (n: number) => MILES.format(n)

/** Lo que dice el botón al acabar (regla 8): con números, hoja a hoja. */
export function resumenFilas(r: ResultadoFilas): string {
  const nombre = new Map(HOJAS_CEGID.map((h) => [h.id, h.nombre]))
  const partes = HOJAS_CEGID.filter((h) => r.hojas[h.id]).map((h) => {
    const x = r.hojas[h.id]
    return x.cargadas === x.esperadas
      ? `${nombre.get(h.id)} ${num(x.cargadas)}`
      : `${nombre.get(h.id)} ${num(x.cargadas)} de ${num(x.esperadas)}`
  })
  const hojas = Object.keys(r.hojas).length
  const cabeza = r.completo
    ? `Cargadas ${num(r.cargadas)} filas de ${hojas} ${hojas === 1 ? 'hoja' : 'hojas'}`
    : `Faltan filas: hay ${num(r.cargadas)} cargadas y el fichero trae ${num(Object.values(r.hojas).reduce((n, x) => n + x.esperadas, 0))}`
  const cambios = [
    r.nuevas ? `${num(r.nuevas)} nuevas` : null,
    r.cambiadas ? `${num(r.cambiadas)} cambiadas` : null,
    r.quitadas ? `${num(r.quitadas)} quitadas porque ya no vienen` : null,
  ].filter(Boolean)
  return `${cabeza}: ${partes.join(' · ')}. ${cambios.length ? `${cambios.join(', ')}.` : 'Ninguna cambia: es lo mismo que ya estaba.'}`
}
