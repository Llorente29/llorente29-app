// src/modules/multitenancy/components/brands/BrandCreateModal.tsx
//
// Modal compacto para crear marca. Campos mínimos para no fricción:
//   - Nombre (obligatorio)
//   - Tipo (own / licensed, default own)
//
// El resto de campos (color, logo, comisión, notas) se rellenan en
// BrandDataTab tras crear. Patrón "create-then-edit" estándar de SaaS.
//
// Slug: se genera automáticamente desde el nombre (no se pide en el modal).
// El usuario puede editarlo después en BrandDataTab si quiere.
//
// BLOQUE B-5 (16/05/2026): migrado de CURRENT_ACCOUNT_ID hardcoded a
// useActiveAccount(). Usa requireActiveAccountId porque el handler asume
// que ya hay cuenta activa (el botón "Nueva marca" no debería ser visible
// si la app aún está cargando cuentas).

import { useState } from 'react'
import { X } from 'lucide-react'
import { useActiveAccount } from '../../hooks/useActiveAccount'
import { createBrand } from '../../services/brandsService'
import type { BrandOwnershipType } from '../../../../types/multitenancy'

interface BrandCreateModalProps {
  onClose: () => void
  onCreated: (brandId: string) => void
}

export default function BrandCreateModal({ onClose, onCreated }: BrandCreateModalProps) {
  const { requireActiveAccountId } = useActiveAccount()

  const [name, setName] = useState('')
  const [ownershipType, setOwnershipType] = useState<BrandOwnershipType>('own')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('El nombre es obligatorio.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const accountId = requireActiveAccountId()
      const newBrand = await createBrand({
        accountId,
        name: trimmed,
        // Slug vacío → el service lo genera con slugify
        slug: '',
        ownershipType,
      })
      onCreated(newBrand.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !submitting) {
      onClose()
    } else if (e.key === 'Enter' && !submitting) {
      // Enter envía solo si estamos en el input de nombre
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT') {
        e.preventDefault()
        handleSubmit()
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brand-create-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        className="bg-card rounded-lg shadow-lg w-full max-w-md border border-border-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h3
            id="brand-create-title"
            className="font-display text-base text-text-primary"
          >
            Nueva marca
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar"
            className="text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <div>
            <label
              htmlFor="brand-name"
              className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-1"
            >
              Nombre de la marca
            </label>
            <input
              id="brand-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Lobbers"
              autoFocus
              disabled={submitting}
              className="w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label
              htmlFor="brand-type"
              className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-1"
            >
              Tipo
            </label>
            <select
              id="brand-type"
              value={ownershipType}
              onChange={(e) => setOwnershipType(e.target.value as BrandOwnershipType)}
              disabled={submitting}
              className="w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="own">Propia</option>
              <option value="licensed">Cedida</option>
            </select>
            <p className="mt-1 text-xs text-text-secondary">
              Propia: marca del grupo. Cedida: opera bajo licencia de un tercero.
            </p>
          </div>

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border-default bg-page rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-card disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || name.trim() === ''}
            className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creando...' : 'Crear marca'}
          </button>
        </div>
      </div>
    </div>
  )
}
