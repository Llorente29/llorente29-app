// src/pages/TiposTurnoPage.tsx
// Edición de tipos de turno: crear, editar, desactivar, borrar.
import { useState, useEffect } from 'react'
import { Card, Button } from '../components/ui'
import {
  fetchAllShiftTypes, upsertShiftType, setShiftTypeActive, deleteShiftType,
  type ShiftType,
} from '../services/calendarService'

interface Props {
  onBack: () => void
}

const PRESET_COLORS = [
  '#F39C2A', '#7C1A1A', '#5A1212', '#1F2937', '#9333EA',
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
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">← Volver</button>
        <Button size="sm" onClick={() => setEditing('new')}>+ Nuevo tipo</Button>
      </div>

      <Card className="p-5">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Tipos de turno</p>
          <h2 className="text-xl font-bold text-gray-900">Configuración de turnos</h2>
          <p className="text-xs text-gray-500 mt-1">
            Edita los horarios y nombres de cada tipo de turno. Los cambios afectan a TODAS las asignaciones del calendario que usen ese tipo.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Cargando...</p>
        ) : (
          <div className="space-y-2">
            {types.map(t => (
              <div key={t.id} className={`p-3 rounded-xl border-2 flex items-center gap-3 ${
                t.active ? 'border-gray-200' : 'border-gray-100 bg-gray-50/50 opacity-60'
              }`}>
                <span className="w-4 h-10 rounded shrink-0" style={{ backgroundColor: t.color }} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900">
                    {t.code} — {t.label}
                    {!t.active && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 font-medium">DESACTIVADO</span>}
                    {t.isOff && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">SISTEMA</span>}
                  </p>
                  {t.startTime && t.endTime ? (
                    <p className="text-xs text-gray-500 tabular-nums">
                      {t.startTime} – {t.endTime} <span className="text-gray-400">({t.hours}h)</span>
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Sin horario (turno especial)</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!t.isOff && (
                    <button onClick={() => setEditing(t)}
                      className="text-xs px-3 py-1.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium">
                      Editar
                    </button>
                  )}
                  {!t.isOff && (
                    <button onClick={() => handleToggleActive(t)}
                      className={`text-xs px-3 py-1.5 rounded font-medium ${
                        t.active
                          ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}>
                      {t.active ? 'Desactivar' : 'Reactivar'}
                    </button>
                  )}
                  {!t.isOff && (
                    <button onClick={() => handleDelete(t)}
                      className="text-xs px-3 py-1.5 rounded bg-red-50 text-red-700 hover:bg-red-100 font-medium">
                      🗑
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 bg-blue-50 border-blue-200">
        <p className="text-xs text-blue-900 leading-relaxed">
          💡 <strong>Cambiar el horario de un turno</strong> afecta a todas las asignaciones existentes (futuras y pasadas) que apunten a ese turno. El histórico de fichajes reales no cambia. Si una franja debe coexistir con otra, mejor crea un turno nuevo.
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
    color: shift?.color || '#7C1A1A',
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
      <div className="bg-white rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
        <p className="text-xs text-gray-500 uppercase tracking-wide">{shift ? 'Editar' : 'Nuevo'}</p>
        <p className="font-bold text-lg text-gray-900 mb-4">{shift ? `${shift.code} — ${shift.label}` : 'Nuevo tipo de turno'}</p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Código</label>
              <input value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="T1, T2, T3..."
                maxLength={10}
                className="w-full border rounded-lg px-3 py-2 text-sm font-bold tabular-nums" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Etiqueta</label>
              <input value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Mañana, Tarde..."
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Hora inicio</label>
              <input type="time" value={form.startTime}
                onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Hora fin</label>
              <input type="time" value={form.endTime}
                onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {previewHours && (
            <p className="text-xs text-gray-500">
              Duración calculada: <strong className="text-gray-900 tabular-nums">{previewHours}h</strong>
              {form.endTime <= form.startTime && form.startTime && (
                <span className="ml-2 text-blue-600">(cruza medianoche)</span>
              )}
            </p>
          )}

          <div>
            <label className="text-xs text-gray-500 block mb-1">Color</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-8 h-8 rounded-lg border-2 ${form.color === c ? 'border-gray-900 ring-2 ring-offset-1 ring-gray-300' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
              <input type="color" value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                className="w-8 h-8 rounded-lg border border-gray-200" />
            </div>
          </div>

          {/* Preview */}
          <div className="p-3 rounded-lg bg-gray-50">
            <p className="text-xs text-gray-500 mb-2">Vista previa</p>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded font-bold text-white text-sm" style={{ backgroundColor: form.color }}>
                {form.code || '?'}
              </span>
              <div>
                <p className="font-medium text-gray-900 text-sm">{form.label || '—'}</p>
                {form.startTime && form.endTime && (
                  <p className="text-xs text-gray-500 tabular-nums">{form.startTime} – {form.endTime}</p>
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
