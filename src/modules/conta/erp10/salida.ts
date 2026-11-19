// src/modules/conta/erp10/salida.ts
//
// X10c (19/11): armarSalida y lo puro de la salida a ERP10 viven en
// supabase/functions/_shared/erp10Salida.ts (el servidor arma con lo mismo); aquí se vuelve a
// exportar, y se queda lo que solo hace el navegador: los libros .xlsx y el zip de los PDF.

import { zipSync } from 'fflate'
import { FICHERO_ASIENTOS, FICHERO_DIAS, FICHERO_EXPEDIDAS, FICHERO_RECIBIDAS, FICHERO_SUBCUENTAS, huellaFila, libroErp10 } from '@/modules/conta/erp10/ficheros'
import type { Clase, Salida } from '../../../../supabase/functions/_shared/erp10Salida.ts'

export * from '../../../../supabase/functions/_shared/erp10Salida.ts'

/** Lo que se baja y se apunta: los libros (en el orden en que se importan), con su huella y la de cada fila. */
export async function prepararDescarga(x: Salida): Promise<{
  libros: { nombre: string; bytes: ArrayBuffer; filas: number; huella: string }[]
  partidas: { entry_id: string; clase: Clase; huella: string }[]
}> {
  const huellaBytes = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((v) => v.toString(16).padStart(2, '0')).join('')
  const libros: { nombre: string; bytes: ArrayBuffer; filas: number; huella: string }[] = []
  for (const [nombre, filas] of [
    [FICHERO_SUBCUENTAS, x.ficheros.subcuentas], [FICHERO_EXPEDIDAS, x.ficheros.expedidas.map((r) => r.fila)], [FICHERO_DIAS, x.ficheros.dias.map((r) => r.fila)],
    [FICHERO_RECIBIDAS, x.ficheros.recibidas.map((r) => r.fila)],
    [FICHERO_ASIENTOS, x.ficheros.asientos.flatMap((a) => a.filas)],
  ] as const) {
    if (!filas.length) continue
    const bytes = await libroErp10(filas)
    libros.push({ nombre, bytes, filas: filas.length, huella: await huellaBytes(bytes) })
  }
  const dias = new Set(x.ficheros.dias.map((d) => d.entryId))
  const partidas = await Promise.all([
    ...x.ficheros.expedidas.map(async (r) => ({ entry_id: r.entryId, clase: 'emitida' as const, huella: await huellaFila(r.fila) })),
    ...x.ficheros.recibidas.map(async (r) => ({ entry_id: r.entryId, clase: 'recibida' as const, huella: await huellaFila(r.fila) })),
    ...x.ficheros.asientos.filter((a) => !dias.has(a.entryId)).map(async (a) => ({ entry_id: a.entryId, clase: 'asiento' as const, huella: await huellaFila(a.filas.flat()) })),
    // X08 · Un día sale una vez, como emitida: la huella de su fila y la de su cobro.
    ...x.ficheros.dias.map(async (d) => ({
      entry_id: d.entryId, clase: 'emitida' as const,
      huella: await huellaFila([...d.fila, ...x.ficheros.asientos.filter((a) => a.entryId === d.entryId).flatMap((a) => a.filas.flat())]),
    })),
  ])
  return { libros, partidas }
}

/** El tope de cada fichero comprimido de PDF (encargo X04: si un mes pasa de 150 MB, en varios). */
export const TOPE_ZIP = 150 * 1024 * 1024

/** Reparte los PDF en ficheros comprimidos de como mucho `tope` bytes, en orden. Uno que pase del tope, solo. */
export function repartirPdfs<T extends { bytes: Uint8Array }>(pdfs: readonly T[], tope = TOPE_ZIP): T[][] {
  const grupos: T[][] = []
  let actual: T[] = []; let peso = 0
  for (const p of pdfs) {
    if (actual.length && peso + p.bytes.length > tope) { grupos.push(actual); actual = []; peso = 0 }
    actual.push(p); peso += p.bytes.length
  }
  if (actual.length) grupos.push(actual)
  return grupos
}

/** Los ficheros comprimidos: pdf.zip si es uno; pdf-1.zip, pdf-2.zip… si son varios. Los PDF ya van comprimidos: se guardan sin volver a comprimir. */
export function comprimirPdfs(pdfs: readonly { nombre: string; bytes: Uint8Array }[], tope = TOPE_ZIP): { nombre: string; bytes: Uint8Array; pdfs: number }[] {
  const grupos = repartirPdfs(pdfs, tope)
  return grupos.map((g, i) => ({
    nombre: grupos.length === 1 ? 'pdf.zip' : `pdf-${i + 1}.zip`,
    bytes: zipSync(Object.fromEntries(g.map((p) => [p.nombre, [p.bytes, { level: 0 }]]))),
    pdfs: g.length,
  }))
}
