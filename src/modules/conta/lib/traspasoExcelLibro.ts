// src/modules/conta/lib/traspasoExcelLibro.ts
//
// B01r26 · El fichero .xlsx de cada Excel del traspaso, en el navegador, de las
// filas que da conta-diez-traspaso (acción «excel»). Sin fila de títulos (Diez la
// leería como una factura más; C0009, 24/10) y las fechas como fechas
// (dd/mm/aaaa), como en la prueba del C12 que entró en la C0009.

/** Las fechas llegan en texto ISO a mediodía UTC (diezExcel.fecha). */
const ES_FECHA = /^(\d{4})-(\d{2})-(\d{2})T12:00:00(\.000)?Z$/
/**
 * B01r26 (ensayo del 14/11): Diez NO lee una fecha con hora («01/10/2026 14:00»);
 * sí la fecha sola en dd/mm/aaaa. Así que cada fecha va como el NÚMERO de día de
 * Excel, entero (sin fracción de hora), con formato dd/mm/yyyy.
 */
export function diaDeExcel(iso: string): number | null {
  const m = ES_FECHA.exec(iso)
  if (!m) return null
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86_400_000)
}

/**
 * El libro, en bytes: un xlsx estándar (B01r26, 14/11: Diez no leía bien las
 * celdas de texto en línea, `t="str"`): los textos en sharedStrings y las fechas
 * como día de Excel con formato dd/mm/yyyy. `xlsx` se carga solo al descargar.
 */
export async function libroXlsx(filas: readonly (string | number)[][], hoja: string): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(filas.map((f) => [...f]))
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue
    const c = ws[k] as { t?: string; v?: unknown; z?: string; w?: string }
    const dia = typeof c.v === 'string' ? diaDeExcel(c.v) : null
    if (dia !== null) { c.t = 'n'; c.v = dia; c.z = 'dd/mm/yyyy'; delete c.w }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, hoja)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx', bookSST: true }) as ArrayBuffer
}

export function bajarXlsx(bytes: ArrayBuffer, fichero: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url; a.download = fichero
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
