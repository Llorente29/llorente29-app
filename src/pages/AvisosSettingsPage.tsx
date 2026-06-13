// src/pages/AvisosSettingsPage.tsx
// Configuración global de avisos y settings de Personal.
import { useState, useEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Card, Button } from '../components/ui'
import { fetchAppSettings, updateAppSettings, type AppSettings } from '../services/appSettingsService'

export default function AvisosSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // Estado local del formulario
  const [showHourBank, setShowHourBank] = useState(false)
  const [tolerance, setTolerance] = useState(8)
  const [lateAlert, setLateAlert] = useState(15)
  const [forgotMin, setForgotMin] = useState(30)

  useEffect(() => {
    fetchAppSettings().then(s => {
      setSettings(s)
      setShowHourBank(s.showHourBankToEmployee)
      setTolerance(s.roundingToleranceMin)
      setLateAlert(s.lateAlertMin)
      setForgotMin(s.forgotClockoutMin)
      setLoading(false)
    })
  }, [])

  async function save() {
    setSaving(true)
    const ok = await updateAppSettings({
      showHourBankToEmployee: showHourBank,
      roundingToleranceMin: tolerance,
      lateAlertMin: lateAlert,
      forgotClockoutMin: forgotMin,
    })
    setSaving(false)
    if (ok) {
      setSavedAt(new Date())
      setTimeout(() => setSavedAt(null), 3000)
    }
  }

  const isDirty = settings && (
    settings.showHourBankToEmployee !== showHourBank ||
    settings.roundingToleranceMin !== tolerance ||
    settings.lateAlertMin !== lateAlert ||
    settings.forgotClockoutMin !== forgotMin
  )

  if (loading) {
    return <Card className="p-6 text-center"><p className="text-sm text-text-secondary">Cargando...</p></Card>
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Personal: Bolsa de horas */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Personal</p>
        <h3 className="font-semibold text-text-primary mb-4">Bolsa de horas</h3>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={showHourBank}
            onChange={e => setShowHourBank(e.target.checked)}
            className="mt-1 w-4 h-4 accent-accent"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">Mostrar la bolsa de horas a los trabajadores</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Si activas esta opción, cada trabajador podrá ver su saldo de horas (semanal, mensual y acumulado) desde su móvil personal.
            </p>
          </div>
        </label>
      </Card>

      {/* Personal: Fichajes */}
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Fichajes</p>
        <h3 className="font-semibold text-text-primary mb-4">Tolerancia y alertas</h3>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">Tolerancia de redondeo (minutos)</label>
            <p className="text-xs text-text-secondary mb-2">
              Si el fichaje cae dentro de esta franja respecto al horario teórico, se redondea automáticamente. La hora real siempre se registra para auditoría.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number" min={0} max={60} value={tolerance}
                onChange={e => setTolerance(parseInt(e.target.value) || 0)}
                className="w-20 border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary"
              />
              <span className="text-xs text-text-secondary">min</span>
              <span className="text-xs text-text-secondary">(recomendado: 8)</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">Alerta por retraso</label>
            <p className="text-xs text-text-secondary mb-2">
              Tiempo desde la hora teórica de entrada para considerar que el empleado no ha fichado y mostrar alerta en "Ahora mismo".
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number" min={0} max={120} value={lateAlert}
                onChange={e => setLateAlert(parseInt(e.target.value) || 0)}
                className="w-20 border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary"
              />
              <span className="text-xs text-text-secondary">min</span>
              <span className="text-xs text-text-secondary">(recomendado: 15)</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">Alerta por olvido de salida</label>
            <p className="text-xs text-text-secondary mb-2">
              Tiempo desde la hora teórica de salida para suponer que el empleado olvidó fichar la salida.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number" min={0} max={240} value={forgotMin}
                onChange={e => setForgotMin(parseInt(e.target.value) || 0)}
                className="w-20 border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary"
              />
              <span className="text-xs text-text-secondary">min</span>
              <span className="text-xs text-text-secondary">(recomendado: 30)</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Notificaciones (placeholder) */}
      <Card className="p-5 opacity-60">
        <p className="text-xs uppercase tracking-wide text-text-secondary mb-3">Notificaciones</p>
        <h3 className="font-semibold text-text-primary mb-2">Push, Email y WhatsApp</h3>
        <p className="text-xs text-text-secondary">
          Próximamente. Las alertas push del navegador, emails automáticos y avisos por WhatsApp se configurarán aquí.
        </p>
      </Card>

      {/* Guardar */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-text-secondary inline-flex items-center gap-1">
          {savedAt
            ? <><CheckCircle2 size={12} className="text-success" /> Guardado a las {savedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</>
            : isDirty ? 'Cambios sin guardar' : ''}
        </p>
        <Button onClick={save} disabled={!isDirty || saving}>
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </div>
    </div>
  )
}
