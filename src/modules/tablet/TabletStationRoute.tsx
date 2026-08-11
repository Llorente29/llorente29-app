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
import { ClipboardList, MonitorPlay, CircleOff, Printer as PrinterIcon, Loader2, LogOut } from 'lucide-react'
import KdsBoard from '../kds/components/KdsBoard'
import KdsAlarmOverlay from '../kds/components/KdsAlarmOverlay'
import AvailabilityNoticeOverlay from '../kds/components/AvailabilityNoticeOverlay'
import TabletAvailabilityTab from './TabletAvailabilityTab'
import OrdersFeed from '../orders/components/OrdersFeed'
import PrintersSettingsPage from '../printing/components/PrintersSettingsPage'
import QrScanButton from '../printing/components/QrScanButton'
import { extractToken } from '../printing/pairingUtils'
import { pairEstacion, unpairDevice, onPrintJobExhausted, type PrintExhaustedInfo } from '../../native/print/printWorker'
import { useDeviceTokenValidation, tokenValidationMessage } from './hooks/useDeviceTokenValidation'

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

type Tab = 'pedidos' | 'cocina' | 'disponibilidad' | 'impresoras'

export default function TabletStationRoute() {
  const [token, setToken] = useState<string | null>(null)
  const [pasteValue, setPasteValue] = useState('')
  const [tab, setTab] = useState<Tab>('pedidos')

  // fix/tablet-robustez (12/08): valida con device_location_by_token (~16ms,
  // no kds_board ~1-2s) con reintento infinito ante red/lentitud — solo un
  // rechazo EXPLÍCITO del servidor desvincula y pide vincular de nuevo.
  const validation = useDeviceTokenValidation(token, () => { clearToken(); unpairDevice(); setToken(null) })

  // Tarea E.2: aviso visible cuando una comanda/ticket agota sus 3 intentos
  // de impresión — antes se perdía muda hasta que el cliente reclamaba.
  const [printFailure, setPrintFailure] = useState<PrintExhaustedInfo | null>(null)
  useEffect(() => onPrintJobExhausted(setPrintFailure), [])

  // Resolución inicial del token: ?token= en la URL o localStorage.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('token')
    if (fromUrl) {
      storeToken(fromUrl)
      window.history.replaceState({}, '', '/estacion')
      setToken(fromUrl)
      // Vincula también el worker de impresión y fija modo=estacion (sin consola).
      pairEstacion(fromUrl)
      return
    }
    setToken(readStoredToken())
  }, [])

  // Manifest de ESTACIÓN: mientras esta ruta está montada, apuntamos el
  // <link rel="manifest"> a /manifest-estacion.json (start_url=/estacion), para
  // que "Añadir a inicio" cree un icono que abre la estación, no la raíz con
  // login. Al desmontar (volver a la app normal) restauramos el manifest global.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!link) return
    const original = link.getAttribute('href')
    link.setAttribute('href', '/manifest-estacion.json')
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const originalTheme = themeMeta?.getAttribute('content') ?? null
    themeMeta?.setAttribute('content', '#0e1820')
    return () => {
      if (original) link.setAttribute('href', original)
      if (themeMeta && originalTheme) themeMeta.setAttribute('content', originalTheme)
    }
  }, [])

  // Vincula la tablet: guarda el token (de un pegado o de un QR), arranca el
  // worker de impresión y fija el modo del dispositivo = estacion.
  function linkWith(rawTokenOrUrl: string) {
    const t = extractToken(rawTokenOrUrl)
    if (!t) return
    storeToken(t)
    setToken(t)
    setPasteValue('')
    pairEstacion(t)
  }

  function handleLink() {
    linkWith(pasteValue)
  }

  function handleUnlink() {
    clearToken()
    unpairDevice()      // para el worker y borra token(s) + modo del dispositivo
    setToken(null)
  }

  // ── Pantalla de vinculación — SOLO ante rechazo explícito, nunca por red/lentitud ──
  if (!token || validation.kind === 'rejected') {
    const rejectedMessage = validation.kind === 'rejected' ? validation.message : null
    return (
      <div className="fixed inset-0 bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <img src="/folvy-icon-192.png" alt="Folvy" className="h-14 w-14 mx-auto mb-3 rounded-2xl" />
          <p className="text-xl font-bold text-zinc-100 mb-4">Folvy</p>
          <h1 className="text-2xl font-bold">Vincular esta tablet</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Escanea el <strong>QR de la estación</strong> (Ajustes de cocina → Dispositivos → QR) o
            pega el token del dispositivo. Al vincular, esta tablet queda como estación e imprime sola.
          </p>
          {rejectedMessage && (
            <div className="mt-4 rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 px-3 py-2 text-sm">
              {rejectedMessage}
            </div>
          )}
          <div className="mt-6 flex flex-col gap-2">
            <QrScanButton onToken={linkWith} className="w-full" />
            <div className="flex items-center gap-3 my-1 text-xs text-zinc-600">
              <span className="flex-1 h-px bg-zinc-800" /> o pega el token <span className="flex-1 h-px bg-zinc-800" />
            </div>
            <input
              value={pasteValue}
              onChange={e => setPasteValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleLink() }}
              placeholder="kdsdev_…"
              className="w-full rounded-lg bg-zinc-900 ring-1 ring-zinc-700 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-400"
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

  // ── Validando (Tarea C): red/lentitud NUNCA piden vincular, reintentan solos ──
  if (validation.kind === 'idle' || validation.kind === 'trying') {
    const msg = tokenValidationMessage(validation) ?? 'Conectando con Folvy…'
    return (
      <div className="fixed inset-0 bg-zinc-950 text-zinc-400 flex flex-col items-center justify-center gap-2 text-center px-6">
        <Loader2 className="animate-spin" size={20} />
        <span>{msg}</span>
        {validation.kind === 'trying' && validation.attempt > 0 && (
          <span className="text-xs text-zinc-600">Intento {validation.attempt}</span>
        )}
      </div>
    )
  }

  // ── Terminal con barra de pestañas ────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: typeof ClipboardList }[] = [
    { id: 'pedidos', label: 'Pedidos', icon: ClipboardList },
    { id: 'cocina', label: 'Cocina', icon: MonitorPlay },
    { id: 'disponibilidad', label: 'Disponibilidad', icon: CircleOff },
    { id: 'impresoras', label: 'Impresoras', icon: PrinterIcon },
  ]
  const locInfo = validation.kind === 'valid' ? validation.info : null
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

      {printFailure && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-red-500/15 text-red-200 ring-1 ring-red-500/40 text-sm shrink-0">
          <span>
            No se pudo imprimir ({printFailure.docType} · {printFailure.printerName}) tras 3 intentos. {printFailure.error}
          </span>
          <button onClick={() => setPrintFailure(null)} className="shrink-0 underline text-xs">cerrar</button>
        </div>
      )}

      {/* Alarma de reparto: banner+sonido a nivel de ruta → visible en CUALQUIER pestaña. */}
      <KdsAlarmOverlay locationId={locInfo?.locationId ?? null} token={token} />
      {/* Aviso multi-integrador: recuerda desconectar en Last/Otter tras un 86. */}
      <AvailabilityNoticeOverlay locationId={locInfo?.locationId ?? null} token={token} />

      <main className="flex-1 min-h-0">
        {tab === 'cocina' && <KdsBoard locationId={null} token={token} />}

        {tab === 'disponibilidad' && (
          <TabletAvailabilityTab token={token} locationName={locationName} />
        )}

        {tab === 'pedidos' && (
          <div className="h-full overflow-y-auto p-4 bg-page">
            <OrdersFeed locationId={locInfo?.locationId ?? ''} token={token} />
          </div>
        )}

        {tab === 'impresoras' && (
          <div className="h-full overflow-y-auto p-4 bg-page">
            <div className="max-w-2xl mx-auto">
              <PrintersSettingsPage token={token} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
