// src/components/InstallAppButton.tsx
//
// Botón "Instalar Folvy" para que el trabajador (o cualquier usuario) guarde la
// app en su móvil como icono, sin tener que buscar la opción en el menú del
// navegador. Pensado para el portal del trabajador (al que llega por QR).
//
// Comportamiento por plataforma:
//  · Android/Chrome: captura el evento beforeinstallprompt y, al pulsar, lanza
//    el prompt NATIVO de instalación. Es el caso de la mayoría de trabajadores.
//  · iPhone/Safari: iOS no permite prompt automático → mostramos instrucciones
//    cortas (Compartir → Añadir a pantalla de inicio).
//  · App ya instalada (modo standalone): no se muestra nada.

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isInStandaloneMode(): boolean {
  // Android/Chrome y iOS exponen el modo standalone de formas distintas.
  const mql = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return mql || iosStandalone
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

export default function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [showIosHelp, setShowIosHelp] = useState(false)

  useEffect(() => {
    if (isInStandaloneMode()) {
      setInstalled(true)
      return
    }

    // Android/Chrome: el navegador dispara este evento cuando la app es instalable.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault() // evitamos el mini-banner por defecto; usamos nuestro botón
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    // Cuando la instalación se completa.
    const onInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Ya instalada: no mostramos nada.
  if (installed) return null

  async function handleClick() {
    if (deferredPrompt) {
      // Android: lanzar el prompt nativo.
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setInstalled(true)
      }
      setDeferredPrompt(null)
    } else if (isIOS()) {
      // iOS: no hay prompt; mostramos instrucciones.
      setShowIosHelp(true)
    } else {
      // Otros navegadores sin soporte: instrucciones genéricas.
      setShowIosHelp(true)
    }
  }

  // En Android, si aún no llegó beforeinstallprompt y no es iOS, el botón puede
  // no hacer nada útil; lo mostramos igual porque en iOS sirve para las
  // instrucciones, y en Android el evento suele llegar en segundos.
  const canShow = deferredPrompt !== null || isIOS() || true

  if (!canShow) return null

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-terracota text-white hover:bg-terracota-hover transition-colors shadow-sm"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Instalar Folvy en este móvil
      </button>

      {showIosHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowIosHelp(false)}>
          <div className="bg-card rounded-xl w-full max-w-sm p-6 border border-border-default" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-text-primary mb-3">Instalar en tu móvil</h3>
            <p className="text-sm text-text-secondary mb-2">
              Para guardar Folvy como una app en tu pantalla de inicio:
            </p>
            <ol className="text-sm text-text-secondary space-y-2 list-decimal list-inside mb-4">
              <li>Pulsa el botón <strong>Compartir</strong> de tu navegador (el cuadrado con la flecha hacia arriba).</li>
              <li>Elige <strong>Añadir a pantalla de inicio</strong>.</li>
              <li>Confirma con <strong>Añadir</strong>.</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIosHelp(false)}
              className="w-full px-3 py-2 rounded-md text-sm font-medium bg-terracota text-white hover:bg-terracota-hover transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  )
}
