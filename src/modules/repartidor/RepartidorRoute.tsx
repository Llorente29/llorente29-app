// src/modules/repartidor/RepartidorRoute.tsx
// PWA del REPARTIDOR - ruta publica /repartidor. Token = courier.access_token.
// T3b nav/distancia/ganancia/rechazar - T3c foto+firma - tema claro/oscuro
// T3d: ajuste "abrir ruta al aceptar" + codigo de recogida destacado.

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Loader2, Power, Phone, Navigation, Package, CheckCircle2, XCircle, Bike, RefreshCw,
  Sun, Moon, Camera, PenLine, X, Settings,
} from 'lucide-react'
import {
  courierSession, courierSetShift, courierFeed, courierClaim, courierDecline, courierAdvance,
  courierPing, courierProofUpload, type CourierSession, type CourierJob,
} from './repartidorService'

const TOKEN_KEY = 'courier_token'
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
const storeToken = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* modo privado */ } }
const AUTOROUTE_KEY = 'courier_autoroute'

const ACTIVE = ['accepted', 'picked_up', 'in_delivery']
const eur = (n: number | null) => (n == null ? '' : n.toFixed(2).replace('.', ',') + ' \u20AC')
const km = (n: number | null) => (n == null ? '' : n.toString().replace('.', ',') + ' km')
const DOT = '\u00B7'

type Theme = 'light' | 'dark'
const THEME_KEY = 'courier_theme'
function initialTheme(): Theme {
  try { const v = localStorage.getItem(THEME_KEY); if (v === 'light' || v === 'dark') return v } catch { /* */ }
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' } catch { return 'dark' }
}
type Palette = ReturnType<typeof palette>
function palette(dark: boolean) {
  return dark ? {
    app: 'bg-zinc-950 text-zinc-100', head: 'bg-zinc-900 border-b border-zinc-800',
    card: 'bg-zinc-900 ring-1 ring-zinc-800', cardActive: 'bg-zinc-900 ring-1 ring-emerald-500/40',
    sub: 'text-zinc-500', body: 'text-zinc-300',
    soft: 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700',
    input: 'bg-zinc-900 ring-1 ring-zinc-700 text-zinc-100 placeholder:text-zinc-600',
    sheet: 'bg-zinc-900',
  } : {
    app: 'bg-zinc-50 text-zinc-900', head: 'bg-white border-b border-zinc-200',
    card: 'bg-white ring-1 ring-zinc-200 shadow-sm', cardActive: 'bg-white ring-1 ring-emerald-400/60 shadow-sm',
    sub: 'text-zinc-500', body: 'text-zinc-700',
    soft: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
    input: 'bg-white ring-1 ring-zinc-300 text-zinc-900 placeholder:text-zinc-400',
    sheet: 'bg-white',
  }
}

type NavApp = 'waze' | 'gmaps'
const NAV_KEY = 'courier_nav_pref'
const NAV_LABEL: Record<NavApp, string> = { waze: 'Waze', gmaps: 'Google Maps' }
const readNavPref = (): NavApp | null => { try { const v = localStorage.getItem(NAV_KEY); return v === 'waze' || v === 'gmaps' ? v : null } catch { return null } }
const storeNavPref = (p: NavApp) => { try { localStorage.setItem(NAV_KEY, p) } catch { /* noop */ } }
function navUrl(app: NavApp, lat: number | null, lng: number | null, addr: string | null): string | null {
  const coord = lat != null && lng != null
  if (app === 'waze') return coord ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` : addr ? `https://waze.com/ul?q=${encodeURIComponent(addr)}&navigate=yes` : null
  return coord ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : addr ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}` : null
}
function openNav(app: NavApp, lat: number | null, lng: number | null, addr: string | null) {
  const u = navUrl(app, lat, lng, addr); if (u) window.open(u, '_blank')
}

export default function RepartidorRoute() {
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [paste, setPaste] = useState('')
  const [sess, setSess] = useState<CourierSession | null>(null)
  const [jobs, setJobs] = useState<CourierJob[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [delivering, setDelivering] = useState<CourierJob | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [autoRoute, setAutoRoute] = useState<boolean>(() => { try { return localStorage.getItem(AUTOROUTE_KEY) === '1' } catch { return false } })
  const lastPing = useRef<number>(0)
  const watchId = useRef<number | null>(null)
  const dark = theme === 'dark'
  const c = palette(dark)

  function toggleAuto() { setAutoRoute(v => { const nv = !v; try { localStorage.setItem(AUTOROUTE_KEY, nv ? '1' : '0') } catch { /* */ } return nv }) }

  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get('token')
    if (u) { storeToken(u); window.history.replaceState({}, '', '/repartidor'); setToken(u); return }
    setToken(readToken())
  }, [])

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const orig = link?.getAttribute('href') ?? null
    link?.setAttribute('href', '/manifest-repartidor.json')
    return () => { if (link && orig) link.setAttribute('href', orig) }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* */ }
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', dark ? '#09090b' : '#fafafa')
  }, [theme, dark])

  useEffect(() => {
    if (!token) { setStatus('idle'); return }
    let cancel = false; setStatus('checking'); setErr(null)
    courierSession(token)
      .then(s => { if (!cancel) { setSess(s); setStatus('valid') } })
      .catch(e => { if (!cancel) { setStatus('invalid'); setErr(e instanceof Error ? e.message : 'Token no valido') } })
    return () => { cancel = true }
  }, [token])

  const loadFeed = useCallback(async () => {
    if (!token) return
    try { setJobs(await courierFeed(token)) } catch { /* silencioso */ }
  }, [token])
  useEffect(() => {
    if (status !== 'valid') return
    void loadFeed(); const id = setInterval(loadFeed, 8000); return () => clearInterval(id)
  }, [status, loadFeed])

  const hasActive = jobs.some(j => j.mine && ACTIVE.includes(j.state))
  useEffect(() => {
    const on = status === 'valid' && sess?.on_shift && hasActive && 'geolocation' in navigator
    if (!on) { if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null } return }
    if (watchId.current != null) return
    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        const now = Date.now(); if (now - lastPing.current < 9000) return; lastPing.current = now
        if (token) void courierPing(token, Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6))).catch(() => {})
      },
      () => { /* sin permiso */ }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )
    return () => { if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null } }
  }, [status, sess?.on_shift, hasActive, token])

  async function toggleShift() {
    if (!token || !sess) return
    setBusy('shift')
    try { const r = await courierSetShift(token, !sess.on_shift); setSess({ ...sess, on_shift: r.on_shift }) }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo cambiar el turno') } finally { setBusy(null) }
  }
  async function act(fn: () => Promise<unknown>, key: string) {
    setBusy(key); setErr(null)
    try { await fn(); await loadFeed() } catch (e) { setErr(e instanceof Error ? e.message : 'Error') } finally { setBusy(null) }
  }
  function claimOffer(j: CourierJob) {
    if (autoRoute) openNav(readNavPref() ?? 'gmaps', j.pickup_lat, j.pickup_lng, j.pickup_address)
    void act(() => courierClaim(token!, j.assignment_id), j.assignment_id + ':c')
  }
  async function confirmDelivery(job: CourierJob, note: string, dataUrl: string | null, kind: 'photo' | 'signature') {
    if (!token) return
    setBusy(job.assignment_id + ':d'); setErr(null)
    try {
      let url: string | undefined
      if (dataUrl) url = await courierProofUpload(token, job.sale_id, kind, dataUrl)
      await courierAdvance(token, job.assignment_id, 'delivered', note || undefined, url)
      setDelivering(null); await loadFeed()
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo confirmar la entrega') } finally { setBusy(null) }
  }

  if (!token || status === 'invalid') {
    return (
      <div className={`fixed inset-0 ${c.app} flex items-center justify-center p-6`}>
        <div className="w-full max-w-sm text-center">
          <img src="/folvy-icon-192.png" className="h-14 w-14 mx-auto mb-3 rounded-2xl" alt="Folvy" />
          <h1 className="text-2xl font-bold">Reparto Folvy</h1>
          <p className={`text-sm ${c.sub} mt-2`}>Abre el enlace que te paso tu encargado, o pega tu codigo de repartidor.</p>
          {status === 'invalid' && err && (
            <div className="mt-4 rounded-lg bg-red-500/15 text-red-500 ring-1 ring-red-500/40 px-3 py-2 text-sm">Codigo no valido. {err}</div>
          )}
          <input value={paste} onChange={e => setPaste(e.target.value)} placeholder="cour_..."
            className={`mt-6 w-full rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-400 ${c.input}`} />
          <button onClick={() => { const t = paste.trim(); if (t) { storeToken(t); setToken(t); setPaste('') } }} disabled={!paste.trim()}
            className="mt-2 w-full rounded-xl bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-50">Entrar</button>
        </div>
      </div>
    )
  }
  if (status === 'checking' || !sess) {
    return <div className={`fixed inset-0 ${c.app} flex items-center justify-center gap-2`}><Loader2 className="animate-spin" size={20} /> Conectando...</div>
  }

  const mine = jobs.filter(j => j.mine && ACTIVE.includes(j.state))
  const offers = jobs.filter(j => !j.mine && j.state === 'offered')

  return (
    <div className={`fixed inset-0 ${c.app} flex flex-col`}>
      <header className={`shrink-0 ${c.head} px-4 py-3 flex items-center gap-2`}>
        <div className="w-9 h-9 rounded-xl bg-emerald-500 grid place-items-center shrink-0"><Bike size={18} className="text-zinc-950" /></div>
        <div className="min-w-0">
          <p className="font-bold leading-tight truncate">{sess.name}</p>
          <p className={`text-xs ${c.sub}`}>{sess.on_shift ? 'En turno' : 'Fuera de turno'}</p>
        </div>
        <button onClick={() => setSettingsOpen(true)} className={`ml-auto p-2 rounded-lg ${c.soft}`} title="Ajustes"><Settings size={18} /></button>
        <button onClick={() => setTheme(dark ? 'light' : 'dark')} className={`p-2 rounded-lg ${c.soft}`} title="Claro / oscuro">
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button onClick={toggleShift} disabled={busy === 'shift'}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold ${sess.on_shift ? 'bg-emerald-500 text-zinc-950' : c.soft}`}>
          <Power size={16} /> {sess.on_shift ? 'En turno' : 'Turno'}
        </button>
      </header>

      {err && <div className="bg-red-500/15 text-red-500 text-sm px-4 py-2">{err}</div>}

      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {mine.map(j => (
          <ActiveCard key={j.assignment_id} j={j} c={c} busy={busy}
            onPicked={() => act(() => courierAdvance(token, j.assignment_id, 'picked_up'), j.assignment_id + ':p')}
            onDelivered={() => setDelivering(j)}
            onFailed={() => { const r = window.prompt('\u00BFQue paso? (motivo del fallo)'); if (r) void act(() => courierAdvance(token, j.assignment_id, 'failed', r), j.assignment_id + ':f') }} />
        ))}

        {sess.on_shift && offers.length > 0 && (
          <div>
            <p className={`text-xs uppercase tracking-wide ${c.sub} mb-2`}>Ofertas ({offers.length})</p>
            <div className="space-y-3">
              {offers.map(j => (
                <OfferCard key={j.assignment_id} j={j} c={c}
                  claiming={busy === j.assignment_id + ':c'} declining={busy === j.assignment_id + ':x'}
                  onClaim={() => claimOffer(j)}
                  onDecline={() => act(() => courierDecline(token, j.assignment_id), j.assignment_id + ':x')} />
              ))}
            </div>
          </div>
        )}

        {mine.length === 0 && (!sess.on_shift || offers.length === 0) && (
          <div className={`text-center ${c.sub} pt-16`}>
            <Package size={40} className="mx-auto mb-3 opacity-40" />
            {sess.on_shift ? 'Sin pedidos ahora mismo. Te avisaremos aqui.' : 'Ponte en turno para recibir pedidos.'}
          </div>
        )}
      </main>

      {delivering && (
        <DeliverySheet job={delivering} c={c} dark={dark} saving={busy === delivering.assignment_id + ':d'}
          onCancel={() => setDelivering(null)}
          onConfirm={(note, dataUrl, kind) => confirmDelivery(delivering, note, dataUrl, kind)} />
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
          <div className={`w-full sm:max-w-md ${c.sheet} rounded-t-2xl sm:rounded-2xl p-4`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-bold text-lg">Ajustes</span>
              <button onClick={() => setSettingsOpen(false)} className={`ml-auto p-2 rounded-lg ${c.soft}`}><X size={18} /></button>
            </div>
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1">
                <p className="font-semibold text-sm">Abrir ruta al aceptar</p>
                <p className={`text-xs ${c.sub}`}>Al aceptar un pedido, abre la navegacion al local de recogida.</p>
              </div>
              <button onClick={toggleAuto} className={`w-12 h-7 rounded-full relative transition-colors shrink-0 ${autoRoute ? 'bg-emerald-500' : c.soft}`}>
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${autoRoute ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OfferCard({ j, c, claiming, declining, onClaim, onDecline }: {
  j: CourierJob; c: Palette; claiming: boolean; declining: boolean; onClaim: () => void; onDecline: () => void
}) {
  const busy = claiming || declining
  return (
    <div className={`rounded-2xl ${c.card} p-4`}>
      <div className="flex items-center gap-2">
        <span className="font-bold">{j.brand ?? 'Pedido'}</span>
        <span className={`text-xs ${c.sub}`}>#{j.order_code}</span>
        <span className={`ml-auto text-sm ${c.body}`}>{eur(j.total)}</span>
      </div>
      <p className={`text-sm ${c.body} mt-2`}>{j.delivery_address ?? 'Sin direccion'}</p>
      {j.delivery_details && <p className={`text-xs ${c.sub}`}>{j.delivery_details}</p>}
      <div className="flex items-center gap-3 mt-2">
        {j.distance_km != null && <span className={`text-xs ${c.sub} inline-flex items-center gap-1`}><Navigation size={12} /> {km(j.distance_km)}</span>}
        <span className={`text-xs ${c.sub}`}>{j.items_count} art. {DOT} {j.pickup_name ?? 'el local'}</span>
        {j.payout != null && <span className="ml-auto text-sm text-emerald-500 font-bold">Ganas {eur(j.payout)}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <button onClick={onDecline} disabled={busy} className={`rounded-xl font-bold py-2.5 disabled:opacity-50 ${c.soft}`}>
          {declining ? '...' : 'Rechazar'}
        </button>
        <button onClick={onClaim} disabled={busy}
          className="col-span-2 rounded-xl bg-emerald-500 text-zinc-950 font-bold py-2.5 hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center justify-center gap-2">
          {claiming ? <><RefreshCw size={16} className="animate-spin" /> Aceptando...</> : 'Aceptar pedido'}
        </button>
      </div>
    </div>
  )
}

function ActiveCard({ j, c, busy, onPicked, onDelivered, onFailed }: {
  j: CourierJob; c: Palette; busy: string | null; onPicked: () => void; onDelivered: () => void; onFailed: () => void
}) {
  const [pref, setPref] = useState<NavApp | null>(readNavPref())
  const [choosing, setChoosing] = useState(false)
  const enroute = j.state !== 'accepted'
  const label = enroute ? 'En ruta al cliente' : 'Recoger en el local'
  const destLat = enroute ? j.delivery_lat : j.pickup_lat
  const destLng = enroute ? j.delivery_lng : j.pickup_lng
  const destAddr = enroute ? j.delivery_address : j.pickup_address
  const canNav = destLat != null || !!destAddr

  function pick(app: NavApp) { setPref(app); storeNavPref(app); setChoosing(false); openNav(app, destLat, destLng, destAddr) }
  function navigate() { if (pref && !choosing) openNav(pref, destLat, destLng, destAddr); else setChoosing(true) }
  function handlePicked() { openNav(pref ?? 'gmaps', j.delivery_lat, j.delivery_lng, j.delivery_address); onPicked() }

  return (
    <div className={`rounded-2xl ${c.cardActive} p-4`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-emerald-500">{label}</span>
        {j.distance_km != null && <span className={`text-xs ${c.sub}`}>{DOT} {km(j.distance_km)}</span>}
        <span className={`ml-auto text-sm ${c.body}`}>{eur(j.total)}</span>
      </div>
      <p className="font-bold mt-2">{j.brand ?? 'Pedido'}</p>

      {!enroute && (
        <div className={`mt-2 rounded-xl px-3 py-2 flex items-center ${c.card}`}>
          <span className={`text-xs ${c.sub}`}>Codigo de recogida</span>
          <span className="ml-auto font-mono font-extrabold text-xl">#{j.order_code}</span>
        </div>
      )}

      <p className={`text-sm ${c.body} mt-2`}>
        {enroute
          ? `${j.delivery_address ?? 'Sin direccion'}${j.delivery_details ? ` ${DOT} ${j.delivery_details}` : ''}`
          : `Recoger en ${j.pickup_name ?? 'el local'}${j.pickup_address ? ` ${DOT} ${j.pickup_address}` : ''}`}
      </p>
      <div className="flex items-center gap-3 mt-2">
        {j.customer_name && <span className={`text-sm ${c.sub}`}>{j.customer_name}</span>}
        {j.customer_phone && <a href={`tel:${j.customer_phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 text-emerald-500 text-sm"><Phone size={14} /> Llamar</a>}
        {j.payout != null && <span className="ml-auto text-sm text-emerald-500 font-bold">Ganas {eur(j.payout)}</span>}
      </div>

      {canNav && (
        <div className="mt-3">
          {choosing || !pref ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => pick('waze')} className="rounded-xl bg-sky-500 text-zinc-950 font-bold py-3 inline-flex items-center justify-center gap-2"><Navigation size={16} /> Waze</button>
              <button onClick={() => pick('gmaps')} className="rounded-xl bg-zinc-900 text-white font-bold py-3 inline-flex items-center justify-center gap-2"><Navigation size={16} /> Google Maps</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={navigate} className="flex-1 rounded-xl bg-sky-500 text-zinc-950 font-bold py-3 inline-flex items-center justify-center gap-2"><Navigation size={18} /> Navegar</button>
              <button onClick={() => setChoosing(true)} className={`text-xs ${c.sub} px-2 py-2 whitespace-nowrap`}>{NAV_LABEL[pref]} {DOT} cambiar</button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        {j.state === 'accepted' ? (
          <button onClick={handlePicked} disabled={!!busy}
            className="col-span-2 rounded-xl bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center justify-center gap-2"><Package size={18} /> He recogido y salgo</button>
        ) : (
          <>
            <button onClick={onDelivered} disabled={!!busy}
              className="rounded-xl bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center justify-center gap-2"><CheckCircle2 size={18} /> Entregado</button>
            <button onClick={onFailed} disabled={!!busy}
              className={`rounded-xl font-bold py-3 text-red-500 disabled:opacity-50 inline-flex items-center justify-center gap-2 ${c.soft}`}><XCircle size={18} /> No entregado</button>
          </>
        )}
      </div>
    </div>
  )
}

function SignaturePad({ dark, onChange }: { dark: boolean; onChange: (d: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)
  useEffect(() => { const cvs = ref.current; if (!cvs) return; cvs.width = cvs.offsetWidth; cvs.height = 160 }, [])
  function xy(e: React.MouseEvent | React.TouchEvent) {
    const cvs = ref.current!; const r = cvs.getBoundingClientRect()
    const p = ('touches' in e && e.touches[0]) ? e.touches[0] : (e as React.MouseEvent)
    return { x: (p.clientX - r.left) * (cvs.width / r.width), y: (p.clientY - r.top) * (cvs.height / r.height) }
  }
  function down(e: React.MouseEvent | React.TouchEvent) { e.preventDefault(); drawing.current = true; const ctx = ref.current!.getContext('2d')!; const p = xy(e); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
  function move(e: React.MouseEvent | React.TouchEvent) { if (!drawing.current) return; e.preventDefault(); const ctx = ref.current!.getContext('2d')!; const p = xy(e); ctx.strokeStyle = dark ? '#e4e4e7' : '#18181b'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineTo(p.x, p.y); ctx.stroke(); dirty.current = true }
  function up() { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(ref.current!.toDataURL('image/png')) }
  function clear() { const cvs = ref.current; if (!cvs) return; cvs.getContext('2d')!.clearRect(0, 0, cvs.width, cvs.height); dirty.current = false; onChange(null) }
  return (
    <div>
      <canvas ref={ref} className={`w-full h-40 rounded-lg touch-none ${dark ? 'bg-zinc-800' : 'bg-zinc-100'}`}
        onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
        onTouchStart={down} onTouchMove={move} onTouchEnd={up} />
      <button onClick={clear} className="text-xs text-zinc-500 mt-1">Borrar firma</button>
    </div>
  )
}

function DeliverySheet({ job, c, dark, saving, onCancel, onConfirm }: {
  job: CourierJob; c: Palette; dark: boolean; saving: boolean
  onCancel: () => void; onConfirm: (note: string, dataUrl: string | null, kind: 'photo' | 'signature') => void
}) {
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [sig, setSig] = useState<string | null>(null)
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    const r = new FileReader(); r.onload = () => setPhoto(r.result as string); r.readAsDataURL(f)
  }
  function confirm() {
    const dataUrl = photo ?? sig
    const kind: 'photo' | 'signature' = photo ? 'photo' : 'signature'
    onConfirm(note.trim(), dataUrl, kind)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className={`w-full sm:max-w-md ${c.sheet} rounded-t-2xl sm:rounded-2xl p-4 max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="font-bold text-lg">Confirmar entrega</span>
          <button onClick={onCancel} className={`ml-auto p-2 rounded-lg ${c.soft}`}><X size={18} /></button>
        </div>
        <p className={`text-sm ${c.sub} mb-3`}>{job.brand ?? 'Pedido'} {DOT} #{job.order_code}</p>

        <label className={`flex items-center gap-3 rounded-xl p-3 ${c.card} cursor-pointer`}>
          <Camera size={20} className="text-emerald-500 shrink-0" />
          <span className="text-sm font-semibold flex-1">{photo ? 'Foto anadida' : 'Hacer foto de la entrega'}</span>
          {photo && <img src={photo} className="w-12 h-12 rounded-lg object-cover" alt="" />}
          <input type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
        </label>

        <div className={`rounded-xl p-3 mt-3 ${c.card}`}>
          <div className="flex items-center gap-2 mb-2">
            <PenLine size={18} className="text-emerald-500" />
            <span className="text-sm font-semibold">Firma del cliente (opcional)</span>
          </div>
          <SignaturePad dark={dark} onChange={setSig} />
        </div>

        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
          placeholder="Nota (opcional): dejado en porteria, entregado en mano..."
          className={`w-full rounded-xl px-3 py-2 mt-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 ${c.input}`} />

        <div className="grid grid-cols-2 gap-2 mt-4">
          <button onClick={onCancel} className={`rounded-xl font-bold py-3 ${c.soft}`}>Cancelar</button>
          <button onClick={confirm} disabled={saving}
            className="rounded-xl bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {saving ? <><RefreshCw size={16} className="animate-spin" /> Enviando...</> : 'Confirmar entrega'}
          </button>
        </div>
      </div>
    </div>
  )
}