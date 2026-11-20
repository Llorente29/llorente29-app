// src/modules/conta/erp10/ficheros.ts
//
// X10c (19/11): lo puro de la salida a ERP10 (las filas, las cuentas, cada recibida, emitida,
// asiento y día) vive en supabase/functions/_shared/erp10Ficheros.ts, para que el servidor
// arme lo que escribe en ERP10 desde la base con las mismas reglas que el Excel. Aquí se
// vuelve a exportar, y se queda lo que solo hace el navegador: el libro .xlsx.

import { libroXlsx } from '@/modules/conta/lib/traspasoExcelLibro'
import type { Fila } from '../../../../supabase/functions/_shared/erp10Ficheros.ts'

export * from '../../../../supabase/functions/_shared/erp10Ficheros.ts'

/**
 * El libro de un fichero: una hoja, sin títulos, con la misma función que la
 * salida a Diez (libroXlsx: textos en sharedStrings, fechas como día de Excel con
 * dd/mm/yyyy). Las celdas vacías no se escriben (en vez de un texto vacío).
 */
export async function libroErp10(filas: readonly Fila[]): Promise<ArrayBuffer> {
  const sinVacias = filas.map((f) => f.map((v) => (v === '' ? undefined : v)))
  return libroXlsx(sinVacias as unknown as (string | number)[][], 'Hoja1')
}

