// supabase/functions/_shared/diezSubcuentas.ts
//
// C04b R5 · Antes de enviar a Diez, las subcuentas que Diez no tenga se crean
// primero allí, con el MISMO código y nombre que en Folvy (Julio, 13/10). Desde
// octubre Folvy usa subcuentas que el plan de Diez no tiene (47700010, y las
// 7080000x de Scandal Burgers, The Urban Kebab y Dirty Burger).
//
// Frenos (además de los del cliente: solo C0009 sin escribirEnReal):
//   · el código tiene que tener los dígitos del plan de Diez (8) y ser solo
//     números: lo que no, PARA sin crear nada;
//   · el nombre no se recorta: si pasa de 60 (el máximo de Descripcion), PARA;
//   · una que ya está en Diez con OTRO nombre no se toca y se dice;
//   · después de crear, se vuelve a leer el plan: cada una tiene que estar, con
//     su nombre. Si no, falla (regla 8: nada se da por hecho).

import type { ClienteDiez } from './diezCliente.ts'

export const DIGITOS_DIEZ = 8
export const MAX_DESCRIPCION = 60

export type SubcuentaFolvy = { codigo: string; nombre: string }
export type PlanDiez = Map<string, string> // código → descripción

export function planDeDiez(filas: readonly Record<string, unknown>[]): PlanDiez {
  return new Map(filas.map((f): [string, string] => [String(f.Codigo ?? '').trim(), String(f.Descripcion ?? '').trim()]).filter(([c]) => c !== ''))
}

const normal = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase()

export interface QueCrear {
  crear: SubcuentaFolvy[]
  /** Ya están en Diez con otro nombre: no se tocan; se dice. */
  otroNombre: { codigo: string; folvy: string; diez: string }[]
  /** No se pueden crear: por qué. Si hay alguna, no se crea ninguna. */
  frenos: string[]
}

/** Qué hay que crear en Diez para que existan todas las subcuentas que usan los asientos. */
export function subcuentasQueFaltan(usadas: readonly SubcuentaFolvy[], plan: PlanDiez): QueCrear {
  const vistas = new Map<string, SubcuentaFolvy>()
  for (const u of usadas) if (!vistas.has(u.codigo)) vistas.set(u.codigo, u)
  const r: QueCrear = { crear: [], otroNombre: [], frenos: [] }
  for (const u of [...vistas.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))) {
    if (!new RegExp(`^\\d{${DIGITOS_DIEZ}}$`).test(u.codigo)) { r.frenos.push(`${u.codigo}: no tiene ${DIGITOS_DIEZ} dígitos, como el plan de Diez`); continue }
    const enDiez = plan.get(u.codigo)
    if (enDiez !== undefined) {
      if (normal(enDiez) !== normal(u.nombre)) r.otroNombre.push({ codigo: u.codigo, folvy: u.nombre, diez: enDiez })
      continue
    }
    if (!u.nombre.trim()) { r.frenos.push(`${u.codigo}: sin nombre en Folvy`); continue }
    if (u.nombre.trim().length > MAX_DESCRIPCION) { r.frenos.push(`${u.codigo}: el nombre pasa de ${MAX_DESCRIPCION} caracteres y Diez lo cortaría`); continue }
    r.crear.push({ codigo: u.codigo, nombre: u.nombre.trim() })
  }
  return r
}

export interface ParteSubcuentas { creadas: string[]; yaEstaban: number; otroNombre: QueCrear['otroNombre'] }

/**
 * Lee el plan de Diez, crea lo que falte y lo comprueba leyendo otra vez.
 * PARA (lanza) si hay frenos o si, después, alguna no está con su nombre.
 */
export async function asegurarSubcuentas(c: Pick<ClienteDiez, 'subcuentas' | 'crearSubcuenta'>, usadas: readonly SubcuentaFolvy[]): Promise<ParteSubcuentas> {
  const antes = planDeDiez(await c.subcuentas())
  const q = subcuentasQueFaltan(usadas, antes)
  if (q.frenos.length) throw new Error(`Subcuentas para Diez: no se crea ninguna. ${q.frenos.join(' · ')}`)
  for (const s of q.crear) await c.crearSubcuenta({ Codigo: s.codigo, Descripcion: s.nombre })
  if (q.crear.length) {
    const despues = planDeDiez(await c.subcuentas())
    const mal = q.crear.filter((s) => normal(despues.get(s.codigo) ?? '') !== normal(s.nombre))
    if (mal.length) throw new Error(`Subcuentas para Diez: después de crearlas no están (o no con su nombre): ${mal.map((s) => s.codigo).join(', ')}`)
  }
  return { creadas: q.crear.map((s) => s.codigo), yaEstaban: new Set(usadas.map((u) => u.codigo)).size - q.crear.length - q.frenos.length, otroNombre: q.otroNombre }
}
