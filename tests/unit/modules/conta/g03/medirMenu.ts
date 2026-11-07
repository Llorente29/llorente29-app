// tests/unit/modules/conta/g03/medirMenu.ts
//
// G03 · La vara de medir (regla 31): lo que ve una empresa, medido IGUAL en
// `main` y en la rama. Solo usa lo que existe en los dos lados: el menú
// (PRODUCTOS, productoVisible, pestanasVisibles) y las órdenes del buscador y
// Favoritos (ORDENES, ordenDisponible). Las tarjetas de dentro de las
// pantallas las decide `useHosteleria()`, que lee `ctx.hosteleria`: se mide
// ese valor; lo de gestoría de dentro (Cobros), `ctx.asesoria` antes y
// `ctx.gestoria` después, y se mide como «cobrosGestoria».
//
// Se mide para TODAS las combinaciones de Diez, interruptores de la cuenta y
// producto suelto: así no hace falta saber cuáles tiene cada cuenta hoy.

import { INTERRUPTORES, PRODUCTOS, pestanasVisibles, productoVisible, type Contexto } from '@/modules/conta/esqueleto/productos'
import { ORDENES, ordenDisponible } from '@/modules/conta/esqueleto/ordenes'

/** Lo que pone el lado medido en el contexto a partir de la empresa (su fila de company y si la cuenta es asesoría). */
export type DeLaEmpresa = (fila: Record<string, unknown>, asesoria: boolean) => Partial<Contexto> & { hosteleria: boolean }

export interface Empresa { quien: string; fila: Record<string, unknown>; asesoria: boolean }

export function combinaciones(): Omit<Contexto, 'hosteleria'>[] {
  const out: Omit<Contexto, 'hosteleria'>[] = []
  const n = INTERRUPTORES.length
  for (let m = 0; m < 1 << n; m++) {
    const interruptores = new Set(INTERRUPTORES.filter((_, i) => m & (1 << i)))
    for (const diez of [false, true]) for (const solo of [false, true]) out.push({ diez, interruptores, solo })
  }
  return out
}

const claveDe = (c: Omit<Contexto, 'hosteleria'>) => `diez=${c.diez} solo=${c.solo} ${[...c.interruptores].sort().join(',') || 'sin interruptores'}`

/** Lo que ve una empresa, por combinación: menú, páginas, órdenes y lo de dentro. */
export function medir(e: Empresa, deLaEmpresa: DeLaEmpresa, cobrosGestoria: (ctx: Contexto) => boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const base of combinaciones()) {
    const ctx: Contexto = { ...base, ...deLaEmpresa(e.fila, e.asesoria) } as Contexto
    out[claveDe(base)] = {
      menu: PRODUCTOS.filter((p) => productoVisible(p, ctx)).map((p) => `${p.id}: ${pestanasVisibles(p, ctx).map((t) => t.id).join(' ')}`),
      ordenes: ORDENES.filter((o) => ordenDisponible(o, ctx)).map((o) => o.id),
      tarjetasHosteleria: ctx.hosteleria,
      cobrosGestoria: cobrosGestoria(ctx),
    }
  }
  return out
}

/** Para guardar la foto: cada vista distinta una vez, y cada empresa y combinación apunta a la suya. */
export function foto(porEmpresa: Record<string, Record<string, unknown>>): { vistas: unknown[]; empresas: Record<string, Record<string, number>> } {
  const vistas: unknown[] = []
  const indice = new Map<string, number>()
  const empresas: Record<string, Record<string, number>> = {}
  for (const [quien, combos] of Object.entries(porEmpresa)) {
    empresas[quien] = {}
    for (const [combo, vista] of Object.entries(combos)) {
      const k = JSON.stringify(vista)
      if (!indice.has(k)) { indice.set(k, vistas.length); vistas.push(vista) }
      empresas[quien][combo] = indice.get(k)!
    }
  }
  return { vistas, empresas }
}
