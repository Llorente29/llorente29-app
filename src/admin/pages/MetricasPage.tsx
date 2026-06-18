// src/admin/pages/MetricasPage.tsx
//
// Panel de métricas de la plataforma (Portal de staff). Una llamada a
// platform_metrics. Muestra solo lo medible de verdad; lo no medible se declara
// explícitamente (churn desde ahora, CAC/LTV/NRR cuando haya datos), nunca como 0 falso.

import { useEffect, useState } from 'react'
import { getPlatformMetrics, formatEur, type PlatformMetrics } from '../services/metricsService'

const PLAN_LABEL: Record<string, string> = {
  starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise', '(sin plan)': 'Sin plan',
}

export default function MetricasPage() {
  const [m, setM] = useState<PlatformMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPlatformMetrics()
      .then(setM)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sm" style={{ color: 'var(--color-text-secondary, #888)' }}>Cargando métricas…</p>
  if (error) return (
    <div className="rounded-lg p-3" style={{ background: '#FDECEC', border: '1px solid #E5A0A0' }}>
      <p className="text-sm" style={{ color: '#A12626' }}>{error}</p>
    </div>
  )
  if (!m) return null

  const maxSignup = Math.max(1, ...m.signupsByMonth.map(s => s.count))

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-display font-medium mb-1" style={{ color: 'var(--color-accent)' }}>Métricas</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary, #666)' }}>
        Salud de la plataforma Folvy. Excluye la cuenta interna (sandbox).
      </p>

      {/* Tarjetas de cabecera */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card label="Clientes activos" value={String(m.clientsActive)} sub={`${m.clientsTotal} en total`} />
        <Card label="MRR estimado" value={formatEur(m.mrrEur)} sub="ingresos recurrentes/mes" accent />
        <Card label="ARR estimado" value={formatEur(m.arrEur)} sub="run-rate anual" />
        <Card label="Uso real (30 d)" value={String(m.usageActive30d)} sub="clientes ingiriendo ventas" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Altas por mes */}
        <Panel title="Altas de clientes por mes">
          {m.signupsByMonth.length === 0 ? (
            <Empty text="Sin altas en el periodo." />
          ) : (
            <div className="flex items-end gap-2 h-32 mt-2">
              {m.signupsByMonth.map(s => (
                <div key={s.month} className="flex-1 flex flex-col items-center justify-end gap-1">
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary, #888)' }}>{s.count}</span>
                  <div style={{ width: '100%', height: `${(s.count / maxSignup) * 100}%`, minHeight: 4, background: 'var(--color-terracota)', borderRadius: 3 }} />
                  <span className="text-[10px]" style={{ color: 'var(--color-text-secondary, #999)' }}>{s.month.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Distribución por plan / estado */}
        <Panel title="Suscripciones por plan">
          {m.subsByPlan.length === 0 ? <Empty text="Sin suscripciones." /> : (
            <div className="flex flex-col gap-2 mt-2">
              {m.subsByPlan.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
                    {PLAN_LABEL[r.plan] ?? r.plan}
                    <span className="text-xs ml-2" style={{ color: 'var(--color-text-secondary, #999)' }}>{r.status}</span>
                  </span>
                  <span className="font-medium" style={{ color: 'var(--color-accent)' }}>{r.count}</span>
                </div>
              ))}
              <div className="border-t mt-1 pt-2 flex items-center justify-between text-xs" style={{ borderColor: 'var(--color-border, #eee)', color: 'var(--color-text-secondary, #888)' }}>
                <span>Activas {m.subsActive} · Trial {m.subsTrial}{m.subsWithoutPlan > 0 ? ` · Sin plan ${m.subsWithoutPlan}` : ''}</span>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Uso real */}
      <Panel title="Uso real del producto">
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary, #888)' }}>
          Lo que ningún panel de facturación ve: si el cliente de verdad usa Folvy (ingesta de ventas).
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Mini label="Activos 7 d" value={String(m.usageActive7d)} />
          <Mini label="Activos 30 d" value={String(m.usageActive30d)} />
          <Mini label="Ventas clientes (30 d)" value={m.clientSales30d.toLocaleString('es-ES')} />
          <Mini label="Ventas clientes (total)" value={m.clientSalesTotal.toLocaleString('es-ES')} />
        </div>
      </Panel>

      {/* Honestidad: lo que aún no se mide */}
      <div className="rounded-lg p-4 mt-6" style={{ background: '#F7F4EF', border: '1px dashed var(--color-border, #d8cfc0)' }}>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-accent)' }}>Aún no medible (sin datos que inventar)</p>
        <ul className="text-sm" style={{ color: 'var(--color-text-secondary, #666)' }}>
          <li><b>Churn</b> — se empieza a medir desde ahora: cada cambio de estado de cuenta queda en Auditoría y alimentará la curva de bajas. No hay histórico previo.</li>
          <li><b>CAC · LTV · NRR</b> — requieren gasto de marketing y revenue de expansión que Folvy no registra todavía. Se añadirán cuando exista la fuente.</li>
          <li><b>MRR vía Stripe</b> — hoy el MRR es estimado (planes × locales). Cuando la facturación pase por Stripe, vendrá de la caja real.</li>
        </ul>
      </div>

      <p className="text-xs mt-4" style={{ color: 'var(--color-text-secondary, #aaa)' }}>
        Generado {new Date(m.generatedAt).toLocaleString('es-ES')} · {m.platformAdminsActive} admin(s) de plataforma
      </p>
    </div>
  )
}

function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg p-4" style={{ background: accent ? 'rgba(193,102,68,0.06)' : 'var(--color-bg-surface, #fff)', border: `1px solid ${accent ? 'var(--color-terracota)' : 'var(--color-border, #e5e5e5)'}` }}>
      <p className="text-xs" style={{ color: 'var(--color-text-secondary, #888)' }}>{label}</p>
      <p className="text-2xl font-display font-medium mt-1" style={{ color: 'var(--color-accent)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary, #999)' }}>{sub}</p>}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-surface, #fff)', border: '1px solid var(--color-border, #e5e5e5)' }}>
      <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>{title}</p>
      {children}
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md p-3" style={{ background: 'var(--color-bg-page, #faf8f5)' }}>
      <p className="text-lg font-medium" style={{ color: 'var(--color-accent)' }}>{value}</p>
      <p className="text-xs" style={{ color: 'var(--color-text-secondary, #888)' }}>{label}</p>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm mt-2" style={{ color: 'var(--color-text-secondary, #aaa)' }}>{text}</p>
}
