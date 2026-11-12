// supabase/functions/conta-bitrix-pestana/campo.ts
//
// GBc · PRUEBA de un campo fijo en la ficha de empresa de Bitrix24, SOLO en el
// Bitrix24 de pruebas (PORTAL_DE_PRUEBAS). La aplicación de la pestaña registra
// su propio tipo de campo (userfieldtype.add) y crea con él «Cuota mensual
// (Sumied)» (crm.company.userfield.add). Bitrix24 dibuja ese campo con una página
// de Sumied (bitrix-campo.html), que no deja escribir: solo enseña el importe y
// «Cambiar en Sumied». En cualquier otro portal no se registra ni se crea nada.
//
// Sin Deno ni red: la llamada a Bitrix24 llega de fuera (la prueban las unitarias).

import { PORTAL_DE_PRUEBAS } from './puro.ts'

export const CAMPO_FIJO = {
  /** El código corto del tipo (userfieldtype.add lo pasa a minúsculas). */
  tipo: 'sumied_fijo',
  titulo: 'Sumied',
  descripcion: 'Un dato que pone Sumied: se ve, y se cambia en Sumied.',
  /** El campo de la empresa, sin el «UF_CRM_» de delante. */
  campo: 'SUMIED_CUOTA',
  etiqueta: 'Cuota mensual (Sumied)',
  /** El alto del recuadro: una línea, como los campos de Bitrix24 de alrededor. */
  alto: 36,
} as const

export const NOMBRE_DEL_CAMPO = `UF_CRM_${CAMPO_FIJO.campo}`

/** Solo en el Bitrix24 de pruebas: en cualquier otro portal no se registra ni se crea nada. */
export const campoFijoEnEstePortal = (portal: string | null) => portal === PORTAL_DE_PRUEBAS

type Llamar = (metodo: string, cuerpo: Record<string, unknown>) => Promise<unknown>
type Respuesta = { result?: unknown; error?: string; error_description?: string } | null

const yaEstaba = (r: Respuesta) => /already/i.test(String(r?.error_description ?? '')) || /ALREADY/i.test(String(r?.error ?? ''))
const porque = (r: Respuesta) => String(r?.error_description ?? r?.error ?? 'sin respuesta').slice(0, 80)

/**
 * Al instalar (con el token del administrador): el tipo «Sumied» y el campo
 * «Cuota mensual (Sumied)» en la ficha de empresa. «Ya estaba» vale. Devuelve
 * los fallos, en frases. En otro portal, ninguna llamada.
 */
export async function registrarCampoFijo(portal: string | null, aqui: string, llamar: Llamar): Promise<string[]> {
  if (!campoFijoEnEstePortal(portal)) return []
  const fallos: string[] = []
  const tipo = {
    USER_TYPE_ID: CAMPO_FIJO.tipo, HANDLER: `${aqui}?paso=campo`, TITLE: CAMPO_FIJO.titulo,
    DESCRIPTION: CAMPO_FIJO.descripcion, OPTIONS: { height: CAMPO_FIJO.alto },
  }
  const t = await llamar('userfieldtype.add', tipo) as Respuesta
  if (!t?.result) {
    // Ya registrado: se deja con la dirección y el alto de ahora.
    const u = yaEstaba(t) ? await llamar('userfieldtype.update', tipo) as Respuesta : null
    if (!u?.result && !yaEstaba(t)) fallos.push(`tipo de campo: ${porque(t)}`)
  }
  const app = await llamar('app.info', {}) as { result?: { ID?: unknown } } | null
  const appId = app?.result?.ID
  if (appId === undefined || appId === null || !/^[0-9]+$/.test(String(appId))) return [...fallos, 'app.info no ha dado el número de la aplicación']

  const hay = await llamar('crm.company.userfield.list', { filter: { FIELD_NAME: NOMBRE_DEL_CAMPO } }) as { result?: unknown[] } | null
  if (Array.isArray(hay?.result) && hay.result.length) return fallos
  const c = await llamar('crm.company.userfield.add', {
    fields: {
      FIELD_NAME: CAMPO_FIJO.campo, USER_TYPE_ID: `rest_${appId}_${CAMPO_FIJO.tipo}`, XML_ID: CAMPO_FIJO.campo,
      EDIT_FORM_LABEL: CAMPO_FIJO.etiqueta, LIST_COLUMN_LABEL: CAMPO_FIJO.etiqueta, LIST_FILTER_LABEL: CAMPO_FIJO.etiqueta,
      // Por si tapa la edición desde la lista (nº 33): en la ficha no basta, eso lo hace la página.
      EDIT_IN_LIST: 'N', SHOW_FILTER: 'Y', SHOW_IN_LIST: 'Y', MANDATORY: 'N', MULTIPLE: 'N', SETTINGS: {},
    },
  }) as Respuesta
  if (!c?.result && !yaEstaba(c)) fallos.push(`campo «${CAMPO_FIJO.etiqueta}»: ${porque(c)}`)
  return fallos
}

/** Lo que se guarda en el campo y se enseña: «150,00 €». */
export function valorDelCampo(cent: number): string {
  const e = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(cent / 100)
  return `${e} €`
}

/** Lo que manda Bitrix24 a la página del campo (USERFIELD_TYPE): el modo, lo guardado y la empresa. */
export interface LlegadaDelCampo {
  modo: 'view' | 'edit'
  guardado: string
  id: string | null
}

export function leerLlegadaDelCampo(form: URLSearchParams): LlegadaDelCampo {
  let o: Record<string, unknown> = {}
  try { o = JSON.parse(form.get('PLACEMENT_OPTIONS') ?? '{}') ?? {} } catch { o = {} }
  const id = String(o.ENTITY_VALUE_ID ?? '')
  const v = o.VALUE
  return {
    modo: o.MODE === 'edit' ? 'edit' : 'view',
    guardado: typeof v === 'string' ? v.slice(0, 40) : typeof v === 'number' ? String(v) : '',
    id: /^[0-9]{1,18}$/.test(id) && id !== '0' ? id : null,
  }
}

/**
 * La red de seguridad: si lo guardado en Bitrix24 no es lo de Sumied (lo cambió
 * alguien por la lista, una importación o la API), se devuelve a lo de Sumied.
 * Si Sumied no sabe la cuota (null), no se toca.
 */
export function queHacerConElCampo(guardado: string, sumied: string | null): { hacer: 'nada' | 'poner' | 'devolver'; valor?: string } {
  if (sumied === null) return { hacer: 'nada' }
  const limpio = guardado.trim()
  if (limpio === sumied) return { hacer: 'nada' }
  return { hacer: limpio ? 'devolver' : 'poner', valor: sumied }
}

/** La nota en el historial de la ficha cuando se devuelve el valor: con quién lo cambió. */
export function notaDeLaDevolucion(antes: string, quien: string | null, ahora: string): string {
  return `Sumied · «${CAMPO_FIJO.etiqueta}» estaba en ${antes}${quien ? ` (lo cambió ${quien})` : ''}: vuelve a ${ahora}, que es lo que dice Sumied. Se cambia en Sumied.`
}
