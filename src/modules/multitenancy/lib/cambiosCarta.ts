// src/modules/multitenancy/lib/cambiosCarta.ts
//
// F01 · PR 2 · Los cambios de carta de una marca de Last (tablero 5). Lo que
// devuelve f01_cambios_carta y cómo se dice. Sin React ni Supabase: lo prueban
// las unitarias.

import { enumerar, fechaCorta, nombreCanal } from './marcasLast'

export interface Propuesta {
  ficha: string
  fichaNombre: string
  tipo: 'add_item' | 'remove_item'
  cantidad: number | null
  unidad: string | null
  unidadNombre: string | null
}

export interface ExtraNuevo {
  modifierId: string
  nombre: string
  pregunta: string | null
  precio: number
  enFolvy: boolean
  propuesta: Propuesta | null
  estado: 'propuesto' | 'falta'
}

export interface CambiosMarca {
  brandId: string
  nombre: string
  platosNuevos: { matricula: string; nombre: string; precio: number }[]
  extrasNuevos: ExtraNuevo[]
  retirados: { menuItemId: string; nombre: string; visto: string | null }[]
  precios: { menuItemId: string; nombre: string; canal: string | null; antes: number; despues: number }[]
  preciosPuestos30d: number
}

type Fila = Record<string, unknown>
const lista = (v: unknown): Fila[] => (Array.isArray(v) ? (v as Fila[]) : [])
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0)

export function leerCambios(datos: unknown): CambiosMarca[] {
  return lista(datos).map((c) => ({
    brandId: String(c.brand_id ?? ''),
    nombre: String(c.nombre ?? ''),
    platosNuevos: lista(c.platos_nuevos).map((p) => ({ matricula: String(p.matricula ?? ''), nombre: String(p.nombre ?? '').trim(), precio: num(p.precio) })),
    extrasNuevos: lista(c.extras_nuevos).map((e) => {
      const p = e.propuesta as Fila | null
      return {
        modifierId: String(e.modifier_id ?? ''),
        nombre: String(e.nombre ?? '').trim(),
        pregunta: txt(e.pregunta),
        precio: num(e.precio),
        enFolvy: e.en_folvy === true,
        propuesta: p ? {
          ficha: String(p.ficha ?? ''), fichaNombre: String(p.ficha_nombre ?? ''),
          tipo: p.tipo === 'remove_item' ? 'remove_item' : 'add_item',
          cantidad: p.cantidad === null || p.cantidad === undefined ? null : num(p.cantidad),
          unidad: txt(p.unidad), unidadNombre: txt(p.unidad_nombre),
        } : null,
        estado: e.estado === 'propuesto' ? 'propuesto' : 'falta',
      }
    }),
    retirados: lista(c.retirados).map((r) => ({ menuItemId: String(r.menu_item_id ?? ''), nombre: String(r.nombre ?? '').trim(), visto: txt(r.visto) })),
    precios: lista(c.precios).map((p) => ({
      menuItemId: String(p.menu_item_id ?? ''), nombre: String(p.nombre ?? '').trim(), canal: txt(p.canal), antes: num(p.antes), despues: num(p.despues),
    })),
    preciosPuestos30d: num(c.precios_puestos_30d),
  }))
}

/** ¿Hay algo que decidir? (lo que avisa en Inicio: los retirados solos no interrumpen). */
export const pideDecidir = (c: CambiosMarca): boolean => c.platosNuevos.length > 0 || c.extrasNuevos.length > 0 || c.precios.length > 0
/** ¿Hay algo que enseñar en la pantalla? */
export const hayCambios = (c: CambiosMarca): boolean => pideDecidir(c) || c.retirados.length > 0

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
export const euros = (n: number): string => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)

/** El resumen del aviso de Inicio: «2 platos nuevos · 4 extras sin decidir · 5 precios distintos». */
export function resumenCambios(c: CambiosMarca): string {
  const partes: string[] = []
  if (c.platosNuevos.length) partes.push(plural(c.platosNuevos.length, 'plato nuevo', 'platos nuevos'))
  if (c.extrasNuevos.length) partes.push(plural(c.extrasNuevos.length, 'extra sin decidir', 'extras sin decidir'))
  if (c.precios.length) partes.push(plural(c.precios.length, 'precio distinto', 'precios distintos'))
  if (c.retirados.length) partes.push(plural(c.retirados.length, 'plato que ya no está', 'platos que ya no están'))
  return partes.join(' · ')
}

/** Lo que hace un extra en cocina, en palabras de cocina. */
export function queHaceEnCocina(e: ExtraNuevo): { fuerte: string | null; frase: string } {
  const p = e.propuesta
  if (!p) return { fuerte: null, frase: 'No sé qué es. Elígelo del almacén.' }
  const cuanto = p.cantidad !== null ? ` · ${formatoCantidad(p.cantidad)} ${p.unidadNombre ?? ''}`.trimEnd() : ''
  if (p.tipo === 'remove_item') return { fuerte: `${p.fichaNombre}${cuanto}`, frase: p.cantidad === null ? 'Quita de la receta (falta cuánto)' : 'Quita de la receta' }
  return { fuerte: `${p.fichaNombre}${cuanto}`, frase: p.cantidad === null ? 'Añade (falta cuánto)' : 'Añade' }
}
const formatoCantidad = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(n)

/** «Vistos por última vez el 11/10» (la fecha más reciente de los que ya no están). */
export function fraseRetirados(c: CambiosMarca): string {
  const nombres = enumerar(c.retirados.map((r) => r.nombre))
  const fechas = c.retirados.map((r) => r.visto).filter((x): x is string => !!x).sort()
  const cuando = fechas.length ? ` Vistos por última vez el ${fechaCorta(fechas[fechas.length - 1]).slice(0, 5)}.` : ''
  return `${nombres}.${cuando} Se quedan en la carta y en el histórico de ventas.`
}

/** Los precios distintos, agrupados por plataforma: «5 precios distintos en Uber Eats». */
export function frasePrecios(c: CambiosMarca): string {
  const por = new Map<string, number>()
  for (const p of c.precios) {
    const k = p.canal ? nombreCanal(p.canal) : 'la carta'
    por.set(k, (por.get(k) ?? 0) + 1)
  }
  return [...por].map(([k, n]) => `${plural(n, 'precio distinto', 'precios distintos')} en ${k}`).join(' · ')
}

/** Lo que se guarda de los extras propuestos. */
export const lotePropuestos = (c: CambiosMarca) => c.extrasNuevos
  .filter((e) => e.estado === 'propuesto' && e.propuesta && e.propuesta.cantidad !== null)
  .map((e) => ({ modifier_id: e.modifierId, ficha: e.propuesta!.ficha, tipo: e.propuesta!.tipo, cantidad: e.propuesta!.cantidad, unidad: e.propuesta!.unidad }))
