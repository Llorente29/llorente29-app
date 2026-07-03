// src/modules/shop/pages/ShopHomePage.tsx
//
// G2e.4 — INICIO del módulo Folvy Shop (dashboard de mando). MAQUETA v2 (paso 1b):
// layout aprobado + 3 correcciones de Julio: (1) filtros en DROPDOWNS multi-select,
// (2) gráficas frescas (gradientes, barras redondeadas, grid casi invisible, tooltip
// y leyenda custom Folvy, donut fino con total al centro), (3) botón Descargar
// (CSV/XLSX). Datos FICTICIOS: sin fetch todavía. Toggle de densidad conservado.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts'
import { Home, TrendingUp, Download, ChevronDown, Search, Check } from 'lucide-react'
import * as XLSX from 'xlsx'
import KpiCard from '@/modules/shop/admin/KpiCard'

const C = {
  surface: '#FFFFFF', ink: '#16140F', inkDim: '#6E6960', inkFaint: '#8A857C',
  line: '#EDEAE3', lineInput: '#E6E3DC', page: '#F7F7F5', softGrid: '#F3F1EC',
  accent: '#FF5436', green: '#16A05B', greenDeep: '#0E6B38', greenBg: '#F0FAF4',
  amber: '#8A5B0A', amberBg: '#FFF6E2', gold: '#E9A81C', red: '#C23B22',
}
function eur(n: number): string { return `${Math.round(n).toLocaleString('es-ES')} €` }
function roiColor(n: number): string { return n >= 2 ? C.greenDeep : n >= 1 ? C.amber : C.red }

// ── Datos FICTICIOS (maqueta) ───────────────────────────────────────────────
const SERIES = [
  { day: '20 jun', conOferta: 120, sinOferta: 210, pedidos: 9 }, { day: '21 jun', conOferta: 180, sinOferta: 240, pedidos: 12 },
  { day: '22 jun', conOferta: 95, sinOferta: 200, pedidos: 8 }, { day: '23 jun', conOferta: 210, sinOferta: 260, pedidos: 14 },
  { day: '24 jun', conOferta: 240, sinOferta: 230, pedidos: 15 }, { day: '25 jun', conOferta: 300, sinOferta: 280, pedidos: 18 },
  { day: '26 jun', conOferta: 260, sinOferta: 320, pedidos: 17 }, { day: '27 jun', conOferta: 150, sinOferta: 240, pedidos: 11 },
  { day: '28 jun', conOferta: 190, sinOferta: 250, pedidos: 13 }, { day: '29 jun', conOferta: 220, sinOferta: 270, pedidos: 15 },
  { day: '30 jun', conOferta: 280, sinOferta: 300, pedidos: 19 }, { day: '01 jul', conOferta: 340, sinOferta: 290, pedidos: 21 },
  { day: '02 jul', conOferta: 310, sinOferta: 260, pedidos: 18 }, { day: '03 jul', conOferta: 360, sinOferta: 310, pedidos: 22 },
]
const BY_KIND = [
  { name: '2x1', value: 520, color: '#16140F' }, { name: '% platos', value: 310, color: '#FF5436' },
  { name: 'Regalo', value: 180, color: '#E9A81C' }, { name: 'Envío', value: 90, color: '#16A05B' },
]
const KIND_TOTAL = BY_KIND.reduce((a, k) => a + k.value, 0)
const TOP_CAMPAIGNS = [
  { name: '2x1 en Aguas', kind: '2x1', roi: 4.2 }, { name: 'BIENVENIDA10', kind: 'Código', roi: 3.1 },
  { name: 'Martes −20% Pizzas', kind: '% platos', roi: 2.6 }, { name: 'Churro de regalo', kind: 'Regalo', roi: 1.8 },
  { name: 'Envío gratis 15€', kind: 'Envío', roi: 1.3 },
]
const BRANDS = [
  { name: 'Bendito Burrito', sales: 1980, margin: 620 }, { name: 'Pizza Loca', sales: 1340, margin: 410 },
  { name: 'Wok & Roll', sales: 890, margin: 280 }, { name: 'Green Bowl', sales: 610, margin: 210 },
]
const LOCALES_SALES = [
  { local: 'Centro', ventas: 2140, pedidos: 71 }, { local: 'Chamberí', ventas: 1560, pedidos: 49 }, { local: 'Salamanca', ventas: 1120, pedidos: 36 },
]
const TOP_DISHES = [
  { name: 'Burrito XL', units: 210 }, { name: 'Coca-Cola 33cl', units: 340 }, { name: 'Nachos con queso', units: 180 },
  { name: 'Pizza Diávola', units: 150 }, { name: 'Agua 50cl', units: 290 },
]
const LOCALES = ['Centro', 'Chamberí', 'Salamanca']
const MARCAS = ['Bendito Burrito', 'Pizza Loca', 'Wok & Roll', 'Green Bowl', 'Sushi Now', 'Kebab House', 'Poke Bar', 'Vegan Kitchen', 'Ramen Ya', 'Taco Loco', 'Smash Burger', 'Pasta Fresca', 'Arepas Mil', 'Bao & Co', 'Falafel King', 'Crepe París', 'Helado Feliz']
const PROMOS = ['2x1', '% platos', 'Regalo', 'Envío', 'Código', 'Fidelidad']

// ── Descargas (maqueta: ficheros de ejemplo con los datos ficticios) ────────
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
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, filename)
}
const REPORTS: { key: string; label: string; rows: () => Record<string, unknown>[] }[] = [
  { key: 'resumen', label: 'Resumen del periodo', rows: () => SERIES.map((p) => ({ Día: p.day, 'Con oferta (€)': p.conOferta, 'Sin oferta (€)': p.sinOferta, Pedidos: p.pedidos })) },
  { key: 'campanas', label: 'Rendimiento por campaña', rows: () => TOP_CAMPAIGNS.map((t) => ({ Campaña: t.name, Tipo: t.kind, ROI: t.roi })) },
  { key: 'marcas', label: 'Ventas por marca', rows: () => BRANDS.map((b) => ({ Marca: b.name, 'Ventas (€)': b.sales, 'Margen (€)': b.margin })) },
  { key: 'locales', label: 'Ventas por local', rows: () => LOCALES_SALES.map((l) => ({ Local: l.local, 'Ventas (€)': l.ventas, Pedidos: l.pedidos })) },
  { key: 'platos', label: 'Top platos', rows: () => TOP_DISHES.map((d) => ({ Plato: d.name, Unidades: d.units })) },
]

// ── Popover genérico (cierra al clicar fuera) ───────────────────────────────
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

function MultiSelect({ label, options, selected, onChange, searchable }: { label: string; options: string[]; selected: Set<string>; onChange: (s: Set<string>) => void; searchable?: boolean }) {
  const [q, setQ] = useState('')
  const all = selected.size === 0 || selected.size === options.length
  const summary = all ? 'Todas' : `${selected.size} sel.`
  const shown = searchable && q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options
  const toggle = (o: string) => { const n = new Set(selected); n.has(o) ? n.delete(o) : n.add(o); onChange(n) }
  return (
    <Popover width={searchable ? 260 : 220} button={(open) => (
      <button style={{ ...styles.ddBtn, ...(open ? styles.ddBtnOpen : {}) }}>
        <span style={styles.ddLabel}>{label}:</span> <span style={styles.ddValue}>{summary}</span> <ChevronDown size={15} color={C.inkFaint} />
      </button>
    )}>
      {() => (
        <>
          {searchable && (
            <div style={styles.ddSearch}><Search size={14} color={C.inkFaint} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" style={styles.ddSearchInput} /></div>
          )}
          <div style={styles.ddActions}>
            <button style={styles.ddAction} onClick={() => onChange(new Set(options))}>Todos</button>
            <button style={styles.ddAction} onClick={() => onChange(new Set())}>Ninguno</button>
          </div>
          <div style={styles.ddList}>
            {shown.map((o) => {
              const on = selected.size === 0 ? false : selected.has(o)
              return (
                <label key={o} style={styles.ddItem}>
                  <span style={{ ...styles.ddCheck, ...(on ? styles.ddCheckOn : {}) }}>{on && <Check size={12} color="#fff" />}</span>
                  <input type="checkbox" checked={on} onChange={() => toggle(o)} style={{ display: 'none' }} />
                  <span style={styles.ddItemName}>{o}</span>
                </label>
              )
            })}
          </div>
        </>
      )}
    </Popover>
  )
}

const RANGE_OPTS = [{ k: '7d', l: '7 días' }, { k: '30d', l: '30 días' }, { k: '90d', l: '90 días' }, { k: 'custom', l: 'Personalizado' }]
function RangeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const label = RANGE_OPTS.find((r) => r.k === value)?.l ?? '30 días'
  return (
    <Popover width={220} button={(open) => (
      <button style={{ ...styles.ddBtn, ...(open ? styles.ddBtnOpen : {}) }}>
        <span style={styles.ddLabel}>Rango:</span> <span style={styles.ddValue}>{label}</span> <ChevronDown size={15} color={C.inkFaint} />
      </button>
    )}>
      {(close) => (
        <div style={styles.ddList}>
          {RANGE_OPTS.map((r) => (
            <button key={r.k} style={{ ...styles.ddRadio, ...(value === r.k ? styles.ddRadioOn : {}) }} onClick={() => { onChange(r.k); if (r.k !== 'custom') close() }}>{r.l}</button>
          ))}
          {value === 'custom' && (
            <div style={styles.ddDates}>
              <input type="date" style={styles.ddDate} /><span style={{ color: C.inkFaint }}>→</span><input type="date" style={styles.ddDate} />
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}

// Tooltip custom (paleta Folvy).
function FTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={styles.tip}>
      <div style={styles.tipDay}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={styles.tipRow}>
          <span style={{ ...styles.tipDot, background: p.color || p.stroke }} />
          <span style={styles.tipName}>{p.name}</span>
          <span style={styles.tipVal}>{p.dataKey === 'pedidos' ? `${p.value} ped.` : eur(Number(p.value))}</span>
        </div>
      ))}
    </div>
  )
}

export default function ShopHomePage() {
  const s = styles
  const [dense, setDense] = useState(false)
  const [range, setRange] = useState('30d')
  const [locs, setLocs] = useState<Set<string>>(new Set())
  const [marcas, setMarcas] = useState<Set<string>>(new Set())
  const [promos, setPromos] = useState<Set<string>>(new Set())
  const gap = dense ? 8 : 12
  const maxBrand = Math.max(...BRANDS.map((b) => b.sales))

  const chips: { label: string; clear: () => void }[] = []
  if (locs.size > 0 && locs.size < LOCALES.length) chips.push({ label: `${locs.size} ${locs.size === 1 ? 'local' : 'locales'}`, clear: () => setLocs(new Set()) })
  if (marcas.size > 0 && marcas.size < MARCAS.length) chips.push({ label: `${marcas.size} ${marcas.size === 1 ? 'marca' : 'marcas'}`, clear: () => setMarcas(new Set()) })
  if (promos.size > 0 && promos.size < PROMOS.length) chips.push({ label: `${promos.size} ${promos.size === 1 ? 'tipo' : 'tipos'}`, clear: () => setPromos(new Set()) })

  return (
    <div style={s.page}>
      <div style={s.mockBanner}>Maqueta v2 · datos de ejemplo — aprueba antes de cablear datos reales.</div>

      <div style={s.header}>
        <div style={s.titleRow}><Home size={22} color={C.accent} /><h1 style={s.h1}>Inicio</h1></div>
        <div style={s.headRight}>
          <div style={s.densityToggle}>
            <button style={{ ...s.densityBtn, ...(!dense ? s.densityOn : {}) }} onClick={() => setDense(false)}>Aireada</button>
            <button style={{ ...s.densityBtn, ...(dense ? s.densityOn : {}) }} onClick={() => setDense(true)}>Compacta</button>
          </div>
          <Popover width={230} button={(open) => (
            <button style={{ ...s.downloadBtn, ...(open ? { background: C.ink } : {}) }}><Download size={16} /> Descargar <ChevronDown size={15} /></button>
          )}>
            {(close) => (
              <div style={s.dlMenu}>
                <div style={s.dlHead}>Informe</div>
                {REPORTS.map((r) => (
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

      {/* Barra de filtros sticky (dropdowns) */}
      <div style={s.filters}>
        <RangeSelect value={range} onChange={setRange} />
        <MultiSelect label="Locales" options={LOCALES} selected={locs} onChange={setLocs} />
        <MultiSelect label="Marcas" options={MARCAS} selected={marcas} onChange={setMarcas} searchable />
        <MultiSelect label="Promo" options={PROMOS} selected={promos} onChange={setPromos} />
        <span style={s.channelFixed}>Canal: Shop</span>
        <span style={s.vsPrev}>· comparado vs periodo anterior</span>
      </div>
      {chips.length > 0 && (
        <div style={s.summaryChips}>
          {chips.map((c, i) => <button key={i} style={s.sumChip} onClick={c.clear}>{c.label} <span style={s.sumX}>×</span></button>)}
        </div>
      )}

      <div style={s.insight}>
        <TrendingUp size={17} color={C.greenDeep} />
        <span>Tus ofertas generaron <b>1.240 €</b> de margen real — un <b style={{ color: C.greenDeep }}>15% más</b> que el periodo anterior. El <b>2x1 en Aguas</b> es tu campaña más rentable (ROI 4,2×).</span>
      </div>

      <div style={{ ...s.heroGrid, gap }}>
        <KpiCard label="Ventas Shop" value={eur(4820)} delta={12} dense={dense} />
        <KpiCard label="Pedidos" value="156" delta={8} dense={dense} />
        <KpiCard label="Ticket medio" value="30,90 €" delta={4} dense={dense} />
        <KpiCard label="Margen real" value={eur(1240)} delta={15} dense={dense} valueColor={C.greenDeep} sub="78% de pedidos medibles" />
        <KpiCard label="Clientes nuevos" value="42" delta={22} dense={dense} sub="por bienvenida" />
        <KpiCard label="Pedidos con oferta" value="38%" delta={6} dense={dense} sub="59 de 156" />
      </div>

      {/* Gráfica principal (fresca) */}
      <div style={{ ...s.card, ...(dense ? s.cardDense : {}), marginTop: gap + 6 }}>
        <div style={s.chartHead}>
          <div style={s.cardTitle}>Ventas por día · con oferta vs sin oferta</div>
          <div style={s.chipLegend}>
            <span style={s.legChip}><span style={{ ...s.legDot, background: C.accent }} /> Con oferta</span>
            <span style={s.legChip}><span style={{ ...s.legDot, background: '#DFDAD0' }} /> Sin oferta</span>
            <span style={s.legChip}><span style={{ ...s.legDot, background: C.ink }} /> Pedidos</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={dense ? 220 : 280}>
          <ComposedChart data={SERIES} margin={{ top: 8, right: 6, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="gOffer" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF6A4E" /><stop offset="100%" stopColor="#FF5436" /></linearGradient>
              <linearGradient id="gPlain" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E9E4DA" /><stop offset="100%" stopColor="#DAD4C8" /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="0" stroke={C.softGrid} vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="eur" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="cnt" orientation="right" tick={{ fontSize: 11, fill: C.inkFaint }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,.03)' }} content={<FTooltip />} />
            <Bar yAxisId="eur" dataKey="conOferta" name="Con oferta" stackId="a" fill="url(#gOffer)" maxBarSize={30} animationDuration={700} />
            <Bar yAxisId="eur" dataKey="sinOferta" name="Sin oferta" stackId="a" fill="url(#gPlain)" radius={[5, 5, 0, 0]} maxBarSize={30} animationDuration={700} />
            <Line yAxisId="cnt" dataKey="pedidos" name="Pedidos" type="monotone" stroke={C.ink} strokeWidth={2.5} dot={false} animationDuration={900} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Fila de 4 tarjetas */}
      <div style={{ ...s.grid4, gap, marginTop: gap }}>
        <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
          <div style={s.cardTitle}>¿Qué oferta te funciona?</div>
          <div style={s.donutWrap}>
            <ResponsiveContainer width="100%" height={168}>
              <PieChart>
                <Pie data={BY_KIND} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={56} outerRadius={72} paddingAngle={3} cornerRadius={6} stroke="none" animationDuration={700}>
                  {BY_KIND.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip content={<FTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={s.donutCenter}><div style={s.donutTotal}>{eur(KIND_TOTAL)}</div><div style={s.donutCap}>invertido</div></div>
          </div>
          <div style={s.legend}>
            {BY_KIND.map((k) => <div key={k.name} style={s.legendRow}><span style={{ ...s.dot, background: k.color }} /><span style={s.legendName}>{k.name}</span><span style={s.legendVal}>{eur(k.value)}</span></div>)}
          </div>
        </div>

        <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
          <div style={s.cardTitle}>Top campañas por ROI</div>
          <div style={s.list}>
            {TOP_CAMPAIGNS.map((t) => (
              <div key={t.name} style={s.listRow} title="Abrirá el panel de la campaña">
                <span style={s.listName}>{t.name}</span><span style={s.listTag}>{t.kind}</span>
                <span style={{ ...s.listRoi, color: roiColor(t.roi) }}>{t.roi.toFixed(1).replace('.', ',')}×</span>
              </div>
            ))}
          </div>
        </div>

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

        <div style={{ ...s.card, ...(dense ? s.cardDense : {}) }}>
          <div style={s.cardTitle}>Platos más vendidos</div>
          <div style={s.list}>
            {TOP_DISHES.map((d, i) => (
              <div key={d.name} style={s.dishRow}><span style={s.dishRank}>{i + 1}</span><span style={s.listName}>{d.name}</span><span style={s.dishUnits}>{d.units} uds</span></div>
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
  headRight: { display: 'flex', alignItems: 'center', gap: 10 },
  densityToggle: { display: 'flex', gap: 4 },
  densityBtn: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  densityOn: { background: C.ink, color: '#fff', border: `1px solid ${C.ink}` },
  downloadBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: C.accent, color: '#fff', borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' },

  dlMenu: { padding: 6 },
  dlHead: { fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: C.inkFaint, padding: '6px 8px 8px' },
  dlRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px' },
  dlName: { flex: 1, fontSize: 13, color: C.ink, fontWeight: 600 },
  dlFmt: { border: `1px solid ${C.lineInput}`, background: '#fff', color: C.inkDim, borderRadius: 8, padding: '3px 9px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' },

  filters: { position: 'sticky', top: 0, zIndex: 20, background: C.page, borderRadius: 14, border: `1px solid ${C.line}`, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 10 },
  channelFixed: { fontSize: 12, color: C.inkFaint, fontWeight: 700, marginLeft: 2 },
  vsPrev: { fontSize: 12, color: C.greenDeep, fontWeight: 700 },
  summaryChips: { display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 },
  sumChip: { border: `1px solid ${C.accent}44`, background: '#FFF1EE', color: C.accent, borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  sumX: { fontWeight: 900, marginLeft: 2 },

  ddBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.lineInput}`, background: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, cursor: 'pointer' },
  ddBtnOpen: { borderColor: C.ink },
  ddLabel: { color: C.inkDim, fontWeight: 600 },
  ddValue: { color: C.ink, fontWeight: 800 },
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

  tip: { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '9px 11px', minWidth: 150 },
  tipDay: { fontSize: 11.5, fontWeight: 800, color: C.inkDim, marginBottom: 6 },
  tipRow: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, marginTop: 3 },
  tipDot: { width: 9, height: 9, borderRadius: 3, flexShrink: 0 },
  tipName: { flex: 1, color: C.inkDim },
  tipVal: { fontWeight: 800, color: C.ink },

  donutWrap: { position: 'relative' },
  donutCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  donutTotal: { fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-.02em' },
  donutCap: { fontSize: 11, color: C.inkFaint, fontWeight: 600 },

  legend: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 },
  legendRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 },
  dot: { width: 11, height: 11, borderRadius: 3, flexShrink: 0 },
  legendName: { fontWeight: 700, color: C.ink, flex: 1 },
  legendVal: { color: C.inkDim, fontWeight: 700 },

  list: { display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 },
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
