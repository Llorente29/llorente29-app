// S01g · Las recepciones de soporte de la liquidación y las filas de «Por
// aclarar» con su acción. Datos inventados: ni proveedores ni cifras reales.
import { describe, expect, it } from 'vitest'
import { boton, etiquetaSoporte, nombreCortoProveedor, type FilaDocumento, type Soporte } from '@/modules/conta/documentos/documentos'
import { estadoDeFila, filasDeLaLista, filtrosDe, opcionesOtras, pestanaDeFila, queEsOtra } from '@/modules/conta/documentos/recibidas'
import { cruceDeLaRecepcion, lineasDeLaRecepcion, resumenDelCruce } from '@/modules/conta/documentos/soporte'
import type { LineaAlbaran, ProductoRelacion } from '@/modules/conta/lib/socioDelMes'

const SOPORTE: Soporte = { proveedor_id: 'p', proveedor: 'SOCIO INVENTADO BRANDS, S.L.', mes: '2026-10', local: 'Local Norte', local_id: 'l', codigo: 'ALB-00001', liquidacion: null }
const fila = (x: Partial<FilaDocumento>): FilaDocumento => ({
  id: 'r1', tipo: 'recepcion', estado: 'soporte', proveedor: { id: 'p', nombre: 'SOCIO INVENTADO BRANDS, S.L.' }, numero: 'FV00000001', fecha: '2026-10-20', total: 163.32,
  canal: 'cocina', confianza: null, porque: null, entendido: null, recepcion: { fecha: '2026-10-20', local: 'Local Norte' }, asiento: null, llego: '2026-10-20T10:00:00Z',
  soporte: SOPORTE, ...x,
})

describe('S01g · la etiqueta de una recepción de soporte', () => {
  it('sin la forma jurídica, sin mayúsculas sostenidas y sin inventar una sigla', () => {
    expect(nombreCortoProveedor('SOCIO INVENTADO BRANDS, S.L.')).toBe('Socio Inventado Brands')
    expect(nombreCortoProveedor('Proveedor Mixto S.A.')).toBe('Proveedor Mixto')
    expect(etiquetaSoporte(SOPORTE)).toBe('Soporte · Socio Inventado Brands · oct 2026 · Local Norte')
  })
  it('va en «Otras», con su etiqueta en el estado, y no en «Por aclarar»', () => {
    const f = fila({})
    expect(pestanaDeFila(f, undefined)).toBe('otras')
    expect(estadoDeFila(f, undefined)).toEqual({ texto: 'Soporte · Socio Inventado Brands · oct 2026 · Local Norte', tono: 'neutro' })
    expect(boton(f)).toEqual({ texto: 'Ver con qué cuadra', principal: false })
  })
  it('el filtro «Qué es» de «Otras» elige entre las etiquetas que hay, y sin él no se esconde ninguna (regla 7)', () => {
    const filas = [fila({}), fila({ id: 'r2', estado: 'repetida', tipo: 'factura', soporte: null }), fila({ id: 'r3', estado: 'para_mirar', tipo: 'factura', soporte: null })]
    expect(opcionesOtras(filas, new Map())).toEqual([{ etiqueta: 'Repetidas', n: 1 }, { etiqueta: 'Soporte · Socio Inventado Brands · oct 2026 · Local Norte', n: 1 }])
    expect(queEsOtra(filas[1])).toBe('Repetidas')
    const otras = filtrosDe(new URLSearchParams('ver=otras'))
    expect(filasDeLaLista(filas, new Map(), otras).map((x) => x.id).sort()).toEqual(['r1', 'r2'])
    const soloSoporte = filtrosDe(new URLSearchParams({ ver: 'otras', que: 'Soporte · Socio Inventado Brands · oct 2026 · Local Norte' }))
    expect(filasDeLaLista(filas, new Map(), soloSoporte).map((x) => x.id)).toEqual(['r1'])
  })
})

describe('S01g · ninguna fila de «Por aclarar» se abre sin una acción que la resuelva (regla 8)', () => {
  it('una llegada sin leer: «Leerla»; sin PDF: «Subir el PDF»; una recepción: «Aclarar»', () => {
    expect(boton(fila({ tipo: 'llegada', estado: 'por_aclarar', porque: 'Recibida, sin leer todavía.', soporte: null }))).toEqual({ texto: 'Leerla', principal: true })
    expect(boton(fila({ tipo: 'llegada', estado: 'por_aclarar', porque: 'Falta el PDF: el correo trae un enlace.', soporte: null }))).toEqual({ texto: 'Subir el PDF', principal: true })
    expect(boton(fila({ tipo: 'recepcion', estado: 'por_aclarar', soporte: null }))).toEqual({ texto: 'Aclarar', principal: true })
  })
})

// La Relación es del MES: 50 ud de pan (dos recepciones: 48 + 2) y 3 Lt de salsa a otro precio.
const RELACION: ProductoRelacion[] = [
  { nombre: 'Pan inventado', precio: 0.62, compras: 50, unidad: 'Uni' },
  { nombre: 'Salsa inventada', precio: 4.75, compras: 3, unidad: 'Lt' },
]
const lin = (albaran: string, articulo: string, nombre: string, dimension: LineaAlbaran['dimension'], cantidadBase: number, importe: number): LineaAlbaran =>
  ({ albaran, articulo, articuloNombre: nombre, producto: nombre, dimension, cantidadBase, importe })
const MES: LineaAlbaran[] = [
  lin('ALB-00001', 'a-pan', 'Pan inventado', 'unit', 48, 29.76),
  lin('ALB-00001', 'a-salsa', 'Salsa inventada', 'volume', 3000, 14.7),
  lin('ALB-00002', 'a-pan', 'Pan inventado', 'unit', 2, 1.24),
]

describe('S01g · con qué liquidación cuadra: lo de esta recepción, lo del mes y lo de la Relación', () => {
  it('la cantidad se compara con la del mes (no con la de una sola recepción); el precio de esta, también', () => {
    const c = cruceDeLaRecepcion('ALB-00001', RELACION, [], MES)
    expect(c.sinRelacion).toBe(false)
    const pan = c.filas.find((f) => f.nombre === 'Pan inventado')!
    expect(pan).toMatchObject({ coincide: true, recepcion: { cantidad: 48, precio: 0.62 }, mes: { cantidad: 50, recepciones: 2 }, relacion: { cantidad: 50, precio: 0.62 } })
    const salsa = c.filas.find((f) => f.nombre === 'Salsa inventada')!
    expect(salsa).toMatchObject({ coincide: false, recepcion: { cantidad: 3, precio: 4.9 } })
    // Lo que no coincide, primero.
    expect(c.filas[0].nombre).toBe('Salsa inventada')
    expect(resumenDelCruce(c)).toBe('1 de 2 coinciden · 1 por aclarar')
  })
  it('sin la Relación no se compara; y lo que trae la recepción sale por línea, en Kg, Lt o ud', () => {
    expect(cruceDeLaRecepcion('ALB-00001', null, [], MES).sinRelacion).toBe(true)
    expect(lineasDeLaRecepcion('ALB-00001', MES)).toEqual([
      { nombre: 'Pan inventado', cantidad: 48, unidad: 'ud', precio: 0.62, importe: 29.76 },
      { nombre: 'Salsa inventada', cantidad: 3, unidad: 'Lt', precio: 4.9, importe: 14.7 },
    ])
  })
})
