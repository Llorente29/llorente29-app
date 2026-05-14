// src/pages/TiposTurnoPage.tsx
// Edición de tipos de turno: crear, editar, desactivar, borrar.
import { useState, useEffect } from 'react'
import { ArrowLeft, Trash2, Lightbulb } from 'lucide-react'
import { Card, Button } from '../components/ui'
import {
  fetchAllShiftTypes, upsertShiftType, setShiftTypeActive, deleteShiftType,
  type ShiftType,
} from '../services/calendarService'

interface Props {
  onBack: () => void
}

const PRESET_COLORS = [
  '#1E3A5F', '#F39C2A', '#7C1A1A', '#1F2937', '#9333EA',
  '#0EA5E9', '#10B981', '#EC4899', '#9CA3AF',
]

export default function TiposTurnoPage({ onBack }: Props) {
  const [types, setTypes] = useState<ShiftType[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ShiftType | 'new' | null>(null)

  async function load() {
    setLoading(true)
    const t = await fetchAllShiftTypes()
    setTypes(t)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleToggleActive(t: ShiftType) {
    if (t.isOff) return   // no se puede desactivar LIBRE
    await setShiftTypeActive(t.id, !t.active)
    await load()
  }

  async function handleDelete(t: ShiftType) {
    if (t.isOff) {
      alert('El tipo LIBRE no se puede borrar.')
      return
    }
    if (!confirm(`¿Eliminar el tipo "${t.code} ${t.label}"? Esto solo es posible si no tiene asignaciones en el calendario. Si tiene asignaciones, mejor desactívalo.`)) return
    const blocked = await deleteShiftType(t.id)
    if (blocked > 0) {
      alert(`No se puede borrar: hay ${blocked} asignaciones de calendario que usan este turno. Desactívalo en su lugar.`)
      return
    }
    if (blocked < 0) {
      alert('Error al borrar.')
      return
    }
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-base">
          <ArrowLeft size={14} /> Volver
        </button>
        <Button size="sm" onClick={() => setEditing('new')}>+ Nuevo tipo</Button>
      </div>

      <Card className="p-5">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-text-secondary">Tipos de turno</p>
          <h2 className="text-xl font-bold text-text-primary">Configuración de turnos</h2>
          <p className="text-xs text-text-secondary mt-1">
            Edita los horarios y nombres de cada tipo de turno. Los cambios afectan a TODAS las asignaciones del calendario que usen ese tipo.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-text-secondary">Cargando...</p>
        ) : (
          <div className="space-y-2">
            {types.map(t => (
              <div key={t.id} className={`p-3 rounded-xl border-2 flex items-center gap-3 ${
                t.active ? 'border-border-default' : 'border-border-default bg-page opacity-60'
              }`}>
                <span className="w-4 h-10 rounded shrink-0" style={{ backgroundColor: t.color }} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-text-primary">
                    {t.code} — {t.label}
                    {!t.active && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-page text-text-secondary font-medium">DESACTIVADO</span>}
                    {t.isOff && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-accent-bg text-accent font-medium">SISTEMA</span>}
                  </p>
                  {t.startTime && t.endTime ? (
                    <p className="text-xs text-text-secondary tabular-nums">
                      {t.startTime} – {t.endTime} <span className="text-text-secondary">({t.hours}h)</span>
                    </p>
                  ) : (
                    <p className="text-xs text-text-secondary italic">Sin horario (turno especial)</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!t.isOff && (
                    <button onClick={() => setEditing(t)}
                      className="text-xs px-3 py-1.5 rounded bg-accent-bg text-accent hover:bg-accent-bg font-medium">
                      Editar
                    </button>
                  )}
                  {!t.isOff && (
                    <button onClick={() => handleToggleActive(t)}
                      className={`text-xs px-3 py-1.5 rounded font-medium ${
                        t.active
                          ? 'bg-warning-bg text-warning hover:bg-warning-bg'
                          : 'bg-success-bg text-success hover:bg-success-bg'
                      }`}>
                      {t.active ? 'Desactivar' : 'Reactivar'}
                    </button>
                  )}
                  {!t.isOff && (
                    <button onClick={() => handleDelete(t)}
                      className="text-xs px-3 py-1.5 rounded bg-danger-bg text-danger hover:opacity-90 font-medium transition-base">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 bg-accent-bg border-accent/30">
        <p className="text-xs text-accent leading-relaxed inline-flex items-start gap-1.5">
          <Lightbulb size={14} className="shrink-0 mt-0.5" />
          <span><strong>Cambiar el horario de un turno</strong> afecta a todas las asignaciones existentes (futuras y pasadas) que apunten a ese turno. El histórico de fichajes reales no cambia. Si una franja debe coexistir con otra, mejor crea un turno nuevo.</span>
        </p>
      </Card>

      {editing && (
        <EditShiftTypeModal
          shift={editing === 'new' ? null : editing}
          onSave={async (form) => {
            await upsertShiftType({
              id: editing === 'new' ? undefined : editing.id,
              code: form.code,
              label: form.label,
              startTime: form.startTime || undefined,
              endTime: form.endTime || undefined,
              color: form.color,
              active: editing === 'new' ? true : (editing as ShiftType).active,
              displayOrder: editing === 'new' ? 5 : (editing as ShiftType).displayOrder,
            })
            setEditing(null)
            await load()
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

interface FormData {
  code: string
  label: string
  startTime: string
  endTime: string
  color: string
}

function EditShiftTypeModal({ shift, onSave, onClose }: {
  shift: ShiftType | null
  onSave: (form: FormData) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<FormData>({
    code: shift?.code || '',
    label: shift?.label || '',
    startTime: shift?.startTime || '',
    endTime: shift?.endTime || '',
    color: shift?.color || '#1E3A5F',
  })
  const [saving, setSaving] = useState(false)

  // Cálculo automático de horas
  const previewHours = (() => {
    if (!form.startTime || !form.endTime) return null
    const [sh, sm] = form.startTime.split(':').map(Number)
    const [eh, em] = form.endTime.split(':').map(Number)
    const start = sh * 60 + sm
    let end = eh * 60 + em
    if (end <= start) end += 24 * 60
    return ((end - start) / 60).toFixed(2)
  })()

  async function handleSubmit() {
    if (!form.code.trim() || !form.label.trim()) {
      alert('Código y etiqueta son obligatorios')
      return
    }
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
        <p className="text-xs text-text-secondary uppercase tracking-wide">{shift ? 'Editar' : 'Nuevo'}</p>
        <p className="font-bold text-lg text-text-primary mb-4">{shift ? `${shift.code} — ${shift.label}` : 'Nuevo tipo de turno'}</p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-secondary block mb-1">Código</label>
              <input value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="T1, T2, T3..."
                maxLength={10}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-sm font-bold tabular-nums bg-card text-text-primary" />
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-1">Etiqueta</label>
              <input value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Mañana, Tarde..."
                className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-secondary block mb-1">Hora inicio</label>
              <input type="time" value={form.startTime}
                onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-1">Hora fin</label>
              <input type="time" value={form.endTime}
                onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
            </div>
          </div>

          {previewHours && (
            <p className="text-xs text-text-secondary">
              Duración calculada: <strong className="text-text-primary tabular-nums">{previewHours}h</strong>
              {form.endTime <= form.startTime && form.startTime && (
                <span className="ml-2 text-accent">(cruza medianoche)</span>
              )}
            </p>
          )}

          <div>
            <label className="text-xs text-text-secondary block mb-1">Color</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-8 h-8 rounded-lg border-2 ${form.color === c ? 'border-text-primary ring-2 ring-offset-1 ring-border-default' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
              <input type="color" value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                className="w-8 h-8 rounded-lg border border-border-default" />
            </div>
          </div>

          {/* Preview */}
          <div className="p-3 rounded-lg bg-page">
            <p className="text-xs text-text-secondary mb-2">Vista previa</p>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded font-bold text-white text-sm" style={{ backgroundColor: form.color }}>
                {form.code || '?'}
              </span>
              <div>
                <p className="font-medium text-text-primary text-sm">{form.label || '—'}</p>
                {form.startTime && form.endTime && (
                  <p className="text-xs text-text-secondary tabular-nums">{form.startTime} – {form.endTime}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving} className="flex-1">
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
