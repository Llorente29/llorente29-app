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
import { useSearchParams } from 'react-router-dom'
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

// ── RANGO QUE LLEGA POR LA URL (02/09) ─────────────────────────────────────
// GARANTÍA (c) del encargo del Inicio: el drill-through aterriza FILTRADO, y se
// demuestra con la URL. `/ventas?desde=2026-09-01&hasta=2026-09-02` abre esta
// pantalla mostrando ese rango, no «Hoy».
//
// No hizo falta obra: la pantalla ya mandaba un `from`/`to` arbitrario a la RPC
// —`periodRange` los calculaba— así que lo único que faltaba era dejar que los
// calculara otro. El contrato de parámetros está en src/shell/home/drill.ts.
//
// [desde, hasta) — `hasta` EXCLUSIVO, igual que los rangos de `periodRange`.
// Mezclar un extremo inclusivo con uno exclusivo es como se cuela un día entero
// de más en un total que alguien va a leer como bueno.
function rangoDeLaUrl(desde: string | null, hasta: string | null): { from: Date; to: Date } | null {
  if (!desde || !hasta) return null
  // `new Date('2026-09-01')` se interpreta como UTC y en Madrid retrocede al día
  // anterior. Se construye la fecha LOCAL a mano — regla 4 del proyecto.
  const trozos = (t: string) => t.split('-').map(Number)
  const [ya, ma, da] = trozos(desde)
  const [yb, mb, db] = trozos(hasta)
  if ([ya, ma, da, yb, mb, db].some(n => !Number.isFinite(n))) return null
  const from = new Date(ya, ma - 1, da)
  const to = new Date(yb, mb - 1, db)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return null
  return { from, to }
}

/** «sábado 29 de agosto», para decir en pantalla qué se está mirando. */
function nombraRango(from: Date, to: Date): string {
  const unDia = to.getTime() - from.getTime() <= 86_400_000
  const f = (d: Date) => d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  if (unDia) return f(from)
  const fin = new Date(to.getTime() - 86_400_000)   // `to` es exclusivo
  return `${f(from)} — ${f(fin)}`
}

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

const TERRA = '#15171A'

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
      className="text-xs px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-600 bg-white hover:border-stone-300 focus:outline-none focus:ring-2 focus:ring-accent/20"
    >
      {children}
    </select>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function VentasDashboardPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [searchParams, setSearchParams] = useSearchParams()
  const rangoUrl = rangoDeLaUrl(searchParams.get('desde'), searchParams.get('hasta'))
  const [period, setPeriod] = useState<PeriodKey>('today')

  /** Volver a un periodo predefinido abandona el rango de la URL y LO BORRA de
   *  la barra: si la URL sigue diciendo un rango que ya no se ve, la próxima
   *  recarga vuelve a él y nadie entiende por qué. */
  function eligePeriodo(k: PeriodKey) {
    setPeriod(k)
    if (rangoUrl) {
      const p = new URLSearchParams(searchParams)
      p.delete('desde'); p.delete('hasta')
      setSearchParams(p, { replace: true })
    }
  }
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

    // El rango de la URL MANDA sobre el botón: se ha llegado aquí pidiendo un
    // rango concreto.
    const { from, to } = rangoUrl ?? periodRange(period)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, accountsLoading, period, locationId, ownership, channel, brandId,
      searchParams.get('desde'), searchParams.get('hasta')])

  // Auditoría externa (2.6): un canal "Desconocido" con net negativo (ajustes/
  // devoluciones sin canal atribuido) pintaba una barra negativa sin sentido.
  // Se agrupan los residuales (net<=0, o sin nombre reconocible) en "Otros" en
  // vez de mostrarlos sueltos -- mismo total, sin la barra rota.
  const byChannelGrouped = useMemo(() => {
    const rows = data?.by_channel ?? []
    const positive = rows.filter((c) => c.net > 0 && c.name && c.name.toLowerCase() !== 'desconocido')
    const residual = rows.filter((c) => !(c.net > 0 && c.name && c.name.toLowerCase() !== 'desconocido'))
    if (residual.length === 0) return positive
    const otrosNet = residual.reduce((sum, c) => sum + c.net, 0)
    const otrosOrders = residual.reduce((sum, c) => sum + c.orders, 0)
    return otrosNet !== 0 || otrosOrders !== 0
      ? [...positive, { name: 'Otros', net: otrosNet, orders: otrosOrders }]
      : positive
  }, [data])
  const channelMax = useMemo(
    () => Math.max(1, ...byChannelGrouped.map((c) => c.net)),
    [byChannelGrouped]
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

  // ── VARIACIÓN vs PERIODO ANTERIOR ──────────────────────────────────────
  // (02/09) «HOY» YA NO SE COMPARA. Decía «vs ayer» y comparaba un día A
  // MEDIAS con uno entero: a las once de la mañana eso da −80 % y no significa
  // nada. Es la regla 2 de src/shell/home/espejo.ts, que se escribió hoy para
  // el Inicio y vale igual aquí — un periodo en curso no se compara con uno
  // cerrado. Se enseña el número del periodo y ya.
  //
  // LO QUE SIGUE SIN SER EL ESPEJO, y se dice en vez de renombrarlo: el
  // servidor (`sales_dashboard`) calcula «periodo anterior de igual duración»,
  // así que para «ayer» compara con anteayer, no con el mismo día de la semana
  // pasada. La etiqueta dice la verdad de lo que compara —«vs anteayer»— y por
  // eso se queda: cambiarla a «vs sábado anterior» sin tocar el servidor sería
  // poner un nombre correcto encima de un cálculo que no lo es. El espejo de
  // verdad aquí es trabajo de servidor y va aparte.
  const prevNet = data?.prev?.net ?? 0
  const curNet = data?.kpis.net ?? 0
  const periodoEnCurso = period === 'today'
  const deltaPct =
    periodoEnCurso || prevNet <= 0
      ? null
      : Math.round(((curNet - prevNet) / prevNet) * 100)
  const periodPrevLabel: Record<PeriodKey, string> = {
    today: 'Sin comparación',
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
          <h1 className="text-2xl font-display text-stone-800">Ventas</h1>
          {/* SI SE HA LLEGADO CON UN RANGO, LA PANTALLA LO DICE. Sin esto,
              ningún botón de periodo sale marcado y el usuario ve unas cifras
              sin saber de qué días son: un filtro invisible es peor que
              ninguno. */}
          {rangoUrl ? (
            <p className="text-sm text-stone-600">
              Mostrando <b>{nombraRango(rangoUrl.from, rangoUrl.to)}</b>{' '}
              <button type="button" onClick={() => eligePeriodo('today')}
                className="underline text-stone-500 hover:text-stone-800">
                quitar el filtro
              </button>
            </p>
          ) : (
            <p className="text-sm text-stone-500">Resumen del negocio en tiempo real</p>
          )}
        </div>
        <div className="flex gap-1.5">
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
            <button
              key={k}
              onClick={() => eligePeriodo(k)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                period === k && !rangoUrl ? 'border-transparent text-white' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
              style={period === k && !rangoUrl ? { background: TERRA } : undefined}
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
              sub={
                periodoEnCurso
                  ? 'El día no ha terminado: comparar con uno cerrado engaña'
                  : prevNet > 0 ? `${eur(prevNet)} · ${data.prev.orders} ped.` : 'sin datos previos'
              }
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
                {byChannelGrouped.map((c) => (
                  <div key={c.name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize">{c.name}</span>
                      <span className="text-stone-500 tabular-nums">{eur(c.net)} · {c.orders} ped.</span>
                    </div>
                    <Bar pct={Math.max(0, (c.net / channelMax) * 100)} color={TERRA} />
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
                    <Bar pct={(l.net / locationMax) * 100} color={TERRA} />
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
                // Auditoría externa (B.2): violeta (#534AB7/#7F77DD) sin
                // relación con la marca, contiguo a "Ventas por canal" (negro/
                // tinta) justo encima -- dos idiomas de color en la misma
                // pantalla, la primera de la demo comercial. Misma escala
                // monocroma que el resto (tailwind.config.js: "rebrand tinta
                // monocroma").
                const color = ratio > 0.66 ? TERRA : ratio > 0.33 ? '#6B7077' : '#E9EBED'
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
