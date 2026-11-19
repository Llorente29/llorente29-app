// src/modules/conta/nucleo/listado/rutas.ts
//
// Q06 · Qué acción de Libros es un listado del núcleo (libros/:area/:accion).
// Las demás siguen en su pantalla de hoy.

import type { QueListado } from './arbol'

export type { QueListado }

const DE_LA_ACCION: Record<string, QueListado> = {
  'libro-mayor': 'mayor',
  'sumas-saldos': 'sumas',
  'diario-resumido': 'diario',
  expedidas: 'emitidas',
  recibidas: 'recibidas',
}

export const queDeLaAccion = (accion: string | undefined): QueListado | null => (accion ? DE_LA_ACCION[accion] ?? null : null)
