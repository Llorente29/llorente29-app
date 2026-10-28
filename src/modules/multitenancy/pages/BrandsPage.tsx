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
import { useSearchParams } from 'react-router-dom'
import BrandsListView from '../components/brands/BrandsListView'
import BrandDetailView from '../components/brands/BrandDetailView'
import MarcasNuevasLast from '../components/brands/MarcasNuevasLast'
import MarcasOcultasLast from '../components/brands/MarcasOcultasLast'
import MarcasPorRevisarLast from '../components/brands/MarcasPorRevisarLast'
import { useActiveAccount } from '../hooks/useActiveAccount'

export default function BrandsPage() {
  // F01 · PR 3: ?marca=<id>&pestana=carta abre una marca en su pestaña (los
  // avisos y el alta llevan a su carta, tablero 3).
  const [params, setParams] = useSearchParams()
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(params.get('marca'))
  const [avisoAlta, setAvisoAlta] = useState<string | null>(null)
  const abrirMarca = (id: string | null, pestana?: string) => {
    setSelectedBrandId(id)
    const p = new URLSearchParams(params)
    p.delete('alta')
    if (id) { p.set('marca', id); if (pestana) p.set('pestana', pestana); else p.delete('pestana') }
    else { p.delete('marca'); p.delete('pestana') }
    setParams(p, { replace: true })
  }

  // Forzamos remount del listado al volver con una key cambiante,
  // para que recargue la lista (por si el detalle modificó la marca).
  // Patrón simple. Si en el futuro queremos refresh más granular,
  // pasamos un onChanged callback al detalle.
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const { activeAccountId } = useActiveAccount()
  // F01: lo que cambia una parte de las marcas de Last (alta, «No la uso»,
  // «Volver a mostrar») lo vuelven a leer las demás.
  const [vueltaLast, setVueltaLast] = useState(0)
  const cambioLast = () => { setVueltaLast((v) => v + 1); setListRefreshKey((k) => k + 1) }

  if (selectedBrandId === null) {
    return (
      <>
        {/* F01: las marcas nuevas de Last y su alta (tablero 2). */}
        {/* F01 · PR 3: las marcas de Last que llegan con otro código (tablero 4). */}
        {activeAccountId && <MarcasPorRevisarLast accountId={activeAccountId} vuelta={vueltaLast} />}
        {activeAccountId && (
          <MarcasNuevasLast accountId={activeAccountId} vuelta={vueltaLast} onCambio={cambioLast}
            // Al darla de alta, Folvy te lleva a su carta (tablero 3).
            onAlta={(brandId, frase) => { setAvisoAlta(frase); abrirMarca(brandId, 'carta') }} />
        )}
        <BrandsListView
          key={listRefreshKey}
          onSelectBrand={(id) => { setAvisoAlta(null); abrirMarca(id) }}
        />
        {/* F01 · Respuesta 1: al final, plegada, las que no se usan. */}
        {activeAccountId && <MarcasOcultasLast accountId={activeAccountId} vuelta={vueltaLast} onCambio={cambioLast} />}
      </>
    )
  }

  return (
    <BrandDetailView
      key={selectedBrandId}
      brandId={selectedBrandId}
      initialTabId={params.get('pestana') ?? undefined}
      aviso={avisoAlta}
      onTabChange={(t) => { const p = new URLSearchParams(params); p.set('pestana', t); setParams(p, { replace: true }) }}
      onBack={() => {
        setAvisoAlta(null)
        abrirMarca(null)
        // refrescar la lista para reflejar cambios del detalle
        setListRefreshKey((k) => k + 1)
      }}
    />
  )
}
