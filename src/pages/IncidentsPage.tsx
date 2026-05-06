import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Input, Select, Textarea, Badge, Card, Modal, Label } from '../components/ui'
import type { Incident } from '../types'

const SEVERITY_COLOR: Record<string, string> = { leve: 'blue', moderada: 'yellow', grave: 'yellow', critica: 'red' }
const STATUS_COLOR: Record<string, string> = { abierta: 'red', en_proceso: 'yellow', resuelta: 'green' }
const TYPES = ['Equipamiento', 'Limpieza', 'Personal', 'Cliente', 'Seguridad', 'Suministros', 'APPCC', 'Otro']

export default function IncidentsPage() {
  const { incidents, setIncidents, locations } = useApp()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('todas')
  const [sevFilter, setSevFilter] = useState('todas')

  const filtered = incidents.filter(i =>
    (statusFilter === 'todas' || i.status === statusFilter) &&
    (sevFilter === 'todas' || i.severity === sevFilter) &&
    (i.title.toLowerCase().includes(search.toLowerCase()) || i.description.toLowerCase().includes(search.toLowerCase()))
  )

  const counts = {
    abierta: incidents.filter(i => i.status === 'abierta').length,
    en_proceso: incidents.filter(i => i.status === 'en_proceso').length,
    resuelta: incidents.filter(i => i.status === 'resuelta').length,
    critica: incidents.filter(i => i.severity === 'critica' && i.status !== 'resuelta').length,
  }

  function createNew() {
    const inc: Incident = {
      id: `inc-${Date.now()}`, title: 'Nueva incidencia', description: '',
      locationId: locations[0]?.id || '', type: 'Otro', severity: 'leve',
      status: 'abierta', reportedBy: '', createdAt: new Date().toISOString(), photos: [],
    }
    setIncidents(prev => [inc, ...prev])
    setSelectedId(inc.id)
  }

  const selected = incidents.find(i => i.id === selectedId)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Incidencias</h1>
          <p className="text-sm text-gray-500 mt-0.5">{incidents.length} total · {counts.abierta} abiertas · {counts.critica > 0 ? `⚠️ ${counts.critica} críticas` : '0 críticas'}</p>
        </div>
        <Button size="sm" onClick={createNew}>+ Nueva incidencia</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Abiertas', val: counts.abierta, bg: 'bg-red-50 border-red-200' },
          { label: 'En proceso', val: counts.en_proceso, bg: 'bg-amber-50 border-amber-200' },
          { label: 'Resueltas', val: counts.resuelta, bg: 'bg-emerald-50 border-emerald-200' },
          { label: 'Críticas', val: counts.critica, bg: 'bg-red-100 border-red-300' },
        ].map(s => (
          <div key={s.label} className={`p-3 rounded-xl border ${s.bg}`}>
            <p className="text-2xl font-bold">{s.val}</p>
            <p className="text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Input placeholder="Buscar incidencia..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-40">
          <option value="todas">Todos los estados</option>
          <option value="abierta">Abierta</option>
          <option value="en_proceso">En proceso</option>
          <option value="resuelta">Resuelta</option>
        </Select>
        <Select value={sevFilter} onChange={e => setSevFilter(e.target.value)} className="w-40">
          <option value="todas">Toda gravedad</option>
          <option value="leve">Leve</option>
          <option value="moderada">Moderada</option>
          <option value="grave">Grave</option>
          <option value="critica">Crítica</option>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center"><p className="text-gray-400 text-sm">No hay incidencias</p></Card>
        ) : filtered.map(inc => {
          const loc = locations.find(l => l.id === inc.locationId)
          return (
            <Card key={inc.id} onClick={() => setSelectedId(inc.id)} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium truncate">{inc.title}</p>
                  <Badge color={SEVERITY_COLOR[inc.severity]}>{inc.severity}</Badge>
                  <Badge color={STATUS_COLOR[inc.status]}>{inc.status.replace('_', ' ')}</Badge>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {loc?.name || '—'} · {inc.type} · {new Date(inc.createdAt).toLocaleDateString('es-ES')}
                  {inc.reportedBy && ` · Por: ${inc.reportedBy}`}
                </p>
              </div>
            </Card>
          )
        })}
      </div>

      {selected && (
        <IncidentModal
          incident={selected}
          onClose={() => setSelectedId(null)}
          onSave={inc => { setIncidents(prev => prev.map(x => x.id === inc.id ? inc : x)); setSelectedId(null) }}
          onDelete={id => { setIncidents(prev => prev.filter(x => x.id !== id)); setSelectedId(null) }}
          locations={locations}
        />
      )}
    </div>
  )
}

function IncidentModal({ incident, onClose, onSave, onDelete, locations }: {
  incident: Incident
  onClose: () => void
  onSave: (i: Incident) => void
  onDelete: (id: string) => void
  locations: ReturnType<typeof useApp>['locations']
}) {
  const [inc, setInc] = useState<Incident>({ ...incident })
  const upd = (f: keyof Incident, v: unknown) => setInc(prev => ({ ...prev, [f]: v }))

  return (
    <Modal open onClose={onClose} size="lg" title={inc.title || 'Incidencia'}>
      <div className="space-y-4">
        <div>
          <Label>Título</Label>
          <Input className="mt-1" value={inc.title} onChange={e => upd('title', e.target.value)} />
        </div>
        <div>
          <Label>Descripción</Label>
          <Textarea className="mt-1" rows={4} value={inc.description} onChange={e => upd('description', e.target.value)} placeholder="Describe la incidencia en detalle..." />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Local</Label>
            <Select className="mt-1" value={inc.locationId} onChange={e => upd('locationId', e.target.value)}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Tipo</Label>
            <Select className="mt-1" value={inc.type} onChange={e => upd('type', e.target.value)}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div>
            <Label>Gravedad</Label>
            <Select className="mt-1" value={inc.severity} onChange={e => upd('severity', e.target.value as Incident['severity'])}>
              <option value="leve">Leve</option>
              <option value="moderada">Moderada</option>
              <option value="grave">Grave</option>
              <option value="critica">Crítica</option>
            </Select>
          </div>
          <div>
            <Label>Estado</Label>
            <Select className="mt-1" value={inc.status} onChange={e => upd('status', e.target.value as Incident['status'])}>
              <option value="abierta">Abierta</option>
              <option value="en_proceso">En proceso</option>
              <option value="resuelta">Resuelta</option>
            </Select>
          </div>
          <div>
            <Label>Reportado por</Label>
            <Input className="mt-1" value={inc.reportedBy} onChange={e => upd('reportedBy', e.target.value)} placeholder="Nombre" />
          </div>
          <div>
            <Label>Asignado a</Label>
            <Input className="mt-1" value={inc.assignedTo || ''} onChange={e => upd('assignedTo', e.target.value)} placeholder="Responsable de resolución" />
          </div>
        </div>
        <div>
          <Label>Notas de resolución</Label>
          <Textarea className="mt-1" rows={3} value={inc.notes || ''} onChange={e => upd('notes', e.target.value)} placeholder="Cómo se resolvió, acciones tomadas..." />
        </div>
        {inc.status === 'resuelta' && !inc.resolvedAt && (
          <Button size="sm" variant="outline" onClick={() => upd('resolvedAt', new Date().toISOString())}>
            Marcar fecha de resolución ahora
          </Button>
        )}
        {inc.resolvedAt && (
          <p className="text-xs text-emerald-600">✅ Resuelta el {new Date(inc.resolvedAt).toLocaleString('es-ES')}</p>
        )}

        <div className="flex items-center justify-between pt-3 border-t">
          <Button variant="danger" size="sm" onClick={() => { if (confirm('¿Eliminar?')) onDelete(inc.id) }}>Eliminar</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => onSave(inc)}>Guardar</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
