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
import PaseBoard from '@/modules/pase/PaseBoard'
import { getLoQueEsLaTablet, type LoQueEsLaTablet } from '@/modules/pase/services/paseService'
import OrdersFeed from '../orders/components/OrdersFeed'
import { useNuevaVersion } from '@/shell/version/useNuevaVersion'
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

type Tab = 'pase' | 'pedidos' | 'cocina' | 'disponibilidad' | 'impresoras'

/** El reloj de la barra. Hora de Madrid, que es la del local (regla 4). */
function ElReloj() {
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="text-[15px] font-semibold text-zinc-300 tabular-nums">
      {ahora.toLocaleTimeString('es-ES', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
      })}
    </span>
  )
}

export default function TabletStationRoute() {
  // 01/09 — LA TABLET SE RECARGA SOLA. No tiene a nadie delante que pulse un
  // botón, así que un aviso aquí no sirve de nada: la de Cocina se quedó cinco
  // días en el mismo bundle porque nadie cerró la pestaña.
  //
  // Pero NUNCA en mitad de un pedido: `useNuevaVersion` pregunta cada 10 s si
  // hay trabajo en curso —lo declara OrdersFeed— y espera. No se rinde: cuando
  // la última comanda se cierra, recarga.
  // ⚠️ B74: el margen que hace inofensivo el hueco de `OrdersFeed` son estos
  // 10 s por defecto. Si se bajan, léela antes (declara 0 antes de saber).
  useNuevaVersion({ autoRecarga: true })

  const [token, setToken] = useState<string | null>(null)
  const [pasteValue, setPasteValue] = useState('')
  const [tab, setTab] = useState<Tab>('pedidos')

  /**
   * QUÉ ES ESTA TABLET · `null` = todavía no se sabe, y eso NO es «como hoy
   * por defecto»: es que no se ha preguntado. Mientras tanto se enseña lo de
   * hoy, que es la única respuesta que no puede sorprender a nadie.
   *
   * (Regla 32, del mismo día: un valor que significa «no lo sé» no comparte
   * representación con uno medido. Ver B74.)
   */
  const [loQueEs, setLoQueEs] = useState<LoQueEsLaTablet | null>(null)

  // fix/tablet-robustez (12/08): valida con device_location_by_token (~16ms,
  // no kds_board ~1-2s) con reintento infinito ante red/lentitud — solo un
  // rechazo EXPLÍCITO del servidor desvincula y pide vincular de nuevo.
  const validation = useDeviceTokenValidation(token, () => { clearToken(); unpairDevice(); setToken(null) })

  // Tarea E.2: aviso visible cuando una comanda/ticket agota sus 3 intentos
  // de impresión — antes se perdía muda hasta que el cliente reclamaba.
  const [printFailure, setPrintFailure] = useState<PrintExhaustedInfo | null>(null)
  // ── Qué es esta tablet · UNA pregunta al arrancar, no en cada sondeo ──────
  //
  // El reparto de pestañas no cambia durante un servicio; las tarjetas sí.
  //
  // 🔴 VA AQUÍ ARRIBA, con los demás hooks, y no junto al código que lo usa:
  // más abajo hay DOS retornos tempranos --la pantalla de vincular y la de
  // validando-- y un hook después de un return se llama condicionalmente. Lo
  // puse ahí primero y lo cazó `react-hooks/rules-of-hooks`.
  useEffect(() => {
    if (!token) return
    let vivo = true
    void getLoQueEsLaTablet(token)
      .then(r => { if (vivo) setLoQueEs(r) })
      .catch(() => { /* se queda en null: se enseña lo de hoy */ })
    return () => { vivo = false }
  }, [token])

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
  //
  // 🔴 EL REPARTO LO DECIDE EL TIPO DE LA ESTACIÓN (`kitchen_station.kind`),
  // no la etiqueta de la tablet. Y sólo cuando el interruptor del local está
  // encendido: con `pase_activo` en false, esto es EXACTAMENTE lo de hoy.
  //
  //     estación expo  → Pase, sin tablero de cocina
  //     estación prep  → tablero de cocina, sin Pase
  //     sin estación   → las dos (camichi4, en Carabanchel)
  //
  // «Pedidos» SE QUEDA EN LAS TRES (15/09/2026, corrección de Julio). Estuvo
  // media jornada quitada de la tablet del pase, y era un error mío de
  // planteamiento: la razón de quitarla nunca fue quitar información, fue que
  // el «Listo» no estuviera en dos sitios. La pregunta buena no era «qué hacéis
  // en Pedidos» sino «qué pasa cuando esto falle»: si el Pase se cuelga, la
  // persona del pase tiene que poder seguir trabajando con la pantalla de
  // siempre --pedidos, teléfonos, tiempos-- sin llamar a nadie.
  //
  // Así que con el Pase encendido la pestaña sigue, entera, y lo ÚNICO que le
  // falta es el botón: `sinMarcarListo`. Un sitio para pulsar, dos para mirar.
  //
  // Impresoras se queda en las TRES: es donde se arregla la impresora, y es
  // justo la que tiene que dejar de fallar en silencio.
  const hayPase = loQueEs?.pase_activo === true && loQueEs.papel !== 'cocina'
  const hayCocina = !loQueEs?.pase_activo || loQueEs.papel !== 'pase'

  const tabs: { id: Tab; label: string; icon: typeof ClipboardList }[] = [
    ...(hayPase ? [{ id: 'pase' as Tab, label: 'Pase', icon: ClipboardList }] : []),
    { id: 'pedidos', label: 'Pedidos', icon: ClipboardList },
    ...(hayCocina ? [{ id: 'cocina' as Tab, label: 'Cocina', icon: MonitorPlay }] : []),
    { id: 'disponibilidad', label: 'Disponibilidad', icon: CircleOff },
    { id: 'impresoras', label: 'Impresoras', icon: PrinterIcon },
  ]

  // Si la pestaña abierta deja de existir --el interruptor se apaga mientras
  // se mira-- se cae a la primera, que siempre existe. Sin esto la pantalla se
  // queda en blanco sin decir por qué.
  const tabValida = tabs.some(t => t.id === tab)
  const tabActual: Tab = tabValida ? tab : tabs[0].id
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
            const active = tabActual === id
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

        {/* LA HORA · la pedía la maqueta del Pase y no estaba en ningún sitio.
            En una cocina el reloj de pared queda detrás y las manos están
            ocupadas: si la pantalla dice «hace 21 min» sin decir de cuándo, no
            hay con qué contrastarlo. Se refresca cada 30 s --no cada segundo--
            porque no hay segundero que enseñar y cada tic es un render. */}
        <div className="flex items-center px-3">
          <ElReloj />
        </div>

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
        {tabActual === 'pase' && (
          <PaseBoard
            token={token}
            /* Al apagar desde la tablet no se recarga la página --hay comandas
               vivas y una recarga en servicio es justo lo que llevamos un mes
               evitando--: se sabe el valor nuevo, porque lo confirmó la propia
               escritura, así que se aplica aquí y la pestaña «Pase» desaparece
               sola. `tabActual` cae a la primera, que es «Pedidos». */
            onApagado={() => setLoQueEs(prev => prev && { ...prev, pase_activo: false })}
          />
        )}

        {tabActual === 'cocina' && <KdsBoard locationId={null} token={token} />}

        {tabActual === 'disponibilidad' && (
          <TabletAvailabilityTab token={token} locationName={locationName} />
        )}

        {/* PEDIDOS SE QUEDA MONTADO, SOLO SE ESCONDE (11/09/2026).
            ⚠️ B74: y que no desmonte es lo que hoy tapa que declare 0 antes de
            tener respuesta. Si algún día desmonta, léela antes.
            `OrdersFeed` es quien declara si hay trabajo en curso, y de eso
            depende que la tablet NO se recargue en mitad de un servicio. Si se
            desmontaba al cambiar de pestaña, su `declaraTrabajoEnCurso(clave, 0)`
            de limpieza dejaba la estación diciendo «no hay nada» — y una tablet
            aparcada en Disponibilidad, que es justo donde se agotan los extras,
            se recargaba sola con comandas vivas. */}
        <div className={`h-full overflow-y-auto p-4 bg-page${tabActual === 'pedidos' ? '' : ' hidden'}`}>
          {hayPase && (
            // Regla 8, un piso más abajo: si un botón desaparece y nadie dice
            // por qué, quien lo busca concluye que la pantalla está rota.
            <div className="max-w-5xl mx-auto mb-3 rounded-xl border border-default bg-card
                            px-3.5 py-2.5 text-[13px] leading-snug text-text-secondary">
              <b className="text-text-primary">El «Listo» se pulsa en la pestaña Pase.</b>{' '}
              Aquí está todo el pedido —teléfonos, tiempos, líneas— y se puede
              aceptar, cerrar y reimprimir. Lo único que no se marca aquí es listo.
            </div>
          )}
          <OrdersFeed locationId={locInfo?.locationId ?? ''} token={token} sinMarcarListo={hayPase} />
        </div>

        {tabActual === 'impresoras' && (
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
