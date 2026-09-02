// src/lib/descargaCsv.ts
//
// LA DESCARGA CSV, EN UN SOLO SITIO.
//
// Estaba escrita dentro de `ShopHomePage.tsx` y funcionaba bien: separador `;`
// —que es lo que Excel en español espera—, comillas escapadas y BOM al
// principio para que los acentos no salgan rotos. Se saca tal cual, no se
// reescribe: es la Regla 10 en su versión buena, reusar lo que ya está probado
// en producción en vez de inventar un segundo formato que se comporte distinto.
//
// EL BOM ES LO QUE MÁS SE OLVIDA. Sin él, Excel abre «Alcalá» como «AlcalÃ¡», y
// el informe se ve mal justo en el sitio donde alguien lo va a mirar.

/** true si hay algo que descargar. false = no se ha creado ningún fichero. */
export function descargaCsv(rows: Record<string, unknown>[], nombreFichero: string): boolean {
  // Sin filas NO se descarga un fichero vacío: un CSV con solo cabecera se abre,
  // no dice nada y parece que el dato no existe. Quien llama decide qué contar.
  if (!rows.length) return false
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreFichero
  a.click()
  URL.revokeObjectURL(url)
  return true
}

/** «folvy-ventas-semana-2026-09-02.csv» */
export function nombreConFecha(base: string, ymd: string): string {
  return `folvy-${base}-${ymd}.csv`
}
