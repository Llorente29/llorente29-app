// src/modules/conta/documentos/soporte.ts
//
// S01g · La ficha de una recepción de soporte de la liquidación (maqueta
// «Sumied · S01g», con el visto bueno de Julio): con qué liquidación cuadra y
// si coinciden cantidad y precio, sin React ni red.
//
// La «Relación Compras y Ventas» de la liquidación es del MES: sus cantidades
// son las de todas las recepciones del mes juntas, no las de una. Así que por
// cada producto de esta recepción se enseñan tres cosas: lo que trae ella, lo
// que traen todas las del mes y lo que dice la Relación; y el estado es el del
// mes (cruzarConRelacion, el del socio del mes: una sola vara). El precio sí
// se compara recepción a recepción.
//
// Nada se esconde (regla 7): lo que no coincide sale primero.

import { cruzarConRelacion, type CasadoAMano, type EstadoProducto, type LineaAlbaran, type ProductoRelacion } from '@/modules/conta/lib/socioDelMes'

export interface CantidadPrecio { cantidad: number | null; precio: number | null }

export interface FilaSoporte {
  nombre: string
  /** Kg, Lt o Uni (la de la Relación; si no está en ella, la del artículo). */
  unidad: string
  recepcion: CantidadPrecio & { importe: number }
  /** Todas las recepciones del mes de la liquidación. */
  mes: (CantidadPrecio & { recepciones: number }) | null
  relacion: CantidadPrecio | null
  estado: EstadoProducto
  coincide: boolean
  texto: string
}

export interface CruceDeLaRecepcion {
  filas: FilaSoporte[]
  coinciden: number
  porAclarar: number
  /** La liquidación no trae su «Relación Compras y Ventas»: no se puede comparar. */
  sinRelacion: boolean
}

/**
 * El cruce de una recepción con la Relación de su liquidación: el de todo el
 * mes, quedándose con los productos que trae esta recepción.
 */
export function cruceDeLaRecepcion(codigo: string, relacion: readonly ProductoRelacion[] | null, casados: readonly CasadoAMano[], lineasDelMes: readonly LineaAlbaran[]): CruceDeLaRecepcion {
  if (!relacion) return { filas: [], coinciden: 0, porAclarar: 0, sinRelacion: true }
  const deEsta = lineasDelMes.filter((l) => l.albaran === codigo)
  const esta = cruzarConRelacion(relacion, casados, deEsta)
  const mes = cruzarConRelacion(relacion, casados, lineasDelMes)
  const filas: FilaSoporte[] = esta.filas.filter((f) => f.albaranes).map((f) => {
    const m = mes.filas.find((x) => x.nombre === f.nombre && x.unidad === f.unidad) ?? null
    const estado = m?.estado ?? f.estado
    return {
      nombre: f.nombre, unidad: f.unidad,
      recepcion: { cantidad: f.albaranes!.cantidad, precio: f.albaranes!.precio, importe: f.albaranes!.importe },
      mes: m?.albaranes ? { cantidad: m.albaranes.cantidad, precio: m.albaranes.precio, recepciones: m.albaranes.albaranes.length } : null,
      relacion: m?.relacion ?? f.relacion, estado, coincide: estado === 'coincide', texto: m?.texto ?? f.texto,
    }
  })
  filas.sort((a, b) => Number(a.coincide) - Number(b.coincide) || a.nombre.localeCompare(b.nombre, 'es'))
  const coinciden = filas.filter((f) => f.coincide).length
  return { filas, coinciden, porAclarar: filas.length - coinciden, sinRelacion: false }
}

/** Lo que trae una recepción, sin liquidación con la que compararla: por línea, en Kg, Lt o ud. */
export function lineasDeLaRecepcion(codigo: string | null, lineas: readonly LineaAlbaran[]): { nombre: string; cantidad: number | null; unidad: string; precio: number | null; importe: number }[] {
  return lineas.filter((l) => codigo === null || l.albaran === codigo).map((l) => {
    const unidad = l.dimension === 'weight' ? 'Kg' : l.dimension === 'volume' ? 'Lt' : 'ud'
    const factor = l.dimension === 'weight' || l.dimension === 'volume' ? 1000 : 1
    const cantidad = l.cantidadBase == null ? null : Math.round((l.cantidadBase / factor) * 1000) / 1000
    const importe = l.importe ?? 0
    return { nombre: l.articuloNombre ?? l.producto ?? 'Sin artículo', cantidad, unidad, precio: cantidad ? Math.round((importe / cantidad) * 100) / 100 : null, importe }
  })
}

/** «4 de 6 coinciden · 2 por aclarar» / «Los 6 coinciden». */
export function resumenDelCruce(c: Pick<CruceDeLaRecepcion, 'filas' | 'coinciden' | 'porAclarar'>): string {
  if (c.filas.length === 0) return 'Ningún producto de esta recepción está en la Relación'
  if (c.porAclarar === 0) return c.filas.length === 1 ? 'El producto coincide' : `Los ${c.filas.length} coinciden`
  return `${c.coinciden} de ${c.filas.length} coinciden · ${c.porAclarar} por aclarar`
}
