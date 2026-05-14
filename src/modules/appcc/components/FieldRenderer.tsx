// src/modules/appcc/components/FieldRenderer.tsx
// Renderiza el input apropiado para un item de checklist APPCC
// según su field_type: numeric, boolean, select, text, date, photo, signature.
//
// Es agnóstico al guardado: emite onChange(value) y el padre decide qué hacer
// (auto-guardar en Supabase, mantener en estado local, etc.).

import { Check, X, AlertTriangle, Camera, Edit3 } from 'lucide-react'
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
}

export default function FieldRenderer({
  item,
  value,
  onChange,
  disabled = false,
  warning = null,
}: FieldRendererProps) {
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
        </div>
      )

    case 'text':
      return (
        <textarea
          disabled={disabled}
          value={value?.text_value ?? ''}
          onChange={e => onChange({ text_value: e.target.value })}
          placeholder="Escribe tu respuesta..."
          rows={3}
          className="w-full px-4 py-3 border border-border-default rounded-lg text-base resize-y focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-page bg-card text-text-primary"
        />
      )

    case 'date':
      return (
        <input
          type="date"
          disabled={disabled}
          value={value?.date_value ?? ''}
          onChange={e => onChange({ date_value: e.target.value || null })}
          className="px-4 py-3 border border-border-default rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-page min-h-touch-base bg-card text-text-primary"
        />
      )

    case 'photo':
      return (
        <div className="inline-flex items-center gap-2 text-sm text-text-secondary italic px-4 py-3 bg-page rounded-lg border border-dashed border-border-default">
          <Camera size={16} /> Adjuntar foto — pendiente de implementar (Supabase Storage)
        </div>
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
