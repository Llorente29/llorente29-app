// src/modules/pos/components/KitchenNoteField.tsx
//
// Campo de nota de cocina reutilizable (TPV T1.d, Tarea B). Dos puntos de
// acceso lo usan: el diálogo de modificadores (PosItemConfigModal, antes de
// "Añadir") y la ficha de línea del carrito (PosLineNoteModal, para editar
// la nota de una línea ya añadida — también cubre productos simples, que no
// pasan por el diálogo de modificadores).
//
// TODO (TPV T1.d): si el texto contiene "alerg"/"celia" hoy no se hace nada
// especial — los alérgenos son un frente aparte (ver herencia plato←ingre-
// dientes en curso). Cuando ese frente decida cómo cruzar nota libre de
// cocina con alérgenos estructurados, este es el punto de entrada natural.

export const QUICK_KITCHEN_NOTES = [
  'Sin cebolla', 'Poco hecho', 'Muy hecho', 'Sin salsa', 'Para llevar aparte', 'Extra picante',
] as const

export const KITCHEN_NOTE_MAX_LEN = 120

function splitNoteParts(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean)
}

function toggleQuickNote(value: string, note: string): string {
  const parts = splitNoteParts(value)
  const idx = parts.findIndex(p => p.toLowerCase() === note.toLowerCase())
  if (idx >= 0) parts.splice(idx, 1)
  else parts.push(note)
  return parts.join(', ').slice(0, KITCHEN_NOTE_MAX_LEN)
}

interface Props {
  value: string
  onChange: (next: string) => void
  autoFocus?: boolean
}

export default function KitchenNoteField({ value, onChange, autoFocus }: Props) {
  const activeParts = splitNoteParts(value).map(p => p.toLowerCase())
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1.5">Nota de cocina (opcional)</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {QUICK_KITCHEN_NOTES.map(note => {
          const active = activeParts.includes(note.toLowerCase())
          return (
            <button
              key={note} type="button" onClick={() => onChange(toggleQuickNote(value, note))}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-base ${active ? 'border-accent bg-accent-bg text-accent' : 'border-border-default bg-page text-text-secondary hover:bg-card'}`}
            >
              {note}
            </button>
          )
        })}
      </div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value.slice(0, KITCHEN_NOTE_MAX_LEN))}
        maxLength={KITCHEN_NOTE_MAX_LEN}
        placeholder="Ej. sin cebolla, poco hecho…"
        autoFocus={autoFocus}
        className="w-full px-3 py-2.5 text-sm border border-border-default rounded-lg bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <p className="text-[11px] text-text-tertiary text-right mt-0.5">{value.length}/{KITCHEN_NOTE_MAX_LEN}</p>
    </div>
  )
}
