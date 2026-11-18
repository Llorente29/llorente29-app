// src/modules/conta/diseno/plantillas/avisoSalir.ts
//
// Salir con cambios sin guardar AVISA (encargo «Ficha de la recibida
// completa», punto 2). Tres puertas, porque son tres salidas distintas:
//
//   1. Cerrar o recargar la pestaña: el aviso del navegador (beforeunload).
//      El texto lo pone el navegador; no se puede cambiar.
//   2. Un enlace de la app (el menú, las migas, la cinta…): se intercepta el
//      clic en fase de CAPTURA, antes de que react-router lo procese, y sale
//      «¿Salir sin guardar?». NO se usa useBlocker: la app monta
//      <BrowserRouter> y no un data router, y ahí useBlocker LANZA (el mismo
//      cuidado que kitchen/pages/PriceGridPage.tsx). Lo que navega con un
//      botón y navigate() en vez de un enlace no pasa por aquí: para eso, la 3.
//   3. Lo que la ficha hace por su cuenta (‹ › a otra factura, Esc, «Volver»):
//      la ficha llama a `pedirSalir(accion)`. Sin cambios, la acción va
//      directa; con cambios, sale el aviso y la acción espera a que se elija.
//
// Decisión (documentada en el encargo): un HOOK, porque `pedirSalir` tiene que
// llegar a los manejadores de la ficha. Devuelve también `aviso`, el diálogo
// ya montado, que la ficha pinta donde quiera. <AvisoSalir> (en
// CambiosSinGuardar.tsx) es el mismo hook envuelto en un componente, para la
// ficha que solo quiere las puertas 1 y 2 (o que prefiere un ref).
//
// K03 · Dentro del marco del núcleo, ir a otra pestaña NO es salir: la
// pantalla se queda viva con lo escrito. Así que ahí la puerta 2 solo
// pregunta por un enlace de la pestaña que se ve y que se abriría en ESTA
// misma pestaña (la pantalla se iría); y lo que hay sin guardar se apunta en
// la pestaña (pestana.ts), para que su aspa pregunte antes de cerrar y la
// pestaña lo enseñe sin abrirla. La 1 (recargar) protege a todas, se vean o
// no. Fuera del núcleo, como siempre.

import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { DialogoSalir } from './DialogoSalir'
import { usePestana } from './pestana'
import type { CambioCampo, ResultadoGuardar } from './cambios'

export interface OpcionesAvisoSalir {
  hay: boolean
  cambios: readonly CambioCampo[]
  /** «COHELDI P26 4.980»: el aviso dice dónde se cambió. */
  donde?: string
  /** Guarda. true si guardó; false o el motivo si no (y entonces no se sale). */
  onGuardar: () => Promise<ResultadoGuardar> | ResultadoGuardar
  /** Lo que se hace con los cambios al «Salir sin guardar» (normalmente, descartar) antes de salir. */
  onDescartar?: () => void
}

export interface AvisoSalirControl {
  /** Hacer `accion` si no hay cambios; si los hay, preguntar antes. */
  pedirSalir: (accion: () => void) => void
}

/** Si un clic va a un enlace interno a otra página, su destino; si no, null. */
export function destinoDelClic(ev: MouseEvent): string | null {
  if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return null
  const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return null
  const href = a.getAttribute('href')
  if (!href || href.startsWith('#')) return null
  let url: URL
  try { url = new URL(a.href, window.location.href) } catch { return null }
  if (url.origin !== window.location.origin) return null
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null
  return url.pathname + url.search + url.hash
}

export function useAvisoSalir({ hay, cambios, donde, onGuardar, onDescartar }: OpcionesAvisoSalir): AvisoSalirControl & { aviso: ReactNode } {
  const navigate = useNavigate()
  // La acción que espera a que se elija; null si no hay aviso abierto.
  const [pendiente, setPendiente] = useState<{ accion: () => void } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const hayRef = useRef(hay)
  useEffect(() => { hayRef.current = hay }, [hay])
  const pestana = usePestana()
  const activa = pestana ? pestana.activa : true
  const esDeEstaPestana = pestana?.esDeEstaPestana
  // K03 · Lo que hay sin guardar, en la pestaña (las funciones del último render, nunca viejas).
  const ultimo = useRef({ cambios, donde, onGuardar, onDescartar })
  useEffect(() => { ultimo.current = { cambios, donde, onGuardar, onDescartar } })
  const ponerCambios = pestana?.ponerCambios
  const claveCambios = hay ? `${donde ?? ''}|${cambios.length}` : ''
  useEffect(() => {
    if (!ponerCambios) return
    if (!claveCambios) { ponerCambios(null); return }
    ponerCambios({
      cambios: ultimo.current.cambios, donde: ultimo.current.donde,
      onGuardar: () => ultimo.current.onGuardar(), onDescartar: () => ultimo.current.onDescartar?.(),
    })
    return () => ponerCambios(null)
  }, [ponerCambios, claveCambios])

  useEffect(() => {
    if (!hay) return
    const antesDeIrse = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    const alClic = (ev: MouseEvent) => {
      const destino = destinoDelClic(ev)
      if (!destino) return
      // K03 · En el núcleo: solo la pestaña que se ve, y solo si el destino la sustituye.
      if (!activa || (esDeEstaPestana && !esDeEstaPestana(destino))) return
      ev.preventDefault(); ev.stopPropagation()
      setFallo(null)
      setPendiente({ accion: () => navigate(destino) })
    }
    window.addEventListener('beforeunload', antesDeIrse)
    document.addEventListener('click', alClic, true)
    return () => {
      window.removeEventListener('beforeunload', antesDeIrse)
      document.removeEventListener('click', alClic, true)
    }
  }, [hay, navigate, activa, esDeEstaPestana])

  const pedirSalir = useCallback((accion: () => void) => {
    if (!hayRef.current) { accion(); return }
    setFallo(null)
    setPendiente({ accion })
  }, [])

  const salir = () => {
    const p = pendiente
    setPendiente(null)
    onDescartar?.()
    p?.accion()
  }
  const guardarYSalir = async () => {
    const p = pendiente
    setGuardando(true); setFallo(null)
    let r: ResultadoGuardar
    try { r = await onGuardar() } catch (e) { r = e instanceof Error ? e.message : String(e) }
    setGuardando(false)
    if (r === true) { setPendiente(null); p?.accion(); return }
    setFallo(typeof r === 'string' && r ? r : 'no se ha podido guardar')
  }

  const aviso = pendiente && cambios.length > 0
    ? createElement(DialogoSalir, {
      cambios, donde, guardando, fallo,
      alSalir: salir, alSeguir: () => { setPendiente(null); setFallo(null) }, alGuardar: () => { void guardarYSalir() },
    })
    : null
  return { pedirSalir, aviso }
}
