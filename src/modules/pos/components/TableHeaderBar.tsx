// src/modules/pos/components/TableHeaderBar.tsx
//
// TPV · Sala (S1) — maqueta «Folvy TPV · Sala», pantalla 3: la cabecera de una
// mesa abierta. «← Sala», «Mesa 4», «Sala · 4 personas · la lleva Marta» y el
// tiempo, que pasa a ámbar desde el umbral del local.
//
// «Cambiar de mesa» (S2), «Dividir la cuenta» (Caja) y «Más» van en sus
// encargos: no se dejan botones que no hacen nada.

import { ArrowLeft, Clock } from 'lucide-react'
import type { TableDetail } from '@/modules/pos/services/posTableService'
import { minutesSince, formatDuration } from '@/modules/pos/lib/tableState'

export default function TableHeaderBar({ detail, tableName, now, warnMinutes, onBack }: {
  detail: TableDetail | null
  tableName: string
  now: number
  warnMinutes: number
  onBack: () => void
}) {
  const minutes = detail ? minutesSince(detail.openedAt, now) : 0
  const late = detail != null && !detail.paidAt && minutes >= warnMinutes
  return (
    <header className="min-h-tpv-header shrink-0 px-3 lg:px-5 py-2 bg-tpv-surface border-b border-tpv-line flex flex-wrap items-center gap-x-4 gap-y-1">
      <button type="button" onClick={onBack}
        className="h-tap-small px-4 rounded-tpv border border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt text-base font-bold inline-flex items-center gap-2">
        <ArrowLeft size={20} strokeWidth={2.4} aria-hidden /> Sala
      </button>
      <b className="text-2xl font-extrabold">Mesa {detail?.tableName ?? tableName}</b>
      {detail && (
        <span className="text-base font-bold text-tpv-txt-2">
          {detail.zoneName} · {detail.covers} persona{detail.covers === 1 ? '' : 's'}{detail.servedByName ? ` · la lleva ${detail.servedByName}` : ''}
        </span>
      )}
      {detail && (
        <span className={`h-10 px-3 rounded-tpv-line border inline-flex items-center gap-1.5 text-tpv-tab font-extrabold ${late ? 'border-tpv-warn bg-tpv-warn-tint text-tpv-warn-text' : 'border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt-2'}`}>
          <Clock size={16} strokeWidth={2.4} aria-hidden /> {formatDuration(minutes)}
        </span>
      )}
    </header>
  )
}
