// src/modules/tablet/TabletStationRoute.tsx
//
// ESTACIÓN DE TABLET — ruta pública /estacion (la monta App.tsx ANTES de los
// gates de sesión, igual que /cocina-tv). FRONTERA DE TOKEN: no hay login; el
// dispositivo se identifica con kds_device.token. Terminal a pantalla completa
// con tres pestañas de la misma realidad operativa:
//   · Pedidos        (feed de pedidos por token)        — Capa 3 (pendiente)
//   · Cocina         (tablero KDS por token)            — Capa 1
//   · Disponibilidad (86: agotar/reactivar por token)   — Capa 2
//
// Comparte el MISMO TOKEN que el kiosco (kds_device.token). /cocina-tv se
// mantiene aparte como modo "solo tablero".

import { useEffect, useState } from 'react'
import { ClipboardList, MonitorPlay, CircleOff, Loader2, LogOut } from 'lucide-react'
import KdsBoard from '../kds/components/KdsBoard'
import { getBoard } from '../kds/services/kdsService'
import { getDeviceLocation, type TabletLocationInfo } from './services/tabletAvailabilityService'
import TabletAvailabilityTab from './TabletAvailabilityTab'

const TOKEN_KEY = 'kds_device_token' // mismo token que el kiosco

function readStoredToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function storeToken(token: string): void {
  try { window.localStorage.setItem(TOKEN_KEY, token) } catch { /* modo privado */ }
}
function clearToken(): void {
  try { window.localStorage.removeItem(TOKEN_KEY) } catch { /* noop */ }
}

type Status = 'idle' | 'checking' | 'valid' | 'invalid'
type Tab = 'pedidos' | 'cocina' | 'disponibilidad'

export default function TabletStationRoute() {
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [pasteValue, setPasteValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('cocina')
  const [locInfo, setLocInfo] = useState<TabletLocationInfo | null>(null)

  // Resolución inicial del token: ?token= en la URL o localStorage.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('token')
    if (fromUrl) {
      storeToken(fromUrl)
      window.history.replaceState({}, '', '/estacion')
      setToken(fromUrl)
      return
    }
    setToken(readStoredToken())
  }, [])

  // Valida el token (kds_board) y, en paralelo, carga el local del dispositivo.
  useEffect(() => {
    if (!token) { setStatus('idle'); return }
    let cancelled = false
    setStatus('checking')
    setError(null)
    getBoard(null, token)
      .then(() => { if (!cancelled) setStatus('valid') })
      .catch((e: unknown) => {
        if (cancelled) return
        setStatus('invalid')
        setError(e instanceof Error ? e.message : 'Token no válido')
      })
    getDeviceLocation(token)
      .then((info) => { if (!cancelled) setLocInfo(info) })
      .catch(() => { /* la cabecera tolera no tener nombre */ })
    return () => { cancelled = true }
  }, [token])

  function handleLink() {
    const t = pasteValue.trim()
    if (!t) return
    storeToken(t)
    setToken(t)
    setPasteValue('')
  }

  function handleUnlink() {
    clearToken()
    setToken(null)
    setStatus('idle')
    setError(null)
    setLocInfo(null)
  }

  // ── Pantalla de vinculación ───────────────────────────────────────────────
  if (!token || status === 'invalid') {
    return (
      <div className="fixed inset-0 bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <img src="/folvy-icon-192.png" alt="Folvy" className="h-14 w-14 mx-auto mb-3 rounded-2xl" />
          <p className="text-xl font-bold text-zinc-100 mb-4">Folvy</p>
          <h1 className="text-2xl font-bold">Vincular esta tablet</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Pega el token del dispositivo (lo generas en Ajustes de cocina → Dispositivos) o abre la
            URL de la estación que copiaste allí.
          </p>
          {status === 'invalid' && error && (
            <div className="mt-4 rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 px-3 py-2 text-sm">
              El token no es válido o fue revocado. {error}
            </div>
          )}
          <div className="mt-6 flex flex-col gap-2">
            <input
              value={pasteValue}
              onChange={e => setPasteValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleLink() }}
              placeholder="kdsdev_…"
              className="w-full rounded-lg bg-zinc-900 ring-1 ring-zinc-700 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              autoFocus
            />
            <button
              onClick={handleLink}
              disabled={!pasteValue.trim()}
              className="w-full rounded-lg bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-50"
            >
              Vincular tablet
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Comprobando token ─────────────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <div className="fixed inset-0 bg-zinc-950 text-zinc-400 flex items-center justify-center gap-2">
        <Loader2 className="animate-spin" size={20} /> Conectando con la cocina…
      </div>
    )
  }

  // ── Terminal con barra de pestañas ────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: typeof ClipboardList }[] = [
    { id: 'pedidos', label: 'Pedidos', icon: ClipboardList },
    { id: 'cocina', label: 'Cocina', icon: MonitorPlay },
    { id: 'disponibilidad', label: 'Disponibilidad', icon: CircleOff },
  ]
  const locationName = locInfo?.locationName ?? 'Local'

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col">
      <header className="flex items-stretch h-[52px] bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2.5 px-4">
          <img src="/folvy-icon-192.png" alt="Folvy" className="h-7 w-7 rounded-lg" />
          <span className="text-sm font-semibold text-zinc-100">Folvy</span>
          <span className="text-sm text-zinc-400 border-l border-zinc-700 pl-2.5">{locationName}</span>
        </div>

        <nav className="flex-1 flex items-stretch justify-center gap-1">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-6 text-sm font-medium border-b-[3px] transition-colors ${
                  active
                    ? 'text-zinc-100 bg-zinc-800 border-emerald-400'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200'
                }`}
              >
                <Icon size={17} /> {label}
              </button>
            )
          })}
        </nav>

        <div className="flex items-center px-3">
          <button
            onClick={handleUnlink}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 px-2 py-1 rounded-md hover:bg-zinc-800"
            title="Desvincular esta tablet"
          >
            <LogOut size={14} /> Desvincular
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        {tab === 'cocina' && <KdsBoard locationId={null} token={token} />}

        {tab === 'disponibilidad' && (
          <TabletAvailabilityTab token={token} locationName={locationName} />
        )}

        {tab === 'pedidos' && (
          <div className="h-full grid place-items-center text-center text-zinc-600 px-6">
            <div>
              <ClipboardList size={40} className="mx-auto mb-3 text-zinc-700" />
              <p className="text-2xl font-semibold text-zinc-400">Pedidos</p>
              <p className="text-sm mt-1 max-w-sm">En camino. La próxima capa trae el feed de pedidos a esta tablet.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
