// src/modules/conta/lib/planVista.ts
//
// C02, tarea 4 · Lo que enseña la pantalla «Plan contable» (maqueta N5Plan,
// dentro del marco de N6). Puro y probado (tests/unit/modules/conta/planVistaC02.test.ts):
// la pantalla solo pinta lo que sale de aquí.
//
//   · Filas de un grupo: las cuentas del cuadro con hijas como CABECERA (código
//     corto, desde pgc_account: no se apunta en ellas, D2), las hojas de la
//     empresa con su código completo, y sus subcuentas sangradas debajo.
//   · «Las que usas» / «Todas»: un umbral ORDENA, no esconde (regla 7). Con
//     «Las que usas», las que tienen algo van arriba y las demás siguen
//     debajo, en gris; con «Todas», en orden de código.
//   · Buscar por nombre, número, «qué se apunta aquí» o palabra clave:
//     «alquiler» encuentra la 621 por lo que se apunta en ella.
//   · «Qué se apunta aquí» en TODA cuenta de apunte (respuesta 3): la suya; si
//     su hoja no tiene uno propio, el de la cuenta de arriba más cercana que lo
//     tenga (40000000 → el de la 400). Las subcuentas de IVA, el ejemplo de su
//     tipo en la tabla del C00 (`plainDe`); las de terceros llevan «1 proveedor».
//     Si ni la cuenta ni ninguna de arriba tiene texto (respuesta 4), la primera
//     frase de la definición del BOE (quinta parte) del código más cercano hacia
//     arriba que la tenga, marcada `plainPgc` para que la pantalla le ponga
//     «(PGC)». No se guarda en plain_name: cuando llegue el texto de hostelería,
//     lo sustituye solo.

import type { Entidad, EstadoCuenta, Papel } from '@/modules/conta/lib/planEmpresa'

export interface CuentaSeriePlan {
  code: string; name: string; plainName: string | null; groupCode: number; parentCode: string | null; isLeaf: boolean
  /** Primera frase de su definición en la quinta parte del BOE (pgc_account.boe_definition), o null. */
  boeDefinition?: string | null
}
export interface CuentaPlan {
  id: string; code: string; templateCode: string; name: string; plainName: string | null; keywords: string[]
  kind: 'template' | 'own'; status: EstadoCuenta; isCommon: boolean; source: 'serie' | 'manual' | 'ai_accepted' | 'migrated'
}
export interface EnlacePlan { companyAccountId: string; entity: Entidad; entityId: string; role: Papel }

/** «traida»: tuya, venida de otro programa con su número (C02c). */
export type Origen = 'serie' | 'tuya' | 'propuesta' | 'traida' | 'generica'

/**
 * El origen de una cuenta de la empresa. «generica»: traída de otro programa y
 * colgada de una cuenta del cuadro CON hijas (la 16000000 de Diez bajo la 160;
 * respuesta 2 del C02c). `esHoja` dice si su template_code es hoja del cuadro.
 */
export const origenDe = (c: Pick<CuentaPlan, 'source' | 'kind'>, esHoja = true): Origen =>
  (c.source === 'migrated' ? (esHoja ? 'traida' : 'generica') : c.source === 'ai_accepted' || c.kind === 'own' ? 'tuya' : 'serie')
export interface FilaPlan {
  clave: string
  tipo: 'subgrupo' | 'cabecera' | 'cuenta' | 'subcuenta'
  /** Lo que se enseña en NÚMERO: corto en las cabeceras, completo en las de apunte. */
  numero: string
  titulo: string
  plain: string | null
  /** `plain` es la definición del BOE (reserva), no un texto de Folvy: se enseña con «(PGC)». */
  plainPgc: boolean
  lleva: string | null
  origen: Origen | null
  usada: boolean
  cuentaId: string | null
  estado: EstadoCuenta | null
}

const ENTIDAD: Record<Entidad, [string, string]> = {
  supplier: ['proveedor', 'proveedores'], customer: ['cliente', 'clientes'], bank_account: ['banco', 'bancos'],
  expense_category: ['tipo de gasto', 'tipos de gasto'], tax_rate: ['tipo de IVA', 'tipos de IVA'], withholding_rate: ['retención', 'retenciones'],
}

/** «14 proveedores», «2 tipos de IVA · 1 retención»: lo que lleva enlazado una cuenta (el importe del año llega con el C04). */
export function loQueLleva(enlaces: readonly EnlacePlan[]): string | null {
  if (!enlaces.length) return null
  const porEntidad = new Map<Entidad, Set<string>>()
  for (const l of enlaces) porEntidad.set(l.entity, (porEntidad.get(l.entity) ?? new Set()).add(l.entityId))
  return [...porEntidad].map(([e, ids]) => `${ids.size} ${ids.size === 1 ? ENTIDAD[e][0] : ENTIDAD[e][1]}`).join(' · ')
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** ¿Encaja la búsqueda? Por número (empieza por), nombre, qué se apunta o palabra clave. */
export function encaja(q: string, c: { code: string; name: string; plainName: string | null; keywords?: readonly string[] }): boolean {
  const t = sinAcentos(q.trim())
  if (!t) return true
  if (/^\d+$/.test(t)) return c.code.startsWith(t)
  const texto = sinAcentos([c.name, c.plainName ?? '', ...(c.keywords ?? [])].join(' '))
  return t.split(/\s+/).every((p) => texto.includes(p))
}

export interface EntradaVista {
  serie: readonly CuentaSeriePlan[]
  cuentas: readonly CuentaPlan[]
  enlaces: readonly EnlacePlan[]
  grupo: number | null
  busqueda: string
  orden: 'usadas' | 'todas'
  /** «Qué se apunta aquí» que no sale de la serie: el de cada subcuenta de IVA (id de cuenta → ejemplo del tipo, C00). */
  plainDe?: ReadonlyMap<string, string>
}

/** El «qué se apunta aquí» de una cuenta del cuadro: el suyo o el de la cuenta de arriba más cercana. */
export function plainHeredado(code: string, porCodigo: ReadonlyMap<string, CuentaSeriePlan>): string | null {
  for (let s = porCodigo.get(code); s; s = s.parentCode ? porCodigo.get(s.parentCode) : undefined) {
    if (s.plainName) return s.plainName
  }
  return null
}

/** La primera frase de la definición del BOE de una cuenta del cuadro: la suya o la de la cuenta de arriba más cercana. */
export function definicionHeredada(code: string, porCodigo: ReadonlyMap<string, CuentaSeriePlan>): string | null {
  for (let s = porCodigo.get(code); s; s = s.parentCode ? porCodigo.get(s.parentCode) : undefined) {
    if (s.boeDefinition) return s.boeDefinition
  }
  return null
}

export interface QueSeApunta { texto: string; pgc: boolean }

/**
 * «Qué se apunta aquí» de una cuenta de la empresa, en este orden: el suyo; el
 * ejemplo de su tipo de IVA (`plainDe`); nada si es la subcuenta de un tercero
 * (ya dice «1 proveedor»); el heredado de la serie; la definición del BOE.
 */
export function queSeApunta(
  c: CuentaPlan,
  e: { serie: readonly CuentaSeriePlan[]; enlaces: readonly EnlacePlan[]; plainDe?: ReadonlyMap<string, string> },
  serieCodigo: ReadonlyMap<string, CuentaSeriePlan> = new Map(e.serie.map((s) => [s.code, s])),
): QueSeApunta | null {
  if (c.plainName) return { texto: c.plainName, pgc: false }
  const propio = e.plainDe?.get(c.id)
  if (propio) return { texto: propio, pgc: false }
  const deTercero = e.enlaces.some((l) => l.companyAccountId === c.id && l.role === 'principal' && ['supplier', 'customer', 'bank_account'].includes(l.entity))
  if (c.kind === 'own' && deTercero) return null
  const heredado = plainHeredado(c.templateCode, serieCodigo)
  if (heredado) return { texto: heredado, pgc: false }
  const boe = definicionHeredada(c.templateCode, serieCodigo)
  return boe ? { texto: boe, pgc: true } : null
}

/**
 * Las filas de la tabla. Con búsqueda, se busca en TODOS los grupos (no se
 * esconde nada por estar en otro grupo) y salen las cuentas que encajan con
 * sus cabeceras para que se entienda dónde están.
 */
export function filasPlan(e: EntradaVista): FilaPlan[] {
  const porHoja = new Map<string, CuentaPlan[]>()
  for (const c of e.cuentas) porHoja.set(c.templateCode, [...(porHoja.get(c.templateCode) ?? []), c])
  const enlacesDe = new Map<string, EnlacePlan[]>()
  for (const l of e.enlaces) enlacesDe.set(l.companyAccountId, [...(enlacesDe.get(l.companyAccountId) ?? []), l])
  const buscando = e.busqueda.trim() !== ''
  const serie = e.serie.filter((s) => s.code.length > 1 && (buscando || e.grupo === null || s.groupCode === e.grupo))
  const usadaCuenta = (c: CuentaPlan) => c.kind === 'own' || (enlacesDe.get(c.id)?.length ?? 0) > 0
  const serieCodigo = new Map(e.serie.map((s) => [s.code, s]))
  const filaCuenta = (c: CuentaPlan, tipo: 'cuenta' | 'subcuenta'): FilaPlan => {
    const q = queSeApunta(c, e, serieCodigo)
    return {
      clave: c.id, tipo, numero: c.code, titulo: c.name, plain: q?.texto ?? null, plainPgc: q?.pgc ?? false, lleva: loQueLleva(enlacesDe.get(c.id) ?? []),
      origen: origenDe(c, serieCodigo.get(c.templateCode)?.isLeaf ?? true), usada: usadaCuenta(c), cuentaId: c.id, estado: c.status,
    }
  }

  const salida: FilaPlan[] = []
  for (const s of serie) {
    if (!s.isLeaf) {
      salida.push({ clave: `s:${s.code}`, tipo: s.code.length === 2 ? 'subgrupo' : 'cabecera', numero: s.code, titulo: s.name, plain: s.plainName, plainPgc: false,
        lleva: null, origen: null, usada: false, cuentaId: null, estado: null })
      continue
    }
    const deLaHoja = porHoja.get(s.code) ?? []
    const hoja = deLaHoja.find((c) => c.kind === 'template')
    const subs = deLaHoja.filter((c) => c.kind === 'own').sort((a, b) => a.code.localeCompare(b.code))
    if (hoja) salida.push(filaCuenta(hoja, 'cuenta'))
    for (const c of subs) salida.push(filaCuenta(c, 'subcuenta'))
  }
  // Una cabecera es «usada» si algo de debajo lo está (para ordenar el grupo).
  for (let i = salida.length - 1; i >= 0; i--) {
    const f = salida[i]
    if (f.tipo === 'cabecera' || f.tipo === 'subgrupo') f.usada = salida.some((g) => g.usada && g.cuentaId && g.numero.startsWith(f.numero))
  }

  let filas = salida
  if (buscando) {
    const quedan = new Set<string>()
    for (const f of salida) {
      if (!f.cuentaId) continue
      const c = e.cuentas.find((x) => x.id === f.cuentaId)!
      if (encaja(e.busqueda, c) || encaja(e.busqueda, { code: c.templateCode, name: '', plainName: null })) quedan.add(f.clave)
    }
    for (const s of e.serie.filter((x) => !x.isLeaf && encaja(e.busqueda, x))) {
      for (const f of salida) if (f.cuentaId && f.numero.startsWith(s.code)) quedan.add(f.clave)
    }
    // Con sus cabeceras, para que se vea dónde está.
    filas = salida.filter((f) => quedan.has(f.clave) || (!f.cuentaId && [...quedan].some((k) => salida.find((g) => g.clave === k)!.numero.startsWith(f.numero))))
  }
  if (e.orden === 'usadas') {
    // Estable: dentro de cada subgrupo, primero las ramas usadas; nada se quita.
    const bloques: FilaPlan[][] = []
    for (const f of filas) {
      if (f.tipo === 'subgrupo' || bloques.length === 0) bloques.push([f])
      else bloques[bloques.length - 1].push(f)
    }
    filas = bloques.flatMap((b) => {
      const [cabeza, ...resto] = b.length && b[0].tipo === 'subgrupo' ? [b[0], ...b.slice(1)] : [null, ...b]
      const ramas: FilaPlan[][] = []
      for (const f of resto) {
        if (f.tipo === 'cabecera' || ramas.length === 0) ramas.push([f])
        else ramas[ramas.length - 1].push(f)
      }
      const usadas = ramas.filter((r) => r.some((f) => f.usada))
      const otras = ramas.filter((r) => !r.some((f) => f.usada))
      return [...(cabeza ? [cabeza] : []), ...usadas.flat(), ...otras.flat()]
    })
  }
  return filas
}

/** Cuántas cuentas de apunte tiene cada grupo (las píldoras 1–7 / 1–9). */
export function cuentasPorGrupo(cuentas: readonly CuentaPlan[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const c of cuentas) m.set(Number(c.code[0]), (m.get(Number(c.code[0])) ?? 0) + 1)
  return m
}

/** «Pymes · 8 dígitos · 615 cuentas» (la línea del índice de Ajustes; la cifra real, D2). */
export function resumenPlan(p: { plan: 'pymes' | 'general'; digitos: number; cuentas: number } | null): string {
  if (!p) return 'Sin activar'
  return `${p.plan === 'pymes' ? 'Pymes' : 'General'} · ${p.digitos} dígitos · ${p.cuentas.toLocaleString('es-ES')} cuentas`
}

/** «Plan de pymes · subcuentas de 8 dígitos · la longitud queda fija con el primer asiento» (cabecera de N5). */
export const lineaDelPlan = (p: { plan: 'pymes' | 'general'; digitos: number }): string =>
  `Plan de ${p.plan === 'pymes' ? 'pymes' : 'general'} · subcuentas de ${p.digitos} dígitos · la longitud queda fija con el primer asiento`
