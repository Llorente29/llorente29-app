// src/modules/kitchen/components/CategoryEmojiPicker.tsx
//
// F3: elegir el emoji de una categoría. El campo `menu_category.emoji` existía
// en la BBDD desde el principio y no había ninguna forma de tocarlo desde la
// app: se sembraba y ahí se quedaba.
//
// No es un selector de emoji completo (eso es una librería y un bundle nuevo):
// es una rejilla corta de los que sirven en una carta, más la opción de
// quitarlo. Si alguien quiere uno raro, el teclado del sistema lo pega en el
// campo de texto — pero eso es otro frente, y prometerlo aquí sería mentir.

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const EMOJIS = [
  '🍔', '🌮', '🌯', '🥙', '🍕', '🍗', '🍖', '🥩',
  '🍟', '🥗', '🥣', '🍜', '🍝', '🍚', '🌶️', '🧀',
  '🥤', '🍺', '🍷', '☕', '🧋', '🍹',
  '🍰', '🍦', '🍪', '🍩', '⭐', '🔥', '🆕', '🌱',
]

interface Props {
  current: string | null
  onPick: (emoji: string | null) => void
  onClose: () => void
}

export default function CategoryEmojiPicker({ current, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    function onDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('touchstart', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('touchstart', onDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Elegir emoji de la categoría"
      className="absolute z-40 mt-1 w-[248px] rounded-xl border border-border-default bg-card p-2"
      style={{ boxShadow: 'var(--shadow-lg)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => { onPick(e); onClose() }}
            className={`h-7 w-7 rounded text-[16px] leading-none flex items-center justify-center
              transition-colors duration-150 hover:bg-accent-bg
              ${current === e ? 'bg-accent-bg ring-1 ring-accent/30' : ''}`}
          >
            {e}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => { onPick(null); onClose() }}
        className="mt-1.5 w-full inline-flex items-center justify-center gap-1 py-1 rounded
          text-[12px] text-text-secondary hover:bg-page transition-colors duration-150"
      >
        <X className="w-3 h-3" /> Sin emoji
      </button>
    </div>
  )
}
