// src/modules/shop/components/DeliveryMap.tsx
//
// Mapa base del editor de zonas de entrega (Capa 1 del motor de envío).
// Monta Mapbox GL centrado en el local, con un pin en su posición.
// Esta es la pieza visual mínima: SIN zonas todavía (se añaden encima en el
// editor). Aísla aquí el ciclo de vida del mapa (crear/destruir, token, CSS)
// para que el editor no tenga que pelearse con Mapbox.
//
// El componente NO decide qué local: recibe lat/lng/name ya resueltos. Los
// casos límite (sin token, sin coords) los resuelve el contenedor (la página).

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { hasMapbox } from '@/modules/shop/services/deliveryZoneService'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

type DeliveryMapProps = {
  lat: number
  lng: number
  locationName: string
  /** Se llama una vez cuando el mapa está listo, por si el editor quiere
   *  añadir capas/controles encima (zonas, draw…). */
  onReady?: (map: mapboxgl.Map) => void
}

export default function DeliveryMap({ lat, lng, locationName, onReady }: DeliveryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return
    // Guard: no recrear si ya existe (StrictMode monta dos veces en dev).
    if (mapRef.current) return

    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [lng, lat],
      zoom: 12.5,
      attributionControl: true,
    })
    mapRef.current = map

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

    // Pin del local.
    new mapboxgl.Marker({ color: '#1E3A5F' })
      .setLngLat([lng, lat])
      .setPopup(new mapboxgl.Popup({ offset: 24 }).setText(locationName))
      .addTo(map)

    map.on('load', () => {
      onReadyRef.current?.(map)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
    // Solo al montar (el local no cambia en vida del componente; si cambiara,
    // el contenedor remonta vía key=locationId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recentrar si cambian las coords sin remontar (defensivo).
  useEffect(() => {
    if (mapRef.current) mapRef.current.setCenter([lng, lat])
  }, [lat, lng])

  if (!hasMapbox()) {
    return (
      <div style={{
        height: 420, borderRadius: 12, border: '1px solid var(--color-border-default)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: 24, color: 'var(--color-text-secondary)',
      }}>
        Falta el token de Mapbox. Configura VITE_MAPBOX_TOKEN para ver el mapa.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ height: 420, borderRadius: 12, overflow: 'hidden' }}
    />
  )
}
