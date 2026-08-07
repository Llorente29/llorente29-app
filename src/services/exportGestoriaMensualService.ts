// src/services/exportGestoriaMensualService.ts
// F5.2 — Cierre de mes / export a gestoría. Envuelve export_gestoria_mensual
// (RPC, verificada en BBDD 07/08 — ver ENCARGO_CODE_F5_gestoria_y_pdf_jornada.md).
// Reemplaza el cálculo cliente-side que hacía InformesPage.tsx (recorriendo
// clockEntries en el navegador): misma fuente que Plantilla/Ficha, e incluye
// la columna `incidencias` que el cálculo anterior no podía dar (lo que
// impide cerrar el mes con confianza — nunca se oculta, es el punto del F5.2).

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export interface ExportGestoriaRow {
  empleado: string
  dni: string
  local: string
  diasTrabajados: number
  horasTrabajadas: number
  horasNocturnas: number
  diasVacaciones: number
  diasBaja: number
  diasFestivoTrabajado: number
  horasContratadas: number
  deltaHoras: number
  /** Texto crudo tal cual lo da la RPC (frases separadas por " · "), vacío = sin incidencias. */
  incidenciasRaw: string
  /** Mismo contenido, ya partido en frases individuales para pintar/agrupar. */
  incidencias: string[]
}

export async function fetchExportGestoriaMensual(
  accountId: string,
  from: string,
  to: string
): Promise<ExportGestoriaRow[]> {
  const { data, error } = await db().rpc('export_gestoria_mensual', {
    p_account: accountId,
    p_from: from,
    p_to: to,
  })
  if (error) {
    console.error('[exportGestoriaMensual] export_gestoria_mensual:', error)
    return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => {
    const raw: string = r.incidencias || ''
    return {
      empleado: (r.empleado || '').trim(),
      dni: r.dni || '',
      local: r.local || '',
      diasTrabajados: Number(r.dias_trabajados) || 0,
      horasTrabajadas: Number(r.horas_trabajadas) || 0,
      horasNocturnas: Number(r.horas_nocturnas) || 0,
      diasVacaciones: Number(r.dias_vacaciones) || 0,
      diasBaja: Number(r.dias_baja) || 0,
      diasFestivoTrabajado: Number(r.dias_festivo_trabajado) || 0,
      horasContratadas: Number(r.horas_contratadas) || 0,
      deltaHoras: Number(r.delta_horas) || 0,
      incidenciasRaw: raw,
      incidencias: raw ? raw.split('·').map(s => s.trim()).filter(Boolean) : [],
    }
  })
}

/* =====================================================
   CSV — mismo formato/convención (';' + BOM UTF-8) que el resto de exports
   de gestoría del proyecto (ver exportGestoriaService.ts).
   ===================================================== */

const CSV_HEADERS = [
  'Empleado', 'DNI', 'Local', 'Días trabajados', 'Horas trabajadas',
  'Horas nocturnas', 'Días vacaciones', 'Días baja', 'Días festivo trabajado',
  'Horas contratadas', 'Delta horas', 'Incidencias',
]

function formatNumberES(n: number, decimals = 2): string {
  return n.toFixed(decimals).replace('.', ',')
}

function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function buildCsvRow(r: ExportGestoriaRow): string {
  const cells = [
    r.empleado, r.dni, r.local,
    String(r.diasTrabajados),
    formatNumberES(r.horasTrabajadas),
    formatNumberES(r.horasNocturnas),
    String(r.diasVacaciones),
    String(r.diasBaja),
    String(r.diasFestivoTrabajado),
    formatNumberES(r.horasContratadas),
    formatNumberES(r.deltaHoras),
    r.incidencias.join(' · '),
  ]
  return cells.map(csvEscape).join(';')
}

export function downloadExportGestoriaCsv(rows: ExportGestoriaRow[], periodLabel: string): void {
  const headerLine = CSV_HEADERS.map(csvEscape).join(';')
  const dataLines = rows.map(buildCsvRow)
  const csvBody = [headerLine, ...dataLines].join('\r\n')
  const BOM = '﻿'
  const blob = new Blob([BOM + csvBody], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const periodSafe = periodLabel.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  const a = document.createElement('a')
  a.href = url
  a.download = `cierre-mes-gestoria_${periodSafe}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
