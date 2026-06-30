// src/modules/orders/components/ChannelBadge.tsx
//
// Chip de canal del feed de Pedidos (tema CLARO, rebrand 30/06/2026).
//
// LOGO + NOMBRE: el logo oficial (bucket público connector-logos) va dentro de
// una CAJITA BLANCA redondeada — como los PNG oficiales traen su propio fondo
// blanco, la cajita blanca los integra sin marco feo — y el nombre de la
// plataforma se muestra al lado, para que SIEMPRE quede identificado (Glovo es
// solo icono; Uber/Just Eat traen texto diminuto que aquí actúa de icono).
//
// Folvy Shop usa el isotipo "El ciclo". Si el logo no carga → punto de color.

import { useState } from 'react'

const LOGO_BASE =
  'https://xzmpnchlguibclvxyynt.supabase.co/storage/v1/object/public/connector-logos'

interface ChannelBadgeProps {
  channel: string | null
  className?: string
}

interface ChannelStyle {
  logo: string | null   // fichero en connector-logos, o null
  color: string         // color de la plataforma (punto de fallback)
  label: string
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
      className={`inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg bg-page border border-default text-text-primary text-[12px] font-bold tracking-wide whitespace-nowrap ${className}`}
    >
      {/* Marca de canal: logo en cajita blanca, isotipo Folvy o punto de color */}
      {showLogo ? (
        <span className="w-7 h-7 rounded-md bg-white border border-default grid place-items-center overflow-hidden shrink-0">
          <img
            src={`${LOGO_BASE}/${st.logo}`}
            alt=""
            className="w-full h-full object-contain"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        </span>
      ) : st.isShop ? (
        <span className="w-7 h-7 rounded-md bg-white border border-default grid place-items-center shrink-0">
          <svg width="15" height="15" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <path d="M42.5 13.8 A21 21 0 1 1 21.5 13.8" fill="none" stroke="#15171A" strokeWidth="7" strokeLinecap="round" />
            <circle cx="32" cy="11" r="7" fill="#1F9D6B" />
          </svg>
        </span>
      ) : (
        <span className="w-2.5 h-2.5 rounded-full shrink-0 ml-1" style={{ backgroundColor: st.color }} />
      )}
      {st.label}
    </span>
  )
}
