// src/modules/kitchen/components/ProductTagChips.tsx
//
// Etiquetas comerciales del producto (Vegano, Picante, Sin gluten…). Paridad
// con Otter: "items sell faster without the guesswork".
//
// EL ENCARGO PEDÍA UNA MIGRACIÓN PARA ESTO Y NO HACE FALTA: `menu_item.tags`
// ya existe en la BBDD (text[]) y `menuItemService` ya lo lee y lo escribe.
// Lo único que faltaba era la interfaz. Verificado en information_schema antes
// de escribir una sola línea.
//
// Los tags son COMERCIALES, no legales. Los alérgenos van aparte y salen del
// escandallo: mezclarlos aquí invitaría a marcar "sin gluten" a mano sobre un
// plato cuyo escandallo dice lo contrario, y eso es un problema sanitario, no
// de diseño.

import { tagLabel } from '@/modules/kitchen/components/productTags'

interface Props {
  tags: string[] | null | undefined
  className?: string
}

export default function ProductTagChips({ tags, className = '' }: Props) {
  if (!tags || tags.length === 0) return null
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`}>
      {tags.map((t) => {
        const { label, emoji } = tagLabel(t)
        return (
          <span
            key={t}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full
              bg-page border border-border-default text-[10px] font-medium text-text-secondary"
          >
            {emoji && <span aria-hidden>{emoji}</span>}{label}
          </span>
        )
      })}
    </span>
  )
}
