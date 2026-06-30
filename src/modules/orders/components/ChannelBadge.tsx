// src/modules/orders/components/ChannelBadge.tsx
//
// Chip de canal del feed de Pedidos (tema CLARO, rebrand 30/06/2026).
// Muestra el LOGO OFICIAL de la plataforma (bucket público connector-logos en
// Supabase) + el nombre. Si el logo no carga, cae a un punto del color de la
// plataforma (sin logos inventados, sin depender del asset). Folvy Shop usa el
// isotipo "El ciclo".
//
// Pill neutro (gris claro + tinta) para que el logo a todo color destaque, en
// línea con los feeds de gestión modernos (Otter/Deliverect).

import { useState } from 'react'

const LOGO_BASE =
  'https://xzmpnchlguibclvxyynt.supabase.co/storage/v1/object/public/connector-logos'

interface ChannelBadgeProps {
  channel: string | null
  className?: string
}

interface ChannelStyle {
  /** Fichero del logo en connector-logos, o null para usar el isotipo Folvy / punto de color. */
  logo: string | null
  /** Color de la plataforma (punto de fallback). */
  color: string
  label: string
  /** Folvy Shop: pinta el ciclo en vez de un logo externo. */
  isShop?: boolean
}

function styleFor(channel: string): ChannelStyle {
  const s = channel.toLowerCase()
  if (s.includes('glovo'))  return { logo: 'glovo.png',    color: '#FFC244', label: channel || 'Glovo' }
  if (s.includes('uber'))   return { logo: 'ubereats.png', color: '#06C167', label: channel || 'Uber Eats' }
  if (s.includes('just'))   return { logo: 'justeat.png',  color: '#FF8000', label: channel || 'Just Eat' }
  if (s.includes('shop') || s.includes('folvy') || s.includes('tienda'))
    return { logo: null, color: '#15171A', label: channel || 'Folvy Shop', isShop: true }
  return { logo: null, color: '#6B7077', label: channel || 'Canal' }
}

export default function ChannelBadge({ channel, className = '' }: ChannelBadgeProps) {
  const [imgFailed, setImgFailed] = useState(false)
  if (!channel) return null
  const st = styleFor(channel)
  const showLogo = st.logo != null && !imgFailed

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-bold tracking-wide whitespace-nowrap bg-page text-text-primary border border-default ${className}`}
    >
      {showLogo ? (
        <img
          src={`${LOGO_BASE}/${st.logo}`}
          alt=""
          className="w-4 h-4 rounded-[3px] object-contain shrink-0"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : st.isShop ? (
        <svg width="15" height="15" viewBox="0 0 64 64" fill="none" aria-hidden="true" className="shrink-0">
          <path d="M42.5 13.8 A21 21 0 1 1 21.5 13.8" fill="none" stroke="#15171A" strokeWidth="7" strokeLinecap="round" />
          <circle cx="32" cy="11" r="7" fill="#1F9D6B" />
        </svg>
      ) : (
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: st.color }} />
      )}
      {st.label}
    </span>
  )
}
