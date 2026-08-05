// src/services/clockoutReminderExcelService.ts
// ENCARGO CODE — Exportación a Excel del informe de recordatorios de olvido de
// fichaje. Mismo patrón que trainingComplianceExcelService.ts: import DINÁMICO
// de xlsx (evita el warning de bundling que ya generó allergenComplianceExcelService.ts
// al importarlo estático).
//
// El anexo "Avisos" (una fila por aviso) es el documento de protección legal:
// demuestra cuándo y cuántas veces se avisó a cada persona.

import type { ReminderRow, ReminderDetailRow } from './clockoutReminderReportService'

const STATUS_LABEL: Record<string, string> = {
  queued: 'En cola', sent: 'Enviado', failed: 'Falló', skipped: 'Omitido',
}

export interface ClockoutReminderExcelData {
  account: { legalName: string | null; cif: string | null }
  generatedAtLabel: string
  generatedAtFilename: string
  summary: ReminderRow[]
  detailsByEmployee: { employeeId: string; employeeName: string; rows: ReminderDetailRow[] }[]
}

export async function generateClockoutReminderExcel(data: ClockoutReminderExcelData): Promise<{ filename: string }> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  // ── Hoja "Resumen" ──
  const infoRows: Record<string, string>[] = [
    { 'Campo': 'Cliente', 'Valor': data.account.legalName ?? '—' },
    { 'Campo': 'CIF', 'Valor': data.account.cif ?? '—' },
    { 'Campo': 'Generado', 'Valor': data.generatedAtLabel },
  ]
  const infoWs = XLSX.utils.json_to_sheet(infoRows, { header: ['Campo', 'Valor'] })
  infoWs['!cols'] = [{ wch: 20 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(wb, infoWs, 'Cliente')

  const summaryRows = data.summary.map(r => ({
    'Empleado': r.employeeName,
    'Total avisos': r.totalSent,
    'Este mes': r.thisMonth,
    'Esta semana': r.thisWeek,
    'Último aviso': r.lastAt ? new Date(r.lastAt).toLocaleString('es-ES') : '—',
    'Recordatorio activo': r.reminderActive ? 'Activado' : 'Renunció',
  }))
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows, {
    header: ['Empleado', 'Total avisos', 'Este mes', 'Esta semana', 'Último aviso', 'Recordatorio activo'],
  })
  summaryWs['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Resumen')

  // ── Hoja "Avisos" (anexo, un aviso por fila — el documento de protección legal) ──
  const detailRows = data.detailsByEmployee.flatMap(({ employeeName, rows }) =>
    rows.map((r: ReminderDetailRow) => ({
      'Empleado': employeeName,
      'Fecha detección': new Date(r.createdAt).toLocaleString('es-ES'),
      'Hora teórica de salida': r.scheduledEnd ?? '—',
      'Estado': STATUS_LABEL[r.status] ?? r.status,
      'Enviado': r.sentAt ? new Date(r.sentAt).toLocaleString('es-ES') : '—',
      'Motivo (si no se envió)': r.skipReason ?? r.error ?? '—',
      'Fichó tras el aviso': r.clockedOutAfter === null ? 'No aplica' : r.clockedOutAfter ? 'Sí' : 'No',
    })),
  )
  const detailWs = XLSX.utils.json_to_sheet(detailRows, {
    header: ['Empleado', 'Fecha detección', 'Hora teórica de salida', 'Estado', 'Enviado', 'Motivo (si no se envió)', 'Fichó tras el aviso'],
  })
  detailWs['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, detailWs, 'Avisos (anexo)')

  const filename = `recordatorios_fichaje_${data.generatedAtFilename}.xlsx`
  XLSX.writeFile(wb, filename)
  return { filename }
}
