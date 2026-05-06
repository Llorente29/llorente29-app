import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Input, Select, Textarea, Badge, Card, Modal, Label, Tabs } from '../components/ui'
import type { Task, ChecklistItem, TaskField } from '../types'

const PRIORITIES = ['baja', 'media', 'alta', 'critica'] as const
const STATUSES = ['pendiente', 'en_progreso', 'completada', 'vencida'] as const
const ROLES = ['Encargado', 'Gerente', 'Cocinero', 'Jefe de cocina', 'Camarero', 'Barra', 'Limpieza', 'Todos']

const PRIORITY_COLOR: Record<string, string> = {
  baja: 'gray', media: 'blue', alta: 'yellow', critica: 'red'
}
const STATUS_COLOR: Record<string, string> = {
  pendiente: 'yellow', en_progreso: 'blue', completada: 'green', vencida: 'red'
}

export default function TasksPage() {
  const { tasks, setTasks, locations, templates } = useApp()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('todas')
  const [locFilter, setLocFilter] = useState('todas')
  const [showFromTemplate, setShowFromTemplate] = useState(false)

  const filtered = tasks.filter(t =>
    (statusFilter === 'todas' || t.status === statusFilter) &&
    (locFilter === 'todas' || t.locationId === locFilter) &&
    (t.title.toLowerCase().includes(search.toLowerCase()) || t.assignedTo.toLowerCase().includes(search.toLowerCase()))
  )

  const counts = {
    pendiente: tasks.filter(t => t.status === 'pendiente').length,
    en_progreso: tasks.filter(t => t.status === 'en_progreso').length,
    completada: tasks.filter(t => t.status === 'completada').length,
    vencida: tasks.filter(t => t.status === 'vencida').length,
  }

  function createBlank() {
    const t: Task = {
      id: `t-${Date.now()}`, title: 'Nueva tarea', description: '',
      locationId: locations[0]?.id || '', assignedTo: '', role: 'Todos',
      status: 'pendiente', priority: 'media',
      dueDate: new Date().toISOString().slice(0, 10),
      checklistItems: [], fields: [], history: [], tags: [], createdAt: new Date().toISOString(),
    }
    setTasks(prev => [t, ...prev])
    setSelectedId(t.id)
  }

  function createFromTemplate(tplId: string) {
    const tpl = templates.find(t => t.id === tplId)
    if (!tpl) return
    const t: Task = {
      id: `t-${Date.now()}`, title: tpl.name, description: tpl.description,
      locationId: locations[0]?.id || '', assignedTo: '', role: tpl.assignableRoles[0] || 'Todos',
      status: 'pendiente', priority: tpl.priority,
      dueDate: new Date().toISOString().slice(0, 10),
      checklistItems: tpl.checklist.map(c => ({ ...c, completed: false })),
      fields: tpl.fields.map(f => ({ ...f, value: '' })),
      history: [], tags: tpl.tags, createdAt: new Date().toISOString(),
      templateId: tplId,
    }
    setTasks(prev => [t, ...prev])
    setSelectedId(t.id)
    setShowFromTemplate(false)
  }

  const selected = tasks.find(t => t.id === selectedId)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Tareas</h1>
          <p className="text-sm text-gray-500 mt-0.5">{tasks.length} tareas · {counts.pendiente} pendientes · {counts.vencida} vencidas</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowFromTemplate(true)}>📋 Desde plantilla</Button>
          <Button size="sm" onClick={createBlank}>+ Nueva tarea</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['pendiente', 'en_progreso', 'completada', 'vencida'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'todas' : s)}
            className={`p-3 rounded-xl border text-left transition-all ${statusFilter === s ? 'ring-2 ring-teal-500' : ''} ${
              s === 'pendiente' ? 'bg-amber-50 border-amber-200' :
              s === 'en_progreso' ? 'bg-blue-50 border-blue-200' :
              s === 'completada' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
            }`}>
            <p className="text-2xl font-bold">{counts[s]}</p>
            <p className="text-xs mt-0.5 capitalize">{s.replace('_', ' ')}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input placeholder="Buscar tarea..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={locFilter} onChange={e => setLocFilter(e.target.value)} className="w-44">
          <option value="todas">Todos los locales</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center"><p className="text-gray-400 text-sm">No hay tareas</p></Card>
        ) : filtered.map(t => {
          const loc = locations.find(l => l.id === t.locationId)
          const done = t.checklistItems.filter(c => c.completed).length
          const total = t.checklistItems.length
          return (
            <Card key={t.id} onClick={() => setSelectedId(t.id)} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium truncate">{t.title}</p>
                  <Badge color={PRIORITY_COLOR[t.priority]}>{t.priority}</Badge>
                  <Badge color={STATUS_COLOR[t.status]}>{t.status.replace('_', ' ')}</Badge>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {loc?.name || '—'} · {t.assignedTo || 'Sin asignar'} · {t.dueDate}
                  {total > 0 && ` · ${done}/${total} checklist`}
                </p>
              </div>
              {t.tags.length > 0 && (
                <div className="hidden sm:flex gap-1 flex-wrap">
                  {t.tags.slice(0, 2).map(tag => <span key={tag} className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{tag}</span>)}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* From template modal */}
      <Modal open={showFromTemplate} onClose={() => setShowFromTemplate(false)} title="Crear desde plantilla" size="md">
        <div className="space-y-3">
          {templates.filter(t => t.active).map(tpl => (
            <Card key={tpl.id} onClick={() => createFromTemplate(tpl.id)} className="p-4 flex items-center gap-3">
              <span className="text-2xl">{tpl.icon}</span>
              <div className="flex-1">
                <p className="font-medium text-sm">{tpl.name}</p>
                <p className="text-xs text-gray-500">{tpl.category} · {tpl.frequency} · ~{tpl.estimatedMinutes}min</p>
              </div>
              <Badge color={PRIORITY_COLOR[tpl.priority]}>{tpl.priority}</Badge>
            </Card>
          ))}
        </div>
      </Modal>

      {/* Task detail */}
      {selected && (
        <TaskModal
          task={selected}
          onClose={() => setSelectedId(null)}
          onSave={t => { setTasks(prev => prev.map(x => x.id === t.id ? t : x)); setSelectedId(null) }}
          onDelete={id => { setTasks(prev => prev.filter(x => x.id !== id)); setSelectedId(null) }}
          locations={locations}
        />
      )}
    </div>
  )
}

function TaskModal({ task, onClose, onSave, onDelete, locations }: {
  task: Task
  onClose: () => void
  onSave: (t: Task) => void
  onDelete: (id: string) => void
  locations: ReturnType<typeof useApp>['locations']
}) {
  const [t, setT] = useState<Task>({ ...task, checklistItems: [...task.checklistItems], fields: [...task.fields] })
  const [tab, setTab] = useState('info')

  const upd = (field: keyof Task, val: unknown) => setT(prev => ({ ...prev, [field]: val }))
  const toggleChecklist = (id: string) => setT(prev => ({
    ...prev,
    checklistItems: prev.checklistItems.map(c => c.id === id ? { ...c, completed: !c.completed, completedAt: !c.completed ? new Date().toISOString() : undefined } : c)
  }))

  const done = t.checklistItems.filter(c => c.completed).length
  const total = t.checklistItems.length
  const pct = total > 0 ? Math.round(done / total * 100) : 0

  const TABS = [{ value: 'info', label: '📋 Info' }, { value: 'checklist', label: `✅ Checklist${total > 0 ? ` (${done}/${total})` : ''}` }, { value: 'fields', label: '📝 Campos' }]

  return (
    <Modal open onClose={onClose} size="lg" title={t.title || 'Tarea'}>
      <div className="space-y-4">
        <Tabs value={tab} onChange={setTab} tabs={TABS} />

        {tab === 'info' && (
          <div className="space-y-4">
            <div>
              <Label>Título</Label>
              <Input className="mt-1" value={t.title} onChange={e => upd('title', e.target.value)} />
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea className="mt-1" rows={3} value={t.description} onChange={e => upd('description', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Estado</Label>
                <Select className="mt-1" value={t.status} onChange={e => upd('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </Select>
              </div>
              <div>
                <Label>Prioridad</Label>
                <Select className="mt-1" value={t.priority} onChange={e => upd('priority', e.target.value)}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
              <div>
                <Label>Local</Label>
                <Select className="mt-1" value={t.locationId} onChange={e => upd('locationId', e.target.value)}>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>Asignado a</Label>
                <Input className="mt-1" value={t.assignedTo} onChange={e => upd('assignedTo', e.target.value)} placeholder="Nombre o rol" />
              </div>
              <div>
                <Label>Fecha límite</Label>
                <Input className="mt-1" type="date" value={t.dueDate} onChange={e => upd('dueDate', e.target.value)} />
              </div>
              <div>
                <Label>Rol requerido</Label>
                <Select className="mt-1" value={t.role} onChange={e => upd('role', e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </Select>
              </div>
            </div>
          </div>
        )}

        {tab === 'checklist' && (
          <div className="space-y-3">
            {total > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div className="bg-teal-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm font-medium text-gray-600">{pct}%</span>
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => {
              const item: ChecklistItem = { id: `cl-${Date.now()}`, text: '', required: false, completed: false }
              setT(prev => ({ ...prev, checklistItems: [...prev.checklistItems, item] }))
            }}>+ Añadir item</Button>
            {t.checklistItems.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-400 text-sm">Sin items en el checklist</p></Card>
            ) : t.checklistItems.map((c, i) => (
              <div key={c.id} className={`flex items-center gap-3 p-3 rounded-xl border ${c.completed ? 'bg-emerald-50 border-emerald-200' : 'bg-white'}`}>
                <input type="checkbox" checked={!!c.completed} onChange={() => toggleChecklist(c.id)} className="rounded w-4 h-4 accent-teal-600" />
                <Input
                  value={c.text}
                  onChange={e => setT(prev => ({ ...prev, checklistItems: prev.checklistItems.map(x => x.id === c.id ? { ...x, text: e.target.value } : x) }))}
                  className={`flex-1 border-0 bg-transparent p-0 focus:ring-0 text-sm ${c.completed ? 'line-through text-gray-400' : ''}`}
                  placeholder={`Item ${i + 1}...`}
                />
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input type="checkbox" checked={c.required} onChange={e => setT(prev => ({ ...prev, checklistItems: prev.checklistItems.map(x => x.id === c.id ? { ...x, required: e.target.checked } : x) }))} />
                    obligatorio
                  </label>
                  <button onClick={() => setT(prev => ({ ...prev, checklistItems: prev.checklistItems.filter(x => x.id !== c.id) }))} className="text-gray-300 hover:text-red-500 text-xs">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'fields' && (
          <div className="space-y-3">
            <Button size="sm" variant="outline" onClick={() => {
              const f: TaskField = { id: `f-${Date.now()}`, label: '', type: 'text', required: false, value: '' }
              setT(prev => ({ ...prev, fields: [...prev.fields, f] }))
            }}>+ Añadir campo</Button>
            {t.fields.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-400 text-sm">Sin campos adicionales</p></Card>
            ) : t.fields.map(f => (
              <Card key={f.id} className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={f.label} onChange={e => setT(prev => ({ ...prev, fields: prev.fields.map(x => x.id === f.id ? { ...x, label: e.target.value } : x) }))} placeholder="Nombre del campo" className="flex-1" />
                  <Select value={f.type} onChange={e => setT(prev => ({ ...prev, fields: prev.fields.map(x => x.id === f.id ? { ...x, type: e.target.value as TaskField['type'] } : x) }))} className="w-36">
                    {['text', 'number', 'datetime', 'textarea', 'temperature'].map(tp => <option key={tp} value={tp}>{tp}</option>)}
                  </Select>
                  <button onClick={() => setT(prev => ({ ...prev, fields: prev.fields.filter(x => x.id !== f.id) }))} className="text-gray-300 hover:text-red-500">✕</button>
                </div>
                <Input value={f.value || ''} onChange={e => setT(prev => ({ ...prev, fields: prev.fields.map(x => x.id === f.id ? { ...x, value: e.target.value } : x) }))} placeholder={`Valor de ${f.label}...`} />
              </Card>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t">
          <Button variant="danger" size="sm" onClick={() => { if (confirm('¿Eliminar?')) onDelete(t.id) }}>Eliminar</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => onSave(t)}>Guardar</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
