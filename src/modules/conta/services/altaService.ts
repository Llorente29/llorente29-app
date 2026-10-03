// src/modules/conta/services/altaService.ts
//
// El alta conversada (C00 §6.4): cada respuesta se guarda en el momento (el
// alta se puede dejar a medias y seguir desde otro dispositivo).
//
// Quién decide cada dato, y cómo queda:
//   · lo propone la IA y la persona dice «sí» (o «No lo sé»)  → conta_ia_poner,
//     origen «ai», con su porqué y en el registro (se puede deshacer)
//   · viene de la cuenta y la persona lo confirma (D2)         → origen «import»
//   · lo escribe o lo elige la persona                         → escritura normal,
//     sin marca
//
// Nombres de la base entre comillas (regla 40): company, company_tax_profile,
// company_doubt, treasury_account, legal_form, iae_heading, cnae_code.

import { tabla, mensaje } from '@/modules/conta/services/bd'
import { ponerConIa } from '@/modules/conta/services/iaService'
import { normalizarNif, tipoEntidadPorNif } from '@/modules/conta/lib/nif'
import { normalizarIban } from '@/modules/conta/lib/iban'
import type { Encontrado, Grupo } from '@/modules/conta/alta/actividades'
import type { PasoAlta } from '@/modules/conta/alta/guion'

type Fila = Record<string, unknown>
const DE_LA_CUENTA = 'De los datos de tu cuenta en Folvy; lo confirmaste en el alta.'

export async function crearEmpresa(accountId: string, userId: string | null, nif: string | null): Promise<string> {
  const n = nif ? normalizarNif(nif) : null
  const { data, error } = await tabla('company').insert({
    account_id: accountId, tax_id: n, tax_id_type: n ? 'nif_es' : null, entity_kind: n ? tipoEntidadPorNif(n) : null,
    setup_step: 'nombre', created_by: userId,
  }).select('id').single()
  if (error) throw new Error(mensaje('No se ha podido empezar el alta', error))
  const id = String((data as Fila).id)
  // La forma jurídica sale de la letra del NIF (Orden EHA/451/2008, art. 3).
  if (n && /^[A-Z]/.test(n)) {
    const { data: f } = await tabla('legal_form').select('code, name, legal_ref').eq('nif_letter', n[0]).maybeSingle()
    if (f) {
      const forma = f as Fila
      await ponerConIa(id, 'company', 'legal_form_code', String(forma.code),
        `La letra ${n[0]} del NIF es la de: ${String(forma.name)} (${String(forma.legal_ref)}).`)
    }
  }
  return id
}

export async function ponerPaso(companyId: string, paso: PasoAlta): Promise<void> {
  const { error } = await tabla('company').update({ setup_step: paso }).eq('id', companyId)
  if (error) throw new Error(mensaje('No se ha guardado por dónde vas', error))
}

export async function ponerNombre(companyId: string, nombre: string, deLaCuenta: boolean): Promise<void> {
  if (deLaCuenta) { await ponerConIa(companyId, 'company', 'legal_name', nombre.trim(), DE_LA_CUENTA, 'import'); return }
  const { error } = await tabla('company').update({ legal_name: nombre.trim() }).eq('id', companyId)
  if (error) throw new Error(mensaje('No se ha guardado el nombre', error))
}

export interface DireccionAlta { calle: string; numero: string; codigoPostal: string; poblacion: string; provincia: string }

/**
 * La dirección del alta. Lo que dedujo la IA (la población por el código
 * postal, la provincia por sus dos primeras cifras) va con su marca y su
 * porqué, por conta_ia_poner; lo demás lo escribió la persona y va sin marca.
 */
export async function ponerDireccion(companyId: string, d: DireccionAlta, deLaCuenta: boolean,
  deducido?: { poblacion: string | null; provincia: string | null }): Promise<void> {
  const campos: [string, string][] = [
    ['fiscal_street', d.calle], ['fiscal_number', d.numero], ['fiscal_postal_code', d.codigoPostal],
    ['fiscal_city', d.poblacion], ['fiscal_province', d.provincia],
  ]
  if (deLaCuenta) {
    for (const [c, v] of campos) if (v.trim() !== '') await ponerConIa(companyId, 'company', c, v.trim(), DE_LA_CUENTA, 'import')
    return
  }
  const porIa: Record<string, string | null> = { fiscal_city: deducido?.poblacion ?? null, fiscal_province: deducido?.provincia ?? null }
  // Lo deducido entra vacío aquí y lo pone la IA: así «Deshacer» lo deja como estaba.
  const fila = Object.fromEntries(campos.map(([c, v]) => [c, v.trim() === '' || porIa[c] ? null : v.trim()]))
  const { error } = await tabla('company').update(fila).eq('id', companyId)
  if (error) throw new Error(mensaje('No se ha guardado la dirección', error))
  for (const [c, v] of campos) {
    const porque = porIa[c]
    if (porque && v.trim() !== '') await ponerConIa(companyId, 'company', c, v.trim(), porque)
  }
}

/** La persona eligió otra cosa que la propuesta: se guarda como suya (sin marca). */
export async function ponerEnPerfil(accountId: string, companyId: string, campo: string, valor: unknown): Promise<void> {
  const { error } = await tabla('company_tax_profile').upsert({ company_id: companyId, account_id: accountId, [campo]: valor }, { onConflict: 'company_id' })
  if (error) throw new Error(mensaje('No se ha guardado', error))
}

/** «No lo sé»: queda la opción normal y la duda para el asesor. */
export async function apuntarDuda(accountId: string, companyId: string, userId: string | null, clave: string, pregunta: string, normal: string): Promise<void> {
  const { error } = await tabla('company_doubt').upsert({
    account_id: accountId, company_id: companyId, question_key: clave, question: pregunta, default_answer: normal, created_by: userId,
  }, { onConflict: 'company_id,question_key' })
  if (error) throw new Error(mensaje('No se ha apuntado la duda', error))
}

export async function anadirBanco(accountId: string, companyId: string, userId: string | null, iban: string): Promise<void> {
  const { error } = await tabla('treasury_account').insert({
    account_id: accountId, company_id: companyId, kind: 'bank', name: 'Cuenta principal', iban: normalizarIban(iban),
    pgc_hint: '572', is_default: true, created_by: userId,
  })
  if (error) throw new Error(mensaje('No se ha guardado el banco', error))
}

/** Termina el alta. Si falta la razón social, el NIF o si es sociedad o autónomo, la base no deja: se dice qué. */
export async function terminarAlta(companyId: string): Promise<void> {
  const { error } = await tabla('company').update({ setup_step: 'hecho', setup_completed_at: new Date().toISOString() }).eq('id', companyId)
  if (error) {
    if (/company_alta_completa/.test(error.message)) {
      throw new Error('Para terminar faltan la razón social o el NIF: ponlos en «Tu empresa» y queda hecha.')
    }
    throw new Error(mensaje('No se ha podido terminar el alta', error))
  }
}

// ── Las propuestas de actividad, de los catálogos oficiales ─────────────────

async function buscarTitulos(cat: 'iae' | 'cnae', termino: string): Promise<Encontrado[]> {
  const t = termino.replace(/[%_,()]/g, ' ').trim()
  if (t.length < 3) return []
  const q = cat === 'iae'
    ? tabla('iae_heading').select('code, title, level').ilike('title', `%${t}%`).in('level', ['grupo', 'epigrafe']).in('section', ['1', '2']).order('code').limit(5)
    : tabla('cnae_code').select('code, title, level').eq('version', '2025').eq('level', 4).ilike('title', `%${t}%`).order('code').limit(5)
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido buscar en ${cat === 'iae' ? 'el IAE' : 'la CNAE'}`, error))
  return ((data ?? []) as Fila[]).map((r) => ({ code: String(r.code), title: String(r.title).replace(/­/g, ''), level: String(r.level) }))
}

export async function buscarParaGrupos(grupos: Grupo[]): Promise<Map<string, { iae: Encontrado[][]; cnae: Encontrado[][] }>> {
  const out = new Map<string, { iae: Encontrado[][]; cnae: Encontrado[][] }>()
  await Promise.all(grupos.map(async (g) => {
    const [iae, cnae] = await Promise.all([
      Promise.all(g.iae.map((t) => buscarTitulos('iae', t))),
      Promise.all(g.cnae.map((t) => buscarTitulos('cnae', t))),
    ])
    out.set(g.clave, { iae, cnae })
  }))
  return out
}

/**
 * Al volver a «A qué te dedicas» durante el alta (respuesta 3): las actividades
 * que se apuntaron en el alta se quitan y se ponen las nuevas. Solo mientras
 * el alta está a medias: con el alta terminada, se cambian en «Tu empresa».
 */
export async function quitarActividadesDelAlta(companyId: string): Promise<void> {
  const { error } = await tabla('company_activity').delete().eq('company_id', companyId)
  if (error) throw new Error(mensaje('No se han podido quitar las actividades de antes', error))
}
