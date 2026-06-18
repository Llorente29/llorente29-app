// src/admin/pages/AuditoriaPage.tsx
//
// Pantalla de Auditoría del Portal de staff. Lista inmutable y cronológica de
// eventos de plataforma, con filtros (cuenta, admin, tipo, rango de fechas) y
// export CSV. Solo lectura: el registro es append-only en BBDD.

import { useEffect, useMemo, useState } from 'react'
import {
  listAuditEvents, getAccountFilterOptions, knownEventTypes,
  eventLabel, summarizeDetails, exportEventsCsv,
  type AuditEvent, type AuditFilters,
} from '../services/auditService'

const PAGE_SIZE = 100

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const min = Math.round(diff / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return `hace ${d} d`
  return new Date(iso).toLocaleDateString('es-ES')
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function AuditoriaPage() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([])
  const eventTypes = useMemo(() => knownEventTypes(), [])

  // Filtros.
  const [accountId, setAccountId] = useState<string>('')
  const [eventType, setEventType] = useState<string>('')
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    getAccountFilterOptions().then(setAccounts).catch(() => setAccounts([]))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const filters: AuditFilters = {
      accountId: accountId || null,
      eventType: eventType || null,
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to + 'T23:59:59').toISOString() : null,
      limit: PAGE_SIZE,
      offset,
    }
    listAuditEvents(filters)
      .then(({ events, total }) => {
        if (cancelled) return
        setEvents(events)
        setTotal(total)
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, eventType, from, to, offset])

  function resetFilters() {
    setAccountId(''); setEventType(''); setFrom(''); setTo(''); setOffset(0)
  }

  const hasFilters = accountId || eventType || from || to
  const showingTo = Math.min(offset + events.length, total)

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-display font-medium mb-1" style={{ color: 'var(--color-accent)' }}>
        Auditoría
      </h1>
      <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary, #666)' }}>
        Registro inmutable de acciones administrativas y eventos de seguridad de la plataforma.
      </p>

      {/* Filtros */}
      <div className="rounded-lg p-4 mb-4" style={{ border: '1px solid var(--color-border, #e5e5e5)', background: 'var(--color-bg-surface, #fff)' }}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select label="Cuenta" value={accountId} onChange={v => { setAccountId(v); setOffset(0) }}
            options={[{ value: '', label: 'Todas' }, ...accounts.map(a => ({ value: a.id, label: a.name }))]} />
          <Select label="Tipo de evento" value={eventType} onChange={v => { setEventType(v); setOffset(0) }}
            options={[{ value: '', label: 'Todos' }, ...eventTypes]} />
          <DateInput label="Desde" value={from} onChange={v => { setFrom(v); setOffset(0) }} />
          <DateInput label="Hasta" value={to} onChange={v => { setTo(v); setOffset(0) }} />
        </div>
        <div className="flex items-center gap-3 mt-3">
          {hasFilters && (
            <button type="button" onClick={resetFilters}
              className="text-sm px-3 py-1.5 rounded-md"
              style={{ border: '1px solid var(--color-border, #ccc)', color: 'var(--color-text-secondary, #555)' }}>
              Limpiar filtros
            </button>
          )}
          <button type="button" onClick={() => exportEventsCsv(events)} disabled={events.length === 0}
            className="text-sm px-3 py-1.5 rounded-md font-medium"
            style={{ background: 'var(--color-terracota)', color: '#fff', opacity: events.length === 0 ? 0.5 : 1 }}>
            Exportar CSV
          </button>
          <span className="text-xs ml-auto" style={{ color: 'var(--color-text-secondary, #888)' }}>
            {loading ? 'Cargando…' : `${total} evento(s)`}
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg p-3 mb-4" style={{ background: '#FDECEC', border: '1px solid #E5A0A0' }}>
          <p className="text-sm" style={{ color: '#A12626' }}>{error}</p>
        </div>
      )}

      {/* Tabla */}
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border, #e5e5e5)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-surface, #f7f7f7)', textAlign: 'left' }}>
              <Th>Cuándo</Th><Th>Quién</Th><Th>Acción</Th><Th>Sobre</Th><Th>Detalle</Th><Th>IP</Th>
            </tr>
          </thead>
          <tbody>
            {!loading && events.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center" style={{ color: 'var(--color-text-secondary, #888)' }}>
                No hay eventos para estos filtros.
              </td></tr>
            )}
            {events.map(ev => (
              <tr key={ev.id} style={{ borderTop: '1px solid var(--color-border, #eee)' }}>
                <Td>
                  <div>{formatDateTime(ev.createdAt)}</div>
                  <div className="text-xs" style={{ color: 'var(--color-text-secondary, #999)' }}>{relativeTime(ev.createdAt)}</div>
                </Td>
                <Td>
                  <div>{ev.adminName ?? <span style={{ color: '#999' }}>sistema</span>}</div>
                  {ev.adminEmail && <div className="text-xs" style={{ color: 'var(--color-text-secondary, #999)' }}>{ev.adminEmail}</div>}
                </Td>
                <Td><span className="font-medium" style={{ color: 'var(--color-accent)' }}>{eventLabel(ev.eventType)}</span></Td>
                <Td>{ev.accountName ?? (ev.targetAccountId ? <span style={{ color: '#999' }}>cuenta {ev.targetAccountId.slice(0, 8)}…</span> : '—')}</Td>
                <Td><span style={{ color: 'var(--color-text-secondary, #555)' }}>{summarizeDetails(ev) || '—'}</span></Td>
                <Td><span className="text-xs" style={{ color: 'var(--color-text-secondary, #999)' }}>{ev.ipAddress ?? '—'}</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span style={{ color: 'var(--color-text-secondary, #888)' }}>
            {offset + 1}–{showingTo} de {total}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="px-3 py-1.5 rounded-md" style={{ border: '1px solid var(--color-border, #ccc)', opacity: offset === 0 ? 0.4 : 1 }}>
              Anterior
            </button>
            <button type="button" disabled={showingTo >= total} onClick={() => setOffset(offset + PAGE_SIZE)}
              className="px-3 py-1.5 rounded-md" style={{ border: '1px solid var(--color-border, #ccc)', opacity: showingTo >= total ? 0.4 : 1 }}>
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-text-secondary, #666)' }}>{children}</th>
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-top" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>{children}</td>
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary, #666)' }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md text-sm bg-white" style={{ border: '1px solid var(--color-border, #ccc)' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary, #666)' }}>{label}</label>
      <input type="date" value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md text-sm" style={{ border: '1px solid var(--color-border, #ccc)' }} />
    </div>
  )
}
