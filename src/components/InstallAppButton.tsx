// src/components/InstallAppButton.tsx
//
// Botón "Instalar Folvy" para que el trabajador (o cualquier usuario) guarde la
// app en su móvil como icono, sin tener que buscar la opción en el menú del
// navegador. Pensado para el portal del trabajador (al que llega por QR).
//
// Comportamiento por plataforma:
//  · Android/Chrome: usa el evento beforeinstallprompt y, al pulsar, lanza el
//    prompt NATIVO de instalación. Es el caso de la mayoría de trabajadores.
//  · iPhone/Safari: iOS no permite prompt automático → instrucciones cortas
//    (Compartir → Añadir a pantalla de inicio).
//  · App ya instalada (modo standalone): no se muestra nada.
//
// CLAVE (12/06/2026): el evento beforeinstallprompt lo captura main.tsx ANTES
// de montar React y lo guarda en window.__folvyInstallPrompt. Este botón lo LEE
// al montar (cubre el caso "el evento saltó antes que el botón") y además
// escucha el evento propio 'folvy:installable' (cubre el caso "salta después").
// Así nunca se pierde el prompt nativo → no caemos al modal por error.

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

function isAndroid(): boolean {
  return /android/i.test(window.navigator.userAgent)
}

export default function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  // Modal de instrucciones manuales: 'ios' | 'android' | null
  const [helpFor, setHelpFor] = useState<'ios' | 'android' | null>(null)

  useEffect(() => {
    if (isInStandaloneMode() || window.__folvyAppInstalled) {
      setInstalled(true)
      return
    }

    // 1) ¿Ya lo capturó main.tsx antes de que montásemos? Léelo de window.
    if (window.__folvyInstallPrompt) {
      setDeferredPrompt(window.__folvyInstallPrompt as BeforeInstallPromptEvent)
    }

    // 2) ¿Llega DESPUÉS de montar? main.tsx emite 'folvy:installable'.
    const onInstallable = () => {
      if (window.__folvyInstallPrompt) {
        setDeferredPrompt(window.__folvyInstallPrompt as BeforeInstallPromptEvent)
      }
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('folvy:installable', onInstallable)
    window.addEventListener('folvy:installed', onInstalled)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('folvy:installable', onInstallable)
      window.removeEventListener('folvy:installed', onInstalled)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Ya instalada: no mostramos nada.
  if (installed) return null

  async function handleClick() {
    if (deferredPrompt) {
      // Android/Chrome: lanzar el prompt nativo (un solo uso).
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setInstalled(true)
      }
      setDeferredPrompt(null)
      window.__folvyInstallPrompt = null
    } else if (isIOS()) {
      // iOS: no hay prompt nativo; instrucciones de Safari.
      setHelpFor('ios')
    } else {
      // Android sin prompt todavía (raro tras el fix), u otro navegador:
      // instrucciones del menú de Chrome en Android, NO las de iOS.
      setHelpFor(isAndroid() ? 'android' : 'android')
    }
  }

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

      {helpFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setHelpFor(null)}>
          <div className="bg-card rounded-xl w-full max-w-sm p-6 border border-border-default" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-text-primary mb-3">Instalar en tu móvil</h3>
            <p className="text-sm text-text-secondary mb-2">
              Para guardar Folvy como una app en tu pantalla de inicio:
            </p>

            {helpFor === 'ios' ? (
              <ol className="text-sm text-text-secondary space-y-2 list-decimal list-inside mb-4">
                <li>Pulsa el botón <strong>Compartir</strong> de Safari (el cuadrado con la flecha hacia arriba).</li>
                <li>Elige <strong>Añadir a pantalla de inicio</strong>.</li>
                <li>Confirma con <strong>Añadir</strong>.</li>
              </ol>
            ) : (
              <ol className="text-sm text-text-secondary space-y-2 list-decimal list-inside mb-4">
                <li>Abre el menú de Chrome: los <strong>tres puntos (⋮)</strong> arriba a la derecha.</li>
                <li>Pulsa <strong>Instalar aplicación</strong> (o <strong>Añadir a pantalla de inicio</strong>).</li>
                <li>Confirma con <strong>Instalar</strong>.</li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setHelpFor(null)}
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
