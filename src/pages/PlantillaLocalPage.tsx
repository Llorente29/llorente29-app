// src/pages/PlantillaLocalPage.tsx
// Plantilla del local: configura cuántos empleados se necesitan por turno y día.
import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Card, Button } from '../components/ui'
import {
  fetchShiftTypes, type ShiftType,
} from '../services/calendarService'
import {
  fetchLocationPlanning, upsertLocationPlanning,
  type LocationPlanningRow,
} from '../services/locationPlanningService'

interface Props {
  onBack: () => void
}

const DAYS_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DAYS_KEYS = ['neededLun', 'neededMar', 'neededMie', 'neededJue', 'neededVie', 'neededSab', 'neededDom'] as const
type DayKey = typeof DAYS_KEYS[number]

export default function PlantillaLocalPage({ onBack }: Props) {
  const { locations } = useApp()
  const [locationId, setLocationId] = useState<string>('')
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([])
  const [planning, setPlanning] = useState<LocationPlanningRow[]>([])
  const [editValues, setEditValues] = useState<Record<string, Record<DayKey | 'default', number>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (!locationId && locations.length > 0) {
      const active = locations.find(l => l.active) || locations[0]
      if (active) setLocationId(active.id)
    }
  }, [locations, locationId])

  useEffect(() => {
    fetchShiftTypes().then(types => setShiftTypes(types.filter(t => !t.isOff)))
  }, [])

  async function load() {
    if (!locationId) return
    setLoading(true)
    const p = await fetchLocationPlanning(locationId)
    setPlanning(p)

    // Cargar valores editables
    const ev: Record<string, Record<DayKey | 'default', number>> = {}
    for (const t of shiftTypes) {
      const row = p.find(x => x.shiftTypeId === t.id)
      ev[t.id] = {
        neededLun: row?.neededLun ?? row?.neededDefault ?? 0,
        neededMar: row?.neededMar ?? row?.neededDefault ?? 0,
        neededMie: row?.neededMie ?? row?.neededDefault ?? 0,
        neededJue: row?.neededJue ?? row?.neededDefault ?? 0,
        neededVie: row?.neededVie ?? row?.neededDefault ?? 0,
        neededSab: row?.neededSab ?? row?.neededDefault ?? 0,
        neededDom: row?.neededDom ?? row?.neededDefault ?? 0,
        default: row?.neededDefault ?? 0,
      }
    }
    setEditValues(ev)
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-line */ }, [locationId, shiftTypes])

  function update(shiftId: string, key: DayKey | 'default', val: number) {
    setEditValues(prev => ({
      ...prev,
      [shiftId]: { ...prev[shiftId], [key]: val }
    }))
  }

  async function save() {
    setSaving(true)
    for (const t of shiftTypes) {
      const v = editValues[t.id]
      if (!v) continue
      await upsertLocationPlanning({
        locationId,
        shiftTypeId: t.id,
        neededLun: v.neededLun,
        neededMar: v.neededMar,
        neededMie: v.neededMie,
        neededJue: v.neededJue,
        neededVie: v.neededVie,
        neededSab: v.neededSab,
        neededDom: v.neededDom,
        neededDefault: v.default,
      })
    }
    setSaving(false)
    setSavedAt(new Date())
    setTimeout(() => setSavedAt(null), 3000)
    await load()
  }

  // Calcular suma horas-empleado necesarias por semana (informativo)
  const weeklyDemand = shiftTypes.reduce((acc, t) => {
    const v = editValues[t.id]
    if (!v) return acc
    const sum = v.neededLun + v.neededMar + v.neededMie + v.neededJue + v.neededVie + v.neededSab + v.neededDom
    return acc + sum * t.hours
  }, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">← Volver al calendario</button>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Plantilla del local</p>
            <h2 className="text-xl font-bold text-gray-900">Necesidades de cobertura</h2>
            <p className="text-xs text-gray-500 mt-1">
              Cuántos empleados se necesitan en cada turno y día. El generador automático intentará cubrir estos mínimos.
            </p>
          </div>
          <select value={locationId} onChange={e => setLocationId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
            {locations.filter(l => l.active).map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Cargando...</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 text-xs font-medium text-gray-500 uppercase">Turno</th>
                    {DAYS_LABELS.map((d, idx) => {
                      const isVSD = idx === 4 || idx === 5 || idx === 6
                      return (
                        <th key={d} className={`text-center py-2 text-xs font-medium uppercase ${isVSD ? 'text-amber-700 bg-amber-50/50' : 'text-gray-500'}`}>
                          {d}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {shiftTypes.map(t => (
                    <tr key={t.id} className="border-b border-gray-100">
                      <td className="py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-3 h-3 rounded" style={{ backgroundColor: t.color }} />
                          <span className="font-semibold text-gray-900">{t.code}</span>
                          <span className="text-xs text-gray-500">{t.label}</span>
                          <span className="text-[10px] text-gray-400">({t.hours}h)</span>
                        </span>
                      </td>
                      {DAYS_KEYS.map((dKey, idx) => {
                        const isVSD = idx === 4 || idx === 5 || idx === 6
                        const val = editValues[t.id]?.[dKey] ?? 0
                        return (
                          <td key={dKey} className={`py-1.5 text-center ${isVSD ? 'bg-amber-50/30' : ''}`}>
                            <input type="number" min={0} max={20} value={val}
                              onChange={e => update(t.id, dKey, parseInt(e.target.value) || 0)}
                              className="w-14 border rounded px-1 py-1 text-center text-sm" />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-800">
              <p className="font-semibold mb-1">📊 Demanda total semanal: {weeklyDemand.toFixed(1)} horas-persona</p>
              <p className="text-[11px] opacity-80">
                Esta es la suma total de horas que necesitas cubrir cada semana. Para hacerlo necesitas equivalente en plantilla.
                Si tienes 3 empleados a 40h tendrás 120h disponibles. Esta cifra te ayuda a saber si tu plantilla es suficiente.
              </p>
            </div>
          </>
        )}

        <div className="flex items-center justify-between pt-4 mt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            {savedAt ? `✓ Guardado a las ${savedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? 'Guardando...' : 'Guardar plantilla'}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Información</p>
        <div className="text-sm text-gray-700 space-y-2">
          <p>📌 Esta plantilla define las necesidades base de tu local.</p>
          <p>📌 V/S/D destacados en color: son los días de mayor demanda donde típicamente necesitas más personal.</p>
          <p>📌 Al generar el calendario, el sistema intentará cubrir cada turno con el número de empleados aquí indicado.</p>
          <p>📌 Si la plantilla disponible no es suficiente para cubrir las necesidades, recibirás avisos sugiriendo:
            ampliar horas a un trabajador, contratar más personal o reducir necesidades.</p>
        </div>
      </Card>
    </div>
  )
}
