// src/modules/orders/components/ChannelBadge.tsx
//
// Chip de canal con color por plataforma para el feed (tema navy/pase oscuro).
// Sin logos (copyright): solo color + nombre. El color se deduce del nombre del
// canal por substring (robusto a "Glovo", "Uber Eats", "Just Eat", "Folvy Shop").
//
// (El KDS pinta un chip violeta único; el catálogo tiene color por canal pero en
// tema claro. Este es el badge propio del feed, oscuro, fiel a las maquetas.)

interface ChannelBadgeProps {
  channel: string | null
  className?: string
}

interface ChannelStyle { bg: string; fg: string; label: string }

function styleFor(channel: string | null): ChannelStyle {
  const s = (channel ?? '').toLowerCase()
  if (s.includes('glovo'))    return { bg: '#ffc244', fg: '#3a2c00', label: channel || 'Glovo' }
  if (s.includes('uber'))     return { bg: '#cdd3d6', fg: '#0c0c0c', label: channel || 'Uber Eats' }
  if (s.includes('just'))     return { bg: '#ff7a1a', fg: '#ffffff', label: channel || 'Just Eat' }
  if (s.includes('shop') || s.includes('folvy') || s.includes('tienda'))
                              return { bg: '#D67442', fg: '#241006', label: channel || 'Folvy Shop' }
  // canal desconocido: slate neutro
  return { bg: '#3a5366', fg: '#eef3f6', label: channel || 'Canal' }
}

export default function ChannelBadge({ channel, className = '' }: ChannelBadgeProps) {
  if (!channel) return null
  const s = styleFor(channel)
  return (
    <span
      className={`px-2 py-0.5 rounded-md text-[11.5px] font-extrabold tracking-wide whitespace-nowrap ${className}`}
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  )
}
