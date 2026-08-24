// src/modules/kitchen/components/AllergenChips.tsx
//
// Los alérgenos PRESENTES del plato, en la fila. Salen del escandallo, no de
// un campo que alguien rellena a mano: por eso son fiables y por eso no se
// pueden editar desde aquí.
//
// Se enseñan como mucho cuatro y el resto se resume en "+N": una fila de carta
// no es la etiqueta legal, es un aviso. El detalle completo vive en Etiquetado.

import type { AllergenChip } from '@/modules/kitchen/services/menuAllergenBulkService'

interface Props {
  allergens: AllergenChip[] | undefined
  max?: number
  className?: string
}

export default function AllergenChips({ allergens, max = 4, className = '' }: Props) {
  if (!allergens || allergens.length === 0) return null
  const shown = allergens.slice(0, max)
  const rest = allergens.length - shown.length
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      title={`Alérgenos: ${allergens.map((a) => a.name).join(', ')}`}
    >
      {shown.map((a) => (
        <span key={a.code} className="text-[11px] text-text-secondary leading-none">
          {a.icon ? <span aria-hidden>{a.icon}</span> : null}
          <span className={a.icon ? 'sr-only' : ''}>{a.name}</span>
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] text-text-secondary">+{rest}</span>}
    </span>
  )
}
