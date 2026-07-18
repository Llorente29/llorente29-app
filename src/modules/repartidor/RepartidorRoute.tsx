// src/modules/repartidor/RepartidorRoute.tsx
//
// PWA del REPARTIDOR — ruta pública /repartidor (App.tsx la monta ANTES de los
// gates, como /estacion). FRONTERA DE TOKEN: sin login; el repartidor entra por
// su enlace personal /repartidor?token=cour_... (su "enlace mágico"/QR).
//
// T3b.1: navegación (Waze/Google Maps, recordada) + ruta auto al recoger.
// T3b.2: oferta con distancia + ganancia (autónomo) + aceptar/rechazar.

import { useEffect, useRef, useState, useCallback } from 'react'
import { Loader2, Power, Phone, Navigation, Package, CheckCircle2, XCircle, Bike, RefreshCw } from 'lucide-react'
import {
  courierSession, courierSetShift, courierFeed, courierClaim, courierDecline, courierAdvance, courierPing,
  type CourierSession, type CourierJob,
} from './repartidorService'

const TOKEN_KEY = 'courier_token'
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
const storeToken = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* modo privado */ } }

const ACTIVE = ['accepted', 'picked_up', 'in_delivery']
const eur = (n: number | null) => (n == null ? '' : n.toFixed(2).replace('.', ',') + ' €')
const km = (n: number | null) => (n == null ? '' : n.toString().replace('.', ',') + ' km')

// ── Navegación (Waze / Google Maps), preferencia recordada por dispositivo ──
type NavApp = 'waze' | 'gmaps'
const NAV_KEY = 'courier_nav_pref'
const NAV_LABEL: Record<NavApp, string> = { waze: 'Waze', gmaps: 'Google Maps' }
const readNavPref = (): NavApp | null => { try { const v = localStorage.getItem(NAV_KEY); return v === 'waze' || v === 'gmaps' ? v : null } catch { return null } }
const storeNavPref = (p: NavApp) => { try { localStorage.setItem(NAV_KEY, p) } catch { /* noop */ } }

function navUrl(app: NavApp, lat: number | null, lng: number | null, addr: string | null): string | null {
  const coord = lat != null && lng != null
  if (app === 'waze') {
    return coord ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
      : addr ? `https://waze.com/ul?q=${encodeURIComponent(addr)}&navigate=yes` : null
  }
  return coord ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : addr ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}` : null
}
function openNav(app: NavApp, lat: number | null, lng: number | null, addr: string | null) {
  const u = navUrl(app, lat, lng, addr)
  if (u) window.open(u, '_blank')
}

export default function RepartidorRoute() {
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [paste, setPaste] = useState('')
  const [sess, setSess] = useState<CourierSession | null>(null)
  const [jobs, setJobs] = useState<CourierJob[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const lastPing = useRef<number>(0)
  const watchId = useRef<number | null>(null)

  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get('token')
    if (u) { storeToken(u); window.history.replaceState({}, '', '/repartidor'); setToken(u); return }
    setToken(readToken())
  }, [])

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const orig = link?.getAttribute('href') ?? null
    link?.setAttribute('href', '/manifest-repartidor.json')
    const tm = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const origTheme = tm?.getAttribute('content') ?? null
    tm?.setAttribute('content', '#0e1820')
    return () => { if (link && orig) link.setAttribute('href', orig); if (tm && origTheme) tm.setAttribute('content', origTheme) }
  }, [])

  useEffect(() => {
    if (!token) { setStatus('idle'); return }
    let cancel = false; setStatus('checking'); setErr(null)
    courierSession(token)
      .then(s => { if (!cancel) { setSess(s); setStatus('valid') } })
      .catch(e => { if (!cancel) { setStatus('invalid'); setErr(e instanceof Error ? e.message : 'Token no válido') } })
    return () => { cancel = true }
  }, [token])

  const loadFeed = useCallback(async () => {
    if (!token) return
    try { setJobs(await courierFeed(token)) } catch { /* silencioso */ }
  }, [token])
  useEffect(() => {
    if (status !== 'valid') return
    void loadFeed()
    const id = setInterval(loadFeed, 8000)
    return () => clearInterval(id)
  }, [status, loadFeed])

  const hasActive = jobs.some(j => j.mine && ACTIVE.includes(j.state))

  useEffect(() => {
    const on = status === 'valid' && sess?.on_shift && hasActive && 'geolocation' in navigator
    if (!on) {
      if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null }
      return
    }
    if (watchId.current != null) return
    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        const now = Date.now()
        if (now - lastPing.current < 9000) return
        lastPing.current = now
        if (token) void courierPing(token, Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6))).catch(() => {})
      },
      () => { /* sin permiso: seguimos sin GPS */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )
    return () => { if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null } }
  }, [status, sess?.on_shift, hasActive, token])

  async function toggleShift() {
    if (!token || !sess) return
    setBusy('shift')
    try { const r = await courierSetShift(token, !sess.on_shift); setSess({ ...sess, on_shift: r.on_shift }) }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo cambiar el turno') }
    finally { setBusy(null) }
  }
  async function act(fn: () => Promise<unknown>, key: string) {
    setBusy(key); setErr(null)
    try { await fn(); await loadFeed() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(null) }
  }

  if (!token || status === 'invalid') {
    return (
      <div className="fixed inset-0 bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          <img src="/folvy-icon-192.png" className="h-14 w-14 mx-auto mb-3 rounded-2xl" alt="Folvy" />
          <h1 className="text-2xl font-bold">Reparto Folvy</h1>
          <p className="text-sm text-zinc-400 mt-2">Abre el enlace que te pasó tu encargado, o pega tu código de repartidor.</p>
          {status === 'invalid' && err && (
            <div className="mt-4 rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 px-3 py-2 text-sm">Código no válido. {err}</div>
          )}
          <input value={paste} onChange={e => setPaste(e.target.value)} placeholder="cour_…"
            className="mt-6 w-full rounded-lg bg-zinc-900 ring-1 ring-zinc-700 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          <button onClick={() => { const t = paste.trim(); if (t) { storeToken(t); setToken(t); setPaste('') } }} disabled={!paste.trim()}
            className="mt-2 w-full rounded-lg bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-50">Entrar</button>
        </div>
      </div>
    )
  }
  if (status === 'checking' || !sess) {
    return <div className="fixed inset-0 bg-zinc-950 text-zinc-400 flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={20} /> Conectando…</div>
  }

  const mine = jobs.filter(j => j.mine && ACTIVE.includes(j.state))
  const offers = jobs.filter(j => !j.mine && j.state === 'offered')

  return (
    <div className="fixed inset-0 bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="shrink-0 bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <Bike size={20} className="text-emerald-400" />
        <div className="min-w-0">
          <p className="font-bold leading-tight truncate">{sess.name}</p>
          <p className="text-xs text-zinc-500">{sess.on_shift ? 'En turno' : 'Fuera de turno'}</p>
        </div>
        <button onClick={toggleShift} disabled={busy === 'shift'}
          className={`ml-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${sess.on_shift ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}>
          <Power size={16} /> {sess.on_shift ? 'En turno' : 'Ponerse en turno'}
        </button>
      </header>

      {err && <div className="bg-red-500/15 text-red-200 text-sm px-4 py-2">{err}</div>}

      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {mine.map(j => (
          <ActiveCard key={j.assignment_id} j={j} busy={busy}
            onPicked={() => act(() => courierAdvance(token, j.assignment_id, 'picked_up'), j.assignment_id + ':p')}
            onDelivered={() => { const note = window.prompt('Nota de entrega (opcional):') ?? undefined; void act(() => courierAdvance(token, j.assignment_id, 'delivered', note), j.assignment_id + ':d') }}
            onFailed={() => { const r = window.prompt('¿Qué pasó? (motivo del fallo)'); if (r) void act(() => courierAdvance(token, j.assignment_id, 'failed', r), j.assignment_id + ':f') }} />
        ))}

        {sess.on_shift && offers.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Ofertas ({offers.length})</p>
            <div className="space-y-3">
              {offers.map(j => (
                <OfferCard key={j.assignment_id} j={j}
                  claiming={busy === j.assignment_id + ':c'}
                  declining={busy === j.assignment_id + ':x'}
                  onClaim={() => act(() => courierClaim(token, j.assignment_id), j.assignment_id + ':c')}
                  onDecline={() => act(() => courierDecline(token, j.assignment_id), j.assignment_id + ':x')} />
              ))}
            </div>
          </div>
        )}

        {mine.length === 0 && (!sess.on_shift || offers.length === 0) && (
          <div className="text-center text-zinc-500 pt-16">
            <Package size={40} className="mx-auto mb-3 opacity-40" />
            {sess.on_shift ? 'Sin pedidos ahora mismo. Te avisaremos aquí.' : 'Ponte en turno para recibir pedidos.'}
          </div>
        )}
      </main>
    </div>
  )
}

function OfferCard({ j, claiming, declining, onClaim, onDecline }: {
  j: CourierJob; claiming: boolean; declining: boolean; onClaim: () => void; onDecline: () => void
}) {
  const busy = claiming || declining
  return (
    <div className="rounded-xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
      <div className="flex items-center gap-2">
        <span className="font-bold">{j.brand ?? 'Pedido'}</span>
        <span className="text-xs text-zinc-500">#{j.order_code}</span>
        <span className="ml-auto text-sm text-zinc-400">{eur(j.total)}</span>
      </div>
      <p className="text-sm text-zinc-300 mt-2">{j.delivery_address ?? 'Sin dirección'}</p>
      {j.delivery_details && <p className="text-xs text-zinc-500">{j.delivery_details}</p>}
      <div className="flex items-center gap-3 mt-2">
        {j.distance_km != null && <span className="text-xs text-zinc-400 inline-flex items-center gap-1"><Navigation size={12} /> {km(j.distance_km)}</span>}
        <span className="text-xs text-zinc-500">{j.items_count} art. · {j.pickup_name ?? 'el local'}</span>
        {j.payout != null && <span className="ml-auto text-sm text-emerald-400 font-bold">Ganas {eur(j.payout)}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <button onClick={onDecline} disabled={busy}
          className="rounded-lg bg-zinc-800 text-zinc-300 font-bold py-2.5 hover:bg-zinc-700 disabled:opacity-50">
          {declining ? '…' : 'Rechazar'}
        </button>
        <button onClick={onClaim} disabled={busy}
          className="col-span-2 rounded-lg bg-emerald-500 text-zinc-950 font-bold py-2.5 hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center justify-center gap-2">
          {claiming ? <><RefreshCw size={16} className="animate-spin" /> Aceptando…</> : 'Aceptar pedido'}
        </button>
      </div>
    </div>
  )
}

function ActiveCard({ j, busy, onPicked, onDelivered, onFailed }: {
  j: CourierJob; busy: string | null; onPicked: () => void; onDelivered: () => void; onFailed: () => void
}) {
  const [pref, setPref] = useState<NavApp | null>(readNavPref())
  const [choosing, setChoosing] = useState(false)
  const enroute = j.state !== 'accepted'
  const label = enroute ? 'En ruta al cliente' : 'Recoger en el local'

  const destLat = enroute ? j.delivery_lat : j.pickup_lat
  const destLng = enroute ? j.delivery_lng : j.pickup_lng
  const destAddr = enroute ? j.delivery_address : j.pickup_address
  const canNav = destLat != null || !!destAddr

  function pick(app: NavApp) {
    setPref(app); storeNavPref(app); setChoosing(false)
    openNav(app, destLat, destLng, destAddr)
  }
  function navigate() {
    if (pref && !choosing) openNav(pref, destLat, destLng, destAddr)
    else setChoosing(true)
  }
  function handlePicked() {
    openNav(pref ?? 'gmaps', j.delivery_lat, j.delivery_lng, j.delivery_address)
    onPicked()
  }

  return (
    <div className="rounded-xl bg-zinc-900 ring-1 ring-emerald-500/30 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-emerald-400">{label}</span>
        {j.distance_km != null && <span className="text-xs text-zinc-500">· {km(j.distance_km)}</span>}
        <span className="ml-auto text-sm text-zinc-400">{eur(j.total)}</span>
      </div>
      <p className="font-bold mt-2">{j.brand ?? 'Pedido'} <span className="text-xs text-zinc-500">#{j.order_code}</span></p>
      <p className="text-sm text-zinc-300 mt-1">
        {enroute
          ? `${j.delivery_address ?? 'Sin dirección'}${j.delivery_details ? ` · ${j.delivery_details}` : ''}`
          : `Recoger en ${j.pickup_name ?? 'el local'}${j.pickup_address ? ` · ${j.pickup_address}` : ''}`}
      </p>
      <div className="flex items-center gap-3 mt-2">
        {j.customer_name && <span className="text-sm text-zinc-400">{j.customer_name}</span>}
        {j.customer_phone && <a href={`tel:${j.customer_phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 text-emerald-400 text-sm"><Phone size={14} /> Llamar</a>}
        {j.payout != null && <span className="ml-auto text-sm text-emerald-400 font-bold">Ganas {eur(j.payout)}</span>}
      </div>

      {canNav && (
        <div className="mt-3">
          {choosing || !pref ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => pick('waze')}
                className="rounded-lg bg-sky-500 text-zinc-950 font-bold py-3 inline-flex items-center justify-center gap-2"><Navigation size={16} /> Waze</button>
              <button onClick={() => pick('gmaps')}
                className="rounded-lg bg-zinc-100 text-zinc-950 font-bold py-3 inline-flex items-center justify-center gap-2"><Navigation size={16} /> Google Maps</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={navigate}
                className="flex-1 rounded-lg bg-sky-500 text-zinc-950 font-bold py-3 inline-flex items-center justify-center gap-2"><Navigation size={18} /> Navegar</button>
              <button onClick={() => setChoosing(true)} className="text-xs text-zinc-500 px-2 py-2 whitespace-nowrap">{NAV_LABEL[pref]} · cambiar</button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        {j.state === 'accepted' ? (
          <button onClick={handlePicked} disabled={!!busy}
            className="col-span-2 rounded-lg bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center justify-center gap-2"><Package size={18} /> He recogido y salgo</button>
        ) : (
          <>
            <button onClick={onDelivered} disabled={!!busy}
              className="rounded-lg bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center justify-center gap-2"><CheckCircle2 size={18} /> Entregado</button>
            <button onClick={onFailed} disabled={!!busy}
              className="rounded-lg bg-zinc-800 text-red-300 font-bold py-3 hover:bg-zinc-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"><XCircle size={18} /> No entregado</button>
          </>
        )}
      </div>
    </div>
  )
}