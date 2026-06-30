// src/modules/orders/components/ChannelBadge.tsx
//
// Chip de canal del feed de Pedidos (tema CLARO, rebrand 30/06/2026).
//
// Plataformas con logo oficial (bucket público connector-logos): el logo se
// muestra GRANDE dentro de una ficha blanca redondeada. Como los PNG oficiales
// ya traen su propio marco/fondo blanco, la ficha blanca los integra sin
// recortar (el blanco se funde) y respeta la imagen de marca de la plataforma.
// No se duplica el nombre (Uber Eats ya lo lleva dentro de su logo).
//
// Folvy Shop y canales sin logo → pill con isotipo/punto de color + nombre.
// Si el logo no carga → cae al pill de color con nombre.

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

  // Plataforma con logo: ficha blanca + logo grande (el marco blanco del PNG se funde).
  if (st.logo && !imgFailed) {
    return (
      <span
        title={st.label}
        className={`inline-flex items-center bg-white border border-default rounded-lg p-0.5 shrink-0 ${className}`}
      >
        <img
          src={`${LOGO_BASE}/${st.logo}`}
          alt={st.label}
          className="h-7 w-auto object-contain"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      </span>
    )
  }

  // Folvy Shop / canal sin logo / fallback: pill con isotipo o punto + nombre.
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-bold tracking-wide whitespace-nowrap bg-page text-text-primary border border-default ${className}`}
    >
      {st.isShop ? (
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
