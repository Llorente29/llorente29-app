// supabase/functions/_shared/crm/contactos.ts
//
// G01c · Del núcleo neutro: qué es cada contacto del CRM en Sumied, sin saber
// de qué CRM viene (lo lee su adaptador; hoy, Bitrix24 en
// conta-bitrix-leer/contactosClientes.ts). La regla, de Julio (07/11, tras el
// recuento #5):
//
//   1. Contacto con empresa → persona de contacto de su empresa (de todas, si
//      tiene varias). No es cliente.
//   2. Contacto sin empresa → cliente SOLO si tiene alguna señal: NIF, Tarifa
//      Recurrente, una negociación o un cliente de GoCardless casado por NIF o
//      correo. Si su única señal es una negociación, entra y sale en
//      «Pendiente de revisar» («Contacto con solo una negociación: ¿es
//      cliente?»).
//   3. Contacto sin empresa y sin ninguna señal → no entra en Sumied; se dice
//      cuántos y cuáles se quedan fuera.
//   4. Contacto con el NIF de una empresa → se une a ese cliente por la regla
//      de siempre (mismo NIF = un cliente), aunque en el CRM esté enlazado a
//      otra empresa o a ninguna.
//   5. Contacto con empresa y con datos de cliente → persona de contacto, y a
//      «Pendiente de revisar» («Contacto con empresa y con datos de cliente»).

import { nifComoLaBase } from './clientes.ts'
import type { FichaContactoCrm } from './ficha.ts'

export type Destino =
  | { es: 'cliente'; motivo: 'solo_negociacion' | null }
  | { es: 'persona_de_contacto'; empresas: string[]; motivo: 'empresa_con_datos' | null }
  | { es: 'fuera' }

/** Qué es un contacto en Sumied (la regla de arriba). nifsDeEmpresas: los NIF de las empresas, como los compara la base. */
export function destinoDe(c: FichaContactoCrm, nifsDeEmpresas: ReadonlySet<string>): Destino {
  const n = nifComoLaBase(c.nif)
  // 4 · Con el NIF de una empresa: se une a ese cliente, esté enlazado a lo que esté.
  if (n && nifsDeEmpresas.has(n)) return { es: 'cliente', motivo: null }
  // 1 y 5 · Con empresa: persona de contacto de todas sus empresas.
  if (c.empresas.length) return { es: 'persona_de_contacto', empresas: c.empresas, motivo: c.datosDeCliente ? 'empresa_con_datos' : null }
  // 2 · Sin empresa: cliente si tiene alguna señal; con solo una negociación, a revisar.
  const { nif, tarifa, negociacion, gocardless } = c.senales
  if (nif || tarifa || gocardless) return { es: 'cliente', motivo: null }
  if (negociacion) return { es: 'cliente', motivo: 'solo_negociacion' }
  // 3 · Sin ninguna señal: no entra.
  return { es: 'fuera' }
}

/** Un contacto en una lista de «Ver cuáles»: su nombre y por qué. */
export interface ContactoEnLista { idExterno: string; nombre: string; porque: string }

export interface Reparto {
  /** Los contactos que entran como fichas de cliente (se unen con las empresas por la regla de siempre). */
  clientes: FichaContactoCrm[]
  /** Las personas de contacto, por empresa del CRM (su id externo). */
  personas: Map<string, FichaContactoCrm[]>
  /** Los que se quedan fuera (sin empresa y sin ninguna señal), con su porqué. */
  fuera: ContactoEnLista[]
  /** Lo que sale en «Pendiente de revisar». */
  pendientes: { tipo: 'contacto_solo_negociacion' | 'contacto_empresa_con_datos'; idExterno: string; nombre: string; empresas: string[]; porque: string }[]
}

export function repartirContactos(contactos: readonly FichaContactoCrm[], nifsDeEmpresas: ReadonlySet<string>, crm: string): Reparto {
  const r: Reparto = { clientes: [], personas: new Map(), fuera: [], pendientes: [] }
  for (const c of contactos) {
    const d = destinoDe(c, nifsDeEmpresas)
    if (d.es === 'fuera') {
      r.fuera.push({ idExterno: c.idExterno, nombre: c.nombre, porque: 'Sin empresa, sin NIF, sin tarifa, sin negociación y sin cliente de GoCardless.' })
      continue
    }
    if (d.es === 'cliente') {
      r.clientes.push(c)
      if (d.motivo === 'solo_negociacion') r.pendientes.push({ tipo: 'contacto_solo_negociacion', idExterno: c.idExterno, nombre: c.nombre, empresas: [],
        porque: `Contacto con solo una negociación: ¿es cliente? (contacto ${c.idExterno} de ${crm}, sin empresa, sin NIF, sin tarifa y sin GoCardless).` })
      continue
    }
    for (const e of d.empresas) r.personas.set(e, [...(r.personas.get(e) ?? []), c])
    if (d.motivo === 'empresa_con_datos') r.pendientes.push({ tipo: 'contacto_empresa_con_datos', idExterno: c.idExterno, nombre: c.nombre, empresas: d.empresas,
      porque: `Contacto con empresa y con datos de cliente (contacto ${c.idExterno} de ${crm}, persona de contacto de ${d.empresas.length === 1 ? 'la empresa' : 'las empresas'} ${d.empresas.join(', ')}, con su propia tarifa): ¿es también cliente?` })
  }
  return r
}

/** Una persona de contacto: lo que se guarda y se enseña en la ficha de su empresa. */
export const personaDeContacto = (c: FichaContactoCrm) => ({ idExterno: c.idExterno, nombre: c.nombre, correos: c.correos, telefonos: c.telefonos })

/** Cuántos contactos hay de cada (lo que enseña «Qué es cada campo › Contactos»). */
export interface ResumenContactos { contactos: number; clientes: number; seUnenAEmpresa: number; personas: number; fuera: number; pendientes: number }

export function resumenDeContactos(contactos: readonly FichaContactoCrm[], r: Reparto, nifsDeEmpresas: ReadonlySet<string>): ResumenContactos {
  const seUnen = r.clientes.filter((c) => { const n = nifComoLaBase(c.nif); return !!n && nifsDeEmpresas.has(n) }).length
  const personas = new Set([...r.personas.values()].flat().map((c) => c.idExterno)).size
  return { contactos: contactos.length, clientes: r.clientes.length - seUnen, seUnenAEmpresa: seUnen, personas, fuera: r.fuera.length, pendientes: r.pendientes.length }
}

/** Lo que se guarda de los contactos en conta_crm.contactos_leidos: los números y las dos listas de «Ver cuáles». */
export interface ContactosLeidos {
  cuando: string
  resumen: ResumenContactos
  fuera: ContactoEnLista[]
  pendientes: ContactoEnLista[]
}
