// src/modules/multitenancy/components/brands/BrandDetailView.tsx
//
// Vista de detalle de una marca. Container con tabs.
//
// ARQUITECTURA CRECIBLE:
//   Los tabs son data-driven via BRAND_TABS. Añadir un tab nuevo (ej:
//   "Facturación", "Integraciones", "Configuración operativa") consiste
//   en:
//     1. Crear el componente nuevo (ej: BrandBillingTab.tsx)
//     2. Añadir UNA línea al array BRAND_TABS
//   Nada más. Los tabs existentes NO se tocan. Garantizado: crecimiento
//   sin modificar arquitectura.
//
// TABS INCLUIDOS (V1):
//   - data:      campos básicos de identidad de la marca
//   - locations: en qué locales opera (toggle ON/OFF por local)
//
// TABS FUTUROS (NO incluidos hoy):
//   - billing:      IBAN, cuenta contable, forma de pago, vencimiento
//   - settings:     toggles operativos (descontar de almacén, etc.)
//   - integration:  códigos externos (Tspoon A00015, Last token, etc.)
//   - categories:   asignación de categoría (Delivery, Delivery MP, etc.)

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { getBrandById } from '../../services/brandsService'
import type { Brand } from '../../../../types/multitenancy'
import BrandDataTab from './BrandDataTab'
import BrandLocationsTab from './BrandLocationsTab'
import BrandHoursTab from './BrandHoursTab'
import BrandLogoUploader from './BrandLogoUploader'

// ─────────────────────────────────────────────────────────────────────
// Configuración de tabs
// ─────────────────────────────────────────────────────────────────────

interface BrandTabProps {
  brand: Brand
  onBrandChange: (updated: Brand) => void
}

interface BrandTabDef {
  id: string
  label: string
  Component: React.ComponentType<BrandTabProps>
}

const BRAND_TABS: BrandTabDef[] = [
  { id: 'data', label: 'Datos', Component: BrandDataTab },
  { id: 'locations', label: 'Disponibilidad', Component: BrandLocationsTab },
  { id: 'hours', label: 'Horarios', Component: BrandHoursTab },
  // Para añadir un tab futuro:
  // { id: 'billing', label: 'Facturación', Component: BrandBillingTab },
]

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

interface BrandDetailViewProps {
  brandId: string
  onBack: () => void
}

export default function BrandDetailView({ brandId, onBack }: BrandDetailViewProps) {
  const [brand, setBrand] = useState<Brand | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTabId, setActiveTabId] = useState<string>(BRAND_TABS[0]?.id ?? 'data')

  // Cargar marca al montar / cuando cambia brandId
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getBrandById(brandId)
      .then((data) => {
        if (!cancelled) {
          if (data === null) {
            setError('La marca no existe o ha sido eliminada.')
          } else {
            setBrand(data)
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Error desconocido'
          setError(msg)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [brandId])

  const activeTab = useMemo(
    () => BRAND_TABS.find((t) => t.id === activeTabId) ?? BRAND_TABS[0],
    [activeTabId]
  )

  return (
    <div className="space-y-4">
      {/* Cabecera con botón Volver */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-base"
        >
          <ArrowLeft size={14} />
          Volver al listado
        </button>
      </div>

      {/* Header de la marca */}
      {loading && (
        <div className="p-8 text-center text-sm text-text-secondary">
          Cargando marca...
        </div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && brand && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="inline-block w-6 h-6 rounded-full shrink-0 border border-border-default"
              style={{ backgroundColor: brand.color || '#cbd5e1' }}
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-display font-medium text-text-primary truncate">
                {brand.name}
              </h2>
              <p className="text-xs text-text-secondary">
                <code>{brand.slug}</code>
                <span className="mx-2">·</span>
                <span>{brand.ownershipType === 'own' ? 'Propia' : 'Cedida'}</span>
                {brand.archivedAt && (
                  <>
                    <span className="mx-2">·</span>
                    <span className="text-warning">Archivada</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Logo de la marca (lo consume el ticket de bolsa de impresión) */}
          <BrandLogoUploader accountId={brand.accountId} brandId={brand.id} />

          {/* Tabs */}
          <div className="border-b border-border-default">
            <nav className="flex gap-1" role="tablist" aria-label="Secciones de marca">
              {BRAND_TABS.map((tab) => {
                const isActive = tab.id === activeTabId
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`tabpanel-${tab.id}`}
                    id={`tab-${tab.id}`}
                    onClick={() => setActiveTabId(tab.id)}
                    className={
                      'px-3 py-2 text-sm font-medium transition-base border-b-2 -mb-px ' +
                      (isActive
                        ? 'text-accent border-accent'
                        : 'text-text-secondary border-transparent hover:text-text-primary')
                    }
                  >
                    {tab.label}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Tab panel activo */}
          <div
            role="tabpanel"
            id={`tabpanel-${activeTab.id}`}
            aria-labelledby={`tab-${activeTab.id}`}
          >
            <activeTab.Component
              brand={brand}
              onBrandChange={(updated) => setBrand(updated)}
            />
          </div>
        </>
      )}
    </div>
  )
}
