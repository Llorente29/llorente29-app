// src/modules/conta/lib/traspasoExcelLibro.ts
//
// B01r26 · El fichero .xlsx de cada Excel del traspaso, en el navegador, de las
// filas que da conta-diez-traspaso (acción «excel»). Sin fila de títulos (Diez la
// leería como una factura más; C0009, 24/10) y las fechas como fechas
// (dd/mm/aaaa), como en la prueba del C12 que entró en la C0009.

/** Las fechas llegan en texto ISO a mediodía UTC (diezExcel.fecha): vuelven a ser fechas. */
const ES_FECHA = /^\d{4}-\d{2}-\d{2}T12:00:00(\.000)?Z$/
export const conFechas = (filas: readonly (string | number)[][]): (string | number | Date)[][] =>
  filas.map((f) => f.map((x) => (typeof x === 'string' && ES_FECHA.test(x) ? new Date(x) : x)))

/** El libro, en bytes. `xlsx` se carga solo al descargar. */
export async function libroXlsx(filas: readonly (string | number)[][], hoja: string): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(conFechas(filas), { cellDates: true })
  for (const k of Object.keys(ws)) {
    const c = ws[k] as { t?: string; z?: string } | undefined
    if (c?.t === 'd') c.z = 'dd/mm/yyyy'
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, hoja)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer
}

export function bajarXlsx(bytes: ArrayBuffer, fichero: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url; a.download = fichero
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
