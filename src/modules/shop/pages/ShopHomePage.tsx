// src/modules/shop/pages/ShopHomePage.tsx
//
// G2e.4 — INICIO del módulo Folvy Shop (dashboard de mando). CABLEADO con datos
// reales: shop_home_overview (todo-en-una, ventana espejo → Δ% vs periodo anterior).
// Filtros en dropdowns (rango · locales · marcas · tipo de promo · canal Shop),
// gráficas frescas (recharts custom), descargas CSV/XLSX reales. Densidad Aireada
// (por defecto) / Compacta.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from 'recharts'
import { Home, TrendingUp, Download, ChevronDown, Search, Check } from 'lucide-react'
import * as XLSX from 'xlsx'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import KpiCard from '@/modules/shop/admin/KpiCard'
import {
  getShopHomeOverview, getShopAdminLocations, getCampaignMenuTree,
  type ShopHomeOverview, type CampaignKind, type ShopAdminLocation,
} from '@/modules/shop/admin/campaignService'

const C = {
  surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', page: '#F7F7F5', softGrid: '#F3F1EC',
  accent: '#FF5436', green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4',
  amber: '#8A5B0A', amberBg: '#FFF6E2', gold: '#E9A81C', red: '#C23B22',
}
function eur(n: number): string { return `${Math.round(n).toLocaleString('es-ES')} €` }
function eur2(n: number | null): string { return n == null ? '—' : `${n.toFixed(2).replace('.', ',')} €` }
function roiColor(n: number | null): string { return n == null ? C.inkFaint : n >= 2 ? C.greenDeep : n >= 1 ? C.amber : C.red }
function pctDelta(cur: number, prev: number, hasPrev: boolean): number | null {
  if (!hasPrev || prev <= 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

const KIND_OPTS: { k: CampaignKind; l: string }[] = [
  { k: 'bogo', l: '2x1' }, { k: 'item_percent', l: '% platos' }, { k: 'free_item', l: 'Regalo' },
  { k: 'free_delivery', l: 'Envío' }, { k: 'standard', l: 'Código' }, { k: 'frequency', l: 'Fidelidad' },
]
const KIND_COLOR: Record<string, string> = {
  bogo: '#16140F', item_percent: '#FF5436', free_item: '#E9A81C', free_delivery: '#16A05B', standard: '#6E6960', frequency: '#1D4ED8',
}
function kindLabel(k: string): string { return KIND_OPTS.find((o) => o.k === k)?.l ?? k }

function downloadCSV(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}
function downloadXLSX(rows: Record<string, unknown>[], filename: string, sheet = 'Datos') {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': '' }])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, filename)
}

// ── Popover + filtros (reutilizados de la maqueta) ──────────────────────────
function Popover({ button, children, width = 240 }: { button: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; width?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen((v) => !v)}>{button(open)}</div>
      {open && <div style={{ ...styles.pop, width }}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

function MultiSelect({ label, options, labelOf, selected, onChange, searchable }: {
  label: string; options: string[]; labelOf?: (v: string) => string; selected: Set<string>; onChange: (s: Set<string>) => void; searchable?: boolean
}) {
  const [q, setQ] = useState('')
  const lab = (v: string) => (labelOf ? labelOf(v) : v)
  const all = selected.size === 0 || selected.size === options.length
  const summary = all ? 'Todas' : `${selected.size} sel.`
  const shown = searchable && q ? options.filter((o) => lab(o).toLowerCase().includes(q.toLowerCase())) : options
  const toggle = (o: string) => { const n = new Set(selected); n.has(o) ? n.delete(o) : n.add(o); onChange(n) }
  return (
    <Popover width={searchable ? 260 : 220} button={(open) => (
      <button style={{ ...styles.ddBtn, ...(open ? styles.ddBtnOpen : {}) }}>
        <span style={styles.ddLabel}>{label}:</span> <span style={styles.ddValue}>{summary}</span> <ChevronDown size={15} color={C.inkFaint} />
      </button>
    )}>
      {() => (
        <>
          {searchable && <div style={styles.ddSearch}><Search size={14} color={C.inkFaint} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" style={styles.ddSearchInput} /></div>}
          <div style={styles.ddActions}>
            <button style={styles.ddAction} onClick={() => onChange(new Set(options))}>Todos</button>
            <button style={styles.ddAction} onClick={() => onChange(new Set())}>Ninguno</button>
          </div>
          <div style={styles.ddList}>
            {shown.map((o) => {
              const on = selected.size !== 0 && selected.has(o)
              return (
                <label key={o} style={styles.ddItem}>
                  <span style={{ ...styles.ddCheck, ...(on ? styles.ddCheckOn : {}) }}>{on && <Check size={12} color="#fff" />}</span>
                  <input type="checkbox" checked={on} onChange={() => toggle(o)} style={{ display: 'none' }} />
                  <span style={styles.ddItemName}>{lab(o)}</span>
                </label>
              )
            })}
          </div>
        </>
      )}
    </Popover>
  )
}

const RANGE_OPTS = [{ k: '7d', l: '7 días' }, { k: '30d', l: '30 días' }, { k: '90d', l: '90 días' }, { k: 'all', l: 'Todo' }, { k: 'custom', l: 'Personalizado' }]
function RangeSelect({ value, onChange, cFrom, cTo, setCFrom, setCTo }: {
  value: string; onChange: (v: string) => void; cFrom: string; cTo: string; setCFrom: (v: string) => void; setCTo: (v: string) => void
}) {
  const label = RANGE_OPTS.find((r) => r.k === value)?.l ?? '30 días'
  return (
    <Popover width={230} button={(open) => (
      <button style={{ ...styles.ddBtn, ...(open ? styles.ddBtnOpen : {}) }}>
        <span style={styles.ddLabel}>Rango:</span> <span style={styles.ddValue}>{label}</span> <ChevronDown size={15} color={C.inkFaint} />
      </button>
    )}>
      {(close) => (
        <div style={styles.ddList}>
          {RANGE_OPTS.map((r) => <button key={r.k} style={{ ...styles.ddRadio, ...(value === r.k ? styles.ddRadioOn : {}) }} onClick={() => { onChange(r.k); if (r.k !== 'custom') close() }}>{r.l}</button>)}
          {value === 'custom' && (
            <div style={styles.ddDates}>
              <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} style={styles.ddDate} />
              <span style={{ color: C.inkFaint }}>→</span>
              <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} style={styles.ddDate} />
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}

function FTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={styles.tip}>
      <div style={styles.tipDay}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={styles.tipRow}>
          <span style={{ ...styles.tipDot, background: p.color || p.stroke }} />
          <span style={styles.tipName}>{p.name}</span>
          <span style={styles.tipVal}>{p.dataKey === 'orders' ? `${p.value} ped.` : eur(Number(p.value))}</span>
        </div>
      ))}
    </div>
  )
}

export default function ShopHomePage() {
  const s = styles
  const navigate = useNavigate()
  const { activeAccountId: accountId } = useActiveAccount()
  const [dense, setDense] = useState(false)
  const [range, setRange] = useState('30d')
  const [cFrom, setCFrom] = useState(''); const [cTo, setCTo] = useState('')
  const [locSel, setLocSel] = useState<Set<string>>(new Set())
  const [brandSel, setBrandSel] = useState<Set<string>>(new Set())
  const [kindSel, setKindSel] = useState<Set<string>>(new Set())
  const [locations, setLocations] = useState<ShopAdminLocation[]>([])
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])
  const [data, setData] = useState<ShopHomeOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const gap = dense ? 8 : 12

  useEffect(() => {
    if (!accountId) return
    let alive = true
    getShopAdminLocations(accountId).then((l) => { if (alive) setLocations(l) }).catch(() => {})
    getCampaignMenuTree(accountId).then((t) => { if (alive) setBrands(t.brands.map((b) => ({ id: b.id, name: b.name }))) }).catch(() => {})
    return () => { alive = false }
  }, [accountId])

  useEffect(() => {
    if (!accountId) return
    let alive = true
    setLoading(true)
    let from: string | null = null; let to: string | null = null
    if (range === 'custom') {
      from = cFrom ? new Date(cFrom).toISOString() : null
      to = cTo ? new Date(new Date(cTo).getTime() + 86400000).toISOString() : null
    } else if (range !== 'all') {
      const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
      from = new Date(Date.now() - days * 86400000).toISOString()
    }
    const brandIds = brandSel.size ? [...brandSel] : null
    const locationIds = locSel.size ? [...locSel] : null
    const kinds = kindSel.size ? ([...kindSel] as CampaignKind[]) : null
    getShopHomeOverview(accountId, from, to, locationIds, brandIds, kinds)
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
    return () => { alive = false }
  }, [accountId, range, cFrom, cTo, locSel, brandSel, kindSel])

  const chips: { label: string; clear: () => void }[] = []
  if (locSel.size > 0 && locSel.size < locations.length) chips.push({ label: `${locSel.size} ${locSel.size === 1 ? 'local' : 'locales'}`, clear: () => setLocSel(new Set()) })
  if (brandSel.size > 0 && brandSel.size < brands.length) chips.push({ label: `${brandSel.size} ${brandSel.size === 1 ? 'marca' : 'marcas'}`, clear: () => setBrandSel(new Set()) })
  if (kindSel.size > 0 && kindSel.size < KIND_OPTS.length) chips.push({ label: `${kindSel.size} ${kindSel.size === 1 ? 'tipo' : 'tipos'}`, clear: () => setKindSel(new Set()) })

  const d = data
  const dv = (cur: number, prev: number) => (d ? pctDelta(cur, prev, d.hasPrev) : null)
  const invested = useMemo(() => (d?.byKind ?? []).reduce((a, k) => a + k.invested, 0), [d])
  const pieData = useMemo(() => (d?.byKind ?? []).filter((k) => k.invested > 0).map((k) => ({ name: kindLabel(k.kind), value: k.invested, color: KIND_COLOR[k.kind] ?? '#888' })), [d])
  const chartData = useMemo(() => (d?.series ?? []).map((p) => ({ day: p.day.slice(5), 'Con oferta': p.withOffer, 'Sin oferta': p.withoutOffer, orders: p.orders })), [d])
  const maxBrand = Math.max(1, ...(d?.brands ?? []).map((b) => b.ventas))
  const pctOffer = d && d.pedidosCur > 0 ? Math.round((d.offerOrdersCur / d.pedidosCur) * 100) : 0
  const marginDelta = d ? dv(d.marginCur ?? 0, d.marginPrev ?? 0) : null

  const reports = d ? [
    { key: 'resumen', label: 'Resumen del periodo', rows: () => (d.series.map((p) => ({ Día: p.day, 'Con oferta (€)': p.withOffer, 'Sin oferta (€)': p.withoutOffer, Pedidos: p.orders }))) },
    { key: 'campanas', label: 'Rendimiento por campaña', rows: () => d.topCampaigns.map((t) => ({ Campaña: t.name, Tipo: kindLabel(t.kind), Canjes: t.redemptions, 'Invertido (€)': t.invested, ROI: t.roi ?? '' })) },
    { key: 'marcas', label: 'Ventas por marca', rows: () => d.brands.map((b) => ({ Marca: b.name, 'Ventas (€)': b.ventas, 'Margen (€)': b.margin ?? '' })) },
    { key: 'platos', label: 'Top platos', rows: () => d.topDishes.map((x) => ({ Plato: x.name, Unidades: x.units })) },
  ] : []

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.titleRow}><Home size={22} color={C.accent} /><h1 style={s.h1}>Inicio</h1></div>
        <div style={s.headRight}>
          <div style={s.densityToggle}>
            <button style={{ ...s.densityBtn, ...(!dense ? s.densityOn : {}) }} onClick={() => setDense(false)}>Aireada</button>
            <button style={{ ...s.densityBtn, ...(dense ? s.densityOn : {}) }} onClick={() => setDense(true)}>Compacta</button>
          </div>
          <Popover width={250} button={(open) => (
            <button style={{ ...s.downloadBtn, ...(open ? { background: C.ink } : {}) }}><Download size={16} /> Descargar <ChevronDown size={15} /></button>
          )}>
            {(close) => (
              <div style={s.dlMenu}>
                <div style={s.dlHead}>Informe del periodo</div>
                {reports.length === 0 ? <div style={s.dlEmpty}>Sin datos que descargar.</div> : reports.map((r) => (
                  <div key={r.key} style={s.dlRow}>
                    <span style={s.dlName}>{r.label}</span>
                    <button style={s.dlFmt} onClick={() => { downloadCSV(r.rows(), `folvy-${r.key}.csv`); close() }}>CSV</button>
                    <button style={s.dlFmt} onClick={() => { downloadXLSX(r.rows(), `folvy-${r.key}.xlsx`, r.label.slice(0, 28)); close() }}>XLSX</button>
                  </div>
                ))}
              </div>
            )}
          </Popover>
        </div>
      </div>

      <div style={s.filters}>
        <RangeSelect value={range} onChange={setRange} cFrom={cFrom} cTo={cTo} setCFrom={setCFrom} setCTo={setCTo} />
        <MultiSelect label="Locales" options={locations.map((l) => l.id)} labelOf={(id) => locations.find((l) => l.id === id)?.name ?? id} selected={locSel} onChange={setLocSel} />
        <MultiSelect label="Marcas" options={brands.map((b) => b.id)} labelOf={(id) => brands.find((b) => b.id === id)?.name ?? id} selected={brandSel} onChange={setBrandSel} searchable />
        <MultiSelect label="Promo" options={KIND_OPTS.map((o) => o.k)} labelOf={(k) => kindLabel(k)} selected={kindSel} onChange={setKindSel} />
        <span style={s.channelFixed}>Canal: Shop</span>
        <span style={s.vsPrev}>· comparado vs periodo anterior</span>
      </div>
      {chips.length > 0 && <div style={s.summaryChips}>{chips.map((c, i) => <button key={i} style={s.sumChip} onClick={c.clear}>{c.label} <span style={s.sumX}>×</span></button>)}</div>}

      {/* Insight */}
      {d && (d.marginCur ?? 0) > 0 && (
        <div style={s.insight}>
          <TrendingUp size={17} color={C.greenDeep} />
          <span>Tus ofertas generaron <b>{eur(d.marginCur ?? 0)}</b> de margen real{marginDelta != null ? <> — un <b style={{ color: marginDelta >= 0 ? C.greenDeep : C.red }}>{Math.abs(marginDelta)}% {marginDelta >= 0 ? 'más' : 'menos'}</b> que el periodo anterior</> : ''}.{d.topCampaigns[0] ? <> Tu campaña más rentable: <b>{d.topCampaigns[0].name}</b>{d.topCampaigns[0].roi != null ? ` (ROI ${d.topCampaigns[0].roi.toFixed(1).replace('.', ',')}×)` : ''}.</> : ''}</span>
        </div>
      )}

      {loading && !d ? (
        <div style={s.muted}>Cargando…</div>
      ) : (
        <>
          <div style={{ ...s.heroGrid, gap }}>
            <KpiCard label="Ventas Shop" value={eur(d?.ventasCur ?? 0)} delta={d ? dv(d.ventasCur, d.ventasPrev) : null} dense={dense} />
            <KpiCard label="Pedidos" value={String(d?.pedidosCur ?? 0)} delta={d ? dv(d.pedidosCur, d.pedidosPrev) : null} dense={dense} />
            <KpiCard label="Ticket medio" value={eur2(d?.ticketCur ?? null)} delta={d ? dv(d.ticketCur ?? 0, d.ticketPrev ?? 0) : null} dense={dense} />
            <KpiCard label="Margen real" value={d?.marginCur != null ? eur(d.marginCur) : '—'} delta={marginDelta} dense={dense} valueColor={C.greenDeep}
              sub={d && d.marginRedCur > 0 ? `${Math.round((d.marginKnownCur / d.marginRedCur) * 100)}% de canjes medibles` : undefined} />
            <KpiCard label="Clientes nuevos" value={String(d?.newCur ?? 0)} delta={d ? dv(d.newCur, d.newPrev) : null} dense={dense} sub="por bienvenida" />
            <KpiCard label="Pedidos con oferta" value={`${pctOffer}%`} delta={d ? dv(d.offerOrdersCur, d.offerOrdersPrev) : null} dense={dense} sub={d ? `${d.offerOrdersCur} de ${d.pedidosCur}` : undefined} />
          </div>

          <div style={{ ...s.card, ...(dense ? s.cardDense : {}), marginTop: gap + 6 }}>
            <div style={s.chartHead}>
              <div style={s.cardTitle}>Ventas por día · con oferta vs sin oferta</div>
              <div style={s.chipLegend}>
                <span style={s.legChip}><span style={{ ...s.legDot, background: C.accent }} /> Con oferta</span>
                <span style={s.legChip}><span style={{ ...s.legDot, background: '#DFDAD0' }} /> Sin oferta</span>
                <span style={s.legChip}><span style={{ ...s.legDot, background: C.ink }} /> Pedidos</span>
              </div>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={dense ? 220 : 280}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 6, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gOffer" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF6A4E" /><stop offset="100%" stopColor="#FF5436" /></linearGradient>
                    <linearGradient id="gPlain" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E9E4DA" /><stop offset="100%" stopColor="#DAD4C8" /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="0" stroke={C.softGrid} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="eur" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="cnt" orientation="right" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,.03)' }} content={<FTooltip />} />
                  <Bar yAxisId="eur" dataKey="Con oferta" stackId="a" fill="url(#gOffer)" maxBarSize={30} animationDuration={700} />
                  <Bar yAxisId="eur" dataKey="Sin oferta" stackId="a" fill="url(#gPlain)" radius={[5, 5, 0, 0]} maxBarSize={30} animationDuration={700} />
                  <Line yAxisId="cnt" dataKey="orders" name="Pedidos" type="monotone" stroke={C.ink} strokeWidth={2.5} dot={false} animationDuration={900} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <div style={s.emptyMini}>Aún no hay ventas en este periodo. En cuanto entren pedidos, verás la evolución aquí.</div>}
          </div>

          <div style={{ ...s.grid4, gap, marginTop: gap }}>
            <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
              <div style={s.cardTitle}>¿Qué oferta te funciona?</div>
              {pieData.length > 0 ? (
                <>
                  <div style={s.donutWrap}>
                    <ResponsiveContainer width="100%" height={168}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={56} outerRadius={72} paddingAngle={3} cornerRadius={6} stroke="none" animationDuration={700}>
                          {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip content={<FTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={s.donutCenter}><div style={s.donutTotal}>{eur(invested)}</div><div style={s.donutCap}>invertido</div></div>
                  </div>
                  <div style={s.legend}>{(d?.byKind ?? []).filter((k) => k.invested > 0).map((k) => <div key={k.kind} style={s.legendRow}><span style={{ ...s.dot, background: KIND_COLOR[k.kind] ?? '#888' }} /><span style={s.legendName}>{kindLabel(k.kind)}</span><span style={s.legendVal}>{eur(k.invested)}</span></div>)}</div>
                </>
              ) : <div style={s.emptyMini}>Sin inversión en oferta todavía.</div>}
            </div>

            <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
              <div style={s.cardTitle}>Top campañas por ROI</div>
              {d && d.topCampaigns.length > 0 ? (
                <div style={s.list}>
                  {d.topCampaigns.map((t) => (
                    <button key={t.id} type="button" style={s.listRow} onClick={() => navigate('../campanas')} title="Ver en Campañas">
                      <span style={s.listName}>{t.name}</span><span style={s.listTag}>{kindLabel(t.kind)}</span>
                      <span style={{ ...s.listRoi, color: roiColor(t.roi) }}>{t.roi != null ? `${t.roi.toFixed(1).replace('.', ',')}×` : '—'}</span>
                    </button>
                  ))}
                </div>
              ) : <div style={s.emptyMini}>Aún no hay canjes que rankear.</div>}
            </div>

            <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
              <div style={s.cardTitle}>Marcas por ventas</div>
              {d && d.brands.length > 0 ? (
                <div style={s.list}>{d.brands.map((b) => (
                  <div key={b.name} style={s.brandRow}>
                    <div style={s.brandTop}><span style={s.listName}>{b.name}</span><span style={s.brandSales}>{eur(b.ventas)}</span></div>
                    <div style={s.brandBarWrap}><span style={{ ...s.brandBar, width: `${Math.round((b.ventas / maxBrand) * 100)}%` }} /></div>
                    {b.margin != null && <div style={s.brandMargin}>margen {eur(b.margin)}</div>}
                  </div>
                ))}</div>
              ) : <div style={s.emptyMini}>Sin ventas en el periodo.</div>}
            </div>

            <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
              <div style={s.cardTitle}>Platos más vendidos</div>
              {d && d.topDishes.length > 0 ? (
                <div style={s.list}>{d.topDishes.map((x, i) => (
                  <div key={x.name} style={s.dishRow}><span style={s.dishRank}>{i + 1}</span><span style={s.listName}>{x.name}</span><span style={s.dishUnits}>{x.units} uds</span></div>
                ))}</div>
              ) : <div style={s.emptyMini}>Sin platos vendidos en el periodo.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { padding: '4px 4px 48px', maxWidth: 1100 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14 },
  titleRow: { display: 'flex', alignItems: 'center', gap: 9 },
  h1: { fontSize: 23, fontWeight: 800, letterSpacing: '-.02em', color: C.ink, margin: 0 },
  headRight: { display: 'flex', alignItems: 'center', gap: 10 },
  densityToggle: { display: 'flex', gap: 4 },
  densityBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  densityOn: { background: C.ink, color: '#fff', border: `1px solid ${C.ink}` },
  downloadBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: C.accent, color: '#fff', borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' },
  dlMenu: { padding: 6 },
  dlHead: { fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: C.inkFaint, padding: '6px 8px 8px' },
  dlEmpty: { fontSize: 12.5, color: C.inkFaint, padding: '4px 8px 10px' },
  dlRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px' },
  dlName: { flex: 1, fontSize: 13, color: C.ink, fontWeight: 600 },
  dlFmt: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 8, padding: '3px 9px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' },
  filters: { position: 'sticky', top: 0, zIndex: 20, background: C.page, borderRadius: 14, border: `1px solid ${C.line}`, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 10 },
  channelFixed: { fontSize: 12, color: C.inkFaint, fontWeight: 700, marginLeft: 2 },
  vsPrev: { fontSize: 12, color: C.greenDeep, fontWeight: 700 },
  summaryChips: { display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 },
  sumChip: { border: `1px solid ${C.accent}44`, background: '#FFF1EE', color: C.accent, borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  sumX: { fontWeight: 900, marginLeft: 2 },
  muted: { color: C.inkDim, fontSize: 14, padding: '40px 0', textAlign: 'center' },
  ddBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.lineInput}`, background: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, cursor: 'pointer' },
  ddBtnOpen: { borderColor: C.ink },
  ddLabel: { color: C.inkDim, fontWeight: 600 }, ddValue: { color: C.ink, fontWeight: 800 },
  pop: { position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, boxShadow: '0 12px 34px rgba(0,0,0,.14)', zIndex: 40, padding: 6, maxHeight: 320, overflow: 'auto' },
  ddSearch: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: `1px solid ${C.line}` },
  ddSearchInput: { border: 'none', outline: 'none', fontSize: 13, width: '100%', color: C.ink },
  ddActions: { display: 'flex', gap: 6, padding: '7px 8px' },
  ddAction: { flex: 1, border: `1px solid ${C.lineInput}`, background: '#fff', borderRadius: 8, padding: '5px 0', fontSize: 12, fontWeight: 700, color: C.inkDim, cursor: 'pointer' },
  ddList: { display: 'flex', flexDirection: 'column', gap: 1, padding: 2 },
  ddItem: { display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  ddCheck: { width: 17, height: 17, borderRadius: 5, border: `1.5px solid ${C.lineInput}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  ddCheckOn: { background: C.accent, border: `1.5px solid ${C.accent}` },
  ddItemName: { color: C.ink },
  ddRadio: { textAlign: 'left', border: 'none', background: 'none', padding: '8px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: C.ink, cursor: 'pointer' },
  ddRadioOn: { background: C.page, color: C.accent, fontWeight: 800 },
  ddDates: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderTop: `1px solid ${C.line}` },
  ddDate: { border: `1px solid ${C.lineInput}`, borderRadius: 8, padding: '5px 8px', fontSize: 12.5, color: C.ink },
  insight: { display: 'flex', alignItems: 'flex-start', gap: 9, background: C.greenBg, border: `1px solid ${C.green}33`, borderRadius: 14, padding: '12px 15px', fontSize: 14, color: C.ink, lineHeight: 1.5, marginBottom: 16, marginTop: 4 },
  heroGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' },
  card: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: '16px 18px' },
  cardDense: { borderRadius: 12, padding: '12px 14px' },
  cardTitle: { fontSize: 13.5, fontWeight: 800, color: C.ink, letterSpacing: '-.01em' },
  chartHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  chipLegend: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  legChip: { display: 'inline-flex', alignItems: 'center', gap: 5, background: C.page, border: `1px solid ${C.line}`, borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 700, color: C.inkDim },
  legDot: { width: 9, height: 9, borderRadius: 3 },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' },
  emptyMini: { fontSize: 13, color: C.inkFaint, padding: '22px 4px', textAlign: 'center', lineHeight: 1.5 },
  tip: { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '9px 11px', minWidth: 150 },
  tipDay: { fontSize: 11.5, fontWeight: 800, color: C.inkDim, marginBottom: 6 },
  tipRow: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, marginTop: 3 },
  tipDot: { width: 9, height: 9, borderRadius: 3, flexShrink: 0 },
  tipName: { flex: 1, color: C.inkDim }, tipVal: { fontWeight: 800, color: C.ink },
  donutWrap: { position: 'relative' },
  donutCenter: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  donutTotal: { fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-.02em' },
  donutCap: { fontSize: 11, color: C.inkFaint, fontWeight: 600 },
  legend: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 },
  legendRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 },
  dot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0 },
  legendName: { fontWeight: 700, color: C.ink, flex: 1 }, legendVal: { color: C.inkDim, fontWeight: 700 },
  list: { display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 },
  listRow: { display: 'flex', alignItems: 'center', gap: 9, background: C.page, border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 11px', cursor: 'pointer', textAlign: 'left', width: '100%' },
  listName: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  listTag: { fontSize: 10.5, fontWeight: 800, color: C.inkDim, background: '#EEEEEB', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' },
  listRoi: { fontSize: 13.5, fontWeight: 900, whiteSpace: 'nowrap', minWidth: 42, textAlign: 'right' },
  brandRow: { padding: '4px 0' },
  brandTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  brandSales: { fontSize: 13, fontWeight: 800, color: C.ink },
  brandBarWrap: { height: 7, background: '#F0EEE9', borderRadius: 999, overflow: 'hidden' },
  brandBar: { display: 'block', height: '100%', background: C.accent, borderRadius: 999 },
  brandMargin: { fontSize: 11, color: C.greenDeep, fontWeight: 700, marginTop: 3 },
  dishRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '5px 0' },
  dishRank: { width: 20, height: 20, borderRadius: '50%', background: C.page, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: C.inkDim, flexShrink: 0 },
  dishUnits: { fontSize: 12, fontWeight: 700, color: C.inkDim, whiteSpace: 'nowrap' },
}
