// src/modules/integrations/components/ConnectorAvatar.tsx
//
// Avatar visual de un conector para las tarjetas del módulo Folvy Connect.
// Muestra el LOGO real (connector.logoUrl) encuadrado en un contenedor blanco
// redondeado. Si no hay logoUrl, o si la imagen falla al cargar, cae a un
// avatar con la inicial del nombre sobre el COLOR DE MARCA de la plataforma.
//
// Así las tarjetas nunca se ven rotas ni frías: con logo → logo; sin logo →
// identidad de color. El color de marca por `code` vive en BRAND_COLOR (fácil
// de ampliar al añadir conectores). Para códigos desconocidos, color neutro.

import { useState } from 'react'

// Color de marca por code de conector (fondo del avatar de fallback).
// Hex permitido aquí: es color de marca de terceros, no token del sistema.
const BRAND_COLOR: Record<string, string> = {
  glovo: '#FFC244',     // amarillo Glovo
  ubereats: '#0B0B0B',  // negro Uber Eats
  justeat: '#FF8000',   // naranja Just Eat
  catcher: '#1A1E2E',   // navy Catcher
  lastapp: '#18181F',   // oscuro Last.app
}
const FALLBACK_COLOR = '#6B7280' // gris neutro para códigos sin color definido

interface ConnectorAvatarProps {
  name: string
  code: string
  logoUrl: string | null
  size?: number // px, lado del cuadrado (default 48)
}

export default function ConnectorAvatar({ name, code, logoUrl, size = 48 }: ConnectorAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const showLogo = !!logoUrl && !imgFailed

  const radius = Math.round(size * 0.25) // esquinas redondeadas proporcionales
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  const bg = BRAND_COLOR[code] ?? FALLBACK_COLOR

  if (showLogo) {
    // Logo encuadrado en contenedor blanco (los logos vienen sobre blanco).
    return (
      <span
        className="shrink-0 inline-flex items-center justify-center overflow-hidden border border-border-default bg-white"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <img
          src={logoUrl as string}
          alt={name}
          width={size}
          height={size}
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
          loading="lazy"
        />
      </span>
    )
  }

  // Fallback: inicial sobre color de marca.
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center font-semibold text-white select-none"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: bg,
        fontSize: Math.round(size * 0.42),
      }}
      aria-label={name}
    >
      {initial}
    </span>
  )
}
