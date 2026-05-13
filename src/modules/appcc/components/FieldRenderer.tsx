// src/modules/appcc/components/FieldRenderer.tsx
// Renderiza el input apropiado para un item de checklist APPCC
// según su field_type: numeric, boolean, select, text, date, photo, signature.
//
// Es agnóstico al guardado: emite onChange(value) y el padre decide qué hacer
// (auto-guardar en Supabase, mantener en estado local, etc.).

import type {
  AppccTemplateItem,
  AppccTemplateItemOption,
} from '@/modules/appcc/types'

const GRANATE = '#7C1A1A'

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
              className="w-36 px-4 py-3 border rounded-lg text-base focus:outline-none focus:ring-2 disabled:bg-gray-50 min-h-[48px]"
              style={{
                borderColor: warning ? '#dc2626' : '#d1d5db',
              }}
            />
            {item.numeric_unit && (
              <span className="text-base text-gray-500">{item.numeric_unit}</span>
            )}
          </div>
          {warning && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200">
              <span className="text-lg">⚠️</span>
              <span className="text-sm sm:text-base text-red-700 font-medium">{warning}</span>
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
              className="px-5 py-3 rounded-lg text-base font-medium transition-all disabled:opacity-50 min-h-[48px] min-w-[80px]"
              style={{
                backgroundColor: value?.boolean_value === true ? '#16a34a' : '#f3f4f6',
                color: value?.boolean_value === true ? 'white' : '#374151',
                border: '1px solid',
                borderColor: value?.boolean_value === true ? '#16a34a' : '#d1d5db',
              }}
            >
              ✓ Sí
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ boolean_value: false })}
              className="px-5 py-3 rounded-lg text-base font-medium transition-all disabled:opacity-50 min-h-[48px] min-w-[80px]"
              style={{
                backgroundColor: value?.boolean_value === false ? '#dc2626' : '#f3f4f6',
                color: value?.boolean_value === false ? 'white' : '#374151',
                border: '1px solid',
                borderColor: value?.boolean_value === false ? '#dc2626' : '#d1d5db',
              }}
            >
              ✗ No
            </button>
          </div>
          {warning && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200">
              <span className="text-lg">⚠️</span>
              <span className="text-sm sm:text-base text-red-700 font-medium">{warning}</span>
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
                className="w-full text-left px-4 py-3 rounded-lg text-base font-medium transition-all disabled:opacity-50 min-h-[48px]"
                style={{
                  backgroundColor: selected ? GRANATE : '#fff',
                  color: selected ? '#fff' : '#374151',
                  border: '1px solid',
                  borderColor: selected ? GRANATE : '#d1d5db',
                }}
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
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base resize-y focus:outline-none focus:ring-2 disabled:bg-gray-50"
        />
      )

    case 'date':
      return (
        <input
          type="date"
          disabled={disabled}
          value={value?.date_value ?? ''}
          onChange={e => onChange({ date_value: e.target.value || null })}
          className="px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 disabled:bg-gray-50 min-h-[48px]"
        />
      )

    case 'photo':
      return (
        <div className="text-sm text-gray-400 italic px-4 py-3 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          📷 Adjuntar foto — pendiente de implementar (Supabase Storage)
        </div>
      )

    case 'signature':
      return (
        <div className="text-sm text-gray-400 italic px-4 py-3 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          ✍️ Firma manuscrita — disponible en plan Pro
        </div>
      )

    default:
      return (
        <div className="text-sm text-red-500">
          Tipo de campo no reconocido: {item.field_type}
        </div>
      )
  }
}