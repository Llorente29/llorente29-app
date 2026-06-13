// src/modules/kds/components/StationsSettings.tsx
//
// Ajustes · Estaciones de cocina (por local). Listar / crear / renombrar /
// activar-desactivar / tipo (prep|expo). La estación 'expo' es la que, al
// completarse, da el pedido por servido (lo decide el backend; aquí solo se
// configura el tipo).

import { useEffect, useState } from 'react'
import { Plus, Loader2, Check, X, Pencil } from 'lucide-react'
import { Button, Input, Select, Badge } from '../../../components/ui'
import {
  listStations, createStation, updateStation, setDefaultStation,
  type KitchenStation, type StationKind,
} from '../services/kdsService'

interface Props { accountId: string; locationId: string }

export default function StationsSettings({ accountId, locationId }: Props) {
  const [stations, setStations] = useState<KitchenStation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form de alta
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<StationKind>('prep')

  // Edición inline
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  async function load() {
    setLoading(true)
    try {
      setStations(await listStations(accountId, locationId))
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando estaciones')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [accountId, locationId])

  async function handleCreate() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await createStation({
        accountId, locationId, name: newName, kind: newKind,
        displayOrder: stations.length,
      })
      setNewName(''); setNewKind('prep')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error creando la estación')
    } finally {
      setSaving(false)
    }
  }

  async function handlePatch(id: string, patch: Parameters<typeof updateStation>[1]) {
    setSaving(true)
    try { await updateStation(id, patch); await load() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error guardando') }
    finally { setSaving(false) }
  }

  function startEdit(s: KitchenStation) { setEditId(s.id); setEditName(s.name) }
  async function commitEdit() {
    if (editId && editName.trim()) await handlePatch(editId, { name: editName })
    setEditId(null)
  }

  // Fija la estación por defecto del local (UNA por local; el servicio hace el
  // orden seguro false→true para no chocar con el índice único parcial).
  async function handleSetDefault(id: string) {
    setSaving(true)
    try { await setDefaultStation(accountId, locationId, id); await load() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error fijando la estación por defecto') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Las estaciones organizan el tablero por puesto de cocina. Marca como <strong>Expo</strong> la
        estación de pase: cuando se completa, el pedido se da por servido. El <strong>radio «por
        defecto»</strong> (uno por local) recibe las líneas sin ruteo específico: esos platos se
        preparan en esa estación.
      </p>

      {error && <div className="text-sm text-danger">{error}</div>}

      {/* Alta */}
      <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg bg-page border border-border-default">
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs font-medium text-text-secondary">Nombre</label>
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Plancha, Fríos, Pase…"
            onKeyDown={e => { if (e.key === 'Enter') void handleCreate() }}
          />
        </div>
        <div className="w-32">
          <label className="text-xs font-medium text-text-secondary">Tipo</label>
          <Select value={newKind} onChange={e => setNewKind(e.target.value as StationKind)}>
            <option value="prep">Preparación</option>
            <option value="expo">Expo / Pase</option>
          </Select>
        </div>
        <Button onClick={() => void handleCreate()} disabled={saving || !newName.trim()}>
          <Plus size={16} /> Añadir
        </Button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary py-6"><Loader2 className="animate-spin" size={18} /> Cargando…</div>
      ) : stations.length === 0 ? (
        <p className="text-sm text-text-secondary py-4">Aún no hay estaciones en este local.</p>
      ) : (
        <ul className="divide-y divide-border-default rounded-lg border border-border-default">
          {stations.map(s => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              {editId === s.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="flex-1"
                    onKeyDown={e => { if (e.key === 'Enter') void commitEdit() }}
                    autoFocus
                  />
                  <Button size="sm" onClick={() => void commitEdit()} disabled={saving}><Check size={15} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditId(null)}><X size={15} /></Button>
                </>
              ) : (
                <>
                  <label
                    className={`shrink-0 flex items-center ${s.isActive ? 'cursor-pointer' : 'opacity-40'}`}
                    title={s.isActive ? 'Estación por defecto del local' : 'Activa la estación para poder ponerla por defecto'}
                  >
                    <input
                      type="radio"
                      name={`kds-default-${locationId}`}
                      checked={s.isDefault}
                      disabled={!s.isActive || saving}
                      onChange={() => void handleSetDefault(s.id)}
                      className="w-4 h-4 accent-accent"
                    />
                  </label>
                  <span className={`flex-1 font-medium ${s.isActive ? 'text-text-primary' : 'text-text-secondary line-through'}`}>
                    {s.name}
                  </span>
                  {s.isDefault && <Badge color="blue">Por defecto</Badge>}
                  <Badge color={s.kind === 'expo' ? 'violet' : 'gray'}>
                    {s.kind === 'expo' ? 'Expo / Pase' : 'Preparación'}
                  </Badge>
                  <button onClick={() => startEdit(s)} className="p-1.5 rounded-md hover:bg-page text-text-secondary" title="Renombrar">
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => void handlePatch(s.id, { kind: s.kind === 'expo' ? 'prep' : 'expo' })}
                    className="text-xs text-accent hover:underline"
                    title="Cambiar tipo"
                  >
                    {s.kind === 'expo' ? '→ Prep' : '→ Expo'}
                  </button>
                  <button
                    onClick={() => void handlePatch(s.id, { isActive: !s.isActive })}
                    className={`text-xs hover:underline ${s.isActive ? 'text-danger' : 'text-success'}`}
                  >
                    {s.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
