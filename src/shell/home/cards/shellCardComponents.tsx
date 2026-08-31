// src/shell/home/cards/shellCardComponents.tsx
//
// LAS TARJETAS TRANSVERSALES DEL INICIO, ya en el catálogo.
//
// Son EXACTAMENTE las siete que el Inicio enseña desde junio, sin reescribir
// ni un widget: se envuelven `MetricCard` y `ModuleSummaryCard` tal cual. Lo
// dice el RECON del 30/08 y es la razón de que existan como estaban —
// «preparado para configurabilidad por usuario sin reescribir los widgets».
// Reescribirlos ahora sería tirar el trabajo que se hizo para no hacerlo dos
// veces, y además cambiaría el aspecto del Inicio en un lote que no va de eso.
//
// Viven en el SHELL y no en un módulo porque su dato sale de
// homeMetricsService, que es del shell. Las de módulo llegan por
// `ModuleDefinition.homeCards` y entran en el mismo catálogo sin tocar esto.
//
// Los componentes viven aquí y las DEFINICIONES en shellCards.ts: mezclar
// componentes y constantes en el mismo módulo rompe el fast refresh.
//
// `MetricCard` NO SE TOCA en este lote (línea base del 30/08, punto 3.2):
// converger MetricCard con KpiCard cambia el aspecto del Inicio y es una
// decisión de diseño, no un merge. Se toma la salida que Julio dejó escrita.

import { Banknote, Users, Inbox, Leaf, BarChart3 } from 'lucide-react'
import MetricCard from '../widgets/MetricCard'
import ModuleSummaryCard from '../widgets/ModuleSummaryCard'
import type { HomeCardProps } from '../../types'
import { useHomeMetrics } from './homeMetricsContext'

// Formateo seguro heredado del Inicio: null → «—», nunca un 0 inventado.
function eur(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 1000 ? 0 : 2 })
}
function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('es-ES')
}

export function VentasHoy() {
  const { metrics, loading } = useHomeMetrics()
  const pct = metrics?.ventasVsAyerPct
  return (
    <MetricCard
      label="Ventas hoy"
      value={loading ? '…' : eur(metrics?.ventasHoy ?? null)}
      icon={Banknote}
      subtitle={loading ? undefined : pct != null ? `${pct >= 0 ? '+' : ''}${pct}% vs ayer` : 'vs ayer sin datos'}
      subtitleTone={pct != null && pct >= 0 ? 'positive' : 'neutral'}
    />
  )
}

export function TrabajandoAhora() {
  const { metrics, loading } = useHomeMetrics()
  const n = metrics?.numLocales
  return (
    <MetricCard
      label="Trabajando ahora"
      value={loading ? '…' : num(metrics?.trabajandoAhora ?? null)}
      icon={Users}
      subtitle={loading ? undefined : n != null ? `en ${n} ${n === 1 ? 'local' : 'locales'}` : undefined}
    />
  )
}

// Sin fuente fiable todavía. Se enseña «—» y se dice: no se inventa un número
// ni se esconde la tarjeta, que serían las dos formas de mentir aquí.
export function Solicitudes() {
  return <MetricCard label="Solicitudes" value="—" icon={Inbox} subtitle="próximamente" />
}
export function AppccHoy() {
  return <MetricCard label="APPCC hoy" value="—" icon={Leaf} subtitle="próximamente" />
}

export function ResumenTeam({ onDrill }: HomeCardProps) {
  const { metrics } = useHomeMetrics()
  return (
    <ModuleSummaryCard
      title="Team" icon={Users} onOpen={onDrill}
      lines={[
        { text: `${metrics?.trabajandoAhora != null ? metrics.trabajandoAhora : '—'} trabajando ahora` },
        { text: 'Detalle de turnos próximamente', muted: true },
      ]}
    />
  )
}
export function ResumenSafety({ onDrill }: HomeCardProps) {
  return (
    <ModuleSummaryCard
      title="Safety" icon={Leaf} onOpen={onDrill}
      lines={[
        { text: 'Resumen APPCC próximamente' },
        { text: 'Se conectará con el módulo Safety', muted: true },
      ]}
    />
  )
}
export function ResumenSales({ onDrill }: HomeCardProps) {
  const { metrics, loading } = useHomeMetrics()
  return (
    <ModuleSummaryCard
      title="Sales" icon={BarChart3} onOpen={onDrill}
      lines={[
        { text: `Ticket medio: ${loading ? '…' : eur(metrics?.ticketMedio7d ?? null)}` },
        { text: `${loading ? '…' : num(metrics?.numPedidos7d ?? null)} pedidos (7 días)` },
        { text: `Ventas 7 días: ${loading ? '…' : eur(metrics?.ventas7d ?? null)}`, muted: true },
      ]}
    />
  )
}
