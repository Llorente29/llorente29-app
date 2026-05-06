import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Card, Label, Input, Alert } from '../components/ui'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export default function InformesPage() {
  const { staff, notifConfig, setNotifConfig } = useApp()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [generating, setGenerating] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  const dateFrom = new Date(year, month - 1, 1).toISOString().slice(0, 10)
  const dateTo = new Date(year, month, 0).toISOString().slice(0, 10)

  const report = staff.map(e => {
    const entries = e.clockEntries.filter(c => c.datetime >= dateFrom && c.datetime <= dateTo + 'T23:59:59')
    let hours = 0
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === 'entrada' && entries[i - 1]?.type === 'salida') {
        hours += (new Date(entries[i - 1].datetime).getTime() - new Date(entries[i].datetime).getTime()) / 3600000
      }
    }
    const abs = e.vacations.filter(v => v.startDate >= dateFrom && v.startDate <= dateTo || v.endDate >= dateFrom && v.endDate <= dateTo)
    return {
      ...e,
      periodEntries: entries,
      totalHours: hours.toFixed(1),
      diasTrabajados: new Set(entries.map(c => c.datetime.slice(0, 10))).size,
      vacaciones: abs.filter(v => v.status === 'aprobada' && v.type === 'Vacaciones'),
      bajas: abs.filter(v => v.type === 'Baja médica'),
      permisos: abs.filter(v => v.type === 'Permiso' || v.type === 'Asuntos propios'),
    }
  })

  function downloadTxt() {
    setGenerating(true)
    setDownloaded(false)
    setTimeout(() => {
      const lines: string[] = [
        `INFORME DE PERSONAL - ${MESES[month - 1].toUpperCase()} ${year}`,
        '='.repeat(60),
        `Generado: ${new Date().toLocaleString('es-ES')}`,
        `Empleados: ${report.length}`,
        '',
      ]
      report.forEach(e => {
        lines.push(
          `EMPLEADO: ${e.name}`,
          '-'.repeat(40),
          `Puesto: ${e.position} | DNI: ${e.dni || '—'} | Contrato: ${e.contractType || '—'}`,
          `Salario bruto: ${e.salary ? e.salary.toLocaleString('es-ES') + ' EUR' : '—'}`,
          '',
          'RESUMEN PERIODO:',
          `  Dias trabajados: ${e.diasTrabajados}`,
          `  Horas totales: ${e.totalHours}h`,
          `  Fichajes: ${e.periodEntries.length}`,
          '',
          'AUSENCIAS:',
          `  Vacaciones: ${e.vacaciones.length} | Bajas: ${e.bajas.length} | Permisos: ${e.permisos.length}`,
          '',
          'FICHAJES:',
          ...e.periodEntries.map(c => `  ${new Date(c.datetime).toLocaleString('es-ES')} | ${c.type.toUpperCase()}${c.roundingApplied ? ' [redondeado]' : ''}`),
          '',
          '',
        )
      })

      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `informe_personal_${month}_${year}.txt`
      a.click()
      URL.revokeObjectURL(a.href)
      setGenerating(false)
      setDownloaded(true)
    }, 400)
  }

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Informes Gestoría</h1>
        <p className="text-sm text-gray-500 mt-0.5">Resumen mensual de personal para envío a gestoría</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: report */}
        <div className="lg:col-span-2 space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-50 rounded-2xl border">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Mes</label>
              <select value={month} onChange={e => setMonth(Number(e.target.value))}
                className="border rounded-lg px-3 py-1.5 text-sm bg-white">
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Año</label>
              <select value={year} onChange={e => setYear(Number(e.target.value))}
                className="border rounded-lg px-3 py-1.5 text-sm bg-white">
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {downloaded && <span className="text-xs text-emerald-600 font-medium">✅ Descargado</span>}
              <Button size="sm" onClick={downloadTxt} disabled={generating}>
                {generating ? '⏳ Generando...' : '📥 Descargar TXT'}
              </Button>
            </div>
          </div>

          {/* Table */}
          <Card>
            <div className="p-4 border-b bg-gray-50 rounded-t-2xl">
              <h3 className="font-semibold text-sm">{MESES[month - 1]} {year} — Resumen</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50">
                  <th className="p-3 text-left text-xs font-semibold text-gray-500">Empleado</th>
                  <th className="p-3 text-center text-xs font-semibold text-gray-500">Días trab.</th>
                  <th className="p-3 text-center text-xs font-semibold text-gray-500">Horas</th>
                  <th className="p-3 text-center text-xs font-semibold text-gray-500">Vacac.</th>
                  <th className="p-3 text-center text-xs font-semibold text-gray-500">Bajas</th>
                  <th className="p-3 text-center text-xs font-semibold text-gray-500">Permisos</th>
                </tr></thead>
                <tbody>
                  {report.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-gray-400 text-sm">Sin empleados registrados</td></tr>
                  ) : report.map(e => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-3">
                        <p className="font-medium">{e.name}</p>
                        <p className="text-xs text-gray-500">{e.position}</p>
                      </td>
                      <td className="p-3 text-center">{e.diasTrabajados}</td>
                      <td className="p-3 text-center font-medium">{e.totalHours}h</td>
                      <td className="p-3 text-center">
                        {e.vacaciones.length > 0
                          ? <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{e.vacaciones.length}</span>
                          : '-'}
                      </td>
                      <td className="p-3 text-center">
                        {e.bajas.length > 0
                          ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{e.bajas.length}</span>
                          : '-'}
                      </td>
                      <td className="p-3 text-center">
                        {e.permisos.length > 0
                          ? <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{e.permisos.length}</span>
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Right: config */}
        <Card className="p-4 space-y-4 h-fit">
          <div>
            <h3 className="font-semibold text-sm">⚙️ Configuración gestoría</h3>
            <p className="text-xs text-gray-500 mt-0.5">Envío automático el día {notifConfig.gestoriaDayOfMonth} de cada mes</p>
          </div>
          <div className="space-y-3">
            <div>
              <Label>Nombre gestoría</Label>
              <Input className="mt-1" value={notifConfig.gestoriaNombre || ''} onChange={e => setNotifConfig(p => ({ ...p, gestoriaNombre: e.target.value }))} placeholder="Gestoría López S.L." />
            </div>
            <div>
              <Label>Email gestoría</Label>
              <Input className="mt-1" type="email" value={notifConfig.gestoriaEmail || ''} onChange={e => setNotifConfig(p => ({ ...p, gestoriaEmail: e.target.value }))} placeholder="gestoria@ejemplo.com" />
            </div>
            <div>
              <Label>Día de envío</Label>
              <Input className="mt-1" type="number" min={1} max={28} value={notifConfig.gestoriaDayOfMonth || 25} onChange={e => setNotifConfig(p => ({ ...p, gestoriaDayOfMonth: parseInt(e.target.value) || 25 }))} />
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border">
              <input
                type="checkbox"
                id="gest-on"
                checked={notifConfig.gestoriaEnabled || false}
                onChange={e => setNotifConfig(p => ({ ...p, gestoriaEnabled: e.target.checked }))}
              />
              <label htmlFor="gest-on" className="text-sm cursor-pointer">
                Activar envío automático el día {notifConfig.gestoriaDayOfMonth || 25}
              </label>
            </div>
            <Alert type="warning">
              El envío automático requiere integración SMTP/EmailJS. Por ahora el informe se descarga en TXT listo para adjuntar.
            </Alert>
          </div>
          <div className="pt-2 border-t text-xs text-gray-400">
            {notifConfig.gestoriaEnabled ? '✅ Envío automático activo' : '⚪ Desactivado'} · Último envío: {notifConfig.gestoriaLastSent ? new Date(notifConfig.gestoriaLastSent).toLocaleDateString('es-ES') : 'Nunca'}
          </div>
        </Card>
      </div>
    </div>
  )
}
