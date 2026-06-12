// src/pages/VentasDashboardPage.tsx
//
// Dashboard de Ventas (Folvy Sales). Pinta los agregados de la RPC server-side
// `sales_dashboard` (vía salesDashboardService). Cálculo en SQL; aquí solo se
// muestra. Diseño contrastado con el benchmark (Otter / R365 / Apicbase):
// KPIs con nº de pedidos junto al importe (dato clave para gerentes dark
// kitchen), propias vs cedidas (margen distinto, nadie más lo separa), ventas
// por canal, ranking de marcas y locales, y mapa de calor horario EN HORA LOCAL.
//
// Filtros: en esta primera versión está activo el de PERIODO. La RPC y el
// servicio ya aceptan local/marca/tipo/canal → se encienden sin reescribir.

import { useEffect, useMemo, useState } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
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
      style={{
        background: own ? '#E1F5EE' : '#FAEEDA',
        color: own ? '#0F6E56' : '#854F0B',
      }}
    >
      {own ? 'propia' : 'cedida'}
    </span>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function VentasDashboardPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [data, setData] = useState<SalesDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    getSalesDashboard({ accountId: activeAccountId, from, to })
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
  }, [activeAccountId, accountsLoading, period])

  // Derivados para pintar barras (porcentajes sobre el máximo del bloque).
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Cabecera + filtro de periodo */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
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
                period === k
                  ? 'border-transparent text-white'
                  : 'border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
              style={period === k ? { background: TERRA } : undefined}
            >
              {PERIOD_LABELS[k]}
            </button>
          ))}
        </div>
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
            Aún no hay ventas en este periodo. El panel se irá poblando según entren pedidos.
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
            <KpiCard label="Ventas netas" value={eur(data.kpis.net)} sub={`${data.kpis.orders} pedidos`} />
            <KpiCard label="Ticket medio" value={eur(data.kpis.aov)} />
            <KpiCard label="Pedidos" value={String(data.kpis.orders)} />
          </div>

          {/* Propias vs cedidas + Canal */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            <div className="rounded-xl bg-white border border-stone-200 p-4">
              <div className="text-sm font-medium text-stone-800 mb-2.5">Propias vs cedidas</div>
              <div className="flex gap-2.5">
                <div className="flex-1 rounded-lg p-3" style={{ background: '#E1F5EE' }}>
                  <div className="text-xs" style={{ color: '#0F6E56' }}>Propias</div>
                  <div className="text-xl font-medium tabular-nums" style={{ color: '#04342C' }}>
                    {eur(own?.net ?? 0)}
                  </div>
                  <div className="text-xs" style={{ color: '#0F6E56' }}>{own?.orders ?? 0} pedidos</div>
                </div>
                <div className="flex-1 rounded-lg p-3" style={{ background: '#FAEEDA' }}>
                  <div className="text-xs" style={{ color: '#854F0B' }}>Cedidas</div>
                  <div className="text-xl font-medium tabular-nums" style={{ color: '#412402' }}>
                    {eur(lic?.net ?? 0)}
                  </div>
                  <div className="text-xs" style={{ color: '#854F0B' }}>{lic?.orders ?? 0} pedidos</div>
                </div>
              </div>
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
                        <span className="text-stone-700">{b.name}</span>{' '}
                        <OwnershipPill type={b.ownership_type} />
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
          </div>
        </>
      )}
    </div>
  )
}
