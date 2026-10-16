// src/modules/conta/marco/nuevo/preferencias.ts
//
// M01 · Lo que cada persona deja a su gusto en el marco: la densidad (Cómoda o
// Compacta), la barra de módulos plegada o desplegada, y el documento oculto o
// a la vista. Decisión de Julio (F01, respuesta 9): en el navegador, por
// usuario, sin tanda. Es una comodidad, no un dato: en otro ordenador empieza
// con lo de serie (compacta, plegada, documento a la vista).
//
// Núcleo puro: leer y guardar reciben el almacén, y sin almacén (navegación
// privada, cuota llena) todo funciona igual con lo de serie.

export type Densidad = 'compacta' | 'comoda'

export interface PreferenciasMarco {
  densidad: Densidad
  /** La barra de módulos desplegada (232 px) o plegada (76 px). */
  barraDesplegada: boolean
  /** El panel del documento, oculto (el formulario a todo el ancho). */
  documentoOculto: boolean
}

export const DE_SERIE: PreferenciasMarco = { densidad: 'compacta', barraDesplegada: false, documentoOculto: false }

export const clavePreferencias = (usuario: string): string => `folvy.conta.marco.${usuario}`

type Almacen = Pick<Storage, 'getItem' | 'setItem'>

/** Lo guardado, o lo de serie en lo que falte o no se entienda. */
export function leerPreferencias(usuario: string, almacen: Pick<Storage, 'getItem'> | null): PreferenciasMarco {
  let v: unknown
  try { v = JSON.parse(almacen?.getItem(clavePreferencias(usuario)) ?? 'null') } catch { v = null }
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    densidad: o.densidad === 'comoda' || o.densidad === 'compacta' ? o.densidad : DE_SERIE.densidad,
    barraDesplegada: typeof o.barraDesplegada === 'boolean' ? o.barraDesplegada : DE_SERIE.barraDesplegada,
    documentoOculto: typeof o.documentoOculto === 'boolean' ? o.documentoOculto : DE_SERIE.documentoOculto,
  }
}

/** Guarda un cambio y devuelve cómo queda. Sin almacén, vale para esta pantalla. */
export function guardarPreferencia(usuario: string, cambio: Partial<PreferenciasMarco>, almacen: Almacen | null): PreferenciasMarco {
  const nuevo = { ...leerPreferencias(usuario, almacen), ...cambio }
  try { almacen?.setItem(clavePreferencias(usuario), JSON.stringify(nuevo)) } catch { /* sin almacén: solo en esta pantalla */ }
  return nuevo
}

export const almacenDelNavegador = (): Storage | null => {
  try { return window.localStorage } catch { return null }
}
