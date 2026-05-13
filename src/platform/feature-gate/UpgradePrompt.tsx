// src/platform/feature-gate/UpgradePrompt.tsx
// Componente que se muestra cuando un usuario intenta acceder a una
// funcionalidad bloqueada por su plan actual.
// Branding Foodint: granate #7C1A1A, beige #F5E9D9, Instrument Serif en titulares.

import type { FC } from 'react'

export interface UpgradePromptProps {
  /** Clave de la feature concreta que se intentó usar (opcional, informativo) */
  feature?: string
  /** Nombre del submódulo que la incluye (opcional, informativo) */
  submodule?: string
  /** Título personalizado. Si no se pasa, se usa uno genérico. */
  title?: string
  /** Descripción personalizada. Si no se pasa, se genera a partir de submodule/feature. */
  description?: string
  /** Callback al pulsar el CTA. Si no se pasa, no se muestra el botón. */
  onUpgrade?: () => void
  /** Texto del botón. Por defecto: "Ver planes disponibles". */
  ctaLabel?: string
}

const GRANATE = '#7C1A1A'
const BEIGE = '#F5E9D9'

export const UpgradePrompt: FC<UpgradePromptProps> = ({
  feature,
  submodule,
  title,
  description,
  onUpgrade,
  ctaLabel = 'Ver planes disponibles',
}) => {
  const resolvedTitle = title ?? 'Funcionalidad no incluida en tu plan'

  const resolvedDescription =
    description ??
    (submodule
      ? `Esta funcionalidad forma parte del módulo "${submodule}" y no está activa en tu plan actual.`
      : feature
        ? `La funcionalidad "${feature}" no está incluida en tu plan actual.`
        : 'Esta funcionalidad no está incluida en tu plan actual.')

  return (
    <div
      role="region"
      aria-label="Funcionalidad bloqueada"
      className="w-full max-w-xl mx-auto my-8 rounded-2xl shadow-md border overflow-hidden"
      style={{ backgroundColor: BEIGE, borderColor: GRANATE }}
    >
      <div
        className="px-6 py-3 flex items-center gap-3"
        style={{ backgroundColor: GRANATE, color: BEIGE }}
      >
        <span aria-hidden="true" className="text-xl leading-none">🔒</span>
        <span className="text-sm uppercase tracking-wider font-medium">
          Plan superior requerido
        </span>
      </div>

      <div className="px-6 py-6">
        <h2
          className="text-2xl mb-3"
          style={{
            fontFamily: '"Instrument Serif", serif',
            color: GRANATE,
            lineHeight: 1.2,
          }}
        >
          {resolvedTitle}
        </h2>

        <p className="text-sm leading-relaxed" style={{ color: '#3a2a2a' }}>
          {resolvedDescription}
        </p>

        {(feature || submodule) && (
          <dl className="mt-4 text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" style={{ color: '#3a2a2a' }}>
            {submodule && (
              <>
                <dt className="font-semibold">Módulo:</dt>
                <dd><code>{submodule}</code></dd>
              </>
            )}
            {feature && (
              <>
                <dt className="font-semibold">Feature:</dt>
                <dd><code>{feature}</code></dd>
              </>
            )}
          </dl>
        )}

        {onUpgrade && (
          <div className="mt-6">
            <button
              type="button"
              onClick={onUpgrade}
              className="px-5 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 active:opacity-80"
              style={{ backgroundColor: GRANATE, color: BEIGE }}
            >
              {ctaLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default UpgradePrompt