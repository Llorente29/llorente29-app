// src/modules/kds/components/DevicesSettings.tsx
//
// Ajustes · Dispositivos / tablets. Crea un kds_device con token largo aleatorio
// generado en cliente, asigna local + estaciones (station_ids; vacío = todas),
// copia la URL del kiosco (/kds?token=...) y permite revocar (is_active=false).
// Muestra last_seen_at.

import { useEffect, useMemo, useState } from 'react'
import { Plus, Loader2, Copy, Check, Tablet, Ban } from 'lucide-react'
import { Button, Input, Badge } from '../../../components/ui'
import {
  listDevices, createDevice, revokeDevice, generateDeviceToken, listStations,
  type KdsDevice, type KitchenStation,
} from '../services/kdsService'

interface Props { accountId: string; locationId: string }

function kioskUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/kds?token=${token}`
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return 'Nunca conectado'
  const d = new Date(iso)
  return `Visto: ${d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`
}

export default function DevicesSettings({ accountId, locationId }: Props) {
  const [devices, setDevices] = useState<KdsDevice[]>([])
  const [stations, setStations] = useState<KitchenStation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Form de alta
  const [label, setLabel] = useState('')
  const [selStations, setSelStations] = useState<string[]>([]) // vacío = todas

  async function load() {
    setLoading(true)
    try {
      const [devs, sts] = await Promise.all([
        listDevices(accountId, locationId),
        listStations(accountId, locationId),
      ])
      setDevices(devs)
      setStations(sts.filter(s => s.isActive))
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando dispositivos')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [accountId, locationId])

  const stationNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of stations) m[s.id] = s.name
    return m
  }, [stations])

  async function handleCreate() {
    if (!label.trim()) return
    setSaving(true)
    try {
      await createDevice({
        accountId, locationId, label,
        stationIds: selStations.length > 0 ? selStations : null,
        token: generateDeviceToken(),
      })
      setLabel(''); setSelStations([])
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error creando el dispositivo')
    } finally {
      setSaving(false)
    }
  }

  async function handleRevoke(id: string) {
    setSaving(true)
    try { await revokeDevice(id); await load() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error revocando') }
    finally { setSaving(false) }
  }

  async function handleCopy(device: KdsDevice) {
    try {
      await navigator.clipboard.writeText(kioskUrl(device.token))
      setCopiedId(device.id)
      window.setTimeout(() => setCopiedId(c => (c === device.id ? null : c)), 1800)
    } catch {
      setError('No se pudo copiar al portapapeles.')
    }
  }

  function toggleSel(id: string) {
    setSelStations(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Cada tablet/TV de cocina es un dispositivo con su token. Abre la URL del kiosco en el
        dispositivo para vincularlo. Si no eliges estaciones, mostrará <strong>todas</strong>.
      </p>

      {error && <div className="text-sm text-danger">{error}</div>}

      {/* Alta */}
      <div className="p-3 rounded-lg bg-page border border-border-default space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs font-medium text-text-secondary">Nombre del dispositivo</label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Tablet plancha, TV pase…" />
          </div>
          <Button onClick={() => void handleCreate()} disabled={saving || !label.trim()}>
            <Plus size={16} /> Crear dispositivo
          </Button>
        </div>
        {stations.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-secondary">Estaciones que muestra (vacío = todas)</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {stations.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSel(s.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium ring-1 transition-colors ${
                    selStations.includes(s.id)
                      ? 'bg-accent text-text-on-accent ring-transparent'
                      : 'bg-card text-text-secondary ring-border-default hover:text-text-primary'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary py-6"><Loader2 className="animate-spin" size={18} /> Cargando…</div>
      ) : devices.length === 0 ? (
        <p className="text-sm text-text-secondary py-4">Aún no hay dispositivos en este local.</p>
      ) : (
        <ul className="space-y-2">
          {devices.map(d => (
            <li key={d.id} className={`flex items-center gap-3 px-3 py-3 rounded-lg border ${d.isActive ? 'border-border-default bg-card' : 'border-border-default bg-page opacity-60'}`}>
              <Tablet size={20} className="text-text-secondary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary truncate">{d.label}</span>
                  {!d.isActive && <Badge color="red">Revocado</Badge>}
                </div>
                <div className="text-xs text-text-secondary mt-0.5">
                  {d.stationIds && d.stationIds.length > 0
                    ? d.stationIds.map(id => stationNames[id] ?? '¿?').join(' · ')
                    : 'Todas las estaciones'}
                  {' · '}{formatLastSeen(d.lastSeenAt)}
                </div>
              </div>
              {d.isActive && (
                <>
                  <Button size="sm" variant="outline" onClick={() => void handleCopy(d)}>
                    {copiedId === d.id ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> URL kiosco</>}
                  </Button>
                  <button
                    onClick={() => void handleRevoke(d.id)}
                    className="p-2 rounded-md hover:bg-danger-bg text-text-secondary hover:text-danger"
                    title="Revocar"
                  >
                    <Ban size={16} />
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
