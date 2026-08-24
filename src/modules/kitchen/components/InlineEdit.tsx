// src/modules/kitchen/components/InlineEdit.tsx
//
// F3 del rediseño: editar nombre y precio EN LA FILA, sin modal.
// Doble clic (o doble toque) abre el input, Enter confirma, Esc cancela, y al
// salir del campo también se confirma — porque en un móvil "salir tocando
// fuera" es el gesto natural y perder lo escrito ahí enfada.
//
// Guardado OPTIMISTA con vuelta atrás: se pinta el valor nuevo al instante y,
// si el servidor dice que no, se restaura el viejo y se enseña el error. Sin
// esto, en una carta de 500 productos cada edición se sentiría como una espera.
//
// El componente NO sabe guardar: recibe `onSave`. Toda la lógica sigue en la
// pantalla, que es donde ya vivía.

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

interface Props {
  value: string
  /** Devuelve el valor ya normalizado, o lanza. Si lanza, se revierte. */
  onSave: (next: string) => Promise<void>
  /** 'text' para el nombre; 'decimal' abre el teclado numérico en móvil. */
  mode?: 'text' | 'decimal'
  /** Cómo se pinta cuando NO se está editando. */
  render: (value: string) => React.ReactNode
  /** Sin esto no se puede entrar a editar (p. ej. mientras hay otra operación). */
  disabled?: boolean
  ariaLabel: string
  inputClassName?: string
  className?: string
}

export default function InlineEdit({
  value, onSave, mode = 'text', render, disabled = false, ariaLabel,
  inputClassName = '', className = '',
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Evita que el blur guarde otra vez lo que Enter acaba de guardar, y que Esc
  // dispare un guardado al desmontar el input.
  const committedRef = useRef(false)

  // No hay efecto que "sincronice" draft con value: fuera de edición se pinta
  // `value` directamente, y `open()` siembra el borrador. Sincronizarlo sería
  // un setState en seco dentro de un efecto, con sus renders en cascada.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function open() {
    if (disabled || saving) return
    setError(null)
    setDraft(value)
    committedRef.current = false
    setEditing(true)
  }

  async function commit() {
    if (committedRef.current) return
    committedRef.current = true
    const next = draft.trim()
    if (next === value.trim() || next === '') {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
    } catch (e) {
      setError(String((e as Error).message ?? e))
      setDraft(value)          // vuelta atrás visible
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    committedRef.current = true
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode={mode === 'decimal' ? 'decimal' : undefined}
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault(); void commit() }
          if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        onBlur={() => void commit()}
        className={`px-1.5 py-0.5 rounded border border-accent bg-card text-text-primary
          focus:outline-none focus:ring-2 focus:ring-accent/20 ${inputClassName}`}
      />
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${ariaLabel} (doble clic para editar)`}
        title="Doble clic para editar"
        onDoubleClick={(e) => { e.stopPropagation(); open() }}
        onKeyDown={(e) => {
          // Enter/F2 desde el teclado: el doble clic no es alcanzable sin ratón.
          if (e.key === 'Enter' || e.key === 'F2') { e.stopPropagation(); e.preventDefault(); open() }
        }}
        className={disabled ? '' : 'cursor-text rounded px-0.5 -mx-0.5 hover:bg-accent-bg/60 transition-colors duration-150'}
      >
        {render(value)}
      </span>
      {saving && <Loader2 className="w-3 h-3 animate-spin text-text-secondary" />}
      {error && <span className="text-[11px] text-danger" title={error}>no se guardó</span>}
    </span>
  )
}
