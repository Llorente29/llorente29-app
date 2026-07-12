// src/pages/EconomiaPlataformasPage.tsx
//
// Economia de Plataforma / Margenes (Capa B + C). Lee la RPC server-side
// `channel_economics_dashboard` via channelEconomicsService. Una verdad en SQL.
// Diseno fresco y grafico, con SALUD DEL DATO (que cubre, que te puedes creer,
// que falta) y cada bloque explicado en lenguaje llano.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { supabase } from '@/lib/supabase'
import {
  getChannelEconomics,
  type ChannelEconomics,
} from '@/modules/ventas/services/channelEconomicsService'

const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n ?? 0)
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`)

const NAVY = '#1E3A5F'
const CORAL = '#FF5436'
const GREEN = '#0F7A54'
const RED = '#C0392B'

function sem(v: number | null, g = 60, a = 45): { bg: string; fg: string } {
  if (v == null) return { bg: '#f1f5f9', fg: '#64748b' }
  if (v >= g) return { bg: '#e3f3ea', fg: GREEN }
  if (v >= a) return { bg: '#fdf1dd', fg: '#B87400' }
  return { bg: '#fbe6e3', fg: RED }
}

type PeriodKey = '90d' | '180d' | 'todo'
const PERIODS: Record<PeriodKey, string> = { '90d': '90 dias', '180d': '6 meses', 'todo': 'Todo' }
function range(k: PeriodKey): { from: Date | null; to: Date | null } {
  if (k === 'todo') return { from: null, to: null }
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - (k === '90d' ? 90 : 180))
  return { from, to }
}
const CH_MAP: Record<string, string> = { glovo: 'import_csv_glovo', uber: 'import_csv_uber', justeat: 'import_csv_je' }
const fdate = (s: string | null) =>
  s ? new Date(s + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'

interface Opt { id: string; name: string }

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
      </div>
      {hint && <p className="text-[12px] text-slate-400 mb-3 leading-snug">{hint}</p>}
      {children}
    </div>
  )
}

function Pill({ v, g, a }: { v: number | null; g?: number; a?: number }) {
  const c = sem(v, g, a)
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums" style={{ background: c.bg, color: c.fg }}>
      {pct(v)}
    </span>
  )
}

function WfRow({ label, amount, max, color, bold, sign }:
  { label: string; amount: number; max: number; color: string; bold?: boolean; sign?: boolean }) {
  const eur0 = (n: number) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
  const width = Math.min(100, (Math.abs(amount) / max) * 100)
  const amountColor = amount < 0 ? RED : bold ? '#0F172A' : GREEN
  return (
    <div className="grid items-center gap-3" style={{ gridTemplateColumns: '170px 1fr 92px' }}>
      <div className={(bold ? 'font-semibold text-slate-800' : 'text-slate-600') + ' text-[13px] truncate'}>
        {sign ? (amount < 0 ? '- ' : '+ ') : ''}{label}
      </div>
      <div className="h-5 rounded bg-slate-100 overflow-hidden">
        <div className="h-5 rounded" style={{ width: width + '%', background: color, opacity: 0.9 }} />
      </div>
      <div className="text-right text-[13px] font-semibold tabular-nums" style={{ color: amountColor }}>
        {amount < 0 ? '-' : ''}{eur0(Math.abs(amount))}
      </div>
    </div>
  )
}

export default function EconomiaPlataformasPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const [period, setPeriod] = useState<PeriodKey>('todo')
  const [channel, setChannel] = useState('')
  const [brandId, setBrandId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [brands, setBrands] = useState<Opt[]>([])
  const [locations, setLocations] = useState<Opt[]>([])
  const [data, setData] = useState<ChannelEconomics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (accountsLoading || !activeAccountId || !supabase) return
    let off = false
    supabase.from('locations').select('id,name').eq('account_id', activeAccountId).order('name')
      .then(({ data }) => { if (!off && data) setLocations(data as Opt[]) })
    supabase.from('brand').select('id,name').eq('account_id', activeAccountId).is('archived_at', null).order('name')
      .then(({ data }) => { if (!off && data) setBrands(data as Opt[]) })
    return () => { off = true }
  }, [activeAccountId, accountsLoading])

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) { setData(null); setLoading(false); return }
    let off = false
    setLoading(true)
    setError(null)
    const { from, to } = range(period)
    getChannelEconomics({
      accountId: activeAccountId, from, to,
      channel: channel ? CH_MAP[channel] : null,
      brandId: brandId || null, locationId: locationId || null,
    })
      .then((d) => { if (!off) setData(d) })
      .catch((e: unknown) => { if (!off) { setError(e instanceof Error ? e.message : 'Error'); setData(null) } })
      .finally(() => { if (!off) setLoading(false) })
    return () => { off = true }
  }, [activeAccountId, accountsLoading, period, channel, brandId, locationId])

  const wfMax = useMemo(() => Math.max(1, ...(data?.waterfall ?? []).map((w) => Math.abs(w.amount))), [data])
  const chMax = useMemo(() => Math.max(1, ...(data?.by_channel ?? []).map((c) => c.venta)), [data])
  const k = data?.kpis
  const salud = data?.salud
  const venta = k?.venta ?? 0
  const conCoste = salud?.canales_con_coste?.join(', ') || 'ninguno'
  const soloVenta = salud?.canales_solo_venta?.join(', ')

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Economia de plataforma</h1>
          <p className="text-sm text-slate-500">Lo que de verdad llega a caja: comisiones, promos, tasas y margen real por pedido.</p>
        </div>
        <div className="flex gap-1.5">
          {(Object.keys(PERIODS) as PeriodKey[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
              style={period === p ? { background: NAVY, color: '#fff', borderColor: 'transparent' } : { borderColor: '#e2e8f0', color: '#475569' }}>
              {PERIODS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* SALUD DEL DATO */}
      {salud && (
        <div className="mb-4 rounded-2xl border p-4" style={{ background: '#f5f8fc', borderColor: '#dbe6f2' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: GREEN }} />
            <span className="text-[13px] font-semibold text-slate-700">Salud del dato — qué estás viendo y cuánto te puedes fiar</span>
          </div>
          <div className="grid gap-2 text-[12.5px] text-slate-600" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            <div><b>Periodo:</b> {fdate(salud.periodo_desde)} – {fdate(salud.periodo_hasta)} · {salud.n_liquidaciones} liquidaciones</div>
            <div><b>Coste real:</b> solo <span style={{ color: GREEN, fontWeight: 600 }}>{conCoste}</span>{soloVenta ? <> · <span className="text-slate-500">{soloVenta} de momento solo venta</span></> : null}</div>
            <div><b>Detalle por pedido:</b> {salud.pedidos_capa_c.toLocaleString('es-ES')} pedidos (Capa C, Glovo)</div>
            <div><b>Casados con tu POS:</b> {salud.casados_pos} ({pct(salud.pct_casado_pos)}) — crece según se llena tu histórico</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        <select value={channel} onChange={(e) => setChannel(e.target.value)}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white">
          <option value="">Todos los canales</option>
          <option value="glovo">Glovo</option>
          <option value="uber">Uber</option>
          <option value="justeat">JustEat</option>
        </select>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white">
          <option value="">Todos los locales</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={brandId} onChange={(e) => setBrandId(e.target.value)}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white">
          <option value="">Todas las marcas</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="py-20 text-center text-sm text-slate-400">Cargando economia...</div>
      ) : !data || venta === 0 ? (
        <div className="py-20 text-center text-sm text-slate-400">No hay liquidaciones con estos filtros.</div>
      ) : (
        <>
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
            {[
              { l: 'Venta bruta', v: eur(k!.venta), s: `todos los canales · ${k!.pedidos} pedidos`, c: NAVY },
              { l: 'Llega a caja', v: pct(k!.pct_efectivo), s: `${eur(k!.liquidacion)} de ${eur(k!.venta_con_coste)} · solo ${conCoste}`, c: sem(k!.pct_efectivo).fg },
              { l: 'Coste del canal', v: eur(k!.coste_canal), s: `comision + promos + tasas · ${conCoste}`, c: RED },
              { l: 'Liquidacion', v: eur(k!.liquidacion), s: `lo que ${conCoste} te ingresa`, c: GREEN },
            ].map((x, i) => (
              <div key={i} className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
                <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{x.l}</div>
                <div className="text-[26px] font-bold tabular-nums mt-1" style={{ color: x.c }}>{x.v}</div>
                <div className="text-xs text-slate-400 mt-0.5 leading-snug">{x.s}</div>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <Card title="De la venta a tu caja"
              hint={`Solo ${conCoste} (unico canal con desglose de coste). De cada euro que vendes, esto es lo que se lleva la plataforma (rojo) y lo que vuelve como credito (verde), hasta lo que te ingresa.`}>
              <div className="flex flex-col gap-2">
                <WfRow label="Venta bruta" amount={k!.venta_con_coste} max={k!.venta_con_coste || 1} color={NAVY} bold />
                {data.waterfall.map((w) => (
                  <WfRow key={w.concept} label={w.concept} amount={w.amount} max={wfMax}
                    color={w.amount < 0 ? CORAL : GREEN} sign />
                ))}
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <WfRow label="Liquidacion" amount={k!.liquidacion} max={k!.venta_con_coste || 1} color={GREEN} bold />
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))' }}>
            <Card title="Rentabilidad por marca"
              hint="% efectivo = de lo vendido, cuanto llega a caja tras comision, promos y tasas. Verde ≥60% · ambar 45-60% · rojo <45%. (Solo canales con coste.)">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase text-slate-400">
                    <th className="text-left font-semibold py-1">Marca</th>
                    <th className="text-right font-semibold py-1">Venta</th>
                    <th className="text-right font-semibold py-1">Efectivo</th>
                    <th className="text-right font-semibold py-1">Promos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_brand.slice(0, 12).map((b) => (
                    <tr key={b.brand} className="border-t border-slate-50">
                      <td className="py-1.5 text-slate-700">
                        {b.brand}
                        {b.es_deuda && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#fbe6e3', color: RED }}>deuda</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{eur(b.venta)}</td>
                      <td className="py-1.5 text-right">{b.pct_efectivo == null ? <span className="text-slate-300">—</span> : <Pill v={b.pct_efectivo} />}</td>
                      <td className="py-1.5 text-right tabular-nums" style={{ color: b.promos < 0 ? RED : '#94a3b8' }}>
                        {b.promos < 0 ? eur(b.promos) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Comparador por canal" hint="Venta por canal y, donde tenemos el desglose, lo que llega a caja. Uber y JustEat aun sin coste (proximamente).">
              <div className="flex flex-col gap-3">
                {data.by_channel.map((c) => (
                  <div key={c.channel}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700">
                        {c.channel}
                        {!c.tiene_coste && <span className="ml-1.5 text-[10px] text-slate-400">(solo venta)</span>}
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        {eur(c.venta)}{c.liquidacion != null ? ' · llega ' + eur(c.liquidacion) : ''}
                      </span>
                    </div>
                    <div className="h-2.5 rounded bg-slate-100 overflow-hidden">
                      <div className="h-2.5 rounded" style={{ width: ((c.venta / chMax) * 100) + '%', background: c.tiene_coste ? NAVY : '#94a3b8' }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {data.per_order && data.per_order.pedidos > 0 && (
            <Card title="Margen real por pedido (Capa C)"
              hint={`Lo que Glovo te paga NETO por cada pedido, casado con tu POS. ${data.per_order.pedidos} pedidos - ${data.per_order.con_pos} con venta del POS al lado. Reconciliado al centimo con la liquidacion real.`}>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
                {data.per_order.by_brand.map((b) => {
                  const c = sem(b.pct_efectivo)
                  return (
                    <div key={b.brand} className="rounded-xl border border-slate-200 p-3">
                      <div className="text-[13px] font-medium text-slate-700 truncate">{b.brand}</div>
                      <div className="text-2xl font-bold tabular-nums mt-1" style={{ color: c.fg }}>{eur(b.neto_medio)}</div>
                      <div className="text-[11px] text-slate-400">neto medio/pedido</div>
                      <div className="flex items-center justify-between mt-2">
                        <Pill v={b.pct_efectivo} />
                        <span className="text-[11px] text-slate-400 tabular-nums">{b.pedidos} ped.</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-3">
                Neto por pedido = reparto de la liquidacion real a prorrata de la venta (suma exacta a lo que la plataforma te pago).
                Las liquidaciones en deuda quedan fuera de este calculo para no ensuciar el margen.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
