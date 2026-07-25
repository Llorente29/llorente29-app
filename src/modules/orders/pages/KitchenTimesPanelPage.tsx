// src/modules/orders/pages/KitchenTimesPanelPage.tsx
//
// Panel de TIEMPOS DE COCINA (KPI). Server-side (RPC kitchen_time_stats), POR LOCAL
// (nunca un número global que mezcle locales/marcas: el local sale del selector
// global; "Alcalá vs Carabanchel" = cambiar de local arriba). Tiempo de cocina =
// ready_at − accepted_at. Excluye cancelados, programados y sin ready_at.
//
// DESTACADO: la ADOPCIÓN. Por debajo del 80% de "Listo" pulsado, el panel avisa en
// su cara de que el dato NO es representativo (si solo se pulsa en los tranquilos, la
// mediana sale preciosa y falsa).

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { MapPin, AlertTriangle, Clock } from 'lucide-react'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { fmtInt, fmtNum } from '@/lib/format'
import { getKitchenTimeStats, type KitchenTimeStats } from '../services/ordersFeedService'

type RangeKey = 'hoy' | '7d' | '30d'
const RANGE_LABEL: Record<RangeKey, string> = { hoy: 'Hoy', '7d': '7 días', '30d': '30 días' }

// [from, to) en ISO para el rango elegido (hora local del navegador).
function rangeIso(key: RangeKey): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString()
  if (key === 'hoy') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return { from: start.toISOString(), to }
  }
  const days = key === '7d' ? 7 : 30
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: start.toISOString(), to }
}

function pct(n: number | null): string { return n == null ? '—' : `${fmtInt(n)}%` }
function mins(n: number | null): string { return n == null ? '—' : `${fmtNum(n, 1)} min` }

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-default bg-card px-4 py-3.5">
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="font-display font-bold text-[26px] tabular-nums text-text-primary mt-1">{value}</div>
      {sub && <div className="text-[12px] text-text-secondary mt-0.5">{sub}</div>}
    </div>
  )
}

export default function KitchenTimesPanelPage() {
  const { resolvedLocationId, isConsolidated } = useLocationScope()
  const [range, setRange] = useState<RangeKey>('hoy')
  const [stats, setStats] = useState<KitchenTimeStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!resolvedLocationId) return
    setLoading(true); setError(null)
    try {
      const { from, to } = rangeIso(range)
      setStats(await getKitchenTimeStats(resolvedLocationId, from, to))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los tiempos')
    } finally {
      setLoading(false)
    }
  }, [resolvedLocationId, range])

  useEffect(() => { void load() }, [load])

  if (isConsolidated || !resolvedLocationId) {
    return (
      <div className="grid place-items-center h-[60vh] text-center text-text-secondary">
        <div>
          <MapPin className="mx-auto mb-3 text-text-secondary" size={32} />
          <p className="text-lg font-medium text-text-primary">Selecciona un local</p>
          <p className="text-sm mt-1">Los tiempos de cocina son por local (nunca un número global). Elige uno arriba.</p>
        </div>
      </div>
    )
  }

  const s = stats?.summary
  const a = stats?.adopcion
  const noRepresenta = a != null && a.representativo === false

  return (
    <div className="max-w-5xl mx-auto p-1">
      <div className="flex items-center gap-3 mb-4">
        <Clock size={22} className="text-text-secondary" />
        <h1 className="font-display font-semibold text-[22px] tracking-tight text-text-primary">Tiempos de cocina</h1>
        <div className="ml-auto flex bg-accent-bg rounded-xl p-0.5 gap-0.5">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map(k => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-bold ${range === k ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary'}`}
            >
              {RANGE_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-danger bg-danger-bg border border-danger/30 rounded-xl px-4 py-3 text-sm mb-4">{error}</div>
      )}

      {/* ADOPCIÓN destacada: si < 80%, el dato NO es representativo. */}
      {a && (
        <div className={`rounded-2xl border px-4 py-3 mb-4 flex items-start gap-2.5 ${
          noRepresenta ? 'border-warning/40 bg-warning-bg text-warning' : 'border-success/30 bg-success-bg text-success'
        }`}>
          {noRepresenta && <AlertTriangle size={18} className="shrink-0 mt-0.5" />}
          <div className="text-[13.5px] font-bold leading-snug">
            Adopción: {pct(a.pct)} · {fmtInt(a.con_listo)} de {fmtInt(a.elegibles)} pedidos con "Listo".
            {noRepresenta && <span className="block font-extrabold mt-0.5">Por debajo del 80% — el dato NO es representativo (mide solo los pedidos marcados).</span>}
          </div>
        </div>
      )}

      {loading && !stats ? (
        <div className="grid place-items-center h-[40vh] text-text-secondary">Cargando…</div>
      ) : (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Tile label="Pedidos medidos" value={fmtInt(s?.n_medidos ?? 0)} />
            <Tile label="Mediana" value={mins(s?.mediana_min ?? null)} sub="tiempo de cocina" />
            <Tile label="Dentro de objetivo" value={pct(s?.pct_en_objetivo ?? null)} sub={stats?.config ? `≤ ${stats.config.amber_max_minutes} min` : undefined} />
            <Tile label="Peor caso" value={mins(s?.peor_min ?? null)} />
          </div>

          {/* Por franja horaria */}
          <Section title="Por franja horaria" empty={!stats?.por_hora?.length}>
            {stats?.por_hora?.map(h => (
              <Row key={h.hora} left={`${String(h.hora).padStart(2, '0')}:00`} n={h.n} med={h.mediana_min} />
            ))}
          </Section>

          {/* Por marca (qué marca frena la cocina) */}
          <Section title="Por marca" empty={!stats?.por_marca?.length}>
            {stats?.por_marca?.map((b, i) => (
              <Row key={b.brand_id ?? `b${i}`} left={b.brand ?? '—'} n={b.n} med={b.mediana_min} />
            ))}
          </Section>

          {/* Tendencia semanal */}
          <Section title="Tendencia semanal" empty={!stats?.tendencia_semanal?.length}>
            {stats?.tendencia_semanal?.map(w => (
              <Row key={w.semana} left={w.semana} n={w.n} med={w.mediana_min} extra={pct(w.pct_en_objetivo)} />
            ))}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, empty, children }: { title: string; empty?: boolean; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-text-secondary mb-2">{title}</h2>
      {empty ? (
        <div className="rounded-xl border border-default bg-card px-4 py-3 text-[13px] text-text-secondary">Sin datos en el periodo.</div>
      ) : (
        <div className="rounded-2xl border border-default bg-card divide-y divide-default overflow-hidden">{children}</div>
      )}
    </div>
  )
}

function Row({ left, n, med, extra }: { left: string; n: number; med: number | null; extra?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
      <span className="font-bold text-text-primary min-w-[64px]">{left}</span>
      <span className="text-text-secondary tabular-nums">{fmtInt(n)} ped.</span>
      <span className="ml-auto font-bold text-text-primary tabular-nums">{med == null ? '—' : `${fmtNum(med, 1)} min`}</span>
      {extra && <span className="text-text-secondary tabular-nums w-[52px] text-right">{extra}</span>}
    </div>
  )
}
