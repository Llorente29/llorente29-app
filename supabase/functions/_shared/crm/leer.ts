// supabase/functions/_shared/crm/leer.ts
//
// G01c (Julio, 07/11) · Del núcleo neutro: guardar en Sumied lo leído de un
// CRM, sin saber de qué CRM viene. El adaptador (hoy, Bitrix24 en
// conta-bitrix-leer) lee sus empresas y sus contactos y los pasa aquí ya como
// fichas neutras (ficha.ts). Aquí se decide y se guarda:
//   · qué es cada contacto (contactos.ts): cliente, persona de contacto o
//     fuera; solo con el mapa de contactos confirmado entra alguno;
//   · los clientes, con la unión por NIF si está aplicada (clientes.ts), en
//     conta_crm_guardar_clientes, de 150 en 150;
//   · las personas de contacto, en conta_crm_guardar_personas;
//   · lo que sale en «Pendiente de revisar», con su porqué (también los
//     clientes cuya ficha ya no entra como cliente: no se archivan solos);
//   · y en conta_crm, lo leído de los contactos (para «Ver cuáles»).
// Devuelve las frases de la lectura (regla 8: la confirmación lleva contenido).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { agrupar, diferenciasDeLectura, nifsQueUnen, paraGuardar, resumenDeUnion, yaNoSonClientes, type ClienteGuardado, type DiferenciaDeCrm, type ErrorAlGuardar } from './clientes.ts'
import { personaDeContacto, repartirContactos, resumenDeContactos, type ContactosLeidos, type Reparto } from './contactos.ts'
import { claveDeFicha, nombreDelCrm, type FichaContactoCrm, type FichaCrm } from './ficha.ts'

/** Un número con el punto de los miles (1.437), también con cuatro cifras. */
export const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** Lo que el adaptador ha leído del CRM. */
export interface LecturaDelCrm {
  crm: string
  empresas: FichaCrm[]
  /** Los contactos, si se han leído: con el mapa confirmado entran; sin él, solo se cuentan. */
  contactos: { contactos: FichaContactoCrm[]; confirmado: boolean } | null
  /** La unión aplicada (mismo NIF = un cliente). */
  unir: boolean
}

/** Los tipos de «Pendiente de revisar» que renueva cada lectura del CRM. */
export const TIPOS_DE_LA_LECTURA = ['fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos', 'ya_no_es_cliente_en_crm'] as const

/** Las fichas que entran como clientes: las empresas y, con el mapa de contactos confirmado, los contactos que son clientes. */
export function fichasDeClientes(l: LecturaDelCrm): { fichas: FichaCrm[]; reparto: Reparto | null; nifs: Set<string> } {
  // Solo los NIF por los que la unión de verdad une (clientes.ts · nifsQueUnen): lo mismo que hará agrupar.
  const nifs = nifsQueUnen(l.empresas.map((f) => f.nif), (l.contactos?.contactos ?? []).map((c) => c.nif))
  if (!l.contactos) return { fichas: l.empresas, reparto: null, nifs }
  const reparto = repartirContactos(l.contactos.contactos, nifs, nombreDelCrm(l.crm))
  return { fichas: l.contactos.confirmado ? [...l.empresas, ...reparto.clientes] : l.empresas, reparto, nifs }
}

export async function guardarLectura(db: SupabaseClient, cuenta: string, lectura: string, l: LecturaDelCrm) {
  const nombre = nombreDelCrm(l.crm)
  const { fichas, reparto, nifs } = fichasDeClientes(l)
  const conContactos = !!(l.contactos?.confirmado && reparto)
  const clientes = agrupar(fichas, l.unir)
  let suma = { nuevos: 0, cambiados: 0, iguales: 0 }
  let juntados = 0
  const errores: ErrorAlGuardar[] = []
  // De 150 en 150 clientes; cada uno en su subtransacción: uno que falla no tumba la lectura.
  for (let i = 0; i < clientes.length; i += 150) {
    const { data, error } = await db.rpc('conta_crm_guardar_clientes', { p_account: cuenta, p_crm: l.crm, p_clientes: clientes.slice(i, i + 150).map(paraGuardar) })
    if (error) throw new Error(`No se han podido guardar las fichas: ${error.message}`)
    const r = data as typeof suma & { errores: ErrorAlGuardar[]; juntados?: number }
    suma = { nuevos: suma.nuevos + r.nuevos, cambiados: suma.cambiados + r.cambiados, iguales: suma.iguales + r.iguales }
    juntados += r.juntados ?? 0
    errores.push(...(r.errores ?? []))
  }

  // Las personas de contacto, todas a la vez (las que no vienen se quitan).
  let personas = { guardadas: 0, sinCliente: 0, quitadas: 0 }
  if (conContactos) {
    const lista = [...reparto!.personas].flatMap(([empresa, cs]) => cs.map((c) => ({ empresa, contacto: personaDeContacto(c) })))
    const { data, error } = await db.rpc('conta_crm_guardar_personas', { p_account: cuenta, p_crm: l.crm, p_personas: lista })
    if (error) throw new Error(`No se han podido guardar las personas de contacto: ${error.message}`)
    personas = data as typeof personas
  }

  // «Pendiente de revisar»: las de la lectura de antes dejan de ser las vigentes.
  const difs: DiferenciaDeCrm[] = diferenciasDeLectura(clientes, errores, l.unir, nombre)
  if (conContactos) {
    for (const p of reparto!.pendientes) difs.push({ tipo: p.tipo, porque_codigo: p.tipo === 'contacto_solo_negociacion' ? 'solo_negociacion' : 'empresa_con_datos',
      porque: p.porque, tipo_ficha: 'contacto', id_externo: p.idExterno, datos: { empresas: p.empresas, nombre: p.nombre } })
  }
  // Los clientes que vinieron del CRM y cuya ficha ya no entra como cliente (G01c, PR B).
  const guardados: (ClienteGuardado & { partyId: string })[] = []
  for (let desde = 0; ; desde += 1000) {
    // Sin los archivados (party.archived_at): un cliente juntado con el de su NIF ya no cuenta.
    const { data, error } = await db.from('conta_gestoria_cliente').select('party_id, tipo_ficha, id_externo, party!inner(name, archived_at)')
      .eq('account_id', cuenta).eq('crm', l.crm).is('party.archived_at', null).order('party_id').range(desde, desde + 999)
    if (error) throw new Error(`No se han podido leer los clientes de Sumied: ${error.message}`)
    for (const x of (data ?? []) as unknown as { party_id: string; tipo_ficha: 'empresa' | 'contacto'; id_externo: string | null; party: { name: string | null } | null }[]) {
      if (x.id_externo) guardados.push({ partyId: x.party_id, tipoFicha: x.tipo_ficha, idExterno: x.id_externo, nombre: x.party?.name ?? null })
    }
    if ((data ?? []).length < 1000) break
  }
  const yaNo = yaNoSonClientes(guardados, clientes, conContactos, nombre)
  difs.push(...yaNo)
  const partyDeGuardado = new Map(guardados.map((g) => [claveDeFicha(g), g.partyId]))

  const { error: eViejas } = await db.from('conta_gestoria_diferencia').update({ vigente: false }).eq('account_id', cuenta).eq('vigente', true).in('tipo', [...TIPOS_DE_LA_LECTURA])
  if (eViejas) throw new Error(`No se han podido renovar las diferencias: ${eViejas.message}`)
  if (difs.length) {
    // El cliente de cada una: el de su ficha; el de una persona de contacto, el de su (primera) empresa.
    const partyDe = new Map<string, string>()
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await db.from('conta_gestoria_ficha').select('tipo_ficha, id_externo, party_id').eq('account_id', cuenta).eq('crm', l.crm).eq('de_empresa', '')
        .order('id_externo').range(desde, desde + 999)
      if (error) throw new Error(`No se han podido leer las fichas de Sumied: ${error.message}`)
      for (const x of (data ?? []) as { tipo_ficha: 'empresa' | 'contacto'; id_externo: string; party_id: string }[]) partyDe.set(claveDeFicha({ tipoFicha: x.tipo_ficha, idExterno: x.id_externo }), x.party_id)
      if ((data ?? []).length < 1000) break
    }
    const partyDeDif = (d: DiferenciaDeCrm) => {
      if (d.tipo === 'ficha_no_guardada') return null
      if (d.tipo === 'ya_no_es_cliente_en_crm') return partyDeGuardado.get(claveDeFicha({ tipoFicha: d.tipo_ficha, idExterno: d.id_externo })) ?? null
      if (d.tipo === 'contacto_empresa_con_datos') return partyDe.get(`empresa:${(d.datos.empresas as string[])[0]}`) ?? null
      return partyDe.get(claveDeFicha({ tipoFicha: d.tipo_ficha, idExterno: d.id_externo })) ?? null
    }
    for (let i = 0; i < difs.length; i += 200) {
      const { error } = await db.from('conta_gestoria_diferencia').insert(difs.slice(i, i + 200).map((d) => ({
        account_id: cuenta, lectura_id: lectura, tipo: d.tipo, porque_codigo: d.porque_codigo, porque: d.porque,
        crm: l.crm, tipo_ficha: d.id_externo ? d.tipo_ficha : null, id_externo: d.id_externo || null, party_id: partyDeDif(d), datos: d.datos })))
      if (error) throw new Error(`No se han podido guardar las diferencias: ${error.message}`)
    }
  }

  // Lo leído de los contactos: cuántos de cada y las dos listas de «Ver cuáles» (también sin confirmar: para decidir con números).
  const leidos: ContactosLeidos | null = reparto && l.contactos ? {
    cuando: new Date().toISOString(), resumen: resumenDeContactos(l.contactos.contactos, reparto, nifs),
    fuera: reparto.fuera, pendientes: reparto.pendientes.map((p) => ({ idExterno: p.idExterno, nombre: p.nombre, porque: p.porque })),
  } : null

  const union = resumenDeUnion(clientes)
  const frases: string[] = []
  if (l.unir) frases.push(`En Sumied, ${miles(union.clientes)} clientes: ${miles(union.clientesUnidos)} con varias fichas (${miles(union.fichasUnidas)} fichas) y ${miles(union.sinNifPorFormato + union.sinNifPorMuchas)} sin NIF.`)
  if (leidos) {
    const r = leidos.resumen
    frases.push(conContactos
      ? `Contactos de ${nombre}: ${miles(r.contactos)}; ${miles(r.clientes)} entran como clientes, ${miles(r.seUnenAEmpresa)} se unen al cliente de su empresa, ${miles(r.personas)} son personas de contacto (${miles(personas.guardadas)} guardadas${personas.sinCliente ? `, ${miles(personas.sinCliente)} de una empresa que no está en Sumied` : ''}) y ${miles(r.fuera)} se quedan fuera.`
      : `Contactos de ${nombre}: ${miles(r.contactos)}. No entra ninguno hasta confirmar su mapa en «Qué es cada campo › Contactos» (entrarían ${miles(r.clientes + r.seUnenAEmpresa)} como clientes y ${miles(r.personas)} como personas de contacto; ${miles(r.fuera)} se quedarían fuera).`)
  }
  if (juntados) frases.push(`${miles(juntados)} ${juntados === 1 ? 'cliente que ya estaba por separado se ha juntado' : 'clientes que ya estaban por separado se han juntado'} con el de su NIF (el otro, archivado; queda el rastro).`)
  if (yaNo.length) frases.push(`${miles(yaNo.length)} ${yaNo.length === 1 ? 'cliente de Sumied ya no es cliente' : 'clientes de Sumied ya no son clientes'} en ${nombre}: en «Pendiente de revisar», sin archivar.`)
  if (errores.length) frases.push(`${miles(errores.length)} ${errores.length === 1 ? 'cliente no se ha guardado' : 'clientes no se han guardado'}: en «Pendiente de revisar», con su porqué.`)
  return { suma, juntados, errores, union, clientes, personas, contactosLeidos: leidos, yaNoSonClientes: yaNo.length, frases }
}
