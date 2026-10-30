// src/modules/conta/laboral/importar/leerCabeceras.ts
//
// LAB1 · Lee del Excel de Cegid SOLO lo que hace falta para la tanda 1: el
// nombre de cada pestaña, sus cabeceras y cuántas filas de datos tiene. En las
// hojas «campo · valor» (Empresa y Convenio), los nombres de la columna A; la B
// (los valores) no sale de aquí. Todo pasa en el navegador: el fichero no se
// sube y ningún valor llega a la base.

import * as XLSX from 'xlsx'
import { HOJAS_CEGID, normalizar, type HojaLeida } from './cegidCabeceras'

const CAMPO_VALOR = new Set(HOJAS_CEGID.filter((h) => h.clase === 'campo_valor').map((h) => normalizar(h.nombre)))

const texto = (c: unknown) => String(c ?? '').trim()

/** Las cabeceras y el número de filas de cada pestaña del libro. */
export function cabecerasDelLibro(libro: XLSX.WorkBook): HojaLeida[] {
  return libro.SheetNames.map((nombre) => {
    const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: true, defval: '', blankrows: false }) as unknown[][]
    if (CAMPO_VALOR.has(normalizar(nombre))) {
      // Campo · valor: la columna A son los nombres; la B, los valores, que no se leen.
      const campos = filas.map((f) => texto(f[0])).filter((c) => c !== '')
      return { nombre, columnas: campos, filas: campos.length }
    }
    const [cabecera = [], ...datos] = filas
    const columnas = cabecera.map(texto)
    while (columnas.length && columnas[columnas.length - 1] === '') columnas.pop()
    return { nombre, columnas, filas: datos.filter((f) => f.some((c) => texto(c) !== '')).length }
  })
}

/** Lee el fichero (bytes de un .xlsx) y devuelve lo de cabecerasDelLibro. */
export function leerCabeceras(bytes: ArrayBuffer | Uint8Array): HojaLeida[] {
  return cabecerasDelLibro(XLSX.read(bytes, { type: 'array', cellDates: false }))
}

/** La huella del fichero, para reconocer el mismo fichero dos veces (md5 no está en el navegador: SHA-256). */
export async function huellaDelFichero(bytes: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
