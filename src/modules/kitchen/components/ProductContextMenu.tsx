// src/modules/kitchen/components/ProductContextMenu.tsx
//
// Menú contextual de un producto de la carta (F4 del rediseño del gestor de
// menús). Se abre con clic derecho en escritorio y con long-press en móvil —
// NO con arrastre: el drag & drop irá en un "modo reordenar" aparte (F5), para
// que los dos gestos no se peleen por el mismo dedo.
//
// El menú NO sabe hacer nada: recibe callbacks. Toda la lógica (y el estado de
// "ocupado", los errores y el Deshacer) vive en la pantalla que lo abre, que es
// donde ya estaba. Aquí solo se decide QUÉ se ofrece y CÓMO se pinta.
//
// Posicionamiento: se ancla al punto del clic/dedo y se corrige contra los
// bordes de la ventana (si no cabe abajo, sube; si no cabe a la derecha, se
// alinea a la izquierda del punto). Sin librerías.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Pencil, Euro, FolderInput, Copy, Store, Pause, Play, X, FileText, ChevronRight,
} from 'lucide-react'

export interface ContextMenuTarget {
  id: string
  name: string
  isAvailable: boolean
  /** Sin escandallo no se puede llevar a otra marca (no hay coste que compartir). */
  recipeItemId: string | null
}

export interface ContextMenuCategoryOption {
  id: string
  name: string
  emoji?: string | null
}

export interface ContextMenuBrandOption {
  id: string
  name: string
}

interface Props {
  target: ContextMenuTarget
  /** Punto de anclaje en coordenadas de ventana (clientX/clientY). */
  x: number
  y: number
  categories: ContextMenuCategoryOption[]
  /** Marcas a las que AÚN no pertenece el producto. */
  brands: ContextMenuBrandOption[]
  busy?: boolean
  onEditName: () => void
  onEditPrice: () => void
  onMoveToCategory: (categoryId: string | null) => void
  onDuplicate: () => void
  onAddToBrand: (brandId: string) => void
  onTogglePause: () => void
  onRemove: () => void
  onOpenFicha: () => void
  onClose: () => void
}

const MENU_WIDTH = 248

function Row({
  icon, label, onClick, disabled, title, danger, submenu, children,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  title?: string
  danger?: boolean
  submenu?: boolean
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="relative"
      onMouseEnter={() => submenu && setOpen(true)}
      onMouseLeave={() => submenu && setOpen(false)}
    >
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        title={title}
        onClick={() => {
          if (disabled) return
          if (submenu) { setOpen((v) => !v); return }
          onClick?.()
        }}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors
          ${disabled
            ? 'text-gray-300 cursor-not-allowed'
            : danger
              ? 'text-red-600 hover:bg-red-50'
              : 'text-gray-700 hover:bg-gray-50'}`}
      >
        <span className="shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {submenu && <ChevronRight className="w-3.5 h-3.5 shrink-0 text-gray-400" />}
      </button>
      {submenu && open && !disabled && (
        <div className="absolute left-full top-0 -ml-1 w-56 max-h-64 overflow-y-auto bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
          {children}
        </div>
      )}
    </div>
  )
}

export default function ProductContextMenu({
  target, x, y, categories, brands, busy = false,
  onEditName, onEditPrice, onMoveToCategory, onDuplicate, onAddToBrand,
  onTogglePause, onRemove, onOpenFicha, onClose,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y })

  // Corregir contra los bordes DESPUÉS de medir el menú: su alto depende de
  // cuántas acciones se ofrecen, así que no se puede saber de antemano.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const rect = el.getBoundingClientRect()
    const left = x + MENU_WIDTH > innerWidth ? Math.max(8, x - MENU_WIDTH) : x
    const top = y + rect.height > innerHeight ? Math.max(8, innerHeight - rect.height - 8) : y
    setPos({ left, top })
  }, [x, y])

  // Cerrar con Escape o al tocar fuera. `capture` para adelantarse a los
  // onClick de la fila que hay debajo (si no, cerrar el menú abre la ficha).
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
      role="menu"
      aria-label={`Acciones de ${target.name}`}
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      className="fixed z-[60] bg-white rounded-xl shadow-xl border border-gray-200 py-1 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-gray-400 truncate border-b border-gray-100 mb-1">
        {target.name}
      </div>

      {/* Editar */}
      <Row icon={<Pencil className="w-4 h-4" />} label="Editar nombre" onClick={onEditName} disabled={busy} />
      <Row icon={<Euro className="w-4 h-4" />} label="Editar precio" onClick={onEditPrice} disabled={busy} />
      <Row icon={<FolderInput className="w-4 h-4" />} label="Mover a categoría" submenu disabled={busy}>
        <button
          type="button"
          onClick={() => onMoveToCategory(null)}
          className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
        >
          Sin categoría
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onMoveToCategory(c.id)}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 truncate"
          >
            {c.emoji ? `${c.emoji} ` : ''}{c.name}
          </button>
        ))}
      </Row>
      <Row icon={<Copy className="w-4 h-4" />} label="Duplicar" onClick={onDuplicate} disabled={busy}
        title="Crea una copia en esta carta, sin escandallo: dos productos no pueden compartir receta en la misma carta" />
      <Row
        icon={<Store className="w-4 h-4" />}
        label="Añadir a otra marca"
        submenu
        disabled={busy || !target.recipeItemId || brands.length === 0}
        title={
          !target.recipeItemId
            ? 'Necesita un escandallo enlazado: es lo que comparten las marcas'
            : brands.length === 0
              ? 'Ya está en todas tus marcas'
              : undefined
        }
      >
        {brands.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onAddToBrand(b.id)}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 truncate"
          >
            {b.name}
          </button>
        ))}
      </Row>

      <div className="my-1 border-t border-gray-100" />

      {/* Disponibilidad y salida de la carta */}
      <Row
        icon={target.isAvailable ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        label={target.isAvailable ? 'Pausar (se me ha acabado)' : 'Reanudar: volver a la venta'}
        onClick={onTogglePause}
        disabled={busy}
      />
      <Row
        icon={<X className="w-4 h-4" />}
        label="Quitar de esta carta"
        onClick={onRemove}
        disabled={busy}
        danger
        title="Archiva el producto: sale de la carta y de las plataformas, sin borrar nada"
      />

      <div className="my-1 border-t border-gray-100" />

      <Row icon={<FileText className="w-4 h-4" />} label="Ir a ficha completa" onClick={onOpenFicha} disabled={busy} />
    </div>
  )
}
