// supabase/functions/conta-bitrix-pestana/seccion.ts
//
// GBd · El plan B, en PRUEBAS: la ficha de empresa común (para todos) con una
// sección «Cuota y facturación (la pone Sumied)» que reúne los campos que pone
// Sumied. El resto de la ficha, como está. Nada se borra: un campo que estaba en
// otra sección se mueve a la de Sumied. Al lado de cada campo, la ayuda de
// Bitrix24 (el «?» junto al nombre) dice «Se cambia en la pestaña Sumied».
// Se hace al instalar o reinstalar la aplicación (token del administrador),
// solo en el Bitrix24 de pruebas.
//
// Sin Deno ni red: la llamada a Bitrix24 llega de fuera (la prueban las unitarias).

import { PORTAL_DE_PRUEBAS } from './puro.ts'

export const SECCION_SUMIED = { name: 'sumied_cuota', title: 'Cuota y facturación (la pone Sumied)' } as const
export const AYUDA_SUMIED = 'Lo pone Sumied. Se cambia en la pestaña Sumied.'

export interface Elemento { name: string; optionFlags?: number; options?: Record<string, unknown> }
export interface Seccion { name: string; title: string; type: string; elements?: Elemento[] }

export const seccionEnEstePortal = (portal: string | null) => portal === PORTAL_DE_PRUEBAS

/**
 * Los campos de Sumied en la ficha de empresa: la «Cuota mensual» del mapa y,
 * si existen en el portal, «Trabajadores» y «Estado del cobro» (los mismos que
 * escribe la pestaña, conta_bitrix_pestana_campos). Sin repetir.
 */
export function camposDeSumied(mapa: unknown, medidos: unknown): string[] {
  const out: string[] = []
  const campos = ((mapa as { campos?: unknown[] } | null)?.campos ?? []) as { campo?: string; codigo?: string | null; etiqueta?: string }[]
  const cuota = campos.filter((c) => c.campo === 'cuota_referencia' && c.codigo)
    .sort((a, b) => Number((b.etiqueta ?? '').toLowerCase() === 'cuota mensual') - Number((a.etiqueta ?? '').toLowerCase() === 'cuota mensual'))[0]
  if (cuota?.codigo) out.push(cuota.codigo)
  const patrones: [string, RegExp][] = [['trabajadores', /^(n(u|ú)mero de |nº de |no\.? de )?trabajadores$/], ['estado_cobro', /^estado del cobro$/]]
  const m = (medidos && typeof medidos === 'object' ? medidos : {}) as Record<string, { formLabel?: string; listLabel?: string; title?: string }>
  for (const [clave, patron] of patrones) {
    const delMapa = campos.find((c) => c.campo === clave && c.codigo)?.codigo
    const medido = Object.keys(m).sort().find((k) => k.startsWith('UF_CRM_') &&
      patron.test(String(m[k]?.formLabel || m[k]?.listLabel || m[k]?.title || '').trim().toLowerCase()))
    const codigo = delMapa ?? medido
    if (codigo && !out.includes(codigo)) out.push(codigo)
  }
  return out
}

/**
 * La ficha común con la sección de Sumied: los campos de Sumied salen de donde
 * estén y van a su sección, la segunda (después de la primera de la ficha). El
 * resto, igual. Dos veces da lo mismo que una.
 */
export function fichaComunConSumied(config: readonly Seccion[], codigos: readonly string[]): Seccion[] {
  const de = new Set(codigos)
  const resto = config.filter((s) => s.name !== SECCION_SUMIED.name)
    .map((s) => ({ ...s, elements: (s.elements ?? []).filter((e) => !de.has(e.name)) }))
  const nueva: Seccion = { name: SECCION_SUMIED.name, title: SECCION_SUMIED.title, type: 'section', elements: codigos.map((name) => ({ name, optionFlags: 1 })) }
  return [...resto.slice(0, 1), nueva, ...resto.slice(1)]
}

type Llamar = (metodo: string, cuerpo: Record<string, unknown>) => Promise<unknown>

/**
 * Al instalar (con el token del administrador): la ficha común con la sección
 * de Sumied y la ayuda en cada campo. Devuelve los fallos, en frases. En otro
 * portal, ninguna llamada.
 */
export async function ponerSeccionSumied(portal: string | null, codigos: readonly string[], llamar: Llamar): Promise<string[]> {
  if (!seccionEnEstePortal(portal) || !codigos.length) return []
  const fallos: string[] = []
  const g = await llamar('crm.company.details.configuration.get', { scope: 'C' }) as { result?: unknown; error_description?: string; error?: string } | null
  const actual = Array.isArray(g?.result) ? g.result as Seccion[] : null
  if (!actual?.length) return [`ficha común: Bitrix24 no la ha dado${g?.error ? ` (${String(g.error_description ?? g.error).slice(0, 60)})` : ''}`]
  const s = await llamar('crm.company.details.configuration.set', { scope: 'C', data: fichaComunConSumied(actual, codigos) }) as { result?: unknown; error?: string; error_description?: string } | null
  if (!s?.result) fallos.push(`ficha común: ${String(s?.error_description ?? s?.error ?? 'sin respuesta').slice(0, 60)}`)
  for (const codigo of codigos) {
    const l = await llamar('crm.company.userfield.list', { filter: { FIELD_NAME: codigo } }) as { result?: { ID?: unknown }[] } | null
    const id = String((l?.result ?? [])[0]?.ID ?? '')
    if (!/^[0-9]+$/.test(id)) continue
    const u = await llamar('crm.company.userfield.update', { id, fields: { HELP_MESSAGE: { la: AYUDA_SUMIED, es: AYUDA_SUMIED, en: AYUDA_SUMIED } } }) as { result?: unknown } | null
    if (!u?.result) fallos.push(`ayuda de ${codigo}: no se ha podido poner`)
  }
  return fallos
}
