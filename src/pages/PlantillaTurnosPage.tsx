// src/pages/PlantillaTurnosPage.tsx
// Sub-fase 3.1 — UI provisional para meter el catálogo de turnos del local
// Aquí el gestor define qué horarios puede abrir el local y cuántas personas
// necesita en cada turno por día de la semana.

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  listShiftTemplates,
  createShiftTemplate,
  updateShiftTemplate,
  deleteShiftTemplate,
} from '../services/schedulerService';
import {
  type ShiftTemplate,
  type DayOfWeek,
  shiftDurationHours,
  DAY_LABELS_SHORT,
} from '../types/scheduler';

const DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];
const DAY_FIELD: Record<DayOfWeek, keyof ShiftTemplate> = {
  0: 'coverage_mon',
  1: 'coverage_tue',
  2: 'coverage_wed',
  3: 'coverage_thu',
  4: 'coverage_fri',
  5: 'coverage_sat',
  6: 'coverage_sun',
};

export default function PlantillaTurnosPage() {
  const { locations } = useApp();
  const [locationId, setLocationId] = useState<string>('');
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Default: primer local
  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

  // Cargar plantillas del local
  async function refresh() {
    if (!locationId) return;
    setLoading(true);
    const list = await listShiftTemplates(locationId);
    setTemplates(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  async function handleCellChange(
    template: ShiftTemplate,
    day: DayOfWeek,
    value: number
  ) {
    const field = DAY_FIELD[day];
    const patch = { [field]: Math.max(0, value) };
    setTemplates((prev) =>
      prev.map((t) => (t.id === template.id ? { ...t, ...patch } : t))
    );
    await updateShiftTemplate(template.id, patch);
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este turno del catálogo?')) return;
    await deleteShiftTemplate(id);
    refresh();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl text-accent">
          Plantilla de turnos del local
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Define qué horarios puede abrir el local y cuántas personas necesita
          en cada turno por día de la semana. El generador automático usará
          esto como base.
        </p>
      </div>

      {/* Selector de local */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-text-primary">Local:</label>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="border border-border-default rounded px-3 py-2 bg-card text-text-primary"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tabla de turnos */}
      <div className="bg-card rounded-lg shadow border border-border-default overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-accent text-text-on-accent">
            <tr>
              <th className="px-3 py-2 text-left sticky left-0 z-20 bg-accent border-r border-white/15">Etiqueta</th>
              <th className="px-3 py-2 text-center">Entrada</th>
              <th className="px-3 py-2 text-center">Salida</th>
              <th className="px-3 py-2 text-center">Horas</th>
              {DAYS.map((d) => (
                <th key={d} className="px-2 py-2 text-center w-14">
                  {DAY_LABELS_SHORT[d]}
                </th>
              ))}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={12} className="py-6 text-center text-text-secondary">
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && templates.length === 0 && (
              <tr>
                <td colSpan={12} className="py-6 text-center text-text-secondary">
                  No hay turnos definidos. Pulsa "Añadir turno" para empezar.
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                editing={editingId === t.id}
                onStartEdit={() => setEditingId(t.id)}
                onStopEdit={() => {
                  setEditingId(null);
                  refresh();
                }}
                onCellChange={handleCellChange}
                onDelete={() => handleDelete(t.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Botón añadir */}
      <div className="mt-4">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded text-text-on-accent font-medium bg-accent hover:bg-accent-hover transition-base"
          >
            + Añadir turno
          </button>
        ) : (
          <NewTemplateForm
            locationId={locationId}
            onCancel={() => setShowForm(false)}
            onCreated={() => {
              setShowForm(false);
              refresh();
            }}
          />
        )}
      </div>

      {/* Resumen de horas-locales necesarias */}
      <CoverageSummary templates={templates} />
    </div>
  );
}

/* ========== Fila de la tabla ========== */

interface TemplateRowProps {
  template: ShiftTemplate;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onCellChange: (t: ShiftTemplate, d: DayOfWeek, v: number) => void;
  onDelete: () => void;
}

function TemplateRow({
  template,
  editing,
  onStartEdit,
  onStopEdit,
  onCellChange,
  onDelete,
}: TemplateRowProps) {
  const [label, setLabel] = useState(template.label);
  const [start, setStart] = useState(template.start_time.slice(0, 5));
  const [end, setEnd] = useState(template.end_time.slice(0, 5));

  const hours = shiftDurationHours(template.start_time, template.end_time);

  async function saveTimeChanges() {
    if (label !== template.label || start !== template.start_time || end !== template.end_time) {
      await updateShiftTemplate(template.id, {
        label,
        start_time: start,
        end_time: end,
      });
    }
    onStopEdit();
  }

  return (
    <tr className="border-b border-border-default hover:bg-page transition-base group">
      <td className="px-3 py-2 sticky left-0 z-10 bg-card group-hover:bg-page border-r border-border-default">
        {editing ? (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="border border-border-default rounded px-2 py-1 w-full bg-card text-text-primary"
          />
        ) : (
          <button
            onClick={onStartEdit}
            className="text-left w-full hover:underline text-text-primary"
          >
            {template.label}
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-center text-text-primary">
        {editing ? (
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="border border-border-default rounded px-2 py-1 bg-card text-text-primary"
          />
        ) : (
          template.start_time.slice(0, 5)
        )}
      </td>
      <td className="px-3 py-2 text-center text-text-primary">
        {editing ? (
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="border border-border-default rounded px-2 py-1 bg-card text-text-primary"
          />
        ) : (
          template.end_time.slice(0, 5)
        )}
      </td>
      <td className="px-3 py-2 text-center font-mono text-text-primary">{hours}</td>
      {DAYS.map((d) => {
        const field = DAY_FIELD[d];
        const value = template[field] as number;
        const isWeekend = d === 4 || d === 5 || d === 6;
        return (
          <td key={d} className="px-1 py-1 text-center">
            <input
              type="number"
              min={0}
              max={9}
              value={value}
              onChange={(e) =>
                onCellChange(template, d, parseInt(e.target.value || '0', 10))
              }
              className={`w-12 border rounded px-1 py-1 text-center transition-base ${
                value > 0
                  ? isWeekend
                    ? 'bg-warning-bg border-warning/30 text-accent font-semibold'
                    : 'bg-page border-border-default text-accent font-semibold'
                  : 'bg-card border-border-default text-text-primary'
              }`}
            />
          </td>
        );
      })}
      <td className="px-3 py-2 text-right">
        {editing ? (
          <button
            onClick={saveTimeChanges}
            className="text-xs px-2 py-1 rounded text-text-on-accent bg-accent hover:bg-accent-hover transition-base"
          >
            Guardar
          </button>
        ) : (
          <button
            onClick={onDelete}
            className="text-xs text-danger hover:underline"
          >
            Eliminar
          </button>
        )}
      </td>
    </tr>
  );
}

/* ========== Formulario de nuevo turno ========== */

interface NewTemplateFormProps {
  locationId: string;
  onCancel: () => void;
  onCreated: () => void;
}

function NewTemplateForm({ locationId, onCancel, onCreated }: NewTemplateFormProps) {
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('12:30');
  const [end, setEnd] = useState('16:45');
  const [saving, setSaving] = useState(false);

  const hours = shiftDurationHours(start, end);

  async function save() {
    if (!label.trim()) {
      alert('Pon una etiqueta al turno (ej. "Mañana corto")');
      return;
    }
    setSaving(true);
    const ok = await createShiftTemplate({
      location_id: locationId,
      label: label.trim(),
      start_time: start,
      end_time: end,
      coverage_mon: 0,
      coverage_tue: 0,
      coverage_wed: 0,
      coverage_thu: 0,
      coverage_fri: 0,
      coverage_sat: 0,
      coverage_sun: 0,
      active: true,
    });
    setSaving(false);
    if (ok) onCreated();
  }

  return (
    <div className="p-4 rounded-lg border-2 border-accent bg-accent-bg">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1 text-text-primary">Etiqueta</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Mañana corto"
            className="border border-border-default rounded px-2 py-1.5 w-full bg-card text-text-primary"
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1 text-text-primary">Entrada</label>
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="border border-border-default rounded px-2 py-1.5 w-full bg-card text-text-primary"
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1 text-text-primary">Salida</label>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="border border-border-default rounded px-2 py-1.5 w-full bg-card text-text-primary"
          />
        </div>
        <div className="flex items-end gap-2">
          <span className="text-sm text-text-primary">
            Duración: <strong>{hours}h</strong>
          </span>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded text-text-on-accent font-medium disabled:opacity-50 bg-accent hover:bg-accent-hover transition-base"
        >
          {saving ? 'Guardando…' : 'Crear turno'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded border border-border-default bg-card text-text-primary hover:bg-page transition-base"
        >
          Cancelar
        </button>
      </div>
      <p className="text-xs text-text-secondary mt-3">
        Después podrás ajustar cuántas personas se necesitan cada día desde la
        tabla.
      </p>
    </div>
  );
}

/* ========== Resumen de horas necesarias semana ========== */

function CoverageSummary({ templates }: { templates: ShiftTemplate[] }) {
  const totals = useMemo(() => {
    let totalShifts = 0;
    let totalHours = 0;
    for (const t of templates) {
      const hours = shiftDurationHours(t.start_time, t.end_time);
      const sum =
        t.coverage_mon +
        t.coverage_tue +
        t.coverage_wed +
        t.coverage_thu +
        t.coverage_fri +
        t.coverage_sat +
        t.coverage_sun;
      totalShifts += sum;
      totalHours += hours * sum;
    }
    return { totalShifts, totalHours: Math.round(totalHours * 100) / 100 };
  }, [templates]);

  if (templates.length === 0) return null;

  return (
    <div className="mt-6 p-4 rounded-lg bg-accent-bg">
      <h3 className="font-display font-semibold mb-2 text-accent">
        Necesidad semanal de cobertura
      </h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-text-secondary">Turnos a cubrir/semana</div>
          <div className="text-2xl font-bold text-accent">
            {totals.totalShifts}
          </div>
        </div>
        <div>
          <div className="text-text-secondary">Horas-empleado/semana</div>
          <div className="text-2xl font-bold text-accent">
            {totals.totalHours}h
          </div>
        </div>
      </div>
      <p className="text-xs text-text-secondary mt-2">
        Estas horas se repartirán entre los empleados del local respetando sus
        jornadas contratadas.
      </p>
    </div>
  );
}
