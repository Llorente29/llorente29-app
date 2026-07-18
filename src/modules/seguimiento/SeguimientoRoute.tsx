// src/modules/seguimiento/SeguimientoRoute.tsx
// Pagina publica de seguimiento del cliente: /seguir/<public_token>.
// Mapa Mapbox con la moto en vivo + estado + destino. Solo lectura (RPC track_by_token).

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Bike, CheckCircle2, AlertTriangle, Phone } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

interface TrackData {
  found: boolean; stage?: string
  brand?: string | null; customer_name?: string | null; delivery_address?: string | null
  rider_name?: string | null; rider_phone?: string | null; rider_transport?: string | null
  rider_lat?: number | null; rider_lng?: number | null; rider_seen_at?: string | null
  eta_delivery?: string | null
  dest_lat?: number | null; dest_lng?: number | null
  pickup_name?: string | null; pickup_lat?: number | null; pickup_lng?: number | null
}

function getToken(): string | null {
  const m = window.location.pathname.match(/\/seguir\/([^/?#]+)/)
  if (m) return decodeURIComponent(m[1])
  return new URLSearchParams(window.location.search).get('token')
}
function vehEmoji(v?: string | null): string {
  const t = (v ?? '').toLowerCase()
  if (t.includes('bici') || t.includes('bike')) return '\u{1F6B2}'
  if (t.includes('coche') || t.includes('car')) return '\u{1F697}'
  return '\u{1F6F5}'
}
function seenAgo(iso?: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms)) return ''
  const min = Math.round(ms / 60000)
  if (min <= 0) return 'ahora mismo'
  if (min === 1) return 'hace 1 min'
  if (min < 60) return `hace ${min} min`
  return 'hace un rato'
}
function markerEl(bg: string, emoji: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `width:36px;height:36px;border-radius:50%;background:${bg};display:grid;place-items:center;box-shadow:0 2px 10px rgba(0,0,0,.35);font-size:18px;border:2px solid #fff`
  el.textContent = emoji
  return el
}

const STEPS = ['Preparando', 'En camino', 'Entregado']
function stepIndex(stage?: string): number {
  if (stage === 'entregado') return 2
  if (stage === 'en_camino') return 1
  return 0
}

export default function SeguimientoRoute() {
  const [token] = useState<string | null>(getToken())
  const [data, setData] = useState<TrackData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const riderRef = useRef<mapboxgl.Marker | null>(null)
  const destRef = useRef<mapboxgl.Marker | null>(null)

  useEffect(() => {
    if (!token) { setErr('Enlace no valido'); return }
    let stop = false
    async function load() {
      if (!supabase) return
      const { data: d, error } = await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)('track_by_token', { p_token: token })
      if (stop) return
      if (error) { setErr(error.message); return }
      setData(d as TrackData)
    }
    void load()
    const id = setInterval(load, 10000)
    return () => { stop = true; clearInterval(id) }
  }, [token])

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || !data?.found) return
    const rider: [number, number] | null = (data.rider_lat != null && data.rider_lng != null) ? [data.rider_lng, data.rider_lat] : null
    const dest: [number, number] | null = (data.dest_lat != null && data.dest_lng != null) ? [data.dest_lng, data.dest_lat] : null
    const center = rider ?? dest
    if (!center) return
    if (!mapRef.current) {
      mapboxgl.accessToken = MAPBOX_TOKEN
      mapRef.current = new mapboxgl.Map({ container: containerRef.current, style: 'mapbox://styles/mapbox/streets-v12', center, zoom: 14 })
    }
    const map = mapRef.current
    if (dest) {
      if (!destRef.current) destRef.current = new mapboxgl.Marker(markerEl('#18181b', '\u{1F3E0}')).setLngLat(dest).addTo(map)
      else destRef.current.setLngLat(dest)
    }
    if (rider) {
      if (!riderRef.current) riderRef.current = new mapboxgl.Marker(markerEl('#10b981', vehEmoji(data.rider_transport))).setLngLat(rider).addTo(map)
      else riderRef.current.setLngLat(rider)
    }
    if (rider && dest) map.fitBounds([rider, dest], { padding: 70, maxZoom: 15, duration: 700 })
    else if (rider) map.easeTo({ center: rider, duration: 700 })
  }, [data])

  if (err || data?.found === false) {
    return (
      <div className="fixed inset-0 bg-zinc-50 text-zinc-900 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <img src="/folvy-icon-192.png" className="h-12 w-12 mx-auto mb-3 rounded-xl" alt="Folvy" />
          <p className="font-bold text-lg">No encontramos este pedido</p>
          <p className="text-sm text-zinc-500 mt-1">El enlace puede haber caducado. Pregunta en el restaurante.</p>
        </div>
      </div>
    )
  }
  if (!data) {
    return <div className="fixed inset-0 bg-zinc-50 text-zinc-500 flex items-center justify-center">Cargando seguimiento...</div>
  }

  const idx = stepIndex(data.stage)
  const incidencia = data.stage === 'incidencia'
  const entregado = data.stage === 'entregado'

  return (
    <div className="fixed inset-0 bg-zinc-50 text-zinc-900 flex flex-col">
      <header className="shrink-0 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-emerald-500 grid place-items-center"><Bike size={18} className="text-white" /></div>
          <div>
            <p className="text-xs text-zinc-500 leading-none">Tu pedido</p>
            <p className="font-bold leading-tight">{data.brand ?? 'Pedido'}</p>
          </div>
        </div>

        {incidencia ? (
          <div className="mt-4 rounded-xl bg-red-500/10 text-red-600 ring-1 ring-red-500/30 px-3 py-2 text-sm inline-flex items-center gap-2">
            <AlertTriangle size={16} /> Ha habido una incidencia con la entrega.
          </div>
        ) : (
          <div className="mt-4 flex items-center">
            {STEPS.map((label, i) => (
              <div key={label} className="flex-1 flex items-center">
                <div className="flex flex-col items-center">
                  <div className={`w-7 h-7 rounded-full grid place-items-center text-white ${i <= idx ? 'bg-emerald-500' : 'bg-zinc-300'}`}>
                    {i < idx || (entregado && i === 2) ? <CheckCircle2 size={16} /> : <span className="text-xs font-bold">{i + 1}</span>}
                  </div>
                  <span className={`text-[11px] mt-1 ${i <= idx ? 'text-zinc-900 font-semibold' : 'text-zinc-400'}`}>{label}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`flex-1 h-1 mx-1 rounded ${i < idx ? 'bg-emerald-500' : 'bg-zinc-300'}`} />}
              </div>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 mx-4 rounded-2xl overflow-hidden ring-1 ring-zinc-200 relative">
        {MAPBOX_TOKEN
          ? <div ref={containerRef} className="absolute inset-0" />
          : <div className="absolute inset-0 grid place-items-center text-sm text-zinc-500 p-6 text-center">{data.delivery_address ?? 'Tu direccion'}</div>}
      </div>

      <div className="shrink-0 p-4">
        <div className="rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-emerald-500 grid place-items-center text-white text-xl">{vehEmoji(data.rider_transport)}</div>
          <div className="min-w-0">
            <p className="font-bold leading-tight truncate">
              {entregado ? 'Pedido entregado' : (data.rider_name ? data.rider_name : 'Buscando repartidor')}
            </p>
            <p className="text-sm text-zinc-500">
              {entregado ? 'Que aproveche' : data.rider_seen_at ? `En camino \u00B7 visto ${seenAgo(data.rider_seen_at)}` : 'Preparando tu pedido'}
            </p>
          </div>
          {data.rider_phone && !entregado && (
            <a href={`tel:${data.rider_phone.replace(/\s+/g, '')}`}
              className="ml-auto shrink-0 inline-flex items-center gap-2 rounded-full bg-emerald-500 text-white font-bold px-4 py-2.5 text-sm hover:bg-emerald-600">
              <Phone size={16} /> Llamar
            </a>
          )}
        </div>
        {data.delivery_address && <p className="text-xs text-zinc-400 text-center mt-3">Entrega en {data.delivery_address}</p>}
      </div>
    </div>
  )
}
