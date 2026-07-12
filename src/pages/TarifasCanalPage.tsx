// src/pages/TarifasCanalPage.tsx
//
// Configuración de tarifas de canal: comisiones por canal (defecto) y override
// por marca y local. Escribe en channel_rate + brand_channel_rate (con location_id).
// Multi-tenant: cada cuenta ve/edita solo lo suyo (RLS). La resolución en cascada
// (marca+local > marca > defecto) la calcula SQL: resolve_channel_commission.

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  loadTariffs, saveChannelDefault, saveOverride, deleteOverride,
  SERVICE_TYPES, SERVICE_LABEL,
  type TariffsData, type ServiceType, type RateOverride,
} from '@/modules/ventas/services/channelRatesService'

const NAVY = '#1E3A5F', CORAL = '#FF5436', AMBER = '#B87400', MUT = '#6b7686', LINE = '#e6e9ef'
const pctStr = (n: number | null | undefined) => (n == null ? '—' : `${n}%`)

export default function TarifasCanalPage() {
  const { activeAccountId } = useActiveAccount()
  const [data, setData] = useState<TariffsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [channelId, setChannelId] = useState<string | null>(null)

  async function reload() {
    if (!activeAccountId) return
    setLoading(true); setErr(null)
    try {
      const d = await loadTariffs(activeAccountId)
      setData(d)
      setChannelId(prev => prev ?? d.channels.find(c => c.slug === 'uber')?.id ?? d.channels[0]?.id ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error cargando tarifas')
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [activeAccountId])

  const channel = useMemo(
    () => data?.channels.find(c => c.id === channelId) ?? null,
    [data, channelId],
  )

  if (loading) return <div style={{ padding: 24, color: MUT }}>Cargando tarifas…</div>
  if (err) return <div style={{ padding: 24, color: '#C0392B' }}>Error: {err}</div>
  if (!data || !channel) return <div style={{ padding: 24, color: MUT }}>Sin canales configurados.</div>

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 18px 80px', fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>Configuración de tarifas de canal</h1>
          <div style={{ color: MUT, fontSize: 12.5, marginTop: 2 }}>Comisiones por canal, marca y local · alimenta el módulo de Ventas</div>
        </div>
      </div>

      {/* Selector de canal */}
      <div style={{ display: 'flex', gap: 7, margin: '16px 0 14px', flexWrap: 'wrap' }}>
        {data.channels.map(c => (
          <button key={c.id} onClick={() => setChannelId(c.id)}
            style={{
              border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 15px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', background: c.id === channelId ? NAVY : '#fff', color: c.id === channelId ? '#fff' : '#475569',
            }}>{c.name}</button>
        ))}
      </div>

      <ChannelDefaults key={channel.id} accountId={activeAccountId!} data={data} channelId={channel.id}
        onSaved={reload} setSaving={setSaving} saving={saving} />

      <OverridesCard accountId={activeAccountId!} data={data} channelId={channel.id} onChanged={reload} />

      <ResolutionCard />
    </div>
  )
}

// ── Defaults por canal ────────────────────────────────────────────────────────

function ChannelDefaults(props: {
  accountId: string; data: TariffsData; channelId: string
  onSaved: () => void; setSaving: (b: boolean) => void; saving: boolean
}) {
  const { accountId, data, channelId } = props
  const defs = SERVICE_TYPES.map(st => {
    const d = data.defaults.find(x => x.channelId === channelId && x.serviceType === st)
    return { st, pct: d?.commissionPct ?? null, rider: d?.ownCourierCost ?? null }
  })
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(defs.map(d => [d.st, d.pct != null ? String(d.pct) : ''])),
  )
  const ownDef = defs.find(d => d.st === 'own_delivery')
  const [rider, setRider] = useState<string>(ownDef?.rider != null ? String(ownDef.rider) : '')

  async function save() {
    props.setSaving(true)
    try {
      for (const st of SERVICE_TYPES) {
        const v = parseFloat(draft[st])
        if (!isNaN(v)) {
          await saveChannelDefault(accountId, channelId, st, v,
            st === 'own_delivery' ? (parseFloat(rider) || null) : null)
        }
      }
      props.onSaved()
    } catch (e) { alert(e instanceof Error ? e.message : 'Error guardando') }
    finally { props.setSaving(false) }
  }

  return (
    <div style={card}>
      <h3 style={h3}>Tarifas por defecto del canal</h3>
      <div style={cd}>Se aplican a todas las marcas salvo que una tenga override. La comisión es un número entero.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 }}>
        {defs.map(d => (
          <div key={d.st} style={{ border: `1px solid ${LINE}`, borderRadius: 11, padding: '12px 14px', background: '#fafbfd' }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{SERVICE_LABEL[d.st]}</div>
            <div style={{ fontSize: 11.5, color: MUT, margin: '2px 0 8px' }}>{d.st}</div>
            <input value={draft[d.st] ?? ''} onChange={e => setDraft({ ...draft, [d.st]: e.target.value })}
              style={numInp} inputMode="decimal" />
            <span style={{ fontSize: 12.5, color: MUT, marginLeft: 5, fontWeight: 600 }}>% comisión</span>
          </div>
        ))}
        <div style={{ border: '1px solid #cfe8db', borderRadius: 11, padding: '12px 14px', background: '#f0f8f4' }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Coste de tu repartidor</div>
          <div style={{ fontSize: 11.5, color: MUT, margin: '2px 0 8px' }}>Reparto propio · para comparar propio vs plataforma</div>
          <input value={rider} onChange={e => setRider(e.target.value)} style={numInp} inputMode="decimal" />
          <span style={{ fontSize: 12.5, color: MUT, marginLeft: 5, fontWeight: 600 }}>€ / pedido</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={save} disabled={props.saving} style={btnPrimary}>{props.saving ? 'Guardando…' : 'Guardar defaults'}</button>
      </div>
    </div>
  )
}

// ── Overrides por marca y local ───────────────────────────────────────────────

function OverridesCard(props: { accountId: string; data: TariffsData; channelId: string; onChanged: () => void }) {
  const { accountId, data, channelId } = props
  const [adding, setAdding] = useState(false)

  // Agrupamos overrides del canal por (marca, local) para mostrar una fila con sus 3 modos
  const rows = useMemo(() => {
    const map = new Map<string, { brandId: string; locationId: string | null; items: RateOverride[] }>()
    for (const o of data.overrides.filter(o => o.channelId === channelId)) {
      const key = `${o.brandId}|${o.locationId ?? ''}`
      if (!map.has(key)) map.set(key, { brandId: o.brandId, locationId: o.locationId, items: [] })
      map.get(key)!.items.push(o)
    }
    return [...map.values()]
  }, [data, channelId])

  const brandName = (id: string) => data.brands.find(b => b.id === id)?.name ?? '—'
  const locName = (id: string | null) => (id ? data.locations.find(l => l.id === id)?.name ?? '—' : '(todos)')

  return (
    <div style={card}>
      <h3 style={h3}>Override por marca y local</h3>
      <div style={cd}>Cada marca hereda el defecto del canal. Solo defines las que difieran. Puedes fijar una marca entera o solo un local.</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr>
          {['Marca', 'Local', 'Reparto plataforma', 'Recogida', 'Reparto propio', ''].map((h, i) => (
            <th key={i} style={{ ...th, textAlign: i < 2 ? 'left' : 'right' }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: MUT, padding: 22 }}>
              Sin overrides — todas las marcas usan el defecto del canal.
            </td></tr>
          )}
          {rows.map((r, i) => {
            const cell = (st: ServiceType) => r.items.find(x => x.serviceType === st)?.commissionPct
            return (
              <tr key={i}>
                <td style={td}>{brandName(r.brandId)}</td>
                <td style={{ ...td, color: MUT }}>{locName(r.locationId)}</td>
                {SERVICE_TYPES.map(st => (
                  <td key={st} style={{ ...td, textAlign: 'right', fontWeight: 700, color: cell(st) != null ? AMBER : '#c9ced8' }}>
                    {cell(st) != null ? pctStr(cell(st)) : '—'}
                  </td>
                ))}
                <td style={{ ...td, textAlign: 'right' }}>
                  <button style={btnLink} onClick={async () => {
                    for (const it of r.items) await deleteOverride(it.id)
                    props.onChanged()
                  }}>Quitar</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {adding
        ? <AddOverrideForm accountId={accountId} data={data} channelId={channelId}
            onDone={() => { setAdding(false); props.onChanged() }} onCancel={() => setAdding(false)} />
        : <button style={addBtn} onClick={() => setAdding(true)}>+ Añadir excepción (marca o marca + local)</button>}
    </div>
  )
}

function AddOverrideForm(props: {
  accountId: string; data: TariffsData; channelId: string; onDone: () => void; onCancel: () => void
}) {
  const { accountId, data, channelId } = props
  const [brandId, setBrandId] = useState(data.brands[0]?.id ?? '')
  const [locationId, setLocationId] = useState('') // '' = todos
  const [pct, setPct] = useState<Record<ServiceType, string>>({ platform_delivery: '', pickup: '', own_delivery: '' })
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      for (const st of SERVICE_TYPES) {
        const v = parseFloat(pct[st])
        if (!isNaN(v)) {
          await saveOverride({
            accountId, brandId, channelId, locationId: locationId || null,
            serviceType: st, commissionPct: v, ownCourierCost: null,
          })
        }
      }
      props.onDone()
    } catch (e) { alert(e instanceof Error ? e.message : 'Error guardando') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ border: `1px dashed ${LINE}`, borderRadius: 10, padding: 14, marginTop: 10, background: '#fafbfd' }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={lbl}>Marca
          <select value={brandId} onChange={e => setBrandId(e.target.value)} style={sel}>
            {data.brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label style={lbl}>Local
          <select value={locationId} onChange={e => setLocationId(e.target.value)} style={sel}>
            <option value="">(todos)</option>
            {data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {SERVICE_TYPES.map(st => (
          <label key={st} style={lbl}>{SERVICE_LABEL[st]}
            <input value={pct[st]} onChange={e => setPct({ ...pct, [st]: e.target.value })}
              placeholder="%" style={{ ...numInp, width: 64 }} inputMode="decimal" />
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button style={btn} onClick={props.onCancel}>Cancelar</button>
        <button style={btnPrimary} disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar excepción'}</button>
      </div>
      <div style={{ fontSize: 11.5, color: MUT, marginTop: 8 }}>Deja en blanco los modos que no quieras fijar: heredarán el defecto del canal.</div>
    </div>
  )
}

function ResolutionCard() {
  return (
    <div style={card}>
      <h3 style={h3}>Cómo se resuelve la tarifa de un pedido</h3>
      <div style={cd}>El módulo busca la más específica primero y cae hacia el defecto.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: '#445' }}>
        <span style={{ ...step, borderColor: CORAL, color: CORAL }}>1 · Marca + Local</span><span style={{ color: MUT }}>→</span>
        <span style={{ ...step, borderColor: AMBER, color: AMBER }}>2 · Marca (todos los locales)</span><span style={{ color: MUT }}>→</span>
        <span style={{ ...step, borderColor: NAVY, color: NAVY }}>3 · Defecto del canal</span>
      </div>
    </div>
  )
}

// estilos
const card: CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px', marginBottom: 15 }
const h3: CSSProperties = { margin: '0 0 3px', fontSize: 15 }
const cd: CSSProperties = { color: MUT, fontSize: 12, marginBottom: 14, lineHeight: 1.4 }
const th: CSSProperties = { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.3px', color: MUT, fontWeight: 600, background: '#fafbfd', padding: '8px 9px', borderBottom: `1px solid ${LINE}` }
const td: CSSProperties = { padding: '8px 9px', borderBottom: `1px solid ${LINE}` }
const numInp: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 9px', fontSize: 14, width: 74, fontWeight: 700, color: NAVY, textAlign: 'right' }
const sel: CSSProperties = { display: 'block', marginTop: 4, border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 9px', fontSize: 13, minWidth: 150 }
const lbl: CSSProperties = { fontSize: 11.5, color: MUT, fontWeight: 600 }
const btn: CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, color: NAVY, fontWeight: 600, cursor: 'pointer' }
const btnPrimary: CSSProperties = { ...btn, background: NAVY, color: '#fff', borderColor: 'transparent' }
const btnLink: CSSProperties = { border: 'none', background: 'none', color: CORAL, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }
const addBtn: CSSProperties = { marginTop: 10, fontSize: 12.5, color: NAVY, fontWeight: 600, cursor: 'pointer', background: 'none', border: `1px dashed ${LINE}`, borderRadius: 9, padding: '8px 12px', width: '100%' }
const step: CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: '4px 11px', fontWeight: 600 }
