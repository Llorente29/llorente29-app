// src/modules/pos/components/DiningRoomSettings.tsx
//
// TPV · Sala (S1) — oficina. Montar la sala de un local: zonas (sala, terraza,
// barra, reservado) y sus mesas, en rejilla ordenada. Pensado para que un
// administrativo monte un restaurante en diez minutos sin ayuda: las mesas se
// crean de golpe («1-6» o «1, 2, 3, B1»), se ordenan con flechas y se
// ensanchan las que son largas. Nada de arrastrar.
//
// Tema claro del admin (no el oscuro del TPV): vive en la ficha del local.

import { useCallback, useEffect, useState } from 'react'
import { LayoutGrid, Plus, Loader2, ArrowUp, ArrowDown, Trash2, AlertCircle, Users, MoveHorizontal } from 'lucide-react'
import {
  listDiningLayout, createZone, updateZone, retireZone, createTables, updateTable, retireTable, setWarnMinutes,
  type DiningZoneRow, type DiningTableRow, type ZoneKind,
} from '@/modules/pos/services/posTableService'
import { parseTableNames } from '@/modules/pos/lib/parseTableNames'

const KINDS: { code: ZoneKind; label: string }[] = [
  { code: 'sala', label: 'Sala' },
  { code: 'terraza', label: 'Terraza' },
  { code: 'barra', label: 'Barra' },
  { code: 'reservado', label: 'Reservado' },
]

const inputCls = 'border border-border-default rounded-md px-3 py-1.5 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent'
const iconBtn = 'w-8 h-8 inline-flex items-center justify-center rounded-md text-text-secondary hover:bg-page hover:text-text-primary disabled:opacity-30'

export default function DiningRoomSettings({ accountId, locationId }: { accountId: string; locationId: string }) {
  const [zones, setZones] = useState<DiningZoneRow[]>([])
  const [tables, setTables] = useState<DiningTableRow[]>([])
  const [warn, setWarn] = useState(90)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const [newZoneName, setNewZoneName] = useState('')
  const [newZoneKind, setNewZoneKind] = useState<ZoneKind>('sala')
  const [addFor, setAddFor] = useState<Record<string, { names: string; seats: number }>>({})

  const load = useCallback(() => listDiningLayout(accountId, locationId).then(r => {
    setZones(r.zones); setTables(r.tables); setWarn(r.warnMinutes)
  }), [accountId, locationId])
  useEffect(() => {
    let cancelled = false
    listDiningLayout(accountId, locationId)
      .then(r => { if (!cancelled) { setZones(r.zones); setTables(r.tables); setWarn(r.warnMinutes) } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando la sala.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, locationId])

  async function run(fn: () => Promise<string | null>) {
    setSaving(true); setError(null); setDone(null)
    try { const msg = await fn(); await load(); if (msg) setDone(msg) } catch (e: unknown) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setSaving(false) }
  }

  function addZone() {
    const name = newZoneName.trim()
    if (!name) { setError('Pon un nombre a la zona.'); return }
    void run(async () => {
      await createZone(accountId, locationId, name, newZoneKind, (zones.at(-1)?.sortOrder ?? 0) + 1)
      setNewZoneName('')
      return `Zona «${name}» creada. Ahora añádele mesas.`
    })
  }

  function moveZone(i: number, dir: -1 | 1) {
    const a = zones[i], b = zones[i + dir]
    if (!a || !b) return
    void run(async () => {
      const order = zones.map(z => z.id)
      ;[order[i], order[i + dir]] = [order[i + dir], order[i]]
      for (let k = 0; k < order.length; k++) await updateZone(order[k], { sortOrder: k + 1 })
      return null
    })
  }

  function addTables(zone: DiningZoneRow) {
    const f = addFor[zone.id] ?? { names: '', seats: 4 }
    const parsed = parseTableNames(f.names)
    if (parsed.error) { setError(parsed.error); return }
    const zt = tables.filter(t => t.zoneId === zone.id)
    void run(async () => {
      await createTables(accountId, locationId, zone.id, parsed.names, f.seats, (zt.at(-1)?.sortOrder ?? 0) + 1)
      setAddFor(prev => ({ ...prev, [zone.id]: { names: '', seats: f.seats } }))
      return `${parsed.names.length} mesa(s) añadidas a ${zone.name}: ${parsed.names.join(', ')}.`
    })
  }

  function moveTable(zt: DiningTableRow[], i: number, dir: -1 | 1) {
    const a = zt[i], b = zt[i + dir]
    if (!a || !b) return
    void run(async () => {
      // Se reescribe el orden de toda la zona: así dos mesas con el mismo
      // número de orden (creadas a mano) no se quedan pegadas.
      const order = zt.map(t => t.id)
      ;[order[i], order[i + dir]] = [order[i + dir], order[i]]
      for (let k = 0; k < order.length; k++) await updateTable(order[k], { sortOrder: k + 1 })
      return null
    })
  }

  return (
    <div className="rounded-xl border border-border-default bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
        <LayoutGrid size={18} className="text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">Sala y mesas (TPV)</h2>
        {saving && <Loader2 size={14} className="animate-spin text-text-secondary ml-auto" />}
      </div>

      <div className="px-4 py-4 space-y-4">
        <p className="text-xs text-text-secondary">
          Las zonas salen como pestañas en la Sala del TPV y las mesas, en este orden, en su rejilla.
          Una mesa larga puede ocupar dos huecos. El nombre de cada mesa es único en el local.
        </p>

        {error && <p className="text-xs text-danger inline-flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}</p>}
        {done && <p className="text-xs text-success font-medium">{done}</p>}
        {loading && <Loader2 size={16} className="animate-spin text-text-secondary" />}

        {zones.map((z, zi) => {
          const zt = tables.filter(t => t.zoneId === z.id)
          const f = addFor[z.id] ?? { names: '', seats: 4 }
          return (
            <div key={z.id} className="rounded-lg border border-border-default p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  defaultValue={z.name}
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== z.name) void run(async () => { await updateZone(z.id, { name: v }); return `Zona renombrada a «${v}».` }) }}
                  className={`${inputCls} font-semibold flex-1 min-w-[140px]`}
                  aria-label="Nombre de la zona"
                />
                <select value={z.kind} onChange={e => void run(async () => { await updateZone(z.id, { kind: e.target.value as ZoneKind }); return null })} className={inputCls} aria-label="Tipo de zona">
                  {KINDS.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
                </select>
                <button type="button" className={iconBtn} disabled={zi === 0 || saving} onClick={() => moveZone(zi, -1)} aria-label="Subir zona"><ArrowUp size={16} /></button>
                <button type="button" className={iconBtn} disabled={zi === zones.length - 1 || saving} onClick={() => moveZone(zi, 1)} aria-label="Bajar zona"><ArrowDown size={16} /></button>
                <button type="button" className={iconBtn} disabled={saving} onClick={() => void run(async () => { await retireZone(z.id); return `Zona «${z.name}» quitada.` })} aria-label="Quitar zona"><Trash2 size={16} /></button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {zt.map((t, ti) => (
                  <div key={t.id} className={`rounded-md border border-border-default bg-page p-2 space-y-1.5 ${t.gridWidth >= 2 ? 'col-span-2' : ''}`}>
                    <div className="flex items-center gap-1">
                      <input
                        defaultValue={t.name}
                        onBlur={e => { const v = e.target.value.trim(); if (v && v !== t.name) void run(async () => { await updateTable(t.id, { name: v }); return `Mesa renombrada a «${v}».` }) }}
                        className={`${inputCls} w-full font-semibold`}
                        aria-label="Nombre de la mesa"
                      />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-text-secondary">
                      <Users size={13} aria-hidden />
                      <input
                        type="number" min={1} max={99} defaultValue={t.seats}
                        onBlur={e => { const v = parseInt(e.target.value, 10); if (v >= 1 && v !== t.seats) void run(async () => { await updateTable(t.id, { seats: v }); return null }) }}
                        className={`${inputCls} w-16 px-2 py-1`}
                        aria-label="Sitios"
                      />
                      <span className="flex-1" />
                      <button type="button" className={iconBtn} disabled={saving} onClick={() => void run(async () => { await updateTable(t.id, { gridWidth: t.gridWidth >= 2 ? 1 : 2 }); return null })} aria-label={t.gridWidth >= 2 ? 'Estrechar' : 'Ensanchar'} title={t.gridWidth >= 2 ? 'Ocupa 2 huecos — estrechar' : 'Ensanchar a 2 huecos'}><MoveHorizontal size={15} /></button>
                      <button type="button" className={iconBtn} disabled={ti === 0 || saving} onClick={() => moveTable(zt, ti, -1)} aria-label="Antes"><ArrowUp size={15} className="-rotate-90" /></button>
                      <button type="button" className={iconBtn} disabled={ti === zt.length - 1 || saving} onClick={() => moveTable(zt, ti, 1)} aria-label="Después"><ArrowDown size={15} className="-rotate-90" /></button>
                      <button type="button" className={iconBtn} disabled={saving} onClick={() => void run(async () => { await retireTable(t.id); return `Mesa ${t.name} quitada.` })} aria-label="Quitar mesa"><Trash2 size={15} /></button>
                    </div>
                  </div>
                ))}
                {zt.length === 0 && <p className="col-span-full text-xs text-text-tertiary">Sin mesas todavía.</p>}
              </div>

              <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border-default">
                <label className="flex-1 min-w-[160px]">
                  <span className="text-xs text-text-secondary uppercase font-medium">Añadir mesas</span>
                  <input
                    value={f.names}
                    onChange={e => setAddFor(prev => ({ ...prev, [z.id]: { ...f, names: e.target.value } }))}
                    onKeyDown={e => { if (e.key === 'Enter') addTables(z) }}
                    placeholder="1-6  ·  o  T1, T2, Barra 1"
                    className={`${inputCls} mt-1 w-full`}
                  />
                </label>
                <label>
                  <span className="text-xs text-text-secondary uppercase font-medium">Sitios</span>
                  <input type="number" min={1} max={99} value={f.seats}
                    onChange={e => setAddFor(prev => ({ ...prev, [z.id]: { ...f, seats: Math.max(1, parseInt(e.target.value, 10) || 1) } }))}
                    className={`${inputCls} mt-1 w-20`} />
                </label>
                <button type="button" onClick={() => addTables(z)} disabled={saving || !f.names.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-text-on-accent text-sm font-medium disabled:opacity-50">
                  <Plus size={15} /> Añadir
                </button>
              </div>
            </div>
          )
        })}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[160px]">
            <span className="text-xs text-text-secondary uppercase font-medium">Nueva zona</span>
            <input value={newZoneName} onChange={e => setNewZoneName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addZone() }}
              placeholder="Sala, Terraza, Barra…" className={`${inputCls} mt-1 w-full`} />
          </label>
          <select value={newZoneKind} onChange={e => setNewZoneKind(e.target.value as ZoneKind)} className={inputCls} aria-label="Tipo de la nueva zona">
            {KINDS.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
          </select>
          <button type="button" onClick={addZone} disabled={saving || !newZoneName.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-text-on-accent text-sm font-medium disabled:opacity-50">
            <Plus size={15} /> Crear zona
          </button>
        </div>

        <div className="pt-3 border-t border-border-default">
          <label className="text-xs text-text-secondary uppercase font-medium">Avisar en ámbar a partir de (minutos de mesa abierta)</label>
          <input type="number" min={5} max={600} value={warn}
            onChange={e => setWarn(parseInt(e.target.value, 10) || 90)}
            onBlur={() => void run(async () => { await setWarnMinutes(accountId, locationId, Math.min(600, Math.max(5, warn))); return `Umbral guardado: ${warn} min.` })}
            className={`${inputCls} mt-1 w-28 block`} />
        </div>
      </div>
    </div>
  )
}
