// src/modules/shop/pages/ShopDeliveryPage.tsx
//
// Pestaña "Entrega" de Folvy Shop. Capa 1 del motor de envío.
// Responsabilidad de ESTE tramo: resolver el local activo y montar el mapa base.
// El editor de zonas (radio/polígono/CP/isócrona) se añade encima en el
// siguiente tramo. Los casos límite se resuelven aquí:
//   - modo consolidado (sin local) → pedir elegir local
//   - local sin coordenadas → avisar (deuda: geocodificar Carabanchel/Pza Castilla)

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import DeliveryMap from '@/modules/shop/components/DeliveryMap'

type LocationRow = { id: string; name: string; lat: number | null; lng: number | null }

export default function ShopDeliveryPage() {
  const { resolvedLocationId, isConsolidated } = useLocationScope()
  const [loc, setLoc] = useState<LocationRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!resolvedLocationId || !supabase) { setLoc(null); return }
    let alive = true
    setLoading(true); setErr(null)
    ;(supabase as any)
      .from('locations')
      .select('id, name, lat, lng')
      .eq('id', resolvedLocationId)
      .single()
      .then(({ data, error }: any) => {
        if (!alive) return
        if (error) setErr(error.message)
        else setLoc(data as LocationRow)
        setLoading(false)
      })
    return () => { alive = false }
  }, [resolvedLocationId])

  // Caso: modo consolidado → no hay un local concreto.
  if (isConsolidated) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Entrega</h2>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Las zonas de entrega se configuran por local. Elige un local concreto
          en el selector de arriba para definir sus zonas.
        </p>
      </div>
    )
  }

  if (loading) return <div style={{ padding: 24 }}>Cargando local…</div>
  if (err) return <div style={{ padding: 24, color: 'var(--color-danger)' }}>Error: {err}</div>
  if (!loc) return <div style={{ padding: 24 }}>No se encontró el local.</div>

  // Caso: local sin coordenadas → no se puede centrar el mapa.
  if (loc.lat == null || loc.lng == null) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Entrega · {loc.name}</h2>
        <div style={{
          background: 'var(--color-warning-bg, #FAEEDA)', borderRadius: 12,
          padding: 16, color: 'var(--color-warning, #854F0B)',
        }}>
          Este local aún no tiene ubicación en el mapa. Hay que geocodificar su
          dirección antes de poder definir zonas de entrega. (Lo resolvemos en el
          siguiente paso del montaje.)
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginTop: 0 }}>Entrega · {loc.name}</h2>
      <p style={{ color: 'var(--color-text-secondary)', marginTop: -8 }}>
        Define dónde reparte este local y a qué precio. (El editor de zonas llega
        en el siguiente paso; por ahora, el mapa.)
      </p>
      <DeliveryMap
        key={loc.id}
        lat={loc.lat}
        lng={loc.lng}
        locationName={loc.name}
      />
    </div>
  )
}
