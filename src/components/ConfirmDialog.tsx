// src/components/ConfirmDialog.tsx
//
// Diálogo de confirmación reutilizable en estilo Folvy. Sustituye al
// window.confirm() nativo del navegador (que muestra "localhost dice" / el
// dominio, rompe la marca y parece un cartel de desarrollador).
//
// Controlado por props: el padre gobierna `open` y reacciona a onConfirm /
// onCancel. Pensado para cualquier "¿seguro?" de la app (crear, borrar,
// archivar...), no solo un caso. Usa las variables de color del tema (bg-card,
// border-default, accent, etc.) para verse coherente con el resto de modales.

import { AlertTriangle, Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'accent' (acción normal) | 'danger' (acción destructiva: borrar, etc.) */
  tone?: 'accent' | 'danger'
  /** Muestra spinner y desactiva los botones mientras la acción está en curso. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Continuar',
  cancelLabel = 'Cancelar',
  tone = 'accent',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null

  const confirmClasses =
    tone === 'danger'
      ? 'border-2 border-danger/30 text-danger bg-card hover:bg-danger-bg'
      : 'bg-accent text-text-on-accent hover:bg-accent-hover'

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-card rounded-t-xl sm:rounded-xl max-w-md w-full overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="px-5 py-3 border-b border-border-default flex items-center gap-2 bg-accent text-text-on-accent">
          <AlertTriangle size={18} className="shrink-0" />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>

        {/* Mensaje */}
        <div className="px-5 py-4">
          <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">
            {message}
          </p>
        </div>

        {/* Botones */}
        <div className="px-5 py-3 border-t border-border-default bg-page flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm border border-border-default rounded-lg bg-card text-text-primary hover:bg-page disabled:opacity-40 transition-base"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-40 transition-base ${confirmClasses}`}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
