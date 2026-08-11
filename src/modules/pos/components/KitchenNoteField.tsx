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
      <label className="block text-xs font-bold text-tpv-txt-2 mb-1.5">Nota de cocina (opcional)</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {QUICK_KITCHEN_NOTES.map(note => {
          const active = activeParts.includes(note.toLowerCase())
          return (
            <button
              key={note} type="button" onClick={() => onChange(toggleQuickNote(value, note))}
              className={`min-h-tap-small px-2.5 rounded-full text-xs font-bold border transition-base ${active ? 'border-tpv-accent bg-tpv-accent/25 text-white' : 'border-tpv-line bg-tpv-surface-2 text-tpv-txt-2 hover:bg-tpv-bg'}`}
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
        className="w-full min-h-tap px-3 text-sm border border-tpv-line rounded-tpv bg-tpv-surface-2 text-tpv-txt placeholder:text-tpv-txt-2 focus:outline-none focus:ring-2 focus:ring-tpv-accent"
      />
      <p className="text-[11px] text-tpv-txt-2 text-right mt-0.5">{value.length}/{KITCHEN_NOTE_MAX_LEN}</p>
    </div>
  )
}
