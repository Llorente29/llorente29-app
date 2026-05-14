// src/components/Logo.tsx
// Logo de Foodint reutilizable. Usa la imagen PNG con fondo transparente.
// NOTA: el fondo beige antiguo (#F5E9D9) se sustituye por bg-accent-bg del
// sistema de marca. La imagen PNG en sí se actualizará cuando se decida
// nombre + identidad final del SaaS.

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  withBg?: boolean   // mostrar con fondo del sistema
  className?: string
}

const SIZES = {
  sm: 'h-8',
  md: 'h-12',
  lg: 'h-16',
  xl: 'h-24',
}

export default function Logo({ size = 'md', withBg = false, className = '' }: LogoProps) {
  const heightClass = SIZES[size]
  const padding = withBg ? 'p-2' : ''
  const bg = withBg ? 'bg-accent-bg rounded-lg' : ''

  return (
    <div className={`inline-flex items-center justify-center ${bg} ${padding} ${className}`}>
      <img
        src={`${import.meta.env.BASE_URL}icon-512.png`}
        alt="Foodint"
        className={`${heightClass} w-auto object-contain`}
        loading="eager"
      />
    </div>
  )
}

// Logo compacto cuadrado (para sidebar, avatares)
export function LogoSquare({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-md overflow-hidden bg-accent-bg shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={`${import.meta.env.BASE_URL}icon-512.png`}
        alt="Foodint"
        className="w-full h-full object-cover"
        loading="eager"
      />
    </div>
  )
}
