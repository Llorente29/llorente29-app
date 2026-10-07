// src/modules/conta/lib/planArbol.ts
//
// C02, respuesta 5 · El plan como ÁRBOL plegable (como Holded, Diez, Sage 50 y
// Contasol): grupo (4) › subgrupo (40) › cuenta (400) › cuentas de apunte
// (40000000) › subcuentas de la empresa (40000001…). Puro y probado
// (tests/unit/modules/conta/planArbolC02.test.ts): la pantalla solo pinta lo
// que sale de aquí.
//
//   · Los nodos del cuadro (pgc_account sin hoja) son las ramas. Cada HOJA del
//     cuadro no sale como tal: sale su cuenta de apunte (la 4000 → 40000000),
//     y debajo de ella las subcuentas de la empresa que cuelgan de esa hoja.
//   · Estado inicial (abiertosPorDefecto): el grupo elegido, abierto hasta el
//     nivel de cuenta (400, 401, 403…), con todo lo de debajo plegado. Con «Las
//     que usas», además, abierto todo lo que tiene subcuentas o enlaces.
//   · Lo que la persona abre o cierra se guarda aparte (un mapa) y manda sobre
//     el estado inicial: así borrar la búsqueda o cambiar de grupo no lo pierde.
//   · Buscar APLANA (filasBuscadas): solo las cuentas que casan, cada una con
//     su ruta («4 › 40 › 400») para que se sepa dónde está.
//   · Un umbral ordena, no esconde (regla 7): plegado no es quitado; la fila
//     cerrada dice lo que lleva dentro («4 cuentas · 4 subcuentas tuyas»).

import { encaja, loQueLleva, origenDe, queSeApunta, type CuentaPlan, type CuentaSeriePlan, type EnlacePlan, type Origen } from '@/modules/conta/lib/planVista'
import type { EstadoCuenta } from '@/modules/conta/lib/planEmpresa'

export type TipoNodo = 'grupo' | 'subgrupo' | 'cuenta' | 'apunte' | 'subcuenta'

export interface NodoPlan {
  /** Código del cuadro (ramas) o id de la cuenta de la empresa (apunte y subcuenta). */
  clave: string
  tipo: TipoNodo
  numero: string
  titulo: string
  /** 1 = grupo. Sirve para la sangría y para `aria-level`. */
  nivel: number
  padre: string | null
  hijos: string[]
  /** Los códigos de arriba, del grupo hacia abajo («4», «40», «400»). */
  ruta: string[]
  plain: string | null
  plainPgc: boolean
  lleva: string | null
  origen: Origen | null
  /** Tiene uso: es tuya o tiene algo enlazado (las ramas: si algo de debajo lo tiene). */
  usada: boolean
  cuentaId: string | null
  estado: EstadoCuenta | null
  /** Cuántas cuentas de apunte y subcuentas tuyas lleva dentro (ramas y apuntes con subcuentas). */
  apuntes: number
  subcuentas: number
}

export interface ArbolPlan {
  nodos: ReadonlyMap<string, NodoPlan>
  /** Los grupos (1, 2… 7 o 9), en orden. */
  raices: string[]
  /** De código de cuenta de la empresa a su nodo (para el Mayor y la búsqueda). */
  porCodigo: ReadonlyMap<string, NodoPlan>
}

export interface EntradaArbol {
  serie: readonly CuentaSeriePlan[]
  cuentas: readonly CuentaPlan[]
  enlaces: readonly EnlacePlan[]
  plainDe?: ReadonlyMap<string, string>
}

const porNumero = (a: { numero: string }, b: { numero: string }) => a.numero.localeCompare(b.numero)

export function arbolPlan(e: EntradaArbol): ArbolPlan {
  const serieCodigo = new Map(e.serie.map((s) => [s.code, s]))
  const enlacesDe = new Map<string, EnlacePlan[]>()
  for (const l of e.enlaces) enlacesDe.set(l.companyAccountId, [...(enlacesDe.get(l.companyAccountId) ?? []), l])
  const nodos = new Map<string, NodoPlan>()
  const tipoRama = (code: string): TipoNodo => (code.length === 1 ? 'grupo' : code.length === 2 ? 'subgrupo' : 'cuenta')

  // Las ramas: todo lo del cuadro que no es hoja.
  for (const s of e.serie) {
    if (s.isLeaf) continue
    nodos.set(s.code, {
      clave: s.code, tipo: tipoRama(s.code), numero: s.code, titulo: s.name, nivel: 0, padre: s.parentCode, hijos: [], ruta: [],
      plain: s.plainName, plainPgc: false, lleva: null, origen: null, usada: false, cuentaId: null, estado: null, apuntes: 0, subcuentas: 0,
    })
  }
  const nodoCuenta = (c: CuentaPlan, tipo: 'apunte' | 'subcuenta', padre: string | null): NodoPlan => {
    const q = queSeApunta(c, e, serieCodigo)
    const enl = enlacesDe.get(c.id) ?? []
    return {
      clave: c.id, tipo, numero: c.code, titulo: c.name, nivel: 0, padre, hijos: [], ruta: [],
      plain: q?.texto ?? null, plainPgc: q?.pgc ?? false, lleva: loQueLleva(enl),
      origen: origenDe(c, serieCodigo.get(c.templateCode)?.isLeaf ?? true),
      usada: c.kind === 'own' || enl.length > 0, cuentaId: c.id, estado: c.status, apuntes: 0, subcuentas: 0,
    }
  }
  // Las cuentas de la empresa, colgadas de la rama de su hoja.
  const porHoja = new Map<string, CuentaPlan[]>()
  for (const c of e.cuentas) porHoja.set(c.templateCode, [...(porHoja.get(c.templateCode) ?? []), c])
  for (const [hoja, cs] of porHoja) {
    // Una genérica de otro programa cuelga de una cuenta CON hijas (la 160): va debajo de ella, no de su madre.
    const s = serieCodigo.get(hoja)
    const rama = s && !s.isLeaf ? s.code : s?.parentCode ?? null
    const plantilla = cs.find((c) => c.kind === 'template') ?? null
    if (plantilla) nodos.set(plantilla.id, nodoCuenta(plantilla, 'apunte', rama))
    for (const c of cs.filter((x) => x.kind === 'own')) nodos.set(c.id, nodoCuenta(c, plantilla ? 'subcuenta' : 'apunte', plantilla?.id ?? rama))
  }
  // Hijos, en orden de número.
  for (const n of nodos.values()) if (n.padre && nodos.has(n.padre)) nodos.get(n.padre)!.hijos.push(n.clave)
  for (const n of nodos.values()) n.hijos.sort((a, b) => porNumero(nodos.get(a)!, nodos.get(b)!))

  // Nivel, ruta y lo que lleva dentro, desde los grupos.
  const raices = [...nodos.values()].filter((n) => n.tipo === 'grupo').sort(porNumero).map((n) => n.clave)
  const baja = (clave: string, nivel: number, ruta: string[]): { apuntes: number; subcuentas: number; usada: boolean } => {
    const n = nodos.get(clave)!
    n.nivel = nivel
    n.ruta = ruta
    let apuntes = 0, subcuentas = 0, usada = n.usada
    for (const h of n.hijos) {
      const r = baja(h, nivel + 1, [...ruta, n.numero])
      const hijo = nodos.get(h)!
      apuntes += r.apuntes + (hijo.tipo === 'apunte' ? 1 : 0)
      subcuentas += r.subcuentas + (hijo.tipo === 'subcuenta' ? 1 : 0)
      usada = usada || r.usada
    }
    n.apuntes = apuntes
    n.subcuentas = subcuentas
    n.usada = usada
    return { apuntes, subcuentas, usada }
  }
  for (const r of raices) baja(r, 1, [])
  // Las ramas sin ninguna cuenta debajo no se pintan: no hay nada que abrir.
  for (const n of [...nodos.values()]) {
    if (!n.cuentaId && n.apuntes === 0 && n.subcuentas === 0) {
      nodos.delete(n.clave)
      if (n.padre && nodos.has(n.padre)) nodos.get(n.padre)!.hijos = nodos.get(n.padre)!.hijos.filter((h) => h !== n.clave)
    }
  }
  const porCodigo = new Map([...nodos.values()].filter((n) => n.cuentaId).map((n) => [n.numero, n]))
  return { nodos, raices: raices.filter((r) => nodos.has(r)), porCodigo }
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Lo que dice una fila con hijos: «4 cuentas · 4 subcuentas tuyas», o «2 subcuentas tuyas» en una de apunte. */
export function resumenNodo(n: NodoPlan): string | null {
  const partes: string[] = []
  if (n.apuntes) partes.push(plural(n.apuntes, 'cuenta', 'cuentas'))
  if (n.subcuentas) partes.push(plural(n.subcuentas, 'subcuenta tuya', 'subcuentas tuyas'))
  return partes.length ? partes.join(' · ') : null
}

export const tieneHijos = (n: NodoPlan): boolean => n.hijos.length > 0

/**
 * Estado inicial del grupo elegido: abierto hasta el nivel de cuenta (el grupo
 * y sus subgrupos); las cuentas, las de apunte y sus subcuentas, plegadas. Con
 * «Las que usas», también abierto lo que tiene subcuentas o enlaces.
 */
export function abiertosPorDefecto(a: ArbolPlan, grupo: string, orden: 'usadas' | 'todas'): Set<string> {
  const abiertos = new Set<string>()
  const recorre = (clave: string) => {
    const n = a.nodos.get(clave)
    if (!n || !tieneHijos(n)) return
    if (n.tipo === 'grupo' || n.tipo === 'subgrupo' || (orden === 'usadas' && (n.subcuentas > 0 || n.usada))) abiertos.add(clave)
    for (const h of n.hijos) recorre(h)
  }
  recorre(grupo)
  return abiertos
}

/** ¿Está abierta? Lo que la persona ha tocado manda; si no, el estado inicial. */
export const estaAbierto = (clave: string, tocados: ReadonlyMap<string, boolean>, porDefecto: ReadonlySet<string>): boolean =>
  tocados.get(clave) ?? porDefecto.has(clave)

/**
 * Las filas que se ven del grupo, en orden. Con «Las que usas», dentro de cada
 * rama van primero los hijos con uso; nada se quita (regla 7).
 */
export function filasVisibles(a: ArbolPlan, grupo: string, abierto: (clave: string) => boolean, orden: 'usadas' | 'todas'): NodoPlan[] {
  const salida: NodoPlan[] = []
  const recorre = (clave: string) => {
    const n = a.nodos.get(clave)
    if (!n) return
    salida.push(n)
    if (!tieneHijos(n) || !abierto(clave)) return
    const hijos = n.hijos.map((h) => a.nodos.get(h)!)
    const ordenados = orden === 'usadas' ? [...hijos.filter((h) => h.usada), ...hijos.filter((h) => !h.usada)] : hijos
    for (const h of ordenados) recorre(h.clave)
  }
  recorre(grupo)
  return salida
}

/**
 * Buscar aplana: las cuentas (de apunte y subcuentas) que casan con lo
 * buscado, en todos los grupos, en orden de número. Casan por su número, su
 * nombre, su «qué se apunta aquí» propio o sus palabras clave; o porque casa
 * la cuenta del cuadro de la que cuelgan («Proveedores» trae las del 400). El
 * texto heredado y la definición del BOE no cuentan: «alquiler» traería media
 * docena de cuentas que solo lo nombran.
 */
export function filasBuscadas(a: ArbolPlan, cuentas: readonly CuentaPlan[], serie: readonly CuentaSeriePlan[], q: string): NodoPlan[] {
  const cuenta = new Map(cuentas.map((c) => [c.id, c]))
  const ramasQueCasan = serie.filter((s) => !s.isLeaf && s.code.length >= 3 && encaja(q, s)).map((s) => s.code)
  return [...a.nodos.values()]
    .filter((n) => {
      const c = n.cuentaId ? cuenta.get(n.cuentaId) : null
      if (!c) return false
      return encaja(q, c) || encaja(q, { code: c.templateCode, name: '', plainName: null }) || ramasQueCasan.some((r) => n.ruta.includes(r))
    })
    .sort(porNumero)
}

/** «4 › 40 › 400»: dónde está una cuenta (la ruta encima, al buscar). */
export const textoRuta = (n: NodoPlan): string => n.ruta.join(' › ')

/** Las hijas directas de un nodo con su tipo (para «Sumas y saldos» de ese nivel). */
export const hijasDe = (a: ArbolPlan, clave: string): NodoPlan[] => (a.nodos.get(clave)?.hijos ?? []).map((h) => a.nodos.get(h)!)

/**
 * Las cuentas de la empresa que suma un nodo: la suya y todas las que cuelgan
 * de él. Una cuenta de apunte con subcuentas (la 40000000 con las de cada
 * proveedor) suma también las de debajo: sin esto, «Sumas y saldos» del 400
 * decía «Aún no hay apuntes» con una factura validada en la 40000002 (e2e 128).
 */
export function cuentasDentro(a: ArbolPlan, clave: string): Set<string> {
  const out = new Set<string>()
  const baja = (k: string) => {
    const n = a.nodos.get(k)
    if (!n) return
    if (n.cuentaId) out.add(n.cuentaId)
    n.hijos.forEach(baja)
  }
  baja(clave)
  return out
}

/**
 * De quién es una cuenta, para los enlaces de la cabecera de su Mayor
 * (respuesta 5): subcuenta de proveedor → «Ficha del proveedor»; de banco →
 * «Banco»; de cliente → «Ficha del cliente» (cuando exista, C03); de IVA →
 * «Impuestos › IVA» (cuando exista). Mira solo el enlace principal: el que dice
 * que la cuenta ES de ese tercero, no los papeles (gasto, pago) que la usan.
 */
export interface DuenoCuenta { tipo: 'proveedor' | 'banco' | 'cliente' | 'iva'; id: string }
export function duenoDeCuenta(c: { id: string; isCommon: boolean }, enlaces: readonly EnlacePlan[]): DuenoCuenta | null {
  // Una cuenta común (40000000, la de todos los que no tienen la suya) no es de nadie.
  if (c.isCommon) return null
  const deEsta = enlaces.filter((l) => l.companyAccountId === c.id && l.role !== 'gasto' && l.role !== 'pago' && l.role !== 'suplidos')
  const de = (entity: EnlacePlan['entity']) => deEsta.find((l) => l.entity === entity)
  const orden: [EnlacePlan['entity'], DuenoCuenta['tipo']][] = [['supplier', 'proveedor'], ['bank_account', 'banco'], ['customer', 'cliente'], ['tax_rate', 'iva']]
  for (const [entity, tipo] of orden) {
    const l = de(entity)
    if (l) return { tipo, id: l.entityId }
  }
  return null
}

/** «Qué se apunta aquí» de cada subcuenta de IVA: el ejemplo de su tipo en la tabla del C00 (respuesta 3). */
export function ejemplosDeIva(cuentas: readonly CuentaPlan[], enlaces: readonly EnlacePlan[], tiposIva: readonly { id: string; example: string | null }[]): Map<string, string> {
  const m = new Map<string, string>()
  const ejemplo = new Map(tiposIva.filter((t) => t.example).map((t) => [t.id, t.example!]))
  const propias = new Set(cuentas.filter((c) => c.kind === 'own').map((c) => c.id))
  for (const l of enlaces) if (l.entity === 'tax_rate' && propias.has(l.companyAccountId) && ejemplo.has(l.entityId)) m.set(l.companyAccountId, ejemplo.get(l.entityId)!)
  return m
}
