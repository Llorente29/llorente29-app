// src/pages/VentasDashboardPage.tsx
//
// Dashboard de Ventas (Folvy Sales). Pinta los agregados de la RPC server-side
// `sales_dashboard` (vía salesDashboardService). Cálculo en SQL; aquí solo se
// muestra. Diseño contrastado con el benchmark (Otter / R365 / Apicbase):
// KPIs con nº de pedidos junto al importe (clave para gerentes dark kitchen),
// propias vs cedidas (margen distinto, nadie más lo separa), ventas por canal,
// ranking de marcas y locales, y mapa de calor horario EN HORA LOCAL.
//
// Filtros universales (como Otter/R365): periodo, local, tipo (propia/cedida),
// canal y marca. Todos se envían a la RPC, que filtra server-side.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { supabase } from '@/lib/supabase'
import {
  getSalesDashboard,
  type SalesDashboard,
} from '@/modules/ventas/services/salesDashboardService'

// ── Helpers ──────────────────────────────────────────────────────────────────

const eur = (n: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n ?? 0)

type PeriodKey = 'today' | 'yesterday' | 'last7' | 'month'

function periodRange(key: PeriodKey): { from: Date; to: Date } {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  switch (key) {
    case 'today':
      return { from: startOfToday, to: startOfTomorrow }
    case 'yesterday': {
      const y = new Date(startOfToday)
      y.setDate(y.getDate() - 1)
      return { from: y, to: startOfToday }
    }
    case 'last7': {
      const f = new Date(startOfToday)
      f.setDate(f.getDate() - 6)
      return { from: f, to: startOfTomorrow }
    }
    case 'month': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: f, to: startOfTomorrow }
    }
  }
}

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  last7: '7 días',
  month: 'Este mes',
}

const TERRA = '#D67442'

interface OptionRow {
  id: string
  name: string
}
interface BrandOption extends OptionRow {
  ownershipType: string | null
}

// ── Componentes de presentación ──────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-stone-50 p-4">
      <div className="text-[13px] text-stone-500">{label}</div>
      <div className="text-2xl font-medium text-stone-800 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-stone-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 rounded bg-stone-100">
      <div className="h-2 rounded" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
    </div>
  )
}

function OwnershipPill({ type }: { type: string | null }) {
  const own = type === 'own'
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full"
      style={{ background: own ? '#E1F5EE' : '#FAEEDA', color: own ? '#0F6E56' : '#854F0B' }}
    >
      {own ? 'propia' : 'cedida'}
    </span>
  )
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-600 bg-white hover:border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D67442]/20"
    >
      {children}
    </select>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function VentasDashboardPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [period, setPeriod] = useState<PeriodKey>('today')
  const [locationId, setLocationId] = useState<string>('')
  const [ownership, setOwnership] = useState<string>('')
  const [channel, setChannel] = useState<string>('')
  const [brandId, setBrandId] = useState<string>('')

  const [locations, setLocations] = useState<OptionRow[]>([])
  const [brands, setBrands] = useState<BrandOption[]>([])

  const [data, setData] = useState<SalesDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (accountsLoading || !activeAccountId || !supabase) return
    let cancelled = false

    supabase
      .from('locations')
      .select('id,name')
      .eq('account_id', activeAccountId)
      .order('name')
      .then(({ data }) => {
        if (!cancelled && data) setLocations(data as OptionRow[])
      })

    supabase
      .from('brand')
      .select('id,name,ownership_type')
      .eq('account_id', activeAccountId)
      .is('archived_at', null)
      .order('name')
      .then(({ data }) => {
        if (!cancelled && data) {
          setBrands(
            (data as { id: string; name: string; ownership_type: string | null }[]).map((b) => ({
              id: b.id,
              name: b.name,
              ownershipType: b.ownership_type,
            }))
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeAccountId, accountsLoading])

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) {
      setData(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    const { from, to } = periodRange(period)
    getSalesDashboard({
      accountId: activeAccountId,
      from,
      to,
      locationId: locationId || null,
      brandId: brandId || null,
      ownership: (ownership || null) as 'own' | 'licensed' | null,
      channel: channel || null,
    })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error desconocido')
        setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeAccountId, accountsLoading, period, locationId, ownership, channel, brandId])

  const channelMax = useMemo(
    () => Math.max(1, ...(data?.by_channel ?? []).map((c) => c.net)),
    [data]
  )
  const locationMax = useMemo(
    () => Math.max(1, ...(data?.by_location ?? []).map((l) => l.net)),
    [data]
  )
  const hourMax = useMemo(
    () => Math.max(1, ...(data?.by_hour ?? []).map((h) => h.net)),
    [data]
  )

  const own = data?.by_ownership.find((o) => o.ownership === 'own')
  const lic = data?.by_ownership.find((o) => o.ownership === 'licensed')

  // Variación vs periodo anterior (maneja prev=0 → sin base de comparación).
  const prevNet = data?.prev?.net ?? 0
  const curNet = data?.kpis.net ?? 0
  const deltaPct =
    prevNet > 0 ? Math.round(((curNet - prevNet) / prevNet) * 100) : null
  const periodPrevLabel: Record<PeriodKey, string> = {
    today: 'vs ayer',
    yesterday: 'vs anteayer',
    last7: 'vs 7 días previos',
    month: 'vs mes anterior',
  }

  // Hora pico (para el texto del heatmap).
  const peakHour =
    data && data.by_hour.length > 0
      ? data.by_hour.reduce((a, b) => (b.net > a.net ? b : a)).hour
      : null

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-serif text-stone-800">Ventas</h1>
          <p className="text-sm text-stone-500">Resumen del negocio en tiempo real</p>
        </div>
        <div className="flex gap-1.5">
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                period === k ? 'border-transparent text-white' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
              style={period === k ? { background: TERRA } : undefined}
            >
              {PERIOD_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {/* Fila de filtros */}
      <div className="flex flex-wrap gap-2 mb-5">
        <Select value={locationId} onChange={setLocationId}>
          <option value="">Todos los locales</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
        <Select value={ownership} onChange={setOwnership}>
          <option value="">Propias y cedidas</option>
          <option value="own">Solo propias</option>
          <option value="licensed">Solo cedidas</option>
        </Select>
        <Select value={channel} onChange={setChannel}>
          <option value="">Todos los canales</option>
          <option value="glovo">Glovo</option>
          <option value="uber">Uber</option>
          <option value="justeat">JustEat</option>
        </Select>
        <Select value={brandId} onChange={setBrandId}>
          <option value="">Todas las marcas</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-sm text-stone-400">Cargando ventas…</div>
      ) : !data || data.kpis.orders === 0 ? (
        <div className="py-20 text-center">
          <div className="text-stone-400 text-sm">
            No hay ventas con estos filtros. Prueba a ampliar el periodo o quitar filtros.
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
            <KpiCard label="Ventas netas" value={eur(data.kpis.net)} sub={`${data.kpis.orders} pedidos`} />
            <KpiCard label="Ticket medio" value={eur(data.kpis.aov)} />
            <KpiCard label="Pedidos" value={String(data.kpis.orders)} />
            <KpiCard
              label={periodPrevLabel[period]}
              value={deltaPct === null ? '—' : `${deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct)}%`}
              sub={prevNet > 0 ? `${eur(prevNet)} · ${data.prev.orders} ped.` : 'sin datos previos'}
            />
          </div>

          {/* Propias vs cedidas + Canal */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            <div className="rounded-xl bg-white border border-stone-200 p-4">
              <div className="text-sm font-medium text-stone-800 mb-2.5">Propias vs cedidas</div>
              <div className="flex gap-2.5">
                <div className="flex-1 rounded-lg p-3" style={{ background: '#E1F5EE' }}>
                  <div className="text-xs" style={{ color: '#0F6E56' }}>Propias</div>
                  <div className="text-xl font-medium tabular-nums" style={{ color: '#04342C' }}>{eur(own?.net ?? 0)}</div>
                  <div className="text-xs" style={{ color: '#0F6E56' }}>{own?.orders ?? 0} pedidos</div>
                </div>
                <div className="flex-1 rounded-lg p-3" style={{ background: '#FAEEDA' }}>
                  <div className="text-xs" style={{ color: '#854F0B' }}>Cedidas</div>
                  <div className="text-xl font-medium tabular-nums" style={{ color: '#412402' }}>{eur(lic?.net ?? 0)}</div>
                  <div className="text-xs" style={{ color: '#854F0B' }}>{lic?.orders ?? 0} pedidos</div>
                </div>
              </div>
              {(own?.net ?? 0) > 0 && (lic?.net ?? 0) > 0 && (
                <div className="text-[11px] text-stone-400 mt-2">
                  {(lic?.net ?? 0) > (own?.net ?? 0)
                    ? 'Las cedidas venden más; vigila el margen, que suele ser menor.'
                    : 'Las propias lideran las ventas: tu marca tira y deja más margen.'}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-white border border-stone-200 p-4">
              <div className="text-sm font-medium text-stone-800 mb-2.5">Ventas por canal</div>
              <div className="flex flex-col gap-2.5">
                {data.by_channel.map((c) => (
                  <div key={c.name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize">{c.name}</span>
                      <span className="text-stone-500 tabular-nums">{eur(c.net)} · {c.orders} ped.</span>
                    </div>
                    <Bar pct={(c.net / channelMax) * 100} color={TERRA} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Ranking marcas + locales */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            <div className="rounded-xl bg-white border border-stone-200 p-4">
              <div className="text-sm font-medium text-stone-800 mb-2.5">Ranking de marcas</div>
              <table className="w-full text-xs">
                <tbody>
                  {data.by_brand.slice(0, 8).map((b) => (
                    <tr key={b.name} className="border-t border-stone-50 first:border-0">
                      <td className="py-1.5">
                        <span className="text-stone-700">{b.name}</span> <OwnershipPill type={b.ownership_type} />
                      </td>
                      <td className="py-1.5 text-center text-stone-500 tabular-nums">{b.orders}</td>
                      <td className="py-1.5 text-right tabular-nums">{eur(b.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl bg-white border border-stone-200 p-4">
              <div className="text-sm font-medium text-stone-800 mb-2.5">Ranking de locales</div>
              <div className="flex flex-col gap-2.5">
                {data.by_location.map((l) => (
                  <div key={l.name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span>{l.name}</span>
                      <span className="text-stone-500 tabular-nums">{eur(l.net)} · {l.orders} ped.</span>
                    </div>
                    <Bar pct={(l.net / locationMax) * 100} color="#534AB7" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Mapa de calor horario (hora local) */}
          <div className="rounded-xl bg-white border border-stone-200 p-4">
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm font-medium text-stone-800">Mapa de calor horario</div>
              <div className="text-[11px] text-stone-400">hora local</div>
            </div>
            <div className="flex gap-1 items-end" style={{ height: 80 }}>
              {data.by_hour.map((h) => {
                const ratio = h.net / hourMax
                const height = Math.max(6, ratio * 64)
                const color = ratio > 0.66 ? '#534AB7' : ratio > 0.33 ? '#7F77DD' : '#CECBF6'
                return (
                  <div key={h.hour} className="flex-1 text-center" title={`${eur(h.net)} · ${h.orders} ped.`}>
                    <div style={{ height, background: color, borderRadius: 3 }} />
                    <div className="text-[9px] text-stone-400 mt-1">{h.hour}h</div>
                  </div>
                )
              })}
            </div>
            {peakHour !== null && (
              <div className="text-[11px] text-stone-400 mt-2">
                Hora punta a las {peakHour}h (hora local). Los datos llegan en UTC y se muestran en la zona de tu cuenta.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
