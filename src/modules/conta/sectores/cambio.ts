// src/modules/conta/sectores/cambio.ts
//
// G03 · Lo que dice el aviso al cambiar de sector: qué saldrá y qué dejará de
// salir. Se saca del menú (las páginas con `solo`) y de las tarjetas de cada
// paquete: no hay una segunda lista que se pueda quedar atrás. Puro.

import { PRODUCTOS, type Condicion } from '@/modules/conta/esqueleto/productos'
import { PAQUETES, type Enciende, type Sector } from './sectores'

const esDeSector = (c: Condicion | undefined): c is Enciende => c === 'hosteleria' || c === 'gestoria'

/** Las páginas del menú que enciende cada condición de sector, por su nombre. */
export function paginasQueEnciende(que: Enciende): string[] {
  const out: string[] = []
  for (const p of PRODUCTOS) {
    if (p.ruta === null) continue
    if (esDeSector(p.solo) && p.solo === que) { out.push(p.etiqueta); continue }
    for (const t of p.pestanas) if (t.ruta !== null && esDeSector(t.solo) && t.solo === que) out.push(t.etiqueta)
  }
  return out
}

/** Todo lo que sale con un sector y no sale en la base: páginas y tarjetas. */
export function loQueSaleCon(sector: Sector): string[] {
  const p = PAQUETES[sector]
  return [...p.enciende.flatMap(paginasQueEnciende), ...p.tarjetas]
}

export interface Cambio { saldra: string[]; dejaraDeSalir: string[] }

export function cambioDeSector(de: Sector, a: Sector): Cambio {
  const antes = loQueSaleCon(de)
  const despues = loQueSaleCon(a)
  return { saldra: despues.filter((x) => !antes.includes(x)), dejaraDeSalir: antes.filter((x) => !despues.includes(x)) }
}

/** «Saldrá: … Dejará de salir: … No se borra nada.» */
export function fraseDelCambio(c: Cambio): string {
  const partes: string[] = []
  if (c.saldra.length) partes.push(`Saldrá: ${c.saldra.join(', ')}.`)
  if (c.dejaraDeSalir.length) partes.push(`Dejará de salir: ${c.dejaraDeSalir.join(', ')}.`)
  if (!partes.length) partes.push('No cambia lo que sale.')
  partes.push('No se borra nada.')
  return partes.join(' ')
}
