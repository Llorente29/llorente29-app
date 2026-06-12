// src/shell/home/HomeGeneral.tsx
//
// Home general transversal del Shell. Primera pantalla tras login.
//
// DATOS REALES (11/06): las métricas y el resumen de Sales salen de la BBDD de
// la cuenta activa vía homeMetricsService (ventas hoy, % vs ayer, trabajando
// ahora, ticket/pedidos 7d). Lo que aún NO tiene fuente fiable (Solicitudes,
// APPCC, detalle de Team/Safety) se muestra como "—" — NO se inventa.
//
// Los widgets (MetricCard, ModuleSummaryCard) siguen siendo autocontenidos y
// reciben todo por props: preparado para configurabilidad por usuario (drag&drop
// + persistencia + reset) en el frente siguiente, sin reescribir los widgets.

import { useEffect, useState } from 'react'
import { Banknote, Users, Inbox, Leaf, BarChart3 } from 'lucide-react'

import { useIsMobile } from '../useIsMobile'
import { useApp } from '../../context/AppContext'
import { useLocationScope } from '../../modules/multitenancy/hooks/useLocationScope'
import MetricCard from './widgets/MetricCard'
import ModuleSummaryCard from './widgets/ModuleSummaryCard'
import { getHomeMetrics, type HomeMetrics } from './homeMetricsService'

const INK = 'var(--color-accent)'
const MUTED = 'var(--color-text-secondary)'

interface HomeGeneralProps {
  userName?: string
  onOpenModule?: (moduleId: string) => void
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'Buenas noches'
  if (h < 14) return 'Buenos días'
  if (h < 21) return 'Buenas tardes'
  return 'Buenas noches'
}

function todayLabel(): string {
  return new Date().toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

// Formateo seguro: si el dato es null (sin fuente real aún), muestra "—".
function eur(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  return n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 1000 ? 0 : 2 })
}
function num(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  return n.toLocaleString('es-ES')
}

export default function HomeGeneral({ userName, onOpenModule }: HomeGeneralProps) {
  const saludo = userName ? `${greeting()}, ${userName}` : greeting()
  const isMobile = useIsMobile()
  const { activeAccountId } = useApp()
  const { resolvedLocationId } = useLocationScope()

  const [metrics, setMetrics] = useState<HomeMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeAccountId) { setMetrics(null); setLoading(false); return }
    let alive = true
    setLoading(true)
    getHomeMetrics(activeAccountId, resolvedLocationId)
      .then(m => { if (alive) { setMetrics(m); setLoading(false) } })
      .catch(() => { if (alive) { setMetrics(null); setLoading(false) } })
    return () => { alive = false }
  }, [activeAccountId, resolvedLocationId])

  const metricsColumns = isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)'
  const modulesColumns = isMobile ? '1fr' : 'repeat(3, 1fr)'

  // Subtítulo de ventas: % vs ayer real, o neutro si no hay base.
  const ventasSubtitle = metrics?.ventasVsAyerPct != null
    ? `${metrics.ventasVsAyerPct >= 0 ? '+' : ''}${metrics.ventasVsAyerPct}% vs ayer`
    : 'vs ayer sin datos'
  const ventasTone = metrics?.ventasVsAyerPct != null && metrics.ventasVsAyerPct >= 0 ? 'positive' : 'neutral'

  const localesSub = metrics?.numLocales != null ? `en ${metrics.numLocales} ${metrics.numLocales === 1 ? 'local' : 'locales'}` : undefined

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', color: INK, margin: '0 0 2px', fontWeight: 500 }}>
        {saludo}
      </h1>
      <p style={{ fontSize: '0.875rem', color: MUTED, margin: '0 0 1.375rem' }}>
        Resumen de tu negocio · {todayLabel()}
      </p>

      {/* 4 métricas transversales — REALES donde hay fuente, "—" donde no. */}
      <div style={{ display: 'grid', gridTemplateColumns: metricsColumns, gap: 12, marginBottom: 22 }}>
        <MetricCard
          label="Ventas hoy"
          value={loading ? '…' : eur(metrics?.ventasHoy ?? null)}
          icon={Banknote}
          subtitle={loading ? undefined : ventasSubtitle}
          subtitleTone={ventasTone}
        />
        <MetricCard
          label="Trabajando ahora"
          value={loading ? '…' : num(metrics?.trabajandoAhora ?? null)}
          icon={Users}
          subtitle={loading ? undefined : localesSub}
        />
        {/* Solicitudes: sin fuente real confirmada aún → "—" honesto. */}
        <MetricCard
          label="Solicitudes"
          value="—"
          icon={Inbox}
          subtitle="próximamente"
          subtitleTone="neutral"
        />
        {/* APPCC hoy: sin fuente real confirmada aún → "—" honesto. */}
        <MetricCard
          label="APPCC hoy"
          value="—"
          icon={Leaf}
          subtitle="próximamente"
        />
      </div>

      {/* Tarjetas-resumen por módulo. Sales = REAL; Team/Safety = pendiente honesto. */}
      <div style={{ display: 'grid', gridTemplateColumns: modulesColumns, gap: 12 }}>
        <ModuleSummaryCard
          title="Team"
          icon={Users}
          onOpen={() => onOpenModule?.('personal')}
          lines={[
            { text: `${metrics?.trabajandoAhora != null ? metrics.trabajandoAhora : '—'} trabajando ahora` },
            { text: 'Detalle de turnos próximamente', muted: true },
          ]}
        />
        <ModuleSummaryCard
          title="Safety"
          icon={Leaf}
          onOpen={() => onOpenModule?.('appcc')}
          lines={[
            { text: 'Resumen APPCC próximamente' },
            { text: 'Se conectará con el módulo Safety', muted: true },
          ]}
        />
        <ModuleSummaryCard
          title="Sales"
          icon={BarChart3}
          onOpen={() => onOpenModule?.('ventas')}
          lines={[
            { text: `Ticket medio: ${loading ? '…' : eur(metrics?.ticketMedio7d ?? null)}` },
            { text: `${loading ? '…' : num(metrics?.numPedidos7d ?? null)} pedidos (7 días)` },
            { text: `Ventas 7 días: ${loading ? '…' : eur(metrics?.ventas7d ?? null)}`, muted: true },
          ]}
        />
      </div>
    </div>
  )
}
