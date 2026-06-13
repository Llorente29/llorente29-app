// src/modules/kds/pages/KdsSettingsPage.tsx
//
// Ajustes de cocina del KDS (dentro del Shell, sesión). Tres pestañas:
// Estaciones (por local), Ruteo familia→estación (por cuenta) y Dispositivos
// (por local). Todo por local del selector global; en consolidado pide elegir.

import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Tabs } from '../../../components/ui'
import { useApp } from '../../../context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import StationsSettings from '../components/StationsSettings'
import FamilyRoutingSettings from '../components/FamilyRoutingSettings'
import DevicesSettings from '../components/DevicesSettings'

type TabKey = 'estaciones' | 'ruteo' | 'dispositivos'

export default function KdsSettingsPage() {
  const { activeAccountId } = useApp()
  const { resolvedLocationId, isConsolidated } = useLocationScope()
  const [tab, setTab] = useState<TabKey>('estaciones')

  if (!activeAccountId) return null

  if (isConsolidated || !resolvedLocationId) {
    return (
      <div className="grid place-items-center h-[50vh] text-center text-text-secondary">
        <div>
          <MapPin className="mx-auto mb-3" size={32} />
          <p className="text-lg font-medium text-text-primary">Selecciona un local</p>
          <p className="text-sm mt-1">Los ajustes de cocina son por local. Elige uno en el selector de arriba.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-display text-text-primary">Ajustes de cocina (KDS)</h1>
        <p className="text-sm text-text-secondary mt-1">
          Configura las estaciones, el ruteo de familias y las tablets de cocina.
        </p>
      </div>

      <Tabs
        value={tab}
        onChange={v => setTab(v as TabKey)}
        tabs={[
          { value: 'estaciones', label: 'Estaciones' },
          { value: 'ruteo', label: 'Ruteo familias' },
          { value: 'dispositivos', label: 'Dispositivos' },
        ]}
      />

      <div className="pt-1">
        {tab === 'estaciones' && <StationsSettings accountId={activeAccountId} locationId={resolvedLocationId} />}
        {tab === 'ruteo' && <FamilyRoutingSettings accountId={activeAccountId} locationId={resolvedLocationId} />}
        {tab === 'dispositivos' && <DevicesSettings accountId={activeAccountId} locationId={resolvedLocationId} />}
      </div>
    </div>
  )
}
