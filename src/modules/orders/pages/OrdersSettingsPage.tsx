// src/modules/orders/pages/OrdersSettingsPage.tsx
//
// Ajustes de Folvy Orders — cáscara de pestañas que fusiona:
//   - Auto-aceptación (por CUENTA, no exige local)
//   - Estaciones / Ruteo familias / Dispositivos (por LOCAL, del KDS)
//
// El guard "elige un local" se afloja A NIVEL DE PESTAÑA: solo las tres de cocina
// lo exigen; Auto-aceptación funciona en consolidado. Reusa tal cual los
// componentes del KDS (no se mueven de carpeta) + el de auto-aceptación.

import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Tabs } from '../../../components/ui'
import { useApp } from '../../../context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import AutoAcceptSettings from '../components/AutoAcceptSettings'
import StationsSettings from '@/modules/kds/components/StationsSettings'
import FamilyRoutingSettings from '@/modules/kds/components/FamilyRoutingSettings'
import DevicesSettings from '@/modules/kds/components/DevicesSettings'
import AjustesDelPase from '@/modules/pase/components/AjustesDelPase'
import LaCocinaDelLocal from '@/modules/kds/components/LaCocinaDelLocal'

// 🔴 «La cocina» ENTRA AHORA; las tres que sustituye salen en el paso
// siguiente, en su propio commit. Van separados a propósito: si algo de la
// página nueva sale mal, se revierte ella sola y las tres viejas siguen ahí.
// Durante ese hueco la misma cosa se configura en dos sitios, y eso se dice en
// la propia pantalla en vez de dejar que alguien lo descubra.
type TabKey = 'autoaccept' | 'pase' | 'cocina' | 'estaciones' | 'ruteo' | 'dispositivos'

function LocationGuard() {
  return (
    <div className="grid place-items-center h-[40vh] text-center text-text-secondary">
      <div>
        <MapPin className="mx-auto mb-3" size={32} />
        <p className="text-lg font-medium text-text-primary">Selecciona un local</p>
        <p className="text-sm mt-1">Estos ajustes son por local. Elige uno en el selector de arriba.</p>
      </div>
    </div>
  )
}

export default function OrdersSettingsPage() {
  const { activeAccountId } = useApp()
  const { resolvedLocationId, isConsolidated } = useLocationScope()
  const [tab, setTab] = useState<TabKey>('autoaccept')

  if (!activeAccountId) return null

  const hasLocation = !isConsolidated && !!resolvedLocationId

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-display text-text-primary">Ajustes de pedidos</h1>
        <p className="text-sm text-text-secondary mt-1">
          Auto-aceptación por canal y configuración del tablero de cocina (estaciones, ruteo y tablets).
        </p>
      </div>

      <Tabs
        value={tab}
        onChange={v => setTab(v as TabKey)}
        tabs={[
          { value: 'autoaccept', label: 'Auto-aceptación' },
          { value: 'pase', label: 'El Pase' },
          { value: 'cocina', label: 'La cocina' },
          { value: 'estaciones', label: 'Estaciones' },
          { value: 'ruteo', label: 'Ruteo familias' },
          { value: 'dispositivos', label: 'Dispositivos' },
        ]}
      />

      <div className="pt-1">
        {/* Por cuenta: no exige local */}
        {tab === 'autoaccept' && <AutoAcceptSettings accountId={activeAccountId} />}

        {/* El Pase NO exige elegir local, y es el punto: la pregunta que trae
            aquí a alguien es «¿dónde está encendido?», y ésa no se contesta
            entrando local por local. Se enseñan todos los de la cuenta a la
            vez, que es lo que hoy no se podía ver en ningún sitio. */}
        {tab === 'pase' && <AjustesDelPase />}

        {/* LA COCINA DE <LOCAL>: las tres de abajo, en una. Por local, así que
            con el mismo guard. Ningún selector nuevo: el de arriba manda y el
            título de la página lleva el nombre. */}
        {tab === 'cocina' && (
          hasLocation && resolvedLocationId
            ? <LaCocinaDelLocal accountId={activeAccountId} locationId={resolvedLocationId} />
            : <LocationGuard />
        )}

        {/* Por local: guard solo en estas tres pestañas.
            ⚠️ LAS TRES SE RETIRAN EN EL PASO SIGUIENTE. Hasta entonces enseñan
            lo mismo que «La cocina», y lo dicen. */}
        {(tab === 'estaciones' || tab === 'ruteo' || tab === 'dispositivos') && (
          <p className="text-[13px] text-text-secondary border border-dashed border-default
                        rounded-xl px-3.5 py-2.5 mb-3">
            Esto mismo, y además qué tablet mira cada estación, está en{' '}
            <button onClick={() => setTab('cocina')} className="underline font-bold text-text-primary">
              La cocina
            </button>. Esta pestaña se va a retirar.
          </p>
        )}
        {tab === 'estaciones' && (
          hasLocation && resolvedLocationId
            ? <StationsSettings accountId={activeAccountId} locationId={resolvedLocationId} />
            : <LocationGuard />
        )}
        {tab === 'ruteo' && (
          hasLocation && resolvedLocationId
            ? <FamilyRoutingSettings accountId={activeAccountId} locationId={resolvedLocationId} />
            : <LocationGuard />
        )}
        {tab === 'dispositivos' && (
          hasLocation && resolvedLocationId
            ? <DevicesSettings accountId={activeAccountId} locationId={resolvedLocationId} />
            : <LocationGuard />
        )}
      </div>
    </div>
  )
}
