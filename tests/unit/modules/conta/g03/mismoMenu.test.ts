// tests/unit/modules/conta/g03/mismoMenu.test.ts
//
// G03 · Tarea 2 · La prueba que manda: Foodint (y el resto de empresas de
// producción) ve el MISMO menú, las mismas páginas, las mismas órdenes del
// buscador y Favoritos y las mismas tarjetas antes y después (regla 31: la
// misma vara a los dos lados).
//   · Antes: foto-antes.json, sacada sobre `main` (45585d8) con medirMenu.ts
//     (generarAntes.test.ts dice cómo).
//   · Después: la misma vara, con el contexto que arma ahora la app
//     (loQueEnciendeLaEmpresa) y la tarjeta de Cobros con `gestoria`.
// Se mide sin la columna `sector` (el front publicado antes que la base) y con
// ella, rellena como dirá la tanda.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loQueEnciendeLaEmpresa } from '@/modules/conta/sectores/sectores'
import { foto, medir, type Empresa } from './medirMenu'
import { HOY } from './poblacion'

const ANTES = JSON.parse(readFileSync(join(__dirname, 'foto-antes.json'), 'utf8')) as ReturnType<typeof foto>
const vistaAntes = (quien: string) => Object.fromEntries(Object.entries(ANTES.empresas[quien]).map(([c, i]) => [c, conG04(ANTES.vistas[i])]))

/**
 * G04 (maqueta del 08/11) · El único cambio que se quiere en el menú: «Clientes
 * y cuotas» deja de ser una pestaña de Ventas y pasa a ser un apartado propio,
 * con Clientes y Tarifa y paquetes (solo donde salía: con el sector Gestoría).
 * Lo demás, igual que en la foto de antes.
 */
function conG04(v: unknown): unknown {
  const x = v as { menu: string[]; ordenes: string[] }
  if (!x.menu.some((l) => l.startsWith('facturacion:') && l.split(' ').includes('clientesCuotas'))) return v
  const menu = x.menu.flatMap((l) => (l.startsWith('facturacion:')
    ? ['clientesCuotas: clientesGestoria tarifasGestoria', l.split(' ').filter((t) => t !== 'clientesCuotas').join(' ')] : [l]))
  // En el buscador, sus dos entradas van donde va el apartado: antes de las de Ventas.
  const ordenes = x.ordenes.filter((o) => o !== 'ir.facturacion.clientesCuotas')
  const i = ordenes.findIndex((o) => o.startsWith('ir.facturacion.'))
  ordenes.splice(i < 0 ? ordenes.length : i, 0, 'ir.clientesCuotas.clientesGestoria', 'ir.clientesCuotas.tarifasGestoria')
  return { ...x, menu, ordenes }
}

const despues = (e: Empresa) => medir(e,
  (fila, asesoria) => ({ ...loQueEnciendeLaEmpresa(fila, asesoria), asesoria }),
  (ctx) => ctx.gestoria === true)

/** Después de la tanda: la misma empresa con su `sector` (is_hospitality se mantiene igual). */
const CON_COLUMNA: Empresa[] = [
  { quien: 'Foodint', fila: { is_hospitality: true, sector: 'hosteleria' }, asesoria: false },
  { quien: 'Piri Piri (sus 3 empresas)', fila: { is_hospitality: true, sector: 'hosteleria' }, asesoria: false },
  { quien: 'Asesoría QBO (sus 2 empresas)', fila: { is_hospitality: false, sector: 'gestoria' }, asesoria: true },
]

describe('G03 · lo que ve cada empresa, antes y después', () => {
  it('la foto de antes tiene las cuatro empresas y sus 32 combinaciones', () => {
    expect(Object.keys(ANTES.empresas)).toEqual(HOY.map((e) => e.quien))
    for (const e of HOY) expect(Object.keys(ANTES.empresas[e.quien])).toHaveLength(32)
  })

  it('Foodint ve exactamente lo mismo, sin la columna y con ella', () => {
    const antes = vistaAntes('Foodint')
    expect(despues(HOY[0])).toEqual(antes)
    expect(despues(CON_COLUMNA[0])).toEqual(antes)
  })

  it.each(HOY.map((e) => [e.quien, e] as const))('%s: sin la columna, lo mismo que hoy', (quien, e) => {
    expect(despues(e)).toEqual(vistaAntes(quien))
  })

  it.each(CON_COLUMNA.map((e) => [e.quien, e] as const))('%s: con su sector, lo mismo que hoy', (quien, e) => {
    expect(despues(e)).toEqual(vistaAntes(quien))
  })

  it('la vara no es un espejo: una empresa de hostelería que pasara a general dejaría de ver Cierres del día', () => {
    const otra = despues({ quien: 'Foodint', fila: { is_hospitality: true, sector: 'general' }, asesoria: false })
    expect(otra).not.toEqual(vistaAntes('Foodint'))
  })
})
