// src/modules/integrations/lib/estadoConexion.ts
//
// B01r26 (15/11) · Lo que se enseña de cada estado de una conexión, y lo que se
// manda al volver a guardar sus credenciales. Sin React: se prueba solo.
//
// Por qué existe: la renovación fallida del token de Diez dejó la conexión de
// Foodint en `down` (connector_mark_down), un estado que la pantalla no conocía.
// `STATUS_PRESENTATION[conn.status]` daba undefined y la página entera se rompía
// («Cannot read properties of undefined (reading 'icon')»), justo la página desde
// la que se levanta la conexión. Ahora cualquier estado tiene presentación: los
// que se conocen, la suya; uno que no, «Estado desconocido» con su nombre.

import type { AccountConnectorStatus, ConnectorConfigField } from '@/types/integrations'

export type Tono = 'neutro' | 'aviso' | 'bien' | 'mal'
export type IconoEstado = 'enchufe' | 'reloj' | 'cargando' | 'bien' | 'alerta' | 'pausa' | 'caida' | 'duda'

export interface PresentacionEstado {
  etiqueta: string
  tono: Tono
  icono: IconoEstado
  /** Rota: hay que hacer algo para que vuelva (volver a guardar las credenciales). */
  rota: boolean
  /** El estado no está entre los que esta pantalla conoce. */
  desconocido: boolean
}

const CONOCIDOS: Record<AccountConnectorStatus, Omit<PresentacionEstado, 'desconocido'>> = {
  available:  { etiqueta: 'Disponible',        tono: 'neutro', icono: 'enchufe',  rota: false },
  requested:  { etiqueta: 'Solicitada',        tono: 'aviso',  icono: 'reloj',    rota: false },
  connecting: { etiqueta: 'Conectando…',       tono: 'aviso',  icono: 'cargando', rota: false },
  connected:  { etiqueta: 'Conectada',         tono: 'bien',   icono: 'bien',     rota: false },
  paused:     { etiqueta: 'En pausa',          tono: 'neutro', icono: 'pausa',    rota: false },
  error:      { etiqueta: 'Error de conexión', tono: 'mal',    icono: 'alerta',   rota: true },
  // La renovación del token falló y Folvy dejó de usarla (connector_mark_down).
  down:       { etiqueta: 'Caída',             tono: 'mal',    icono: 'caida',    rota: true },
}

export function presentacionDeEstado(estado: string | null | undefined): PresentacionEstado {
  const k = String(estado ?? '')
  if (Object.prototype.hasOwnProperty.call(CONOCIDOS, k)) return { ...CONOCIDOS[k as AccountConnectorStatus], desconocido: false }
  // Un estado nuevo en la base no rompe la página: se dice cuál es.
  return { etiqueta: k ? `Estado desconocido (${k})` : 'Estado desconocido', tono: 'aviso', icono: 'duda', rota: false, desconocido: true }
}

/**
 * Los secretos que se mandan al guardar. `connector_secret_save` REEMPLAZA el
 * secreto entero con lo que recibe: guardar con los campos en blanco dejaba las
 * credenciales en `{}`, y guardar solo uno borraba los demás. Por eso, si el
 * conector tiene secretos, van todos o no se guarda.
 */
export function secretosParaGuardar(
  campos: ConnectorConfigField[],
  valores: Record<string, string>,
  yaHayCredenciales: boolean,
): { ok: true; secretos: Record<string, string> } | { ok: false; motivo: string } {
  const secretos = campos.filter((f) => f.type === 'secret')
  const escritos: Record<string, string> = {}
  for (const f of secretos) {
    const v = valores[f.key]?.trim()
    if (v) escritos[f.key] = v
  }
  const faltan = secretos.filter((f) => !escritos[f.key])
  if (secretos.length === 0 || faltan.length === 0) return { ok: true, secretos: escritos }
  if (yaHayCredenciales && faltan.length === secretos.length) {
    return { ok: false, motivo: `Para guardar, escribe otra vez ${listaDe(secretos)}: lo que se guarda sustituye a lo que hay, y en blanco se borrarían.` }
  }
  return { ok: false, motivo: `Falta${faltan.length > 1 ? 'n' : ''} ${listaDe(faltan)}: se guardan todas a la vez, y lo que no se escribe se borra.` }
}

/** La configuración que se manda: la que hay, con los campos del formulario encima (no se pierde la que no sale en él). */
export function configParaGuardar(
  actual: Record<string, unknown> | null | undefined,
  delFormulario: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(actual ?? {}), ...delFormulario }
}

const listaDe = (fs: ConnectorConfigField[]) => {
  const n = fs.map((f) => `«${f.label}»`)
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`
}
