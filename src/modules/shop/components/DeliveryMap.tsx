// src/modules/shop/components/DeliveryMap.tsx
//
// Mapa base + dibujo de zonas del editor de entrega (Capa 1 del motor de envío).
// Pinta: zonas guardadas (radio→círculo, polígono→área; postal no se pinta),
// un DRAFT en vivo —círculo (radio) O polígono (isócrona)— de la zona en edición,
// y RESALTA la zona seleccionada (highlightZoneId).
// Además, MODO DIBUJO (drawing): activa mapbox-gl-draw para que el hostelero
// dibuje un polígono a mano (clic por vértice, doble clic para cerrar) y lo
// devuelve por onPolygonDrawn.
// Aísla aquí todo el trato con Mapbox.

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import * as turf from '@turf/turf'
import { hasMapbox, type DeliveryZone } from '@/modules/shop/services/deliveryZoneService'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

const ZONE_COLORS = ['#1D9E75', '#378ADD', '#D85A30', '#7F77DD', '#BA7517', '#D4537E']
export function zoneColor(index: number): string {
  return ZONE_COLORS[index % ZONE_COLORS.length]
}

export type DraftCircle = { lat: number; lng: number; radiusM: number } | null
export type DraftPolygon = GeoJSON.Polygon | null

type DeliveryMapProps = {
  lat: number
  lng: number
  locationName: string
  zones?: DeliveryZone[]
  draftCircle?: DraftCircle
  draftPolygon?: DraftPolygon
  highlightZoneId?: string | null
  drawing?: boolean
  onPolygonDrawn?: (poly: GeoJSON.Polygon | null) => void
  onReady?: (map: mapboxgl.Map) => void
}

function zonesToGeoJSON(zones: DeliveryZone[], highlightId: string | null): GeoJSON.FeatureCollection {
  const anyHighlight = highlightId != null
  const features: GeoJSON.Feature[] = []
  zones.forEach((z, i) => {
    const dim = anyHighlight && z.id !== highlightId
    const props = { color: zoneColor(i), zoneId: z.id, dim }
    if (z.method === 'radius' && z.center_lat != null && z.center_lng != null && z.radius_m) {
      const circle = turf.circle([z.center_lng, z.center_lat], z.radius_m / 1000, { steps: 64, units: 'kilometers' })
      circle.properties = props
      features.push(circle)
    } else if (z.method === 'polygon' && z.area_geojson) {
      features.push({ type: 'Feature', geometry: z.area_geojson, properties: props })
    }
  })
  return { type: 'FeatureCollection', features }
}

function draftToGeoJSON(circle: DraftCircle, polygon: DraftPolygon): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  if (polygon) {
    features.push({ type: 'Feature', geometry: polygon, properties: { color: '#185FA5' } })
  } else if (circle && circle.radiusM) {
    const c = turf.circle([circle.lng, circle.lat], circle.radiusM / 1000, { steps: 64, units: 'kilometers' })
    c.properties = { color: '#185FA5' }
    features.push(c)
  }
  return { type: 'FeatureCollection', features }
}

export default function DeliveryMap({
  lat, lng, locationName, zones = [], draftCircle = null, draftPolygon = null,
  highlightZoneId = null, drawing = false, onPolygonDrawn, onReady,
}: DeliveryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const drawRef = useRef<MapboxDraw | null>(null)
  const loadedRef = useRef(false)
  const onReadyRef = useRef(onReady)
  const onPolygonDrawnRef = useRef(onPolygonDrawn)
  onReadyRef.current = onReady
  onPolygonDrawnRef.current = onPolygonDrawn

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return

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

    new mapboxgl.Marker({ color: '#1E3A5F' })
      .setLngLat([lng, lat])
      .setPopup(new mapboxgl.Popup({ offset: 24 }).setText(locationName))
      .addTo(map)

    map.on('load', () => {
      map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'zones-fill', type: 'fill', source: 'zones',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'dim'], 0.05, 0.16] },
      })
      map.addLayer({
        id: 'zones-line', type: 'line', source: 'zones',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'dim'], 1, 2],
          'line-opacity': ['case', ['get', 'dim'], 0.4, 1],
        },
      })

      map.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': '#185FA5', 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#185FA5', 'line-width': 2, 'line-dasharray': [2, 1] } })

      // Herramienta de dibujo (oculta hasta que drawing=true la active).
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: 'simple_select',
      })
      drawRef.current = draw
      map.addControl(draw)

      const emitPolygon = () => {
        const fc = draw.getAll()
        const poly = fc.features.find(f => f.geometry.type === 'Polygon')
        onPolygonDrawnRef.current?.(poly ? (poly.geometry as GeoJSON.Polygon) : null)
      }
      map.on('draw.create', emitPolygon)
      map.on('draw.update', emitPolygon)
      map.on('draw.delete', () => onPolygonDrawnRef.current?.(null))

      loadedRef.current = true
      ;(map.getSource('zones') as mapboxgl.GeoJSONSource)?.setData(zonesToGeoJSON(zones, highlightZoneId))
      ;(map.getSource('draft') as mapboxgl.GeoJSONSource)?.setData(draftToGeoJSON(draftCircle, draftPolygon))
      onReadyRef.current?.(map)
    })

    return () => { map.remove(); mapRef.current = null; drawRef.current = null; loadedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (mapRef.current) mapRef.current.setCenter([lng, lat]) }, [lat, lng])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    ;(map.getSource('zones') as mapboxgl.GeoJSONSource | undefined)?.setData(zonesToGeoJSON(zones, highlightZoneId))
  }, [zones, highlightZoneId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    ;(map.getSource('draft') as mapboxgl.GeoJSONSource | undefined)?.setData(draftToGeoJSON(draftCircle, draftPolygon))
  }, [draftCircle, draftPolygon])

  // Modo dibujo: al activarse, limpia lo anterior y entra en draw_polygon.
  // Al desactivarse, borra lo dibujado y vuelve a selección.
  useEffect(() => {
    const map = mapRef.current
    const draw = drawRef.current
    if (!map || !draw || !loadedRef.current) return
    if (drawing) {
      draw.deleteAll()
      onPolygonDrawnRef.current?.(null)
      draw.changeMode('draw_polygon')
    } else {
      draw.deleteAll()
      draw.changeMode('simple_select')
    }
  }, [drawing])

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

  return <div ref={containerRef} style={{ height: 420, borderRadius: 12, overflow: 'hidden' }} />
}
