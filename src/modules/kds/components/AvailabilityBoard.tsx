// src/modules/kds/components/AvailabilityBoard.tsx
//
// DISPONIBILIDAD · C2 — layout ÚNICO compartido por KitchenAvailabilityPage
// (web) y TabletAvailabilityTab (tablet): panel "Local y marcas" (Cap. C +
// Cap. B: cabecera con LocationCloseControl + BrandCloseControl, banner
// LocationStatusCard + ClosedBrandsCard) seguido de la cabecera de "Productos".
// Antes cada pantalla repetía este bloque a mano con jerarquía/envoltorio
// distintos (web sin panel real, tablet sin panel en absoluto). Orden estable
// Local → Marcas → Productos en las dos superficies.
//
// "Cerrar local" y "Cerrar marca" viven JUNTOS en la cabecera del panel (mismo
// patrón: botón → modal). El estado del local (LocationStatusCard) es solo
// lectura y se refresca al cerrar/reabrir vía key (statusVersion).
//
// La rejilla de tarjetas de producto (visualmente distinta: compacta en web,
// grande y táctil en tablet) NO se fusiona aquí — se pasa como children.

import { useState, type ReactNode } from 'react'
import { CircleOff, Store } from 'lucide-react'
import { themeCls, type Theme } from '../lib/theme'
import SectionHeader from './SectionHeader'
import LocationStatusCard from './LocationStatusCard'
import ClosedBrandsCard from './ClosedBrandsCard'
import BrandCloseControl from './BrandCloseControl'
import LocationCloseControl from './LocationCloseControl'

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
  // Cerrar/reabrir el local vive en LocationCloseControl (con confirmación); el
  // banner de estado (LocationStatusCard) es de solo lectura. Al cambiar el
  // estado, se refresca el banner remontándolo con una key nueva.
  const [statusVersion, setStatusVersion] = useState(0)

  return (
    <>
      <div className={`rounded-xl p-4 mb-5 ${t.card}`}>
        <SectionHeader
          icon={Store}
          title="Local y marcas"
          theme={theme}
          className="mb-3"
          action={
            <div className="flex items-center gap-2">
              <LocationCloseControl
                locationId={locationId}
                token={token}
                dark={dark}
                onChanged={() => setStatusVersion((v) => v + 1)}
              />
              <BrandCloseControl accountId={accountId} token={token} dark={dark} />
            </div>
          }
        />
        {(locationId || token) && (
          <LocationStatusCard key={statusVersion} locationId={locationId} token={token} dark={dark} />
        )}
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
