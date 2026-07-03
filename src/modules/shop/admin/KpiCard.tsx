// src/modules/shop/admin/KpiCard.tsx
//
// Tarjeta KPI AUTOCONTENIDA y reutilizable (G2e.3/G2e.4). Números protagonistas,
// estilo limpio y vendible, con Δ% vs periodo anterior opcional. Pensada para
// EMBEBER en cualquier dashboard sin acoplarse a la pantalla que la usa — el futuro
// "Inicio configurable" compondrá varias en la home. Sin dependencias del padre.

import { type CSSProperties } from 'react'

export interface KpiCardProps {
  label: string
  value: string
  sub?: string
  /** Color del número (p.ej. verde/ámbar/rojo del ROI). Por defecto tinta. */
  valueColor?: string
  /** Δ% vs periodo anterior. Positivo = verde ▲, negativo = rojo ▼. */
  delta?: number | null
  /** Densidad compacta (menos aire, número algo menor). */
  dense?: boolean
}

export default function KpiCard({ label, value, sub, valueColor, delta, dense }: KpiCardProps) {
  const up = delta != null && delta >= 0
  return (
    <div style={{ ...S.card, ...(dense ? S.cardDense : {}) }}>
      <div style={S.label}>{label}</div>
      <div style={S.valueRow}>
        <span style={{ ...S.value, ...(dense ? S.valueDense : {}), ...(valueColor ? { color: valueColor } : {}) }}>{value}</span>
        {delta != null && (
          <span style={{ ...S.delta, color: up ? '#0E6B38' : '#C23B22' }}>
            {up ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
      {sub && <div style={S.sub}>{sub}</div>}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  card: { background: '#FFFFFF', border: '1px solid #EDEAE3', borderRadius: 16, padding: '16px 18px' },
  cardDense: { borderRadius: 12, padding: '11px 13px' },
  label: { fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#8A857C' },
  valueRow: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 5 },
  value: { fontSize: 30, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.05, color: '#16140F' },
  valueDense: { fontSize: 23 },
  delta: { fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap' },
  sub: { fontSize: 12, color: '#6E6960', marginTop: 3 },
}
