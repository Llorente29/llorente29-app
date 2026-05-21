// src/components/Logo.tsx
//
// Logo de Folvy reutilizable. Usa los SVGs de marca oficiales.
//
// Variantes disponibles:
//   - Logo (default): wordmark completo "folvy" + isotipo, sobre fondo cream.
//   - Logo (variant="dark"): wordmark + isotipo sobre fondo azul marino. Usar
//     en headers oscuros, hero sections con bg accent.
//   - LogoSquare: solo el isotipo cuadrado con esquinas redondeadas, ideal
//     para avatares, app icons, sidebars compactas.
//
// Bloque H Sprint 3 (20/05/2026): migracion completa de PNG Folvy a SVGs
// Folvy oficiales.

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
  let src: string
  if (variant === 'dark') {
    src = `${import.meta.env.BASE_URL}folvy_logo_oscuro.svg`
  } else if (variant === 'transparent') {
    src = `${import.meta.env.BASE_URL}folvy_logo_transparente.svg`
  } else {
    src = `${import.meta.env.BASE_URL}folvy_logo_principal.svg`
  }

  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <img
        src={src}
        alt="Folvy"
        className={`${heightClass} w-auto object-contain`}
        loading="eager"
      />
    </div>
  )
}

// Logo compacto cuadrado (para sidebar, avatares, app icons)
export function LogoSquare({ size = 32, variant = 'manager', className = '' }: {
  size?: number
  variant?: 'manager' | 'empleados'
  className?: string
}) {
  const src = variant === 'empleados'
    ? `${import.meta.env.BASE_URL}folvy_isotipo_empleados.svg`
    : `${import.meta.env.BASE_URL}folvy_isotipo_manager.svg`

  return (
    <div
      className={`inline-flex items-center justify-center rounded-md overflow-hidden shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt="Folvy"
        className="w-full h-full object-cover"
        loading="eager"
      />
    </div>
  )
}
