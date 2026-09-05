// src/lib/descargaXlsx.ts
//
// LA DESCARGA XLSX, hermana de `descargaCsv.ts`.
//
// POR QUE NACE. `import * as XLSX` estaba copiado en CINCO ficheros, cada uno
// con su propio formato de salida. Eso no es un problema hoy —cada pantalla
// funciona— pero es el sexto camino esperando a nacer, y el día que alguien
// arregle el ancho de columna en uno, los otros cuatro seguirán como estaban.
//
// ⚠️ Y AQUI NO SE MIGRAN LAS CINCO. Cambiar cinco pantallas que hoy funcionan
// exige capturas antes/después de las cinco —la misma condición que se le puso
// a la unificación de `KpiCard`— y esas capturas no se pueden hacer sin sesión
// en la app. Así que este fichero nace SOLO para el generador de informes: al
// no tocar ninguna pantalla existente, no hay antes/después que comparar porque
// no hay riesgo que correr. Las cinco migran cuando alguien pueda mirarlas.
//
// Mismo contrato que `descargaCsv`: devuelve false si no había nada, y NO baja
// un fichero vacío. Un libro con solo cabecera se abre, no dice nada y parece
// que el dato no existe.

import * as XLSX from 'xlsx'

/** true si hay algo que descargar. false = no se ha creado ningún fichero. */
export function descargaXlsx(
  rows: Record<string, unknown>[],
  nombreFichero: string,
  nombreHoja = 'Informe',
): boolean {
  if (!rows.length) return false

  const hoja = XLSX.utils.json_to_sheet(rows)

  // Ancho de columna por el contenido más largo, cabecera incluida. Sin esto,
  // Excel enseña «####» en cualquier importe y hay que ir columna por columna:
  // un fichero que hay que arreglar antes de leerlo no está terminado.
  const cols = Object.keys(rows[0])
  hoja['!cols'] = cols.map((c) => {
    const largo = Math.max(
      c.length,
      ...rows.map((r) => String(r[c] ?? '').length),
    )
    return { wch: Math.min(Math.max(largo + 2, 10), 40) }
  })

  const libro = XLSX.utils.book_new()
  // El nombre de hoja de Excel admite 31 caracteres y ni : \ / ? * [ ].
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja.replace(/[:\\/?*[\]]/g, '-').slice(0, 31))
  XLSX.writeFile(libro, nombreFichero)
  return true
}

/** «folvy-ventas-semana-2026-09-06.xlsx» */
export function nombreXlsxConFecha(base: string, ymd: string): string {
  return `folvy-${base}-${ymd}.xlsx`
}
