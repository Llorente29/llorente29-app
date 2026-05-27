// src/modules/folvy-ai/components/FolvyAIIsotype.tsx
//
// Isotipo de Folvy AI: aro azul navy con arco terracota + punto central.
// Reproduce el isotipo de marca para que el chat se sienta Folvy.
//
// Uso:
//   <FolvyAIIsotype />                     → tamaño 24, sobre fondo claro
//   <FolvyAIIsotype size={28} accentBg />  → blanco sobre fondo terracota (botón cerrado)

interface Props {
  size?: number;
  className?: string;
  accentBg?: boolean;
}

export function FolvyAIIsotype({ size = 24, className, accentBg = false }: Props) {
  const stroke = accentBg ? '#FFFFFF' : '#1E3A5F';
  const dot = accentBg ? '#FFFFFF' : '#1E3A5F';
  const arc = accentBg ? '#FFFFFF' : '#D67442';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="18" fill="none" stroke={stroke} strokeWidth="3" />
      <path
        d="M 24 6 A 18 18 0 0 1 42 24"
        fill="none"
        stroke={arc}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="3.5" fill={dot} />
    </svg>
  );
}
