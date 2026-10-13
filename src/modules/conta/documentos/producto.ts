// src/modules/conta/documentos/producto.ts
//
// D01 · ¿Se enseña Documentos dentro de Folvy o como producto vendido solo?
// PUENTE hasta que se fusione la C06 (rama conta/c06-sola): allí la respuesta es
// useProductoSolo() y el nombre, MARCA.nombre (src/modules/conta/cuenta/). Este
// fichero decide lo mismo y por los mismos caminos para no esperar a la fusión,
// y se borra el día que entre: se cambia su import por los de C y nada más.
//
//   · Solo si la cuenta tiene marca (accounts.product_brand, la columna de la
//     C06; llega con la fila de la cuenta que ya carga la plataforma), o si se
//     entra con ?marca=contabilidad fuera de producción (recordado en la sesión
//     del navegador con la misma clave que C, «producto.marca»).
//   · Solo: ni Cocina ni la palabra «Folvy». La pantalla habla en primera
//     persona («lo he apuntado yo»), como la maqueta, y sin nombre de producto.

import { useFeatureGate } from '@/platform/feature-gate/useFeatureGate'

const CLAVE_SESION = 'producto.marca'
const esProduccion = (h: string) => h === 'folvy.app' || h.endsWith('.folvy.app')

/** ¿Pide la pestaña la marca de contabilidad? Pura salvo por lo que lee del navegador. */
export function marcaDeLaPestana(host: string, buscar: string, recordada: string | null): string | null {
  if (esProduccion(host.toLowerCase())) return null
  const pedida = new URLSearchParams(buscar).get('marca')
  if (pedida !== null) return pedida === 'folvy' ? null : pedida
  return recordada && recordada !== 'folvy' ? recordada : null
}

function leerMarca(): string | null {
  if (typeof window === 'undefined') return null
  let recordada: string | null = null
  try { recordada = window.sessionStorage.getItem(CLAVE_SESION) } catch { /* sin almacenamiento */ }
  return marcaDeLaPestana(window.location.hostname, window.location.search, recordada)
}

/** La cuenta es solo de contabilidad (C06): tiene marca. */
export const esCuentaConMarca = (fila: unknown): boolean => {
  const m = (fila as { product_brand?: unknown } | null)?.product_brand
  return typeof m === 'string' && m !== ''
}

export interface Producto {
  /** Vendido solo: sin Cocina y sin «Folvy». */
  solo: boolean
  /** El nombre del producto para escribirlo en la pantalla, o null si no se escribe. */
  nombre: string | null
}

export function useProducto(): Producto {
  const { account } = useFeatureGate()
  const solo = esCuentaConMarca(account) || leerMarca() !== null
  return { solo, nombre: solo ? null : 'Folvy' }
}
