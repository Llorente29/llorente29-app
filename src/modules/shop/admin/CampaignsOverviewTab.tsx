// src/modules/shop/admin/CampaignsOverviewTab.tsx
//
// G2e.3 — Vista GENERAL de rendimiento (dashboard comercial vendible). Filtros +
// HERO de 6 KPIs + evolución diaria + reparto por tipo + top campañas. Datos de
// campaigns_overview (solo lectura). Autocontenida (estilos inline), gráficas con
// recharts (ya en el repo).

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts'
import { Sparkles } from 'lucide-react'
import {
  getCampaignsOverview, getCampaignMenuTree,
  type CampaignsOverview, type CampaignKind, type TreeBrand,
} from '@/modules/shop/admin/campaignService'

const C = {
  surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', page: '#F7F7F5',
  accent: '#FF5436', green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4',
  amber: '#8A5B0A', amberBg: '#FFF6E2', blue: '#1D4ED8', red: '#C23B22', gold: '#E9A81C', pill: '#EEEEEB',
}

function eur(n: number | null | undefined): string { return n == null ? '—' : `${n.toFixed(2).replace('.', ',')} €` }
function eur0(n: number | null | undefined): string { return n == null ? '—' : `${Math.round(n).toLocaleString('es-ES')} €` }
function roiText(n: number | null): string { return n == null ? '—' : `${n.toFixed(1).replace('.', ',')}×` }
function roiColor(n: number | null): string { return n == null ? C.inkFaint : n >= 2 ? C.greenDeep : n >= 1 ? C.amber : C.red }

const KIND_META: Record<string, { label: string; color: string }> = {
  standard:      { label: 'Código',   color: '#6E6960' },
  frequency:     { label: 'Fidelidad', color: '#1D4ED8' },
  item_percent:  { label: '% platos', color: '#FF5436' },
  bogo:          { label: '2x1',      color: '#16140F' },
  free_delivery: { label: 'Envío',    color: '#16A05B' },
  free_item:     { label: 'Regalo',   color: '#E9A81C' },
}
function kindLabel(k: CampaignKind): string { return KIND_META[k]?.label ?? k }
function kindColor(k: CampaignKind): string { return KIND_META[k]?.color ?? '#8A857C' }

const RANGES: { key: '7d' | '30d' | '90d' | 'all'; label: string }[] = [
  { key: '7d', label: '7 días' }, { key: '30d', label: '30 días' },
  { key: '90d', label: '90 días' }, { key: 'all', label: 'Todo' },
]
const KIND_FILTERS: CampaignKind[] = ['bogo', 'item_percent', 'free_item', 'free_delivery', 'standard', 'frequency']

export default function CampaignsOverviewTab({ accountId, hasCampaigns, onCreate, onOpenCampaign }: {
  accountId: string
  hasCampaigns: boolean
  onCreate: () => void
  onOpenCampaign: (couponId: string) => void
}) {
  const s = styles
  const [range, setRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d')
  const [kinds, setKinds] = useState<Set<CampaignKind>>(new Set())
  const [brandId, setBrandId] = useState<string>('all')
  const [brands, setBrands] = useState<TreeBrand[]>([])
  const [data, setData] = useState<CampaignsOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    getCampaignMenuTree(accountId).then((t) => { if (alive) setBrands(t.brands) }).catch(() => {})
    return () => { alive = false }
  }, [accountId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const now = Date.now()
    const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : null
    const from = days == null ? null : new Date(now - days * 86400000).toISOString()
    const ks = kinds.size ? [...kinds] : null
    getCampaignsOverview(accountId, from, null, ks, brandId === 'all' ? null : brandId)
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
    return () => { alive = false }
  }, [accountId, range, kinds, brandId])

  const toggleKind = (k: CampaignKind) => setKinds((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })

  const pctOffer = data && data.totalOrders > 0 ? Math.round((data.offerOrders / data.totalOrders) * 100) : 0
  const chartData = useMemo(() => (data?.series ?? []).map((p) => ({ day: p.day.slice(5), soldEur: p.soldEur, invested: p.invested, canjes: p.redemptions })), [data])
  const pieData = useMemo(() => (data?.byKind ?? []).filter((k) => k.invested > 0).map((k) => ({ name: kindLabel(k.kind), value: k.invested, color: kindColor(k.kind) })), [data])

  // Estado vacío bonito: cuenta sin campañas todavía (pantalla de demo/venta).
  if (!hasCampaigns) {
    return (
      <div style={s.emptyWrap}>
        <div style={s.emptyIcon}><Sparkles size={30} color={C.accent} /></div>
        <div style={s.emptyTitle}>Aquí verás cuánto te hacen ganar tus ofertas</div>
        <div style={s.emptyText}>Margen real generado, ROI y qué campañas funcionan mejor — no solo ventas brutas. Crea tu primera campaña y este panel cobra vida.</div>
        <button style={s.emptyBtn} onClick={onCreate}>Crea tu primera campaña</button>
      </div>
    )
  }

  return (
    <div>
      {/* Filtros */}
      <div style={s.filters}>
        <div style={s.chipRow}>
          {RANGES.map((r) => (
            <button key={r.key} type="button" style={{ ...s.chip, ...(range === r.key ? s.chipOn : {}) }} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>
        <div style={s.chipRow}>
          {KIND_FILTERS.map((k) => (
            <button key={k} type="button" style={{ ...s.chip, ...(kinds.has(k) ? s.chipOn : {}) }} onClick={() => toggleKind(k)}>{kindLabel(k)}</button>
          ))}
        </div>
        <div style={s.chipRow}>
          <button type="button" style={{ ...s.chip, ...(brandId === 'all' ? s.chipOn : {}) }} onClick={() => setBrandId('all')}>Todas las marcas</button>
          {brands.map((b) => (
            <button key={b.id} type="button" style={{ ...s.chip, ...(brandId === b.id ? s.chipOn : {}) }} onClick={() => setBrandId(b.id)}>{b.name}</button>
          ))}
          <span style={s.channelFixed}>Canal: Shop</span>
        </div>
      </div>

      {loading ? (
        <div style={s.muted}>Cargando rendimiento…</div>
      ) : !data ? (
        <div style={s.muted}>No se pudo cargar el rendimiento.</div>
      ) : (
        <>
          {/* Frase cálida */}
          {data.marginReal != null && data.marginReal > 0 && (
            <div style={s.headline}>Tus ofertas te han generado <b>{eur(data.marginReal)}</b> de margen real{range !== 'all' ? ` en los últimos ${range === '7d' ? '7' : range === '30d' ? '30' : '90'} días` : ''}.</div>
          )}

          {/* HERO — 6 KPIs */}
          <div style={s.heroGrid}>
            <Kpi label="Vendido con oferta" value={eur0(data.soldEur)} tone="ink" />
            <Kpi label="Invertido" value={eur0(data.invested)} tone="ink" />
            <Kpi label="Margen real" value={data.marginReal != null ? eur0(data.marginReal) : '—'} tone="green" />
            <Kpi label="ROI global" value={roiText(data.roi)} color={roiColor(data.roi)} />
            <Kpi label="Clientes nuevos" value={String(data.newCustomers)} tone="ink" sub="por bienvenida" />
            <Kpi label="Pedidos con oferta" value={`${pctOffer}%`} tone="ink" sub={`${data.offerOrders} de ${data.totalOrders}`} />
          </div>

          {data.marginMissing > 0 && (
            <div style={s.honesty}>{data.marginMissing} {data.marginMissing === 1 ? 'canje aún sin margen calculable' : 'canjes aún sin margen calculable'} (falta escandallo).</div>
          )}

          {/* Evolución diaria */}
          {chartData.length > 0 ? (
            <div style={s.card}>
              <div style={s.cardTitle}>Evolución diaria</div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={{ stroke: C.line }} tickLine={false} />
                  <YAxis yAxisId="eur" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="cnt" orientation="right" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: any, n: any) => (n === 'canjes' ? [v, 'canjes'] : [eur(Number(v)), n === 'soldEur' ? 'vendido' : 'invertido'])} />
                  <Bar yAxisId="eur" dataKey="soldEur" name="soldEur" fill={C.green} radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Bar yAxisId="eur" dataKey="invested" name="invested" fill={C.accent} radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Line yAxisId="cnt" type="monotone" dataKey="canjes" name="canjes" stroke={C.ink} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={s.emptyMini}>Aún no hay canjes en este periodo. En cuanto entren pedidos con oferta, verás la evolución aquí.</div>
          )}

          {/* Reparto por tipo + Top campañas */}
          <div style={s.row2}>
            <div style={{ ...s.card, flex: 1, minWidth: 260 }}>
              <div style={s.cardTitle}>¿Qué oferta te funciona?</div>
              {pieData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={2}>
                        {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => eur(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={s.legend}>
                    {(data.byKind ?? []).filter((k) => k.invested > 0).map((k) => (
                      <div key={k.kind} style={s.legendRow}>
                        <span style={{ ...s.legendDot, background: kindColor(k.kind) }} />
                        <span style={s.legendName}>{kindLabel(k.kind)}</span>
                        <span style={s.legendVal}>{eur(k.invested)} · {k.redemptions} {k.redemptions === 1 ? 'canje' : 'canjes'}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <div style={s.emptyMini}>Sin inversión en oferta todavía.</div>}
            </div>

            <div style={{ ...s.card, flex: 1.3, minWidth: 300 }}>
              <div style={s.cardTitle}>Top campañas por ROI</div>
              {data.top.length > 0 ? (
                <div style={s.topList}>
                  {data.top.map((t) => (
                    <button key={t.id} type="button" style={s.topRow} onClick={() => onOpenCampaign(t.id)}>
                      <span style={{ ...s.topBadge, background: kindColor(t.kind), color: t.kind === 'free_item' || t.kind === 'frequency' || t.kind === 'standard' || t.kind === 'free_delivery' ? '#fff' : (t.kind === 'bogo' ? '#FFC400' : '#fff') }}>{kindLabel(t.kind)}</span>
                      <span style={s.topName}>{t.name}</span>
                      <span style={s.topMeta}>{t.redemptions} canjes · {eur(t.invested)}</span>
                      <span style={{ ...s.topRoi, color: roiColor(t.roi) }}>{t.roi != null ? `ROI ${roiText(t.roi)}` : '—'}</span>
                    </button>
                  ))}
                </div>
              ) : <div style={s.emptyMini}>Aún no hay canjes que rankear.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, tone, color }: { label: string; value: string; sub?: string; tone?: 'ink' | 'green'; color?: string }) {
  const s = styles
  const c = color ?? (tone === 'green' ? C.greenDeep : C.ink)
  return (
    <div style={s.kpi}>
      <div style={s.kpiLabel}>{label}</div>
      <div style={{ ...s.kpiValue, color: c }}>{value}</div>
      {sub && <div style={s.kpiSub}>{sub}</div>}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  filters: { display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 },
  chipRow: { display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' },
  chip: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  chipOn: { background: C.ink, color: '#fff', border: `1px solid ${C.ink}` },
  channelFixed: { marginLeft: 4, fontSize: 12, color: C.inkFaint, fontWeight: 600 },
  muted: { color: C.inkDim, fontSize: 14, padding: '40px 0', textAlign: 'center' },
  headline: { fontSize: 15, color: C.ink, marginBottom: 14, lineHeight: 1.5 },

  heroGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 },
  kpi: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: '16px 18px' },
  kpiLabel: { fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: C.inkFaint },
  kpiValue: { fontSize: 30, fontWeight: 800, letterSpacing: '-.02em', marginTop: 5, lineHeight: 1.05 },
  kpiSub: { fontSize: 12, color: C.inkDim, marginTop: 3 },
  honesty: { fontSize: 12, color: C.amber, background: C.amberBg, borderRadius: 10, padding: '7px 12px', marginBottom: 16, display: 'inline-block' },

  card: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: '16px 18px', marginBottom: 16 },
  cardTitle: { fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 12, letterSpacing: '-.01em' },
  row2: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  emptyMini: { fontSize: 13, color: C.inkFaint, padding: '20px 4px', textAlign: 'center', lineHeight: 1.5 },

  legend: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  legendRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 },
  legendDot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0 },
  legendName: { fontWeight: 700, color: C.ink, minWidth: 64 },
  legendVal: { color: C.inkDim },

  topList: { display: 'flex', flexDirection: 'column', gap: 6 },
  topRow: { display: 'flex', alignItems: 'center', gap: 10, background: C.page, border: `1px solid ${C.line}`, borderRadius: 12, padding: '9px 12px', cursor: 'pointer', textAlign: 'left', width: '100%' },
  topBadge: { fontSize: 10.5, fontWeight: 900, padding: '2px 8px', borderRadius: 999, flexShrink: 0 },
  topName: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  topMeta: { fontSize: 11.5, color: C.inkDim, whiteSpace: 'nowrap' },
  topRoi: { fontSize: 13, fontWeight: 900, whiteSpace: 'nowrap', minWidth: 64, textAlign: 'right' },

  emptyWrap: { textAlign: 'center', padding: '48px 24px', border: `1px dashed ${C.lineInput}`, borderRadius: 18, background: C.surface, maxWidth: 520, margin: '10px auto' },
  emptyIcon: { width: 62, height: 62, borderRadius: '50%', background: '#FFF1EE', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' },
  emptyTitle: { fontSize: 19, fontWeight: 800, color: C.ink, letterSpacing: '-.02em' },
  emptyText: { fontSize: 14, color: C.inkDim, marginTop: 8, lineHeight: 1.55, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' },
  emptyBtn: { marginTop: 20, border: 'none', background: C.accent, color: '#fff', borderRadius: 999, padding: '12px 22px', fontSize: 14.5, fontWeight: 800, cursor: 'pointer' },
}
