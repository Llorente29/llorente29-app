// src/modules/appcc/components/FieldRenderer.tsx
// Renderiza el input apropiado para un item de checklist APPCC
// según su field_type: numeric, boolean, select, text, date, photo, signature.
// Todos los tipos incluyen opción de adjuntar foto debajo del input principal.

import { useState } from 'react'
import { Check, X, AlertTriangle, Edit3, Camera } from 'lucide-react'
import PhotoUploader from './PhotoUploader'
import type {
  AppccTemplateItem,
  AppccTemplateItemOption,
} from '@/modules/appcc/types'

export interface FieldValue {
  numeric_value?: number | null
  boolean_value?: boolean | null
  text_value?: string | null
  date_value?: string | null
  selected_option_id?: string | null
}

export interface FieldRendererProps {
  item: AppccTemplateItem & { options?: AppccTemplateItemOption[] }
  value: FieldValue | null
  onChange: (next: FieldValue) => void
  disabled?: boolean
  warning?: string | null
  /** ID de la respuesta guardada (para vincular fotos) */
  responseId?: string | null
  /** ID del usuario actual (para subir fotos) */
  userId?: string | null
}

/** Botón + panel de fotos colapsable, reutilizado en todos los tipos de campo */
function PhotoSection({
  responseId,
  userId,
  disabled,
}: {
  responseId: string | null
  userId: string | null
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-base disabled:opacity-40"
        >
          <Camera size={13} /> Adjuntar foto
        </button>
      ) : (
        <div className="pt-2 border-t border-border-default mt-1">
          <PhotoUploader
            responseId={responseId}
            userId={userId ?? ''}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  )
}

export default function FieldRenderer({
  item,
  value,
  onChange,
  disabled = false,
  warning = null,
  responseId = null,
  userId = null,
}: FieldRendererProps) {

  const photoSection = (
    <PhotoSection
      responseId={responseId}
      userId={userId}
      disabled={disabled}
    />
  )

  switch (item.field_type) {
    case 'numeric':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="number"
              step="any"
              disabled={disabled}
              value={value?.numeric_value ?? ''}
              onChange={e => {
                const raw = e.target.value
                onChange({ numeric_value: raw === '' ? null : Number(raw) })
              }}
              placeholder={
                item.numeric_min !== null && item.numeric_max !== null
                  ? `${item.numeric_min} – ${item.numeric_max}`
                  : ''
              }
              className={`w-36 px-4 py-3 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-page min-h-touch-base bg-card text-text-primary ${
                warning ? 'border-danger' : 'border-border-default'
              }`}
            />
            {item.numeric_unit && (
              <span className="text-base text-text-secondary">{item.numeric_unit}</span>
            )}
          </div>
          {warning && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-danger-bg border border-danger/30">
              <AlertTriangle size={18} className="text-danger shrink-0" />
              <span className="text-sm sm:text-base text-danger font-medium">{warning}</span>
            </div>
          )}
          {photoSection}
        </div>
      )

    case 'boolean':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ boolean_value: true })}
              className={`inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-lg text-base font-medium transition-base disabled:opacity-50 min-h-touch-base min-w-[80px] border ${
                value?.boolean_value === true
                  ? 'bg-success text-text-on-accent border-success'
                  : 'bg-page text-text-primary border-border-default hover:border-success'
              }`}
            >
              <Check size={16} /> Sí
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ boolean_value: false })}
              className={`inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-lg text-base font-medium transition-base disabled:opacity-50 min-h-touch-base min-w-[80px] border ${
                value?.boolean_value === false
                  ? 'bg-danger text-text-on-accent border-danger'
                  : 'bg-page text-text-primary border-border-default hover:border-danger'
              }`}
            >
              <X size={16} /> No
            </button>
          </div>
          {warning && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-danger-bg border border-danger/30">
              <AlertTriangle size={18} className="text-danger shrink-0" />
              <span className="text-sm sm:text-base text-danger font-medium">{warning}</span>
            </div>
          )}
          {photoSection}
        </div>
      )

    case 'select':
      return (
        <div className="space-y-2">
          {(item.options ?? []).map(opt => {
            const selected = value?.selected_option_id === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ selected_option_id: opt.id })}
                className={`w-full text-left px-4 py-3 rounded-lg text-base font-medium transition-base disabled:opacity-50 min-h-touch-base border ${
                  selected
                    ? 'bg-accent text-text-on-accent border-accent hover:bg-accent-hover'
                    : 'bg-card text-text-primary border-border-default hover:border-accent'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
          {photoSection}
        </div>
      )

    case 'text':
      return (
        <div>
          <textarea
            disabled={disabled}
            value={value?.text_value ?? ''}
            onChange={e => onChange({ text_value: e.target.value })}
            placeholder="Escribe tu respuesta..."
            rows={3}
            className="w-full px-4 py-3 border border-border-default rounded-lg text-base resize-y focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-page bg-card text-text-primary"
          />
          {photoSection}
        </div>
      )

    case 'date':
      return (
        <div>
          <input
            type="date"
            disabled={disabled}
            value={value?.date_value ?? ''}
            onChange={e => onChange({ date_value: e.target.value || null })}
            className="px-4 py-3 border border-border-default rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-page min-h-touch-base bg-card text-text-primary"
          />
          {photoSection}
        </div>
      )

    case 'photo':
      // Campo dedicado solo a foto (sin input previo)
      return (
        <PhotoUploader
          responseId={responseId}
          userId={userId ?? ''}
          disabled={disabled}
        />
      )

    case 'signature':
      return (
        <div className="inline-flex items-center gap-2 text-sm text-text-secondary italic px-4 py-3 bg-page rounded-lg border border-dashed border-border-default">
          <Edit3 size={16} /> Firma manuscrita — disponible en plan Pro
        </div>
      )

    default:
      return (
        <div className="text-sm text-danger">
          Tipo de campo no reconocido: {item.field_type}
        </div>
      )
  }
}
