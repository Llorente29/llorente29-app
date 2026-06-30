// src/components/Logo.tsx
//
// Logo de Folvy reutilizable. Rebrand 30/06/2026 — "El ciclo": anillo abierto
// (la operación girando) + punto de margen verde (donde el ciclo se cierra).
// Se dibuja INLINE en SVG, sin depender de ficheros .svg externos: escala
// perfecto a cualquier tamaño y no hay que mantener assets.
//
// Variantes:
//   - Logo (default / light): lockup ciclo + wordmark "folvy" en tinta, para
//     fondos claros (la norma con la marca nueva).
//   - Logo (variant="dark"): mismo lockup en blanco, para fondos oscuros
//     (modo cocina, bloques de tinta).
//   - Logo (variant="transparent"): alias de light (compat retro).
//   - LogoSquare: tile cuadrado con el anillo, para avatares / app icons /
//     sidebars compactas.

const GREEN = '#1F9D6B'   // punto de margen (constante en ambas variantes)
const INK = '#15171A'     // tinta (fondos claros)

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'light' | 'dark' | 'transparent'
  className?: string
}

const SIZES = {
  sm: 'h-8',
  md: 'h-12',
  lg: 'h-16',
  xl: 'h-24',
}

export default function Logo({ size = 'md', variant = 'light', className = '' }: LogoProps) {
  const heightClass = SIZES[size]
  const ink = variant === 'dark' ? '#FFFFFF' : INK

  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg
        className={`${heightClass} w-auto`}
        viewBox="0 0 252 64"
        fill="none"
        role="img"
        aria-label="Folvy"
      >
        {/* El ciclo: anillo abierto + punto de margen */}
        <path
          d="M42.5 13.8 A21 21 0 1 1 21.5 13.8"
          fill="none"
          stroke={ink}
          strokeWidth="6"
          strokeLinecap="round"
        />
        <circle cx="32" cy="11" r="6" fill={GREEN} />
        {/* Wordmark */}
        <text
          x="74"
          y="44"
          fontFamily="'Space Grotesk', Inter, sans-serif"
          fontSize="44"
          fontWeight="600"
          letterSpacing="-2"
          fill={ink}
        >
          folvy
        </text>
      </svg>
    </div>
  )
}

// Logo compacto cuadrado (para sidebar, avatares, app icons). El parámetro
// `variant` se conserva por compatibilidad con los llamadores antiguos
// (manager/empleados), pero ambos rinden el mismo tile de marca.
export function LogoSquare({ size = 32, className = '' }: {
  size?: number
  variant?: 'manager' | 'empleados'
  className?: string
}) {
  const r = size * 0.6
  return (
    <div
      className={`inline-flex items-center justify-center rounded-md overflow-hidden shrink-0 ${className}`}
      style={{ width: size, height: size, background: INK }}
    >
      <svg width={r} height={r} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path
          d="M42.5 13.8 A21 21 0 1 1 21.5 13.8"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <circle cx="32" cy="11" r="6" fill={GREEN} />
      </svg>
    </div>
  )
}
