// src/modules/conta/lib/revision430.ts
//
// C03 · Respuesta 3: la revisión de las cuentas 430 traídas de otro programa.
// Entran TODAS las traídas, también las que la importación dejó enlazadas a
// un proveedor como cuenta de pago: un enlace de pago no es un papel, y sin
// papel ese tercero no sale en «Clientes», «Plataformas» ni «Socios».
//
// Para cada una propone qué es, con su porqué y su confianza:
//   · cuenta propia sin ficha: «<plataforma> Ventas» (tus ventas por ese canal);
//   · plataforma de reparto: el nombre es el de una plataforma (o el de su
//     sociedad en España); se propone la ficha de esa plataforma;
//   · socio de marca: el 430 es de alguien que ya es proveedor (mismo NIF,
//     enlace de pago o mismo nombre): te vende y te paga, lo propio de una
//     cesión de marca;
//   · cliente normal: nadie con su NIF ni su nombre; ficha nueva con lo que
//     trae el listado.
// Nada se escribe aquí: la pantalla lo propone y la persona confirma fila a fila.

import { parecido } from '@/modules/conta/lib/importarPlan'
import type { Papel } from '@/modules/conta/lib/terceros'

export type Tipo430 = 'plataforma' | 'socio' | 'cliente' | 'propia'
export type Confianza430 = 'seguro' | 'probable'

export const TIPO_430: Record<Tipo430, string> = {
  plataforma: 'Plataforma de reparto', socio: 'Socio de marca', cliente: 'Cliente', propia: 'Cuenta tuya sin ficha',
}

/** Una 430 traída, con lo que dice de ella el listado y sus enlaces de hoy. */
export interface Cuenta430 {
  id: string
  code: string
  name: string
  /** NIF del listado de clientes del programa (normalizado), o null. */
  nif: string | null
  /** Dirección del listado, para la ficha nueva. */
  direccion: { calle: string | null; cp: string | null; poblacion: string | null; provincia: string | null } | null
  /** El proveedor del que es cuenta de pago (enlace «pago» de la importación), o null. */
  pagoDeProveedor: string | null
  /** El tercero del que ya es cuenta de cliente (enlace customer/principal), o null. */
  clienteDe: string | null
  /** Ya decidido como cuenta tuya sin ficha. */
  propia: boolean
}

export interface Tercero430 {
  id: string
  nombre: string
  nif: string | null
  papeles: readonly Papel[]
  supplierId: string | null
  archivado: boolean
  /** Su cuenta de proveedor o acreedor en el plan (40/41), para decir cuál es. */
  codigoProveedor: string | null
}

export interface Canal430 { id: string; nombre: string; plataformaDe: string | null }

export interface Propuesta430 {
  tipo: Tipo430
  /** La ficha propuesta (existente), o null si es ficha nueva o cuenta propia. */
  tercero: Tercero430 | null
  porque: string
  confianza: Confianza430
  /** Para una plataforma: el canal de venta que se le enlaza (sus liquidaciones), si está libre. */
  canal: Canal430 | null
}

/** Las plataformas, por los nombres con que aparecen y su sociedad en España. */
const PLATAFORMAS: { nombre: string; claves: string[]; sociedad?: { clave: string; texto: string } }[] = [
  { nombre: 'Glovo', claves: ['glovo', 'glovoapp'] },
  { nombre: 'Uber Eats', claves: ['ubereats', 'uber'], sociedad: { clave: 'portiereats', texto: 'Portier Eats Spain es la sociedad de Uber Eats en España' } },
  { nombre: 'Just Eat', claves: ['justeat'] },
]

const clave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const palabras = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const sinPrefijo = (s: string) => s.replace(/^(Clientes|Proveedores|Acreedores) · /, '')

/** La plataforma de un nombre («UBER EATS», «PORTIER EATS SPAIN, S.L.»), y si es por su sociedad. */
export function plataformaDe(nombre: string): { nombre: string; porSociedad: string | null } | null {
  const k = clave(sinPrefijo(nombre))
  for (const p of PLATAFORMAS) {
    // Una clave corta («uber») solo vale entera: «Uberto» no es Uber Eats.
    if (p.claves.some((c) => k === c || (c.length >= 5 && k.startsWith(c)))) return { nombre: p.nombre, porSociedad: null }
    if (p.sociedad && k.startsWith(p.sociedad.clave)) return { nombre: p.nombre, porSociedad: p.sociedad.texto }
  }
  return null
}

const etiqueta = (t: Tercero430) => (t.codigoProveedor ? `${t.codigoProveedor} · ${t.nombre}` : t.nombre)

/** ¿Ya está hecha? Enlazada como cuenta de cliente de alguien con papel de cliente, plataforma o socio; o decidida como tuya. */
export function hecha(c: Cuenta430, terceros: readonly Tercero430[]): boolean {
  if (c.propia) return true
  if (!c.clienteDe) return false
  const t = terceros.find((x) => x.id === c.clienteDe)
  return !!t && t.papeles.some((p) => p === 'customer' || p === 'platform' || p === 'brand_partner')
}

/** Un nombre que acaba en punto («S.L.») no lleva otro detrás. */
const sinDoblePunto = (p: Propuesta430): Propuesta430 => ({ ...p, porque: p.porque.replace(/\.\./g, '.') })

export function proponer430(c: Cuenta430, terceros: readonly Tercero430[], canales: readonly Canal430[]): Propuesta430 {
  return sinDoblePunto(proponer(c, terceros, canales))
}

function proponer(c: Cuenta430, terceros: readonly Tercero430[], canales: readonly Canal430[]): Propuesta430 {
  const nombre = sinPrefijo(c.name)
  const plat = plataformaDe(nombre)
  const vivos = terceros.filter((t) => !t.archivado)
  const delPago = c.pagoDeProveedor ? terceros.find((t) => t.supplierId === c.pagoDeProveedor) ?? null : null

  // 1 · «<plataforma> Ventas»: la cuenta de tus ventas por ese canal, no un cliente.
  if (plat && palabras(nombre).includes('ventas')) {
    return {
      tipo: 'propia', tercero: null, canal: null, confianza: 'probable',
      porque: `Se llama «${nombre}»: es la cuenta de tus ventas por ${plat.nombre}, no un cliente. Se queda sin ficha.`,
    }
  }

  // 2 · Una plataforma de reparto: la ficha de esa plataforma.
  if (plat) {
    const deLaPlataforma = (t: Tercero430) => plataformaDe(t.nombre)?.nombre === plat.nombre
    const candidata = (delPago && deLaPlataforma(delPago) ? delPago : null)
      ?? vivos.find((t) => deLaPlataforma(t) && !!c.nif && t.nif === c.nif)
      ?? vivos.find((t) => deLaPlataforma(t) && t.papeles.includes('platform'))
      ?? vivos.find((t) => deLaPlataforma(t) && plataformaDe(t.nombre)?.porSociedad === null)
      ?? vivos.find((t) => deLaPlataforma(t))
      ?? null
    const canal = canales.find((x) => plataformaDe(x.nombre)?.nombre === plat.nombre && (!x.plataformaDe || x.plataformaDe === candidata?.id)) ?? null
    if (!candidata) {
      return { tipo: 'plataforma', tercero: null, canal, confianza: 'probable', porque: `Es ${plat.nombre}, pero no encuentro su ficha de proveedor: elígela o créala.` }
    }
    const sociedad = plataformaDe(candidata.nombre)?.porSociedad
    const mismoNif = !!c.nif && candidata.nif === c.nif
    let porque: string
    let confianza: Confianza430
    if (delPago === candidata) {
      porque = `Es ${plat.nombre} y ya está enlazada a ${etiqueta(candidata)} para compensar sus pagos.`
      confianza = 'seguro'
    } else if (mismoNif) {
      porque = `Es ${plat.nombre}: mismo NIF que ${etiqueta(candidata)}.`
      confianza = 'seguro'
    } else if (sociedad) {
      porque = `${sociedad}: ${etiqueta(candidata)}. ${c.nif ? 'El NIF de la 430 no coincide con el de esa ficha: confírmalo.' : 'La 430 no trae NIF: confírmalo tú.'}`
      confianza = 'probable'
    } else {
      porque = `Es ${plat.nombre}: mismo nombre que ${etiqueta(candidata)}.`
      confianza = c.nif && candidata.nif && c.nif !== candidata.nif ? 'probable' : 'seguro'
    }
    return { tipo: 'plataforma', tercero: candidata, canal, porque, confianza }
  }

  // 3 · Alguien que ya es proveedor: socio de marca (te vende y te paga).
  const porNif = c.nif ? vivos.find((t) => t.nif === c.nif) ?? terceros.find((t) => t.nif === c.nif) ?? null : null
  const porNombre = vivos.find((t) => parecido(t.nombre, nombre) === 'igual') ?? null
  const proveedor = [porNif, delPago, porNombre].find((t) => t?.papeles.includes('supplier')) ?? null
  if (proveedor) {
    const como = porNif === proveedor ? `mismo NIF que ${etiqueta(proveedor)}`
      : delPago === proveedor ? `ya está enlazada a ${etiqueta(proveedor)} para compensar sus pagos`
      : `mismo nombre que ${etiqueta(proveedor)}${proveedor.nif ? '' : ' (esa ficha no tiene NIF)'}`
    return {
      tipo: 'socio', tercero: proveedor, canal: null,
      confianza: porNif === proveedor || delPago === proveedor ? 'seguro' : 'probable',
      porque: `${como[0].toUpperCase()}${como.slice(1)}. Es proveedor y cliente a la vez: te vende y te paga, lo propio de un socio de marca.`,
    }
  }

  // 4 · Ya es tercero (con su NIF) sin ser proveedor: ese, como cliente.
  if (porNif) return { tipo: 'cliente', tercero: porNif, canal: null, confianza: 'seguro', porque: `Mismo NIF que ${porNif.nombre}.` }

  // 5 · Nadie: cliente nuevo con lo que trae el listado.
  return {
    tipo: 'cliente', tercero: null, canal: null, confianza: c.nif ? 'seguro' : 'probable',
    porque: c.nif
      ? `Nadie tiene su NIF (${c.nif}) ni su nombre: ficha nueva, traída del listado y por completar.`
      : 'Nadie se llama así y el listado no trae NIF: ficha nueva, por completar.',
  }
}

/** Lo que la persona elige con «Cambiar»: su tipo y su ficha (o ficha nueva). */
export function elegida(tipo: Tipo430, tercero: Tercero430 | null, canales: readonly Canal430[]): Propuesta430 {
  const plat = tipo === 'plataforma' && tercero ? plataformaDe(tercero.nombre) : null
  const canal = plat ? canales.find((x) => plataformaDe(x.nombre)?.nombre === plat.nombre && (!x.plataformaDe || x.plataformaDe === tercero!.id)) ?? null : null
  return { tipo, tercero: tipo === 'propia' ? null : tercero, canal, confianza: 'seguro', porque: 'Lo has elegido tú.' }
}

/** Lo que va a pasar al confirmar, en palabras (regla 8: el botón dice qué hace). */
export function queHace(c: Cuenta430, p: Propuesta430, archivar = false): string {
  const quien = p.tercero?.nombre ?? sinPrefijo(c.name)
  switch (p.tipo) {
    case 'propia': return `${c.code} se queda como cuenta tuya, sin ficha.`
    case 'plataforma': return `${quien} pasa a ser plataforma de reparto${p.canal ? ` (canal ${p.canal.nombre}, con sus liquidaciones)` : ''} y ${c.code} su cuenta de cliente.`
    case 'socio': return `${quien} pasa a ser socio de marca y cliente, con ${c.code} como su cuenta de cliente${archivar ? '; queda archivado (histórico)' : ''}.`
    case 'cliente': return p.tercero ? `${quien} pasa a ser cliente, con ${c.code} como su cuenta.` : `Ficha nueva de cliente «${quien}»${c.nif ? ` con NIF ${c.nif}` : ''} y ${c.code} como su cuenta.`
  }
}

/**
 * La tarjeta de la lista: con «Clientes», «Plataformas» o «Socios» vacío y 430
 * traídas sin revisar, en vez de «aún no hay nadie», lo que falta y a dónde ir.
 * Con filas en el filtro no sale: la revisión ya está arriba (regla 7: la
 * tarjeta no tapa filas).
 */
export function tarjetaPorRevisar(filtro: string, filasDelFiltro: number, busca: string, pendientes: number, programa: string | null): string | null {
  if (filasDelFiltro > 0 || busca.trim() || pendientes === 0 || !['clientes', 'plataformas', 'socios'].includes(filtro)) return null
  const de = programa ? ` de ${programa}` : ''
  return pendientes === 1 ? `Tienes 1 cuenta de cliente traída${de} por revisar` : `Tienes ${pendientes} cuentas de clientes traídas${de} por revisar`
}
