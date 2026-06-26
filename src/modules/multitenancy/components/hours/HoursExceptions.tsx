// src/modules/multitenancy/components/hours/HoursExceptions.tsx
//
// Días especiales / festivos de (local, marca|null). Pisan el horario habitual
// en is_brand_open. Cada excepción se guarda por DÍA, pero el alta admite un
// RANGO (desde/hasta) que se expande a N días. La lista agrupa días
// consecutivos con la misma configuración en un único rango visible.

import { useEffect, useState } from 'react'
import { Plus, Trash2, CalendarDays } from 'lucide-react'
import {
  getExceptions, addExceptionRange, deleteException, type HoursException,
} from '../../services/businessHoursService'

interface Props {
  accountId: string
  locationId: string
  brandId: string | null
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Agrupa días consecutivos con misma config (cerrado/horario/nota) en rangos.
interface ExcGroup {
  fromDate: string
  toDate: string
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
  note: string | null
  ids: string[]
}

function groupExceptions(items: HoursException[]): ExcGroup[] {
  const groups: ExcGroup[] = []
  const sameConfig = (a: HoursException, g: ExcGroup) =>
    a.isClosed === g.isClosed && a.openTime === g.openTime && a.closeTime === g.closeTime && (a.note ?? '') === (g.note ?? '')
  const nextDay = (iso: string) => {
    const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }
  for (const x of items) {
    const last = groups[groups.length - 1]
    if (last && sameConfig(x, last) && nextDay(last.toDate) === x.exceptionDate) {
      last.toDate = x.exceptionDate
      if (x.id) last.ids.push(x.id)
    } else {
      groups.push({
        fromDate: x.exceptionDate, toDate: x.exceptionDate,
        isClosed: x.isClosed, openTime: x.openTime, closeTime: x.closeTime, note: x.note,
        ids: x.id ? [x.id] : [],
      })
    }
  }
  return groups
}

export default function HoursExceptions({ accountId, locationId, brandId }: Props) {
  const [groups, setGroups] = useState<ExcGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Formulario de alta
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [closed, setClosed] = useState(true)
  const [openTime, setOpenTime] = useState('12:00')
  const [closeTime, setCloseTime] = useState('23:00')
  const [note, setNote] = useState('')

  function reload() {
    if (!locationId) return
    setLoading(true)
    setError(null)
    getExceptions(locationId, brandId)
      .then((items) => setGroups(groupExceptions(items)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false))
  }

  useEffect(reload, [locationId, brandId])

  async function handleAdd() {
    if (!fromDate) { setError('Elige al menos la fecha de inicio.'); return }
    setBusy(true)
    setError(null)
    try {
      await addExceptionRange(
        accountId, locationId, brandId,
        fromDate, toDate || fromDate,
        closed, closed ? null : openTime, closed ? null : closeTime,
        note.trim() || null,
      )
      setFromDate(''); setToDate(''); setNote(''); setClosed(true)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteGroup(ids: string[]) {
    setBusy(true)
    try {
      for (const id of ids) await deleteException(id)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo borrar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
        <CalendarDays size={15} className="text-accent" />
        Días especiales y festivos
      </div>
      <p className="text-xs text-text-secondary">
        Fechas o periodos que cambian el horario habitual (cierre por festivo, vacaciones, jornada especial…).
      </p>

      {error && (
        <div className="rounded-lg p-2.5 text-sm" style={{ background: '#FDECEC', border: '1px solid #E5A0A0', color: '#A12626' }}>
          {error}
        </div>
      )}

      {/* Lista de próximas (agrupadas en rangos) */}
      {loading ? (
        <p className="text-sm text-text-secondary">Cargando…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-text-secondary">No hay días especiales programados.</p>
      ) : (
        <div className="rounded-md border border-border-default divide-y divide-border-default">
          {groups.map((g, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium text-text-primary w-44 shrink-0">
                {g.fromDate === g.toDate
                  ? formatDate(g.fromDate)
                  : `${formatDate(g.fromDate)} – ${formatDate(g.toDate)}`}
              </span>
              <span className="flex-1 text-text-secondary">
                {g.isClosed
                  ? <span className="text-danger font-medium">Cerrado</span>
                  : `${g.openTime}–${g.closeTime}`}
                {g.note && <span className="ml-2 text-text-tertiary">· {g.note}</span>}
              </span>
              <button
                type="button"
                onClick={() => handleDeleteGroup(g.ids)}
                disabled={busy}
                className="p-1 rounded-md hover:bg-accent-bg text-text-secondary"
                aria-label="Borrar"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Alta */}
      <div className="rounded-md border border-border-default bg-page p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-text-secondary">Desde</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <label className="text-xs text-text-secondary">Hasta</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            placeholder="(opcional)"
            className="px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <label className="inline-flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            Cerrado todo el día
          </label>
          {!closed && (
            <span className="inline-flex items-center gap-1.5">
              <input
                type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)}
                className="px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-text-secondary">–</span>
              <input
                type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)}
                className="px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </span>
          )}
        </div>
        <p className="text-[11px] text-text-tertiary">Deja “Hasta” vacío para un solo día.</p>
        <div className="flex items-center gap-2">
          <input
            type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Nota (opcional): Navidad, vacaciones, evento…"
            className="flex-1 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={14} /> Añadir
          </button>
        </div>
      </div>
    </div>
  )
}
