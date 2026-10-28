// src/modules/personal/laboral/productoLaboral.ts
//
// LS1 (28/10/2026). Las pantallas de Personal valen para los dos productos:
// en Folvy › Personal, como siempre; dentro de Sumied › Laboral, con su
// vocabulario («centro», no «local») y sin nada de hostelería (ni ventas, ni
// cocina, ni demanda por platos, ni el semáforo de manipular alimentos).
//
// Fuera de Sumied no hay proveedor: el valor por defecto es Folvy, y Folvy
// sigue exactamente igual.

import { createContext, createElement, useContext, type ReactNode } from 'react'

export interface ProductoLaboral {
  /** Estamos dentro de Sumied › Laboral. */
  sumied: boolean
  /** Se enseña lo de hostelería (ventas, cocina, demanda, alimentos). */
  hosteleria: boolean
  /** «local» / «centro», y sus formas. */
  local: string
  locales: string
  Local: string
  Locales: string
  /** «el local» / «el centro». */
  elLocal: string
  /** «del local» / «del centro». */
  delLocal: string
  /** Dónde viven las pantallas: `/personal` en Folvy, `/conta/laboral` en Sumied. */
  base: string
  /** «Folvy» / «Sumied», donde la pantalla nombra al producto. */
  marca: string
}

export const FOLVY: ProductoLaboral = {
  sumied: false, hosteleria: true, local: 'local', locales: 'locales', Local: 'Local', Locales: 'Locales',
  elLocal: 'el local', delLocal: 'del local', base: '/personal', marca: 'Folvy',
}

export const SUMIED: ProductoLaboral = {
  sumied: true, hosteleria: false, local: 'centro', locales: 'centros', Local: 'Centro', Locales: 'Centros',
  elLocal: 'el centro', delLocal: 'del centro', base: '/conta/laboral', marca: 'Sumied',
}

const Contexto = createContext<ProductoLaboral>(FOLVY)

/** El producto en el que se está viendo la pantalla (Folvy si nadie dice otra cosa). */
export function useProductoLaboral(): ProductoLaboral {
  return useContext(Contexto)
}

/** Envuelve una pantalla de Personal para enseñarla dentro de Sumied. */
export function conProductoLaboral(valor: ProductoLaboral, hijos: ReactNode) {
  return createElement(Contexto.Provider, { value: valor }, hijos)
}

/**
 * Cambia «local» por «centro» (y sus formas) en un texto ya escrito, para los
 * mensajes que se arman en un servicio y no en la pantalla. Respeta mayúsculas.
 */
export function enVocabulario(texto: string, p: ProductoLaboral): string {
  if (!p.sumied) return texto
  return texto
    .replace(/\bLocales\b/g, p.Locales).replace(/\blocales\b/g, p.locales)
    .replace(/\bLocal\b/g, p.Local).replace(/\blocal\b/g, p.local)
}
