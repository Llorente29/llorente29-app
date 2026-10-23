// src/modules/conta/documentos/colaRecibidas.ts
//
// D04 · La cola de las facturas recibidas, UNA lectura para los dos que la
// cuentan: la ficha («1 de 77») y la barra (el chip de «Facturas recibidas»).
// Antes la barra contaba con conta_pendientes y la ficha con la lista: dos
// consultas, y Julio veía 99 en la barra y «1 de 77» en la ficha (D03, punto
// 11). Ahora las dos salen de aquí: los documentos de la ventana, sus extras y
// los MISMOS filtros que la lista (filasDeLaLista). Si cuentan cosas distintas
// (la barra suma «por revisar» y «por aclarar»), lo dice su etiqueta.

import { leerDocumentos, leerExtrasFacturas } from '@/modules/conta/services/documentosService'
import { ventanaParaRevisar } from './documentos'
import { colaDeFacturas, filasDeLaLista, filtrosDe, type Filtros } from './recibidas'

/** Las facturas de la cola, en el orden de la lista, con sus filtros (los de la URL de la lista). */
export async function colaRecibidas(accountId: string, companyId: string, desde: string, hasta: string, filtros: Filtros): Promise<string[]> {
  const [cola] = await colasRecibidas(accountId, companyId, desde, hasta, [filtros])
  return cola
}

/** Varias colas de una sola lectura (la barra: «por revisar» y «por aclarar»). */
export async function colasRecibidas(accountId: string, companyId: string, desde: string, hasta: string, filtros: readonly Filtros[]): Promise<string[][]> {
  const d = await leerDocumentos(companyId, desde, hasta)
  const ids = d.filas.filter((x) => x.tipo === 'factura').map((x) => x.id)
  const extras = await leerExtrasFacturas(accountId, ids).catch(() => new Map())
  return filtros.map((f) => colaDeFacturas(filasDeLaLista(d.filas, extras, f)))
}

/** Lo que cuenta la barra: las colas «Por revisar» y «Por aclarar» de serie (la lista sin filtros, últimos 12 meses). */
export async function cuentaRecibidas(accountId: string, companyId: string, hoy: string): Promise<{ porRevisar: number; porAclarar: number }> {
  const { desde, hasta } = ventanaParaRevisar(hoy)
  const [revisar, aclarar] = await colasRecibidas(accountId, companyId, desde, hasta, [
    filtrosDe(new URLSearchParams('ver=por-revisar')),
    filtrosDe(new URLSearchParams('ver=por-aclarar')),
  ])
  return { porRevisar: revisar.length, porAclarar: aclarar.length }
}
