// src/modules/kitchen/components/MenuFilterChips.tsx
//
// F2 del rediseño del gestor de menús: los chips que faltaban bajo el buscador.
// El buscador ya existía; lo que no había era forma de preguntar "enséñame los
// que no tienen escandallo" sin recorrer la carta a ojo.
//
// Todo es CLIENT-SIDE: la carta ya está cargada entera en memoria, así que
// filtrar no cuesta una consulta. La única excepción es "Archivados", que sí
// necesita pedir datos que la carta no trae (los archivados están fuera por
// definición) — por eso el padre recarga cuando ese chip cambia, y por eso
// lleva su propio aviso de carga.

import type { ReactNode } from 'react'
import { FileWarning, ImageOff, CircleSlash, Archive, Loader2 } from 'lucide-react'

import {
  EMPTY_FILTERS, anyFilterActive, type MenuFilterKey, type MenuFilters,
} from '@/modules/kitchen/components/menuFilters'

interface ChipDef {
  key: MenuFilterKey
  label: string
  icon: ReactNode
  title: string
}

const CHIPS: ChipDef[] = [
  {
    key: 'sinEscandallo',
    label: 'Sin escandallo',
    icon: <FileWarning className="w-3.5 h-3.5" />,
    title: 'Productos sin receta enlazada: no tienen coste ni descuentan stock',
  },
  {
    key: 'sinFoto',
    label: 'Sin foto',
    icon: <ImageOff className="w-3.5 h-3.5" />,
    title: 'Productos sin fotografía: en las plataformas se venden mucho peor',
  },
  {
    key: 'agotados',
    label: 'Agotados',
    icon: <CircleSlash className="w-3.5 h-3.5" />,
    title: 'Productos marcados como agotados (86)',
  },
  {
    key: 'archivados',
    label: 'Archivados',
    icon: <Archive className="w-3.5 h-3.5" />,
    title: 'Productos que se quitaron de la carta. Verlos no es devolverlos.',
  },
]

interface Props {
  value: MenuFilters
  onChange: (next: MenuFilters) => void
  /** Cuántos productos pasan el filtro / cuántos hay. Solo con algún filtro. */
  counts?: { shown: number; total: number } | null
  /** "Archivados" está recargando desde el servidor. */
  loadingArchived?: boolean
  disabled?: boolean
}

export default function MenuFilterChips({
  value, onChange, counts, loadingArchived = false, disabled = false,
}: Props) {
  const active = anyFilterActive(value)

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {CHIPS.map((c) => {
        const on = value[c.key]
        const busy = c.key === 'archivados' && loadingArchived
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            title={c.title}
            disabled={disabled}
            onClick={() => onChange({ ...value, [c.key]: !on })}
            className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-[12px] font-medium
              transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed
              ${on
                ? 'bg-accent text-text-on-accent border-accent'
                : 'bg-card text-text-secondary border-border-default hover:bg-page hover:text-text-primary'}`}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : c.icon}
            {c.label}
          </button>
        )
      })}

      {active && counts && (
        <span className="text-[12px] text-text-secondary tabular-nums ml-0.5">
          {counts.shown} de {counts.total}
        </span>
      )}

      {active && (
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_FILTERS })}
          disabled={disabled}
          className="text-[12px] text-text-secondary underline underline-offset-2 hover:text-text-primary ml-0.5 disabled:opacity-50"
        >
          Quitar filtros
        </button>
      )}
    </div>
  )
}
