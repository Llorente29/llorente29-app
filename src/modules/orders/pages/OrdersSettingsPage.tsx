// src/modules/orders/pages/OrdersSettingsPage.tsx
//
// Ajustes de Folvy Orders — tres pestañas:
//   - Auto-aceptación (por CUENTA, no exige local)
//   - El Pase (por CUENTA: enseña TODOS los locales a la vez)
//   - La cocina de <local> (por LOCAL)
//
// ── RETIRADAS «Estaciones», «Ruteo familias» y «Dispositivos» (16/09) ──────
//
// Eran la misma cosa mirada tres veces --una estación tiene nombre, papel, qué
// platos le tocan y qué tablet la mira-- y ahora son «La cocina».
//
// 🔴 ANTES DE BORRARLAS SE MIRÓ QUIÉN ENLAZABA (regla 18), y salieron DOS cosas
// que la página nueva no tenía y que habrían desaparecido sin avisar:
//
//   1. Dar de alta una tablet, enseñar su QR, copiar sus dos enlaces
//      --estación y TV-- y darla de baja. Sin eso la cuenta se quedaba SIN
//      NINGUNA FORMA de enchufar una tablet nueva, y el aviso de «asígnale una
//      estación» de la página nueva apuntaba a algo que no existía.
//
//   2. QUÉ PAQUETE CORRE CADA TABLET. «Dispositivos» era la ÚNICA pantalla que
//      enseñaba `kds_device_bundle_status`, y el vigía de bundle desfasado
//      --migración `20260902T0800`-- justifica su umbral apoyándose en que esa
//      pantalla existe y NO filtra: «el umbral de 24 h vive SOLO en el vigía
//      que interrumpe» (regla 7). Retirarla sin traer esto dejaba al vigía sin
//      su mitad que no esconde.
//
// Lo segundo no lo dice el front en ninguna parte: lo dice un comentario dentro
// de una migración. Las dos están ahora en «La cocina», y sólo entonces se
// retiraron las tres pestañas y su cuarta copia sin rutar (`KdsSettingsPage`).
//
// Nadie enlazaba a esas pestañas: eran estado local de esta pantalla, no rutas.
// No hacen falta redirecciones. `KdsSettingsPage` no la importaba nadie.

import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Tabs } from '../../../components/ui'
import { useApp } from '../../../context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import AutoAcceptSettings from '../components/AutoAcceptSettings'
import AjustesDelPase from '@/modules/pase/components/AjustesDelPase'
import LaCocinaDelLocal from '@/modules/kds/components/LaCocinaDelLocal'

type TabKey = 'autoaccept' | 'pase' | 'cocina'

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
          Auto-aceptación por canal, el Pase y la configuración de cada cocina.
        </p>
      </div>

      <Tabs
        value={tab}
        onChange={v => setTab(v as TabKey)}
        tabs={[
          { value: 'autoaccept', label: 'Auto-aceptación' },
          { value: 'pase', label: 'El Pase' },
          { value: 'cocina', label: 'La cocina' },
        ]}
      />

      <div className="pt-1">
        {/* Por cuenta: no exige local */}
        {tab === 'autoaccept' && <AutoAcceptSettings accountId={activeAccountId} />}

        {/* El Pase NO exige elegir local, y es el punto: la pregunta que trae
            aquí a alguien es «¿dónde está encendido?», y ésa no se contesta
            entrando local por local. Se enseñan todos los de la cuenta a la
            vez, que es lo que antes no se podía ver en ningún sitio. */}
        {tab === 'pase' && <AjustesDelPase />}

        {/* LA COCINA DE <LOCAL>: las estaciones, qué prepara cada una, qué
            tablet la mira y en qué paquete va. Por local, así que con guard.
            Ningún selector nuevo: manda el de arriba y el título de la página
            lleva el nombre del local. */}
        {tab === 'cocina' && (
          hasLocation && resolvedLocationId
            ? <LaCocinaDelLocal accountId={activeAccountId} locationId={resolvedLocationId} />
            : <LocationGuard />
        )}
      </div>
    </div>
  )
}
