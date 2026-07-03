// src/modules/shop/pages/ShopHomePage.tsx
//
// G2e.4 — INICIO del módulo Folvy Shop (dashboard de mando). PASO 1: MAQUETA
// ESTÁTICA con datos FICTICIOS realistas para aprobar el LAYOUT antes de cablear
// RPCs (lección del Hub). Nada de fetch todavía: todo lo que se ve es de ejemplo.
// Benchmark: Otter Dashboard (denso, comparado) + la goleada Folvy = MARGEN REAL.
//
// Toggle de densidad (Aireada tipo Toast / Compacta tipo Otter) para que Julio elija.

import { useState, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { Home, TrendingUp } from 'lucide-react'
import KpiCard from '@/modules/shop/admin/KpiCard'

const C = {
  surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', page: '#F7F7F5',
  accent: '#FF5436', green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4',
  amber: '#8A5B0A', amberBg: '#FFF6E2', gold: '#E9A81C', red: '#C23B22', ink2: '#1D4ED8',
}
function eur(n: number): string { return `${Math.round(n).toLocaleString('es-ES')} €` }
function roiColor(n: number): string { return n >= 2 ? C.greenDeep : n >= 1 ? C.amber : C.red }

// ── Datos FICTICIOS (maqueta) ───────────────────────────────────────────────
const SERIES = [
  { day: '20 jun', conOferta: 120, sinOferta: 210, pedidos: 9 },
  { day: '21 jun', conOferta: 180, sinOferta: 240, pedidos: 12 },
  { day: '22 jun', conOferta: 95,  sinOferta: 200, pedidos: 8 },
  { day: '23 jun', conOferta: 210, sinOferta: 260, pedidos: 14 },
  { day: '24 jun', conOferta: 240, sinOferta: 230, pedidos: 15 },
  { day: '25 jun', conOferta: 300, sinOferta: 280, pedidos: 18 },
  { day: '26 jun', conOferta: 260, sinOferta: 320, pedidos: 17 },
  { day: '27 jun', conOferta: 150, sinOferta: 240, pedidos: 11 },
  { day: '28 jun', conOferta: 190, sinOferta: 250, pedidos: 13 },
  { day: '29 jun', conOferta: 220, sinOferta: 270, pedidos: 15 },
  { day: '30 jun', conOferta: 280, sinOferta: 300, pedidos: 19 },
  { day: '01 jul', conOferta: 340, sinOferta: 290, pedidos: 21 },
  { day: '02 jul', conOferta: 310, sinOferta: 260, pedidos: 18 },
  { day: '03 jul', conOferta: 360, sinOferta: 310, pedidos: 22 },
]
const BY_KIND = [
  { name: '2x1',      value: 520, color: '#16140F' },
  { name: '% platos', value: 310, color: '#FF5436' },
  { name: 'Regalo',   value: 180, color: '#E9A81C' },
  { name: 'Envío',    value: 90,  color: '#16A05B' },
]
const TOP_CAMPAIGNS = [
  { name: '2x1 en Aguas',        kind: '2x1',       roi: 4.2 },
  { name: 'BIENVENIDA10',        kind: 'Código',    roi: 3.1 },
  { name: 'Martes −20% Pizzas',  kind: '% platos',  roi: 2.6 },
  { name: 'Churro de regalo',    kind: 'Regalo',    roi: 1.8 },
  { name: 'Envío gratis 15€',    kind: 'Envío',     roi: 1.3 },
]
const BRANDS = [
  { name: 'Bendito Burrito', sales: 1980, margin: 620 },
  { name: 'Pizza Loca',      sales: 1340, margin: 410 },
  { name: 'Wok & Roll',      sales: 890,  margin: 280 },
  { name: 'Green Bowl',      sales: 610,  margin: 210 },
]
const TOP_DISHES = [
  { name: 'Burrito XL',        units: 210 },
  { name: 'Coca-Cola 33cl',    units: 340 },
  { name: 'Nachos con queso',  units: 180 },
  { name: 'Pizza Diávola',     units: 150 },
  { name: 'Agua 50cl',         units: 290 },
]
const RANGES = ['7 días', '30 días', '90 días', 'Personalizado']
const LOCALES = ['Todos', 'Centro', 'Chamberí', 'Salamanca']
const MARCAS = ['Todas', 'Bendito Burrito', 'Pizza Loca', 'Wok & Roll', 'Green Bowl']
const PROMOS = ['Todas', '2x1', '% platos', 'Regalo', 'Envío', 'Código']

export default function ShopHomePage() {
  const s = styles
  const [dense, setDense] = useState(false)
  const [range, setRange] = useState('30 días')
  const [loc, setLoc] = useState('Todos')
  const [marca, setMarca] = useState('Todas')
  const [promo, setPromo] = useState('Todas')
  const gap = dense ? 8 : 12
  const maxBrand = Math.max(...BRANDS.map((b) => b.sales))

  return (
    <div style={s.page}>
      {/* Banner de maqueta */}
      <div style={s.mockBanner}>Maqueta · datos de ejemplo — aprueba el layout antes de cablear datos reales.</div>

      <div style={s.header}>
        <div style={s.titleRow}><Home size={22} color={C.accent} /><h1 style={s.h1}>Inicio</h1></div>
        <div style={s.densityToggle}>
          <span style={s.densityLabel}>Densidad</span>
          <button style={{ ...s.densityBtn, ...(!dense ? s.densityOn : {}) }} onClick={() => setDense(false)}>Aireada</button>
          <button style={{ ...s.densityBtn, ...(dense ? s.densityOn : {}) }} onClick={() => setDense(true)}>Compacta</button>
        </div>
      </div>

      {/* Barra de filtros sticky */}
      <div style={s.filters}>
        <div style={s.filterGroup}>
          <span style={s.filterLabel}>Rango</span>
          {RANGES.map((r) => <button key={r} style={{ ...s.chip, ...(range === r ? s.chipOn : {}) }} onClick={() => setRange(r)}>{r}</button>)}
          <span style={s.vsPrev}>vs periodo anterior</span>
        </div>
        <div style={s.filterGroup}>
          <span style={s.filterLabel}>Locales</span>
          {LOCALES.map((l) => <button key={l} style={{ ...s.chipSm, ...(loc === l ? s.chipOn : {}) }} onClick={() => setLoc(l)}>{l}</button>)}
        </div>
        <div style={s.filterGroup}>
          <span style={s.filterLabel}>Marcas</span>
          {MARCAS.map((m) => <button key={m} style={{ ...s.chipSm, ...(marca === m ? s.chipOn : {}) }} onClick={() => setMarca(m)}>{m}</button>)}
        </div>
        <div style={s.filterGroup}>
          <span style={s.filterLabel}>Promo</span>
          {PROMOS.map((p) => <button key={p} style={{ ...s.chipSm, ...(promo === p ? s.chipOn : {}) }} onClick={() => setPromo(p)}>{p}</button>)}
          <span style={s.channelFixed}>Canal: Shop</span>
        </div>
      </div>

      {/* Insight cálido */}
      <div style={s.insight}>
        <TrendingUp size={17} color={C.greenDeep} />
        <span>Tus ofertas generaron <b>1.240 €</b> de margen real — un <b style={{ color: C.greenDeep }}>15% más</b> que el periodo anterior. El <b>2x1 en Aguas</b> es tu campaña más rentable (ROI 4,2×).</span>
      </div>

      {/* HERO — 6 KPIs con Δ vs periodo anterior */}
      <div style={{ ...s.heroGrid, gap }}>
        <KpiCard label="Ventas Shop"        value={eur(4820)}  delta={12}  dense={dense} />
        <KpiCard label="Pedidos"            value="156"        delta={8}   dense={dense} />
        <KpiCard label="Ticket medio"       value="30,90 €"    delta={4}   dense={dense} />
        <KpiCard label="Margen real"        value={eur(1240)}  delta={15}  dense={dense} valueColor={C.greenDeep} sub="78% de pedidos medibles" />
        <KpiCard label="Clientes nuevos"    value="42"         delta={22}  dense={dense} sub="por bienvenida" />
        <KpiCard label="Pedidos con oferta" value="38%"        delta={6}   dense={dense} sub="59 de 156" />
      </div>

      {/* Gráfica principal */}
      <div style={{ ...s.card, ...(dense ? s.cardDense : {}), marginTop: gap + 6 }}>
        <div style={s.cardTitle}>Ventas por día · con oferta vs sin oferta</div>
        <ResponsiveContainer width="100%" height={dense ? 220 : 280}>
          <ComposedChart data={SERIES} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={{ stroke: C.line }} tickLine={false} />
            <YAxis yAxisId="eur" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="cnt" orientation="right" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: any, n: any) => (n === 'pedidos' ? [v, 'pedidos'] : [eur(Number(v)), n === 'conOferta' ? 'con oferta' : 'sin oferta'])} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="eur" dataKey="conOferta" name="Con oferta" stackId="a" fill={C.accent} radius={[0, 0, 0, 0]} maxBarSize={30} />
            <Bar yAxisId="eur" dataKey="sinOferta" name="Sin oferta" stackId="a" fill="#DFDAD0" radius={[3, 3, 0, 0]} maxBarSize={30} />
            <Line yAxisId="cnt" type="monotone" dataKey="pedidos" name="Pedidos" stroke={C.ink} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Fila de 4 tarjetas */}
      <div style={{ ...s.grid4, gap, marginTop: gap }}>
        {/* Donut */}
        <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
          <div style={s.cardTitle}>¿Qué oferta te funciona?</div>
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie data={BY_KIND} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={70} paddingAngle={2}>
                {BY_KIND.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip formatter={(v: any) => eur(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
          <div style={s.legend}>
            {BY_KIND.map((k) => (
              <div key={k.name} style={s.legendRow}><span style={{ ...s.dot, background: k.color }} /><span style={s.legendName}>{k.name}</span><span style={s.legendVal}>{eur(k.value)}</span></div>
            ))}
          </div>
        </div>

        {/* Top campañas por ROI */}
        <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
          <div style={s.cardTitle}>Top campañas por ROI</div>
          <div style={s.list}>
            {TOP_CAMPAIGNS.map((t) => (
              <div key={t.name} style={s.listRow} title="Abrirá el panel de la campaña">
                <span style={s.listName}>{t.name}</span>
                <span style={s.listTag}>{t.kind}</span>
                <span style={{ ...s.listRoi, color: roiColor(t.roi) }}>{t.roi.toFixed(1).replace('.', ',')}×</span>
              </div>
            ))}
          </div>
        </div>

        {/* Ranking de marcas */}
        <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
          <div style={s.cardTitle}>Marcas por ventas</div>
          <div style={s.list}>
            {BRANDS.map((b) => (
              <div key={b.name} style={s.brandRow}>
                <div style={s.brandTop}><span style={s.listName}>{b.name}</span><span style={s.brandSales}>{eur(b.sales)}</span></div>
                <div style={s.brandBarWrap}><span style={{ ...s.brandBar, width: `${Math.round((b.sales / maxBrand) * 100)}%` }} /></div>
                <div style={s.brandMargin}>margen {eur(b.margin)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Top platos */}
        <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
          <div style={s.cardTitle}>Platos más vendidos</div>
          <div style={s.list}>
            {TOP_DISHES.map((d, i) => (
              <div key={d.name} style={s.dishRow}>
                <span style={s.dishRank}>{i + 1}</span>
                <span style={s.listName}>{d.name}</span>
                <span style={s.dishUnits}>{d.units} uds</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { padding: '4px 4px 48px', maxWidth: 1100 },
  mockBanner: { background: C.amberBg, border: `1px solid ${C.gold}55`, color: C.amber, fontSize: 12.5, fontWeight: 700, borderRadius: 10, padding: '8px 13px', marginBottom: 14 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14 },
  titleRow: { display: 'flex', alignItems: 'center', gap: 9 },
  h1: { fontSize: 23, fontWeight: 800, letterSpacing: '-.02em', color: C.ink, margin: 0 },
  densityToggle: { display: 'flex', alignItems: 'center', gap: 6 },
  densityLabel: { fontSize: 12, color: C.inkFaint, fontWeight: 600, marginRight: 2 },
  densityBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  densityOn: { background: C.ink, color: '#fff', border: `1px solid ${C.ink}` },

  filters: { position: 'sticky', top: 0, zIndex: 20, background: C.page, borderRadius: 14, border: `1px solid ${C.line}`, padding: '11px 14px', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  filterGroup: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  filterLabel: { fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: C.inkFaint, minWidth: 56 },
  chip: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  chipSm: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  chipOn: { background: C.ink, color: '#fff', border: `1px solid ${C.ink}` },
  vsPrev: { marginLeft: 6, fontSize: 11.5, color: C.greenDeep, fontWeight: 700 },
  channelFixed: { marginLeft: 6, fontSize: 12, color: C.inkFaint, fontWeight: 600 },

  insight: { display: 'flex', alignItems: 'flex-start', gap: 9, background: C.greenBg, border: `1px solid ${C.green}33`, borderRadius: 14, padding: '12px 15px', fontSize: 14, color: C.ink, lineHeight: 1.5, marginBottom: 16 },

  heroGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' },
  card: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: '16px 18px' },
  cardDense: { borderRadius: 12, padding: '12px 14px' },
  cardTitle: { fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 12, letterSpacing: '-.01em' },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' },

  legend: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 },
  legendRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 },
  dot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0 },
  legendName: { fontWeight: 700, color: C.ink, flex: 1 },
  legendVal: { color: C.inkDim, fontWeight: 700 },

  list: { display: 'flex', flexDirection: 'column', gap: 7 },
  listRow: { display: 'flex', alignItems: 'center', gap: 9, background: C.page, border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 11px', cursor: 'pointer' },
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
