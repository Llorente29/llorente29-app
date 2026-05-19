// src/modules/multitenancy/pages/BrandsPage.tsx
//
// Página raíz del CRUD de marcas. Hace de "router interno" entre dos vistas:
//   - Lista de marcas (BrandsListView)
//   - Detalle de una marca (BrandDetailView)
//
// Decisión de diseño: NO añadimos rutas globales tipo 'brand_detail' al
// tipo Page del proyecto. La sub-vista se maneja con state local aquí.
// Razones:
//   - Es local a este módulo, no contamina App.tsx
//   - Consistente con el patrón de OnboardingPage / ExecutionPage de APPCC
//   - Cuando llegue el sistema de routing real (deuda técnica conocida),
//     migrar esto a rutas será trivial
//
// State expuesto:
//   - selectedBrandId: string | null
//     null  → muestra BrandsListView
//     UUID  → muestra BrandDetailView de esa marca
//
// CALLBACKS:
//   - openBrand(id): pasa del listado al detalle de la marca id
//   - backToList(): vuelve al listado desde el detalle

import { useState } from 'react'
import BrandsListView from '../components/brands/BrandsListView'
import BrandDetailView from '../components/brands/BrandDetailView'

export default function BrandsPage() {
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)

  // Forzamos remount del listado al volver con una key cambiante,
  // para que recargue la lista (por si el detalle modificó la marca).
  // Patrón simple. Si en el futuro queremos refresh más granular,
  // pasamos un onChanged callback al detalle.
  const [listRefreshKey, setListRefreshKey] = useState(0)

  if (selectedBrandId === null) {
    return (
      <BrandsListView
        key={listRefreshKey}
        onSelectBrand={(id) => setSelectedBrandId(id)}
      />
    )
  }

  return (
    <BrandDetailView
      brandId={selectedBrandId}
      onBack={() => {
        setSelectedBrandId(null)
        // refrescar la lista para reflejar cambios del detalle
        setListRefreshKey((k) => k + 1)
      }}
    />
  )
}
