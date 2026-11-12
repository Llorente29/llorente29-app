// supabase/functions/_shared/avisos/cola.ts
//
// G01d · Tarea 2 · La cola de avisos, sin red ni base. Puro.
//
//   · Cada aviso se trata UNA vez: el que ya está en la cola (por su clave)
//     no vuelve a entrar, tampoco si llega repetido en el mismo envío.
//   · Del CRM, ficha a ficha: de varios avisos pendientes de la misma ficha
//     cuenta el último (por su ts; a igual ts, la baja). Un alta o un cambio
//     es leer esa ficha; una baja no borra nada en Sumied: sale en
//     «Pendiente de revisar» (Julio, encargo G01d).
//   · De GoCardless, por empresa emisora: los avisos se juntan unos 30 s y
//     entonces se relee la cuenta entera de esa empresa, con las mismas reglas
//     que la lectura de siempre (Julio, 08/11: opción a). Si siguen llegando,
//     a los 2 min se relee igual, para no esperar sin fin.
//   · Si un trabajo falla, se repite más tarde (Bitrix24 no reintenta): a los
//     1, 2, 5, 15 y 30 min. Después se deja: lo recoge la lectura de la noche,
//     y el registro dice por qué.

import type { AvisoCrm, AvisoGc } from './leerAviso.ts'

/** Los avisos que aún no estaban: sin los que ya se vieron ni los repetidos del mismo envío. */
export function sinRepetidos<T extends { clave: string }>(nuevos: readonly T[], yaVistas: ReadonlySet<string>): T[] {
  const vistas = new Set(yaVistas)
  const out: T[] = []
  for (const a of nuevos) {
    if (vistas.has(a.clave)) continue
    vistas.add(a.clave)
    out.push(a)
  }
  return out
}

/** Lo que hay que hacer con una ficha del CRM. */
export type TrabajoCrm =
  | { tipo: 'leer_ficha'; crm: string; tipoFicha: AvisoCrm['tipoFicha']; idExterno: string; claves: string[] }
  | { tipo: 'baja'; crm: string; tipoFicha: AvisoCrm['tipoFicha']; idExterno: string; claves: string[] }

const PESO_ACCION: Record<AvisoCrm['accion'], number> = { alta: 0, cambio: 1, baja: 2 }

/** Del CRM: un trabajo por ficha, con el último aviso de cada una. Cada trabajo lleva las claves de los avisos que cubre. */
export function trabajosDelCrm(pendientes: readonly AvisoCrm[]): TrabajoCrm[] {
  const porFicha = new Map<string, AvisoCrm[]>()
  for (const a of pendientes) {
    const k = `${a.crm}:${a.tipoFicha}:${a.idExterno}`
    porFicha.set(k, [...(porFicha.get(k) ?? []), a])
  }
  const out: TrabajoCrm[] = []
  for (const avisos of porFicha.values()) {
    const ultimo = [...avisos].sort((x, y) => x.ts - y.ts || PESO_ACCION[x.accion] - PESO_ACCION[y.accion]).at(-1)!
    out.push({ tipo: ultimo.accion === 'baja' ? 'baja' : 'leer_ficha', crm: ultimo.crm, tipoFicha: ultimo.tipoFicha, idExterno: ultimo.idExterno,
      claves: avisos.map((a) => a.clave).sort() })
  }
  return out.sort((a, b) => a.crm.localeCompare(b.crm) || a.tipoFicha.localeCompare(b.tipoFicha) || Number(a.idExterno) - Number(b.idExterno))
}

export const JUNTAR_GC_MS = 30_000
export const COMO_MUCHO_GC_MS = 120_000

/** Un aviso de GoCardless en la cola: de qué empresa emisora y cuándo llegó a Sumied. */
export interface AvisoGcEnCola { aviso: AvisoGc; empresa: string; llegada: number }

export interface TrabajoGc { tipo: 'releer_empresa'; empresa: string; claves: string[] }

/**
 * De GoCardless: las empresas que ya toca releer (las demás esperan a juntar
 * más avisos). Toca cuando el último aviso tiene 30 s, o el primero 2 min.
 */
export function trabajosDeGoCardless(pendientes: readonly AvisoGcEnCola[], ahora: number): TrabajoGc[] {
  const porEmpresa = new Map<string, AvisoGcEnCola[]>()
  for (const p of pendientes) porEmpresa.set(p.empresa, [...(porEmpresa.get(p.empresa) ?? []), p])
  const out: TrabajoGc[] = []
  for (const [empresa, ps] of porEmpresa) {
    const primero = Math.min(...ps.map((p) => p.llegada))
    const ultimo = Math.max(...ps.map((p) => p.llegada))
    if (ahora - ultimo >= JUNTAR_GC_MS || ahora - primero >= COMO_MUCHO_GC_MS) {
      out.push({ tipo: 'releer_empresa', empresa, claves: ps.map((p) => p.aviso.clave).sort() })
    }
  }
  return out.sort((a, b) => a.empresa.localeCompare(b.empresa))
}

export const REINTENTOS_MIN = [1, 2, 5, 15, 30] as const

/** Cuándo se repite un trabajo que ha fallado (null: ya no; lo recoge la lectura de la noche). */
export function siguienteIntento(intentosHechos: number, ahora: number): number | null {
  const espera = REINTENTOS_MIN[intentosHechos - 1]
  return espera === undefined ? null : ahora + espera * 60_000
}
