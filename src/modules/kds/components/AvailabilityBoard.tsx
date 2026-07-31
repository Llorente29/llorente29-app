// src/modules/kds/components/AvailabilityBoard.tsx
//
// DISPONIBILIDAD · C2 — layout ÚNICO compartido por KitchenAvailabilityPage
// (web) y TabletAvailabilityTab (tablet): panel "Local y marcas" (Cap. C +
// Cap. B: LocationStatusCard + BrandCloseControl + ClosedBrandsCard) seguido
// de la cabecera de "Productos". Antes cada pantalla repetía este bloque a
// mano con jerarquía/envoltorio distintos (web sin panel real, tablet sin
// panel en absoluto). Orden estable Local → Marcas → Productos en las dos
// superficies.
//
// La rejilla de tarjetas de producto (visualmente distinta: compacta en web,
// grande y táctil en tablet) NO se fusiona aquí — se pasa como children.

import type { ReactNode } from 'react'
import { CircleOff, Store } from 'lucide-react'
import { themeCls, type Theme } from '../lib/theme'
import SectionHeader from './SectionHeader'
import LocationStatusCard from './LocationStatusCard'
import ClosedBrandsCard from './ClosedBrandsCard'
import BrandCloseControl from './BrandCloseControl'

interface Props {
  theme: Theme
  accountId?: string | null
  token?: string | null
  /** Local seleccionado (web) o null (tablet: el token ya fija el local). */
  locationId: string | null
  productsTitle: string
  /** null = cargando ("…"). */
  productsCount: number | null
  /** Acción del header de Productos (web: botón "Agotar producto"). Tablet lo
   *  deja vacío — sus controles de acción viven en su propia barra superior. */
  productsAction?: ReactNode
  children: ReactNode
}

export default function AvailabilityBoard({
  theme, accountId, token, locationId, productsTitle, productsCount, productsAction, children,
}: Props) {
  const t = themeCls(theme)
  const dark = theme === 'dark'

  return (
    <>
      <div className={`rounded-xl p-4 mb-5 ${t.card}`}>
        <SectionHeader
          icon={Store}
          title="Local y marcas"
          theme={theme}
          className="mb-3"
          action={<BrandCloseControl accountId={accountId} token={token} dark={dark} />}
        />
        {(locationId || token) && <LocationStatusCard locationId={locationId} token={token} dark={dark} />}
        <ClosedBrandsCard accountId={accountId} token={token} dark={dark} />
      </div>

      <SectionHeader
        icon={CircleOff}
        title={productsTitle}
        count={productsCount}
        dot="danger"
        theme={theme}
        className="mb-2.5"
        action={productsAction}
      />

      {children}
    </>
  )
}
