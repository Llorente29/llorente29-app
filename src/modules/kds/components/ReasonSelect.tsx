// src/modules/kds/components/ReasonSelect.tsx
//
// DISPONIBILIDAD · C3b — selector de motivo, EXTRA opcional junto a los
// botones de duración/confirmar. Nunca gatea el flujo rápido: por defecto
// "Sin especificar" (-> p_reason_code=null), el botón de cerrar/agotar sigue
// funcionando a un toque si el operario no lo toca.

import { themeCls, type Theme } from '../lib/theme'
import { REASON_OPTIONS, type ReasonCode } from '../lib/reasonCode'

interface Props {
  value: ReasonCode | ''
  onChange: (v: ReasonCode | '') => void
  theme?: Theme
  className?: string
}

export default function ReasonSelect({ value, onChange, theme = 'light', className }: Props) {
  const t = themeCls(theme)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ReasonCode | '')}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${t.input} ${className ?? ''}`}
    >
      {REASON_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
