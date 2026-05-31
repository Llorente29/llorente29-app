// src/shell/useIsMobile.ts
//
// R1.1 — Hook de detección de viewport móvil para el Shell responsive.
//
// Devuelve true cuando el ancho del viewport está por debajo del breakpoint
// `md` de Tailwind (768px): el rango móvil/tablet-estrecho (390–767px) donde
// el layout de escritorio no cabe. Por encima de 768px devuelve false y el
// Shell renderiza el layout de escritorio aprobado en Sesión 14 sin cambios.
//
// Única fuente de verdad del breakpoint: TopBar y Shell la comparten, así no
// hay deriva entre el JS y las clases `md:` de Tailwind. El query usa 767.98px
// para alinearse al pixel con el borde `md` de Tailwind y evitar el hueco
// fraccionario en 768px.
//
// Implementación con useSyncExternalStore + matchMedia (patrón React 19 para
// suscribirse a una fuente externa): evita "tearing" y solo re-renderiza al
// cruzar el umbral, no en cada píxel de resize.

import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(max-width: 767.98px)'

function getMql(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }
  return window.matchMedia(MOBILE_QUERY)
}

function subscribe(onChange: () => void): () => void {
  const mql = getMql()
  if (!mql) return () => {}
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  const mql = getMql()
  return mql ? mql.matches : false
}

// SSR / sin window: asumimos escritorio (false). El proyecto es SPA (Vite),
// pero useSyncExternalStore exige este tercer argumento.
function getServerSnapshot(): boolean {
  return false
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
