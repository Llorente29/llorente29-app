// supabase/functions/conta-bitrix-pestana/campo.ts
//
// GBd · RETIRADA del campo fijo del GBc (#626). Julio eligió el plan B (12/11):
// campos normales y una red que deshace al momento. Al instalar o reinstalar la
// aplicación (con el token del administrador), SOLO en el Bitrix24 de pruebas,
// se borran el campo «Cuota mensual (Sumied)» y el tipo de campo «Sumied», en
// ese orden: si se borrara solo el tipo, el campo se quedaría escondido con su
// valor y volvería al registrar el tipo otra vez (userfieldtype.delete).
//
// Este fichero se va entero en el PR del plan B, cuando Julio confirme que en
// el Bitrix24 de pruebas ya no queda nada.
//
// Sin Deno ni red: la llamada a Bitrix24 llega de fuera (la prueban las unitarias).

import { PORTAL_DE_PRUEBAS } from './puro.ts'

/** Lo que registró el GBc: el código corto del tipo y el campo de la empresa. */
export const CAMPO_FIJO = { tipo: 'sumied_fijo', campo: 'UF_CRM_SUMIED_CUOTA' } as const

/** Solo en el Bitrix24 de pruebas: en cualquier otro portal no se toca nada. */
export const campoFijoEnEstePortal = (portal: string | null) => portal === PORTAL_DE_PRUEBAS

type Llamar = (metodo: string, cuerpo: Record<string, unknown>) => Promise<unknown>
type Respuesta = { result?: unknown; error?: string; error_description?: string } | null

const porque = (r: Respuesta) => String(r?.error_description ?? r?.error ?? 'sin respuesta').slice(0, 80)
/** «No existe» vale: ya estaba retirado. */
const noEstaba = (r: Respuesta) => /not found|no existe|does not exist|unknown|not registered/i.test(`${r?.error ?? ''} ${r?.error_description ?? ''}`)

/**
 * Al instalar (con el token del administrador): borra el campo y después el
 * tipo. Lo que ya no estaba, vale. Devuelve los fallos, en frases. En otro
 * portal, ninguna llamada.
 */
export async function retirarCampoFijo(portal: string | null, llamar: Llamar): Promise<string[]> {
  if (!campoFijoEnEstePortal(portal)) return []
  const fallos: string[] = []
  const hay = await llamar('crm.company.userfield.list', { filter: { FIELD_NAME: CAMPO_FIJO.campo } }) as { result?: { ID?: unknown }[] } | null
  for (const f of Array.isArray(hay?.result) ? hay.result : []) {
    const id = String(f?.ID ?? '')
    if (!/^[0-9]+$/.test(id)) continue
    const d = await llamar('crm.company.userfield.delete', { id }) as Respuesta
    if (!d?.result && !noEstaba(d)) fallos.push(`campo «Cuota mensual (Sumied)»: ${porque(d)}`)
  }
  const t = await llamar('userfieldtype.delete', { USER_TYPE_ID: CAMPO_FIJO.tipo }) as Respuesta
  if (!t?.result && !noEstaba(t)) fallos.push(`tipo de campo «Sumied»: ${porque(t)}`)
  return fallos
}
