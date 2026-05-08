// src/components/personal/BolsaHorasView.tsx
// Vista de bolsa de horas con 3 modalidades: semanal, mensual, acumulado.
// Usado por gestor (en ficha empleado) y trabajador (en su modo móvil).
import { useMemo } from 'react'
import { Card } from '../ui'
import type { Employee } from '../../types'
import { computeHourBankSummary, type HourBankPeriod } from '../../services/horasComputo'

interface Props {
  employee: Employee
  variant?: 'desktop' | 'mobile'  // ajusta layout
}

export default function BolsaHorasView({ employee, variant = 'desktop' }: Props) {
  const summary = useMemo(() => computeHourBankSummary(employee), [employee])

  return (
    <div className="space-y-3">
      <PeriodCard period={summary.week} title="Esta semana" icon="📅" variant={variant} />
      <PeriodCard period={summary.month} title="Este mes" icon="🗓️" variant={variant} />
      <PeriodCard period={summary.accumulated} title="Acumulado" icon="∑" variant={variant} />

      {variant === 'desktop' && (
        <div className="text-[10px] text-gray-400 px-1 leading-relaxed">
          <p>· La bolsa compara las horas trabajadas (pares cerrados de fichaje) contra las horas teóricas según el horario asignado al empleado.</p>
          <p>· Solo se cuentan días pasados o el día actual hasta el momento (no se anticipan días futuros).</p>
          <p>· Saldo positivo = horas extra acumuladas. Saldo negativo = horas pendientes de recuperar.</p>
        </div>
      )}
    </div>
  )
}

function PeriodCard({ period, title, icon, variant }: {
  period: HourBankPeriod; title: string; icon: string; variant: 'desktop' | 'mobile'
}) {
  const balance = period.balance
  const positive = balance > 0.05
  const negative = balance < -0.05
  const neutral = !positive && !negative

  const balanceClass = positive
    ? 'text-emerald-600'
    : negative
      ? 'text-red-600'
      : 'text-gray-500'

  const balanceLabel = positive
    ? `+${balance.toFixed(1)}h`
    : negative
      ? `${balance.toFixed(1)}h`
      : '0.0h'

  return (
    <Card className={`p-4 ${positive ? 'bg-emerald-50/30 border-emerald-100' : negative ? 'bg-red-50/30 border-red-100' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">{icon}</span>
            <p className="font-semibold text-gray-900 text-sm">{title}</p>
          </div>
          <p className="text-xs text-gray-500 truncate">{period.label}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl font-bold tabular-nums ${balanceClass}`}>{balanceLabel}</p>
          <p className="text-[10px] text-gray-400">
            {neutral ? 'al día' : positive ? 'horas extra' : 'pendientes'}
          </p>
        </div>
      </div>

      <div className={`grid ${variant === 'mobile' ? 'grid-cols-2' : 'grid-cols-3'} gap-3 mt-3 pt-3 border-t border-gray-100`}>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Trabajadas</p>
          <p className="text-sm font-semibold text-gray-700 tabular-nums">{period.workedHours.toFixed(1)}h</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Contrato</p>
          <p className="text-sm font-semibold text-gray-700 tabular-nums">{period.contractedHours.toFixed(1)}h</p>
        </div>
        {variant === 'desktop' && (
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Días</p>
            <p className="text-sm font-semibold text-gray-700 tabular-nums">{period.daysInRange}</p>
          </div>
        )}
      </div>
    </Card>
  )
}
