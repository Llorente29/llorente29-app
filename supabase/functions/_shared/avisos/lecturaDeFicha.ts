// supabase/functions/_shared/avisos/lecturaDeFicha.ts
//
// G01d · Tarea 2 · Del aviso a la lectura de UNA ficha del CRM. Puro.
//
// Lo que se pide de la ficha es exactamente lo que pide la lectura entera, con
// los mismos campos (los del mapa, sin los sensibles: lectura.ts · leerFichas
// y leerContactos), pero con un filtro por su id. Así la ficha sale igual que
// si se hubiera leído con todas, y las reglas de después (mapa, unión por NIF,
// contactos, campos bloqueados) son las mismas: no se duplica nada.
//
// Lo que se haga después con la ficha (guardarla con el núcleo partido de
// _shared/crm) es de la tarea 3.

import type { TrabajoCrm } from './cola.ts'

/** Una petición al CRM, neutra: el adaptador (Bitrix24) la manda tal cual. */
export interface Peticion { metodo: string; cuerpo: Record<string, unknown> }

export type PlanDeFicha =
  | { tipo: 'leer'; tipoFicha: 'empresa' | 'contacto'; idExterno: string; peticiones: Peticion[] }
  | { tipo: 'pendiente_de_revisar'; tipoFicha: 'empresa' | 'contacto'; idExterno: string; porque: string }

/**
 * Bitrix24. La empresa: crm.company.list con los campos del mapa y filtro por
 * su ID. El contacto: crm.contact.list igual, y sus empresas con crm.item.list
 * (entityTypeId 3, companyIds: crm.contact.list no los trae, documentación
 * oficial), como en la lectura entera. Las negociaciones del contacto se
 * piden en la tarea 3, cuando se compruebe en el portal de pruebas cómo
 * filtrarlas por un contacto que no es el principal (contactIds).
 * Una baja no se puede leer (la ficha ya no está): sale en «Pendiente de
 * revisar» y no se borra nada en Sumied.
 */
export function planDeFichaBitrix(t: TrabajoCrm, select: { empresa: readonly string[]; contacto: readonly string[] }): PlanDeFicha {
  if (t.tipo === 'baja') {
    return { tipo: 'pendiente_de_revisar', tipoFicha: t.tipoFicha, idExterno: t.idExterno,
      porque: `${t.tipoFicha === 'empresa' ? 'La empresa' : 'El contacto'} n.º ${t.idExterno} se ha borrado en el CRM. En Sumied no se borra nada: decide si se queda.` }
  }
  const id = Number(t.idExterno)
  if (t.tipoFicha === 'empresa') {
    return { tipo: 'leer', tipoFicha: 'empresa', idExterno: t.idExterno,
      peticiones: [{ metodo: 'crm.company.list', cuerpo: { select: [...select.empresa], filter: { ID: id }, order: { ID: 'ASC' }, start: 0 } }] }
  }
  return { tipo: 'leer', tipoFicha: 'contacto', idExterno: t.idExterno, peticiones: [
    { metodo: 'crm.contact.list', cuerpo: { select: [...select.contacto], filter: { ID: id }, order: { ID: 'ASC' }, start: 0 } },
    { metodo: 'crm.item.list', cuerpo: { entityTypeId: 3, select: ['id', 'companyIds'], filter: { id }, order: { id: 'ASC' }, start: 0 } },
  ] }
}
