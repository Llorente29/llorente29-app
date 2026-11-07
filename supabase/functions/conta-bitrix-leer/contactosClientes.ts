// supabase/functions/conta-bitrix-leer/contactosClientes.ts
//
// G01c · Tarea 3 · Los contactos de Bitrix24 como clientes o como personas de
// contacto. Puro: lo prueban las unitarias (tests/unit/modules/conta/gestoria/
// contactosClientes.test.ts). La regla, de Julio (07/11, tras el recuento #5):
//
//   1. Contacto con empresa → persona de contacto de su empresa (de todas, si
//      tiene varias). No es cliente.
//   2. Contacto sin empresa → cliente SOLO si tiene alguna señal: NIF, Tarifa
//      Recurrente, una negociación o un cliente de GoCardless casado por NIF o
//      correo. Si su única señal es una negociación, entra y sale en
//      «Pendiente de revisar» («Contacto con solo una negociación: ¿es
//      cliente?»).
//   3. Contacto sin empresa y sin ninguna señal → no entra en Sumied; se dice
//      cuántos se quedan fuera.
//   4. Contacto con el NIF de una empresa → se une a ese cliente por la regla
//      de siempre (mismo NIF = un cliente), aunque en Bitrix24 esté enlazado a
//      otra empresa o a ninguna.
//   5. Contacto con empresa y con datos de cliente → persona de contacto, y a
//      «Pendiente de revisar» («Contacto con empresa y con datos de cliente»).
//   6. El mapa: NIF = «NIF/NIE»; dirección = ADDRESS; cuota de referencia =
//      «Tarifa Recurrente». Los contactos no tienen situación: «Tipo de
//      cliente» es un dato de referencia de la ficha, no la situación.

import { nifComoLaBase, type FichaParaUnir } from './clientes.ts'
import { importeACent, normalizarNif } from './mapa.ts'

/** El mapa de contactos: es dato, se confirma en «Qué es cada campo» (pestaña Contactos). */
export interface MapaContactos {
  nif: string | null
  /** La dirección y, si los tiene, sus campos de código postal, población y provincia. */
  direccion: { calle: string; cp?: string | null; poblacion?: string | null; provincia?: string | null } | null
  /** La cuota de referencia («Tarifa Recurrente»): solo se enseña. */
  cuota: string | null
  /** «Tipo de cliente»: un dato de referencia, no la situación. */
  tipoCliente: string | null
  /** El texto de cada opción de «Tipo de cliente». */
  textosTipo?: Record<string, string>
  confirmado?: { quien: string | null; cuando: string } | null
}

/** Lo que no está en el contacto y se mira aparte (sus empresas, las negociaciones, GoCardless). */
export interface ExtrasDeContacto {
  empresas: readonly string[]
  conNegociacion: boolean
  gocardless: { nifs: ReadonlySet<string>; correos: ReadonlySet<string> }
}

export interface FichaContacto extends FichaParaUnir {
  origen: 'contacto'
  bitrixId: string
  nombre: string
  nif: string | null
  nifEnBitrix: string | null
  situacion: null
  /** «Tipo de cliente», en texto: de referencia. */
  tipoCliente: string | null
  /** Las empresas de Bitrix24 de las que es persona de contacto. */
  empresas: string[]
  correos: string[]
  telefonos: string[]
  calle: string | null; cp: string | null; poblacion: string | null; provincia: string | null
  cuotaReferencia: { etiqueta: string; importeCent: number | null; texto: string } | null
  /** Las señales de cliente (regla 2). */
  senales: { nif: boolean; tarifa: boolean; negociacion: boolean; gocardless: boolean }
  /** Datos de cliente propios (regla 5): hoy, una cuota con importe. */
  datosDeCliente: boolean
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) { for (const x of v) { const t = texto(x); if (t) return t } return null }
  if (typeof v === 'object') return texto((v as { VALUE?: unknown }).VALUE)
  const t = String(v).trim()
  return t === '' ? null : t
}
const varios = (v: unknown): string[] => {
  const xs = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]
  return [...new Set(xs.map(texto).filter((x): x is string => !!x))]
}
const calle = (v: unknown) => { const t = texto(v); return t ? t.split('|')[0].replace(/\s+/g, ' ').trim() || null : null }
const conImporte = (t: string | null) => { const c = importeACent(t); return c !== null && c !== 0 }

/** Una fila de crm.contact.list → la ficha del contacto, con su mapa y lo que se mira aparte. */
export function leerContacto(fila: Record<string, unknown>, mapa: MapaContactos, x: ExtrasDeContacto): FichaContacto {
  const nombre = [texto(fila.NAME), texto(fila.SECOND_NAME), texto(fila.LAST_NAME)].filter(Boolean).join(' ')
  const nifEnBitrix = mapa.nif ? texto(fila[mapa.nif]) : null
  const nif = normalizarNif(nifEnBitrix)
  const correos = varios(fila.EMAIL).map((c) => c.toLowerCase())
  const cuotaTexto = mapa.cuota ? texto(fila[mapa.cuota]) : null
  const tipoId = mapa.tipoCliente ? texto(fila[mapa.tipoCliente]) : null
  const nb = nifComoLaBase(nif)
  return {
    origen: 'contacto', bitrixId: String(fila.ID ?? ''),
    nombre: nombre || `Contacto ${String(fila.ID ?? '')} de Bitrix24`,
    nif, nifEnBitrix, situacion: null,
    tipoCliente: tipoId ? mapa.textosTipo?.[tipoId] ?? tipoId : null,
    empresas: [...new Set(x.empresas.map(String).filter((e) => e && e !== '0'))],
    correos, telefonos: varios(fila.PHONE),
    calle: mapa.direccion ? calle(fila[mapa.direccion.calle]) : null,
    cp: mapa.direccion?.cp ? texto(fila[mapa.direccion.cp]) : null,
    poblacion: mapa.direccion?.poblacion ? texto(fila[mapa.direccion.poblacion]) : null,
    provincia: mapa.direccion?.provincia ? texto(fila[mapa.direccion.provincia]) : null,
    cuotaReferencia: cuotaTexto ? { etiqueta: 'Tarifa recurrente', importeCent: importeACent(cuotaTexto), texto: cuotaTexto } : null,
    senales: {
      nif: !!nb,
      tarifa: conImporte(cuotaTexto),
      negociacion: x.conNegociacion,
      gocardless: (!!nb && x.gocardless.nifs.has(nb)) || correos.some((c) => x.gocardless.correos.has(c)),
    },
    datosDeCliente: conImporte(cuotaTexto),
  }
}

export type Destino =
  | { es: 'cliente'; motivo: 'solo_negociacion' | null }
  | { es: 'persona_de_contacto'; empresas: string[]; motivo: 'empresa_con_datos' | null }
  | { es: 'fuera' }

/** Qué es un contacto en Sumied (la regla de arriba). nifsDeEmpresas: los NIF de las empresas, como los compara la base. */
export function destinoDe(c: FichaContacto, nifsDeEmpresas: ReadonlySet<string>): Destino {
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

export interface Reparto {
  /** Los contactos que entran como fichas de cliente (se unen con las empresas por la regla de siempre). */
  clientes: FichaContacto[]
  /** Las personas de contacto, por empresa de Bitrix24. */
  personas: Map<string, FichaContacto[]>
  /** Cuántos contactos se quedan fuera (sin empresa y sin ninguna señal). */
  fuera: number
  /** Lo que sale en «Pendiente de revisar». */
  pendientes: { tipo: 'contacto_solo_negociacion' | 'contacto_empresa_con_datos'; bitrixId: string; nombre: string; empresas: string[]; porque: string }[]
}

export function repartirContactos(contactos: readonly FichaContacto[], nifsDeEmpresas: ReadonlySet<string>): Reparto {
  const r: Reparto = { clientes: [], personas: new Map(), fuera: 0, pendientes: [] }
  for (const c of contactos) {
    const d = destinoDe(c, nifsDeEmpresas)
    if (d.es === 'fuera') { r.fuera++; continue }
    if (d.es === 'cliente') {
      r.clientes.push(c)
      if (d.motivo === 'solo_negociacion') r.pendientes.push({ tipo: 'contacto_solo_negociacion', bitrixId: c.bitrixId, nombre: c.nombre, empresas: [],
        porque: `Contacto con solo una negociación: ¿es cliente? (contacto ${c.bitrixId} de Bitrix24, sin empresa, sin NIF, sin tarifa y sin GoCardless).` })
      continue
    }
    for (const e of d.empresas) r.personas.set(e, [...(r.personas.get(e) ?? []), c])
    if (d.motivo === 'empresa_con_datos') r.pendientes.push({ tipo: 'contacto_empresa_con_datos', bitrixId: c.bitrixId, nombre: c.nombre, empresas: d.empresas,
      porque: `Contacto con empresa y con datos de cliente (contacto ${c.bitrixId} de Bitrix24, persona de contacto de ${d.empresas.length === 1 ? 'la empresa' : 'las empresas'} ${d.empresas.join(', ')}, con su propia tarifa): ¿es también cliente?` })
  }
  return r
}

/** Una persona de contacto, lo que se guarda y se enseña en la ficha de su empresa. */
export const personaDeContacto = (c: FichaContacto) => ({ bitrixId: c.bitrixId, nombre: c.nombre, correos: c.correos, telefonos: c.telefonos })
