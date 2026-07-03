// src/modules/shop/admin/KpiCard.tsx
//
// Tarjeta KPI AUTOCONTENIDA y reutilizable (G2e.3). Números protagonistas, estilo
// limpio y vendible. Pensada para EMBEBER en cualquier dashboard sin acoplarse a la
// pantalla que la usa — p.ej. el futuro "Inicio configurable" compondrá varias en la
// home. Sin dependencias del padre: paleta y estilos propios.

import { type CSSProperties } from 'react'

export interface KpiCardProps {
  label: string
  value: string
  sub?: string
  /** Color del número (p.ej. verde/ámbar/rojo del ROI). Por defecto tinta. */
  valueColor?: string
}

export default function KpiCard({ label, value, sub, valueColor }: KpiCardProps) {
  return (
    <div style={S.card}>
      <div style={S.label}>{label}</div>
      <div style={{ ...S.value, ...(valueColor ? { color: valueColor } : {}) }}>{value}</div>
      {sub && <div style={S.sub}>{sub}</div>}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  card: { background: '#FFFFFF', border: '1px solid #EDEAE3', borderRadius: 16, padding: '16px 18px' },
  label: { fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#8A857C' },
  value: { fontSize: 30, fontWeight: 800, letterSpacing: '-.02em', marginTop: 5, lineHeight: 1.05, color: '#16140F' },
  sub: { fontSize: 12, color: '#6E6960', marginTop: 3 },
}
