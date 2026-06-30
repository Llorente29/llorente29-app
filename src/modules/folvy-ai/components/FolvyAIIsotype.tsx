// src/modules/folvy-ai/components/FolvyAIIsotype.tsx
//
// Isotipo de Folvy AI: "El ciclo" — anillo abierto (la operación girando) +
// punto de margen verde (donde el ciclo se cierra). Marca 30/06/2026.
//
// Uso:
//   <FolvyAIIsotype />                     → tamaño 24, anillo tinta sobre fondo claro
//   <FolvyAIIsotype size={28} accentBg />  → anillo blanco sobre fondo tinta (botón cerrado)

interface Props {
  size?: number;
  className?: string;
  accentBg?: boolean;
}

const GREEN = '#1F9D6B';

export function FolvyAIIsotype({ size = 24, className, accentBg = false }: Props) {
  const ring = accentBg ? '#FFFFFF' : '#15171A';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M42.5 13.8 A21 21 0 1 1 21.5 13.8"
        fill="none"
        stroke={ring}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="32" cy="11" r="6" fill={GREEN} />
    </svg>
  );
}
