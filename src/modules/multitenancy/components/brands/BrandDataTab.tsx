// src/modules/multitenancy/components/brands/BrandDataTab.tsx
//
// Tab "Datos" del detalle de marca. Modos:
//   - View (default): muestra todos los campos en read-only
//   - Edit: campos editables, botones Guardar / Cancelar
//
// Acciones disponibles fuera del modo edit:
//   - Editar (entra a edit mode)
//   - Archivar (si is_active y no archivedAt)
//   - Restaurar (si archivedAt)
//
// Campos editables:
//   - name, slug, ownershipType, color, logoUrl, notes
//   El servicio valida unicidad de slug, así que el error se muestra inline.
//
// NOTA DEUDA 0 (2026-06-03): se retiró el campo "Comisión %". La comisión no
// vive en la marca (era residuo ignorado por la economía); vive por
// marca×canal×tipo de servicio en brand_channel_rate, y se gestionará desde
// la futura pantalla "Canales".

import { useEffect, useState } from 'react'
import { Edit2, X as XIcon, Archive, RotateCcw } from 'lucide-react'
import {
  updateBrand,
  archiveBrand,
  restoreBrand,
} from '../../services/brandsService'
import { listCuisines, type Cuisine } from '../../services/cuisineService'
import type {
  Brand,
  BrandUpdate,
  BrandOwnershipType,
} from '../../../../types/multitenancy'

interface BrandDataTabProps {
  brand: Brand
  onBrandChange: (updated: Brand) => void
}

// Estado del formulario en modo edit. Mismo shape que BrandUpdate
// pero con strings garantizados para inputs (no undefined).
interface FormState {
  name: string
  slug: string
  ownershipType: BrandOwnershipType
  color: string
  logoUrl: string
  shopUrl: string
  qrCaption: string
  cuisineCode: string
  notes: string
}

function brandToFormState(b: Brand): FormState {
  return {
    name: b.name,
    slug: b.slug,
    ownershipType: b.ownershipType,
    color: b.color ?? '',
    logoUrl: b.logoUrl ?? '',
    shopUrl: b.shopUrl ?? '',
    qrCaption: b.qrCaption ?? '',
    cuisineCode: b.cuisineCode ?? '',
    notes: b.notes ?? '',
  }
}

export default function BrandDataTab({ brand, onBrandChange }: BrandDataTabProps) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<FormState>(() => brandToFormState(brand))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cuisines, setCuisines] = useState<Cuisine[]>([])

  useEffect(() => {
    let alive = true
    listCuisines().then(cs => { if (alive) setCuisines(cs) }).catch(() => { /* sin lista */ })
    return () => { alive = false }
  }, [])

  // Si la marca de fuera cambia (otro tab modificó algo, etc.), sincronizamos
  // el formulario solo si NO estamos en modo edit (no pisar lo que el usuario
  // está escribiendo).
  useEffect(() => {
    if (!editing) setForm(brandToFormState(brand))
  }, [brand, editing])

  function enterEdit() {
    setForm(brandToFormState(brand))
    setError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setForm(brandToFormState(brand))
    setError(null)
    setEditing(false)
  }

  async function save() {
    const trimmedName = form.name.trim()
    if (trimmedName === '') {
      setError('El nombre es obligatorio.')
      return
    }

    // Construimos patch solo con los campos que CAMBIARON respecto a brand.
    // Esto evita writes innecesarios y deja el log de Supabase limpio.
    const patch: BrandUpdate = {}

    if (trimmedName !== brand.name) patch.name = trimmedName
    if (form.slug.trim() !== brand.slug) patch.slug = form.slug.trim()
    if (form.ownershipType !== brand.ownershipType) {
      patch.ownershipType = form.ownershipType
    }

    const colorTrimmed = form.color.trim()
    const colorNext: string | null = colorTrimmed === '' ? null : colorTrimmed
    if (colorNext !== brand.color) patch.color = colorNext

    const logoTrimmed = form.logoUrl.trim()
    const logoNext: string | null = logoTrimmed === '' ? null : logoTrimmed
    if (logoNext !== brand.logoUrl) patch.logoUrl = logoNext

    const shopTrimmed = form.shopUrl.trim()
    const shopNext: string | null = shopTrimmed === '' ? null : shopTrimmed
    if (shopNext !== brand.shopUrl) patch.shopUrl = shopNext

    const captionTrimmed = form.qrCaption.trim()
    const captionNext: string | null = captionTrimmed === '' ? null : captionTrimmed
    if (captionNext !== brand.qrCaption) patch.qrCaption = captionNext

    const cuisineNext: string | null = form.cuisineCode === '' ? null : form.cuisineCode
    if (cuisineNext !== brand.cuisineCode) patch.cuisineCode = cuisineNext

    const notesTrimmed = form.notes.trim()
    const notesNext: string | null = notesTrimmed === '' ? null : notesTrimmed
    if (notesNext !== brand.notes) patch.notes = notesNext

    // Si no hay cambios, salimos sin tocar BBDD
    if (Object.keys(patch).length === 0) {
      setEditing(false)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const updated = await updateBrand(brand.id, patch)
      onBrandChange(updated)
      setEditing(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleArchive() {
    if (!confirm(`¿Archivar la marca "${brand.name}"? Se ocultará del catálogo activo pero su histórico se preservará.`)) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const updated = await archiveBrand(brand.id)
      onBrandChange(updated)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRestore() {
    setSubmitting(true)
    setError(null)
    try {
      const updated = await restoreBrand(brand.id)
      onBrandChange(updated)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Barra de acciones */}
      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={enterEdit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            <Edit2 size={14} />
            Editar
          </button>
          {brand.archivedAt ? (
            <button
              type="button"
              onClick={handleRestore}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-card disabled:opacity-50"
            >
              <RotateCcw size={14} />
              Restaurar
            </button>
          ) : (
            <button
              type="button"
              onClick={handleArchive}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-warning-bg hover:text-warning disabled:opacity-50"
            >
              <Archive size={14} />
              Archivar
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={submitting || form.name.trim() === ''}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-card disabled:opacity-50"
          >
            <XIcon size={14} />
            Cancelar
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {/* Formulario */}
      <div className="rounded-md bg-card border border-border-default p-4 space-y-4">
        <Field label="Nombre">
          {editing ? (
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          ) : (
            <p className="text-sm text-text-primary">{brand.name}</p>
          )}
        </Field>

        <Field
          label="Slug"
          hint={editing ? 'Identificador URL-safe. Único en la cuenta.' : undefined}
        >
          {editing ? (
            <input
              type="text"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            />
          ) : (
            <code className="text-sm text-text-secondary">{brand.slug}</code>
          )}
        </Field>

        <Field label="Tipo">
          {editing ? (
            <select
              value={form.ownershipType}
              onChange={(e) =>
                setForm({ ...form, ownershipType: e.target.value as BrandOwnershipType })
              }
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="own">Propia</option>
              <option value="licensed">Cedida</option>
            </select>
          ) : (
            <p className="text-sm text-text-primary">
              {brand.ownershipType === 'own' ? 'Propia' : 'Cedida'}
            </p>
          )}
        </Field>

        <Field label="Color" hint={editing ? 'Color identificativo en listados.' : undefined}>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.color || '#cbd5e1'}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                disabled={submitting}
                className="h-8 w-12 rounded border border-border-default cursor-pointer"
              />
              <input
                type="text"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                placeholder="#RRGGBB"
                disabled={submitting}
                className="flex-1 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-5 h-5 rounded border border-border-default"
                style={{ backgroundColor: brand.color || '#cbd5e1' }}
              />
              <code className="text-sm text-text-secondary">{brand.color || '—'}</code>
            </div>
          )}
        </Field>

        <Field label="Logo URL">
          {editing ? (
            <input
              type="url"
              value={form.logoUrl}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              placeholder="https://..."
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          ) : brand.logoUrl ? (
            <a
              href={brand.logoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:underline break-all"
            >
              {brand.logoUrl}
            </a>
          ) : (
            <p className="text-sm text-text-secondary">—</p>
          )}
        </Field>

        <Field
          label="Tienda propia (URL)"
          hint={editing ? 'Folvy Shop de esta marca. El ticket de bolsa pinta un QR a esta URL para llevar pedidos al canal directo.' : undefined}
        >
          {editing ? (
            <input
              type="url"
              value={form.shopUrl}
              onChange={(e) => setForm({ ...form, shopUrl: e.target.value })}
              placeholder="https://..."
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          ) : brand.shopUrl ? (
            <a
              href={brand.shopUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:underline break-all"
            >
              {brand.shopUrl}
            </a>
          ) : (
            <p className="text-sm text-text-secondary">—</p>
          )}
        </Field>

        <Field
          label="Texto del QR"
          hint={editing ? 'Mensaje que acompaña al QR en el ticket (lo decides tú). Si lo dejas vacío, se usa un texto por defecto.' : undefined}
        >
          {editing ? (
            <input
              type="text"
              value={form.qrCaption}
              onChange={(e) => setForm({ ...form, qrCaption: e.target.value })}
              placeholder="Pide directo la próxima vez y ahorra"
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          ) : (
            <p className="text-sm text-text-primary whitespace-pre-wrap">
              {brand.qrCaption || <span className="text-text-secondary">—</span>}
            </p>
          )}
        </Field>

        <Field
          label="Tipo de cocina"
          hint={editing ? 'Cómo aparece la marca en tu tienda online (Folvy Shop). Lo eliges tú; si lo dejas vacío, no se muestra etiqueta.' : undefined}
        >
          {editing ? (
            <select
              value={form.cuisineCode}
              onChange={(e) => setForm({ ...form, cuisineCode: e.target.value })}
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">— Sin especificar —</option>
              {cuisines.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.emoji ? `${c.emoji} ` : ''}{c.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-text-primary">
              {(() => {
                const c = cuisines.find((x) => x.code === brand.cuisineCode)
                return c
                  ? `${c.emoji ? `${c.emoji} ` : ''}${c.label}`
                  : <span className="text-text-secondary">—</span>
              })()}
            </p>
          )}
        </Field>

        <Field label="Notas">
          {editing ? (
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          ) : (
            <p className="text-sm text-text-primary whitespace-pre-wrap">
              {brand.notes || <span className="text-text-secondary">—</span>}
            </p>
          )}
        </Field>

        {/* Metadatos read-only siempre */}
        <div className="pt-3 border-t border-border-default text-xs text-text-secondary space-y-1">
          <div>
            <span className="font-medium">Creada:</span>{' '}
            {new Date(brand.createdAt).toLocaleString('es-ES')}
            {brand.createdByName && <> · por {brand.createdByName}</>}
          </div>
          <div>
            <span className="font-medium">Actualizada:</span>{' '}
            {new Date(brand.updatedAt).toLocaleString('es-ES')}
          </div>
          {brand.archivedAt && (
            <div className="text-warning">
              <span className="font-medium">Archivada:</span>{' '}
              {new Date(brand.archivedAt).toLocaleString('es-ES')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Sub-component: Field (label + slot)
// ─────────────────────────────────────────────────────────────────────

interface FieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-text-secondary">{hint}</p>}
    </div>
  )
}
